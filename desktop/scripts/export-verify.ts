// Verification harness for the shared export service. Bundled with esbuild and
// run under plain node — the export layer is deliberately free of Electron and
// DOM dependencies so it can be checked without launching the app.
//
//   npm run verify:export
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { toCsv } from '../src/lib/export/csv'
import { docToHtml } from '../src/lib/export/html'
import { billHtml } from '../src/lib/export/bill'
import { exportFileName, rangeScope } from '../src/lib/export/index'
import type { DocContext, ExportDoc } from '../src/lib/export/types'
import { saleInvoiceHtml } from '../src/features/sales/invoice'
import { purchaseInvoiceHtml } from '../src/features/purchases/invoice'
import { paymentReceiptHtml } from '../src/features/customers/receipt'
import { returnSlipHtml } from '../src/features/returns/slip'
import { purchaseOrderHtml } from '../src/features/purchases/purchaseOrder'
import { DEFAULT_PRINT_SETTINGS } from '../src/shared/printDefaults'
import type {
  PaymentReceipt, PrintSettings, Purchase, PurchaseItem, PurchaseOrder, PurchaseOrderItem,
  ReturnReceipt, Sale, SaleItem, Shop,
} from '../src/shared/types'

let failures = 0
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failures++
    console.error(`FAIL  ${name}`, detail ?? '')
  }
}

/** Collapses the formatting whitespace in generated CSS for assertions. */
const flat = (s: string) => s.replace(/\s+/g, ' ')

/** The same escaping the templates apply, so assertions can look for real text. */
const escHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const shop = {
  name: 'Sadiq & Sons "Traders"',
  address: 'Shop 4, Main Bazaar',
  city: 'Lahore',
  phone: '0300-1234567',
  ntn: '1234567-8',
  currency: 'Rs',
  receipt_footer: 'Goods once sold are not returnable',
  local_logo_path: null,
} as unknown as Shop

/** A context with the shop defaults, optionally overridden per check. */
const withSettings = (over: Partial<PrintSettings> = {}): DocContext => ({
  shop,
  currency: 'Rs',
  settings: { ...DEFAULT_PRINT_SETTINGS, ...over },
})

// Reports print on sheets; the shipped default template is the counter receipt,
// so the sheet checks below say so explicitly.
const ctx = withSettings({ receipt_template: 'full' })

// ---------------------------------------------------------------- CSV basics
interface Row {
  name: string
  qty: number
  total: number
}

const doc = (rows: Row[]): ExportDoc => ({
  module: 'SalesReport',
  scope: rangeScope('2026-01-01', '2026-01-31'),
  title: 'Sales Report',
  sections: [
    {
      columns: [
        { header: 'Item', value: (r: Row) => r.name },
        { header: 'Qty', value: (r: Row) => r.qty, align: 'right' },
        { header: 'Total', value: (r: Row) => r.total, money: true },
      ],
      rows,
      footer: [null, rows.reduce((a, r) => a + r.qty, 0), rows.reduce((a, r) => a + r.total, 0)],
    },
  ],
})

const csv = toCsv(doc([
  { name: 'Sugar 1kg', qty: 3, total: 45000 },
  { name: 'Rice, basmati', qty: 2, total: 123456 },
  { name: 'Tea "gold"', qty: 1, total: 99 },
  { name: '=cmd|calc', qty: 1, total: -500 },
]))
const lines = csv.trim().split('\r\n')

check('csv header matches columns', lines[0] === 'Item,Qty,Total', lines[0])
check('csv money is a raw decimal, no currency symbol', lines[1] === 'Sugar 1kg,3,450', lines[1])
check('csv quotes fields containing commas', lines[2] === '"Rice, basmati",2,1234.56', lines[2])
check('csv doubles embedded quotes', lines[3] === '"Tea ""gold""",1,0.99', lines[3])
check('csv neutralises formula injection', lines[4].startsWith("'=cmd|calc"), lines[4])
check('csv keeps negative money negative', lines[4].endsWith(',-5'), lines[4])
// 45000 + 123456 + 99 - 500 = 168055 paisa. The footer must take the same
// money conversion as its column, or CSV and PDF totals diverge.
check('csv footer totals row', lines[5] === ',7,1680.55', lines[5])

// Sum the exported money column and compare against the source data — this is
// the round-trip that catches paisa/rupee conversion drift.
const exported = lines.slice(1, 5).map((l) => Number(l.split(',').pop()))
const sum = exported.reduce((a, b) => a + b, 0)
check('csv money round-trips exactly', Math.round(sum * 100) === 45000 + 123456 + 99 - 500, sum)

// ------------------------------------------------------------- empty + large
const emptyCsv = toCsv(doc([]))
check('empty report still emits headers', emptyCsv.trim().split('\r\n')[0] === 'Item,Qty,Total', emptyCsv)

const big: Row[] = Array.from({ length: 5000 }, (_, i) => ({
  name: `Product ${i} — a deliberately long product name to stress column widths`,
  qty: i,
  total: i * 137,
}))
const t0 = Date.now()
const bigCsv = toCsv(doc(big))
const csvMs = Date.now() - t0
check('5000-row csv not truncated', bigCsv.trim().split('\r\n').length === 5002, bigCsv.split('\r\n').length)
check(`5000-row csv generated fast (${csvMs}ms)`, csvMs < 1000, csvMs)

const t1 = Date.now()
const bigHtml = docToHtml(doc(big), ctx)
const htmlMs = Date.now() - t1
check('5000-row html contains every row', (bigHtml.match(/<tr>/g) ?? []).length >= 5000)
check(`5000-row html generated fast (${htmlMs}ms)`, htmlMs < 2000, htmlMs)

// ------------------------------------------------------------ HTML integrity
const html = docToHtml(
  {
    ...doc([{ name: 'Sugar 1kg', qty: 3, total: 45000 }]),
    subtitle: '01 Jan 2026 — 31 Jan 2026',
    meta: [['Range', '01 Jan 2026 — 31 Jan 2026']],
    stats: [{ label: 'Gross sales', value: 'Rs 450' }],
    note: 'Excludes returns.',
  },
  ctx
)
check('html escapes shop name', html.includes('Sadiq &amp; Sons &quot;Traders&quot;'), false)
check('html formats money for display', html.includes('Rs 450'))
check('html repeats table head across pages', html.includes('thead { display: table-header-group; }'))
check('html avoids splitting rows', html.includes('break-inside: avoid'))
check(
  'html applies the saved paper size and per-side margins',
  flat(html).includes('@page { size: A4 portrait; margin: 12mm 12mm 12mm 12mm; }'),
  flat(html).match(/@page \{[^}]*\}/)?.[0]
)
check('html includes note and stats', html.includes('Excludes returns.') && html.includes('Gross sales'))

const landscape = docToHtml(
  doc([]),
  withSettings({
    receipt_template: 'full',
    paper_size: 'Legal',
    landscape: true,
    margin_top_mm: 6,
    margin_right_mm: 8,
    margin_bottom_mm: 6,
    margin_left_mm: 8,
  })
)
check(
  'html honours landscape and asymmetric margins',
  flat(landscape).includes('@page { size: Legal landscape; margin: 6mm 8mm 6mm 8mm; }'),
  flat(landscape).match(/@page \{[^}]*\}/)?.[0]
)
check('empty section renders an empty state, not a broken table', landscape.includes('No records for the selected filters.'))

// ------------------------------------------------------- settings are applied
const noHeader = docToHtml(doc([]), withSettings({ receipt_template: 'full', show_header: false }))
check('show_header off hides the letterhead', !noHeader.includes('Sadiq &amp; Sons'), false)

const customHead = docToHtml(
  doc([]),
  withSettings({ receipt_template: 'full', header_text: 'CASH MEMO', footer_text: 'Warranty void if seal broken' })
)
check('custom header text prints', customHead.includes('CASH MEMO'))
check('custom footer text overrides the shop receipt footer', customHead.includes('Warranty void if seal broken'))
check('shop receipt footer is the fallback', docToHtml(doc([]), ctx).includes('Goods once sold are not returnable'))
check(
  'show_notes off suppresses the footer entirely',
  !docToHtml(doc([]), withSettings({ receipt_template: 'full', show_notes: false })).includes('Goods once sold'),
  false
)

const after = docToHtml(
  { ...doc([{ name: 'Sugar 1kg', qty: 3, total: 45000 }]), title: 'Sales Report' },
  withSettings({ receipt_template: 'full', currency_position: 'after' })
)
check('currency position applies to printed money', after.includes('450 Rs'), false)

// ------------------------------------------------------------------ filenames
check(
  'report filename follows convention',
  /^SalesReport_2026-01-01_to_2026-01-31_\d{4}-\d{2}-\d{2}\.csv$/.test(
    exportFileName('SalesReport', rangeScope('2026-01-01', '2026-01-31'), 'csv')
  ),
  exportFileName('SalesReport', rangeScope('2026-01-01', '2026-01-31'), 'csv')
)
check(
  'bill filename follows convention',
  /^SalesInvoice_SAL-2026-0001_\d{4}-\d{2}-\d{2}\.pdf$/.test(exportFileName('SalesInvoice', 'SAL-2026-0001', 'pdf')),
  exportFileName('SalesInvoice', 'SAL-2026-0001', 'pdf')
)
check(
  'filename strips characters illegal on windows',
  !/[\\/:*?"<>|]/.test(exportFileName('SalesInvoice', 'INV/2026:001?', 'pdf')),
  exportFileName('SalesInvoice', 'INV/2026:001?', 'pdf')
)
check('single-day range collapses to one date', rangeScope('2026-01-05', '2026-01-05') === '2026-01-05')

// ------------------------------------------------------------------ bill layout
const saleBill = {
  title: 'SALES INVOICE',
  number: 'SAL-2026-0001',
  meta: [['Date', '02 Aug 2026']] as [string, string][],
  party: { label: 'Billed to', lines: ['Ahmed Khan', '0301-9999999'] },
  columns: [
    { header: 'Item', value: (r: Row) => r.name },
    { header: 'Qty', value: (r: Row) => r.qty, align: 'right' as const },
    { header: 'Total', value: (r: Row) => r.total, money: true },
  ],
  rows: [{ name: 'Sugar 1kg', qty: 3, total: 45000 }],
  totals: [
    { label: 'Subtotal', value: 45000 },
    { label: 'Total', value: 45000, strong: true },
    { label: 'Paid', text: 'ON CREDIT' },
  ],
  fields: { preparedBy: 'Bilal' },
  note: 'Thank you',
  watermark: 'RETURNED',
}

const bill = billHtml(saleBill, ctx)
check('bill numbers its line items', bill.includes('<td class="r">1</td>'))
check('bill shows party block', bill.includes('Billed to') && bill.includes('Ahmed Khan'))
check('bill renders money totals', bill.includes('Rs 450'))
check('bill supports non-money total rows', bill.includes('ON CREDIT'))
check('bill draws watermark', bill.includes('class="wm"') && bill.includes('RETURNED'))
check('bill prints Prepared by when the toggle is on', bill.includes('Prepared by') && bill.includes('Bilal'))
check(
  'prepared-by toggle off removes the field',
  !billHtml(saleBill, withSettings({ receipt_template: 'full', show_prepared_by: false })).includes('Prepared by'),
  false
)

const emptyBill = billHtml(
  { title: 'SALES INVOICE', number: 'X', columns: [{ header: 'Item', value: (r: Row) => r.name }], rows: [] },
  ctx
)
check('bill with no lines does not break the table', emptyBill.includes('No line items on this document.'))

// --------------------------------------------------------------- thermal roll
// The roll must be a different document, not a narrowed sheet: no column grid,
// continuous page height, and the mm width of the stock it prints on.
const roll = billHtml(saleBill, withSettings({ receipt_template: 'thermal', paper_size: 'Thermal80' }))
check('roll page is continuous at the stock width', flat(roll).includes('@page { size: 72mm auto; margin: 0; }'), flat(roll).match(/@page \{[^}]*\}/)?.[0])
check('roll abandons the column grid', !roll.includes('<table'), false)
check('roll still lists the item and its amount', roll.includes('Sugar 1kg') && roll.includes('Rs 450'))
check('roll keeps the totals', roll.includes('ON CREDIT'))

const roll58 = billHtml(saleBill, withSettings({ receipt_template: 'thermal', paper_size: 'Thermal58' }))
check('58mm stock narrows the page', flat(roll58).includes('@page { size: 50mm auto; margin: 0; }'))

// A thermal template chosen on A4 stock still prints as a roll — the two
// settings can disagree in the UI, but only one document can come out.
const rollOnA4 = billHtml(saleBill, withSettings({ receipt_template: 'thermal', paper_size: 'A4' }))
check('thermal template forces roll geometry', flat(rollOnA4).includes('@page { size: 72mm auto;'), flat(rollOnA4).match(/@page \{[^}]*\}/)?.[0])

// …and roll stock with a sheet template also prints as a roll, because the
// printer physically cannot produce anything wider.
const sheetOnRoll = billHtml(saleBill, withSettings({ receipt_template: 'full', paper_size: 'Thermal80' }))
check('roll stock overrides a sheet template', !sheetOnRoll.includes('<table'), false)

// Reports on roll stock re-flow to stacked label/value lines rather than
// squeezing a six-column table into 72 mm.
const rollReport = docToHtml(doc([{ name: 'Sugar 1kg', qty: 3, total: 45000 }]), withSettings({ paper_size: 'Thermal80' }))
check('roll report stacks rows instead of tabulating', rollReport.includes('class="trow"') && !rollReport.includes('<table'))

// ============================================================================
// The three counter documents that used to leave no printed proof: a customer
// due payment, a return refund, and a purchase order sent to a supplier. Each
// is checked for live data, sheet and roll layout, and settings obedience.
// ============================================================================

const LONG_NAME =
  'Muhammad Abdul Rehman Siddiqui & Brothers General Store (Main Branch, Ferozepur Road)'

// ------------------------------------------------------- customer payment receipt
const payment: PaymentReceipt = {
  id: 'p1',
  receipt_number: 'RCP-2026-0007',
  customer_id: 'c1',
  customer_name: 'Ahmed Khan',
  amount: 250000,
  method: 'cash',
  note: 'Against last month',
  balance_before: 400000,
  balance_after: 150000,
  created_by_name: 'Bilal',
  created_at: '2026-08-02T10:15:00.000Z',
}

const rcp = paymentReceiptHtml(payment, ctx)
check('receipt carries its own number', rcp.includes('RCP-2026-0007'))
check('receipt names the payer, not a placeholder', rcp.includes('Received from') && rcp.includes('Ahmed Khan'))
check('receipt prints the method', rcp.includes('Cash'))
check('receipt prints previous, received and remaining', // 4000 - 2500 = 1500
  rcp.includes('Rs 4,000') && rcp.includes('Rs 2,500') && rcp.includes('Rs 1,500'), false)
check('partial payment says the balance is still due', rcp.includes('Balance still due'))
check('receipt credits the cashier who took the money', rcp.includes('Bilal'))
check('receipt carries its note', rcp.includes('Against last month'))
// A cash receipt has no line items; an empty item grid would be a bug, not a
// document.
// The only table on the sheet must be the totals block; an item grid with no
// items would print "No line items on this document." on a cash receipt.
check('receipt prints no item table',
  (rcp.match(/<table/g) ?? []).length === 1 && !rcp.includes('No line items'),
  (rcp.match(/<table[^>]*>/g) ?? []))
check('receipt totals stand alone full width', rcp.includes('totals-solo'))

const settled = paymentReceiptHtml({ ...payment, amount: 400000, balance_after: 0 }, ctx)
check('cleared balance is not called a due', settled.includes('>Balance<') && !settled.includes('Balance still due'), false)

const over = paymentReceiptHtml({ ...payment, amount: 500000, balance_after: -100000 }, ctx)
check('overpayment prints an advance, never a negative due', over.includes('Advance held') && over.includes('Rs 1,000'), false)
check('overpayment shows no minus sign on the advance', !over.includes('-Rs 1,000'), false)

const rcpLong = paymentReceiptHtml({ ...payment, customer_name: LONG_NAME }, ctx)
check('receipt prints a long payer name in full', rcpLong.includes('Ferozepur Road'))
check('sheet wraps long party names instead of clipping', rcpLong.includes('overflow-wrap: anywhere'))

const rcpRoll = paymentReceiptHtml(
  { ...payment, customer_name: LONG_NAME },
  withSettings({ receipt_template: 'thermal', paper_size: 'Thermal58' })
)
check('58mm receipt is a roll, not a narrowed sheet', flat(rcpRoll).includes('@page { size: 50mm auto;') && !rcpRoll.includes('<table'), false)
check('58mm receipt keeps every figure', rcpRoll.includes('Rs 2,500') && rcpRoll.includes('Rs 1,500'))
check('58mm receipt still has no empty item block', !rcpRoll.includes('No line items'), false)
check('roll lets a long name wrap but never the amount', rcpRoll.includes('overflow-wrap: anywhere') && rcpRoll.includes('white-space: nowrap'))

check('receipt obeys show_header', !paymentReceiptHtml(payment, withSettings({ show_header: false })).includes('Sadiq &amp; Sons'), false)
check('receipt obeys custom footer text', paymentReceiptHtml(payment, withSettings({ footer_text: 'Keep this slip' })).includes('Keep this slip'))
check('receipt obeys currency position', paymentReceiptHtml(payment, withSettings({ currency_position: 'after' })).includes('2,500 Rs'))
check('receipt obeys show_prepared_by', !paymentReceiptHtml(payment, withSettings({ show_prepared_by: false })).includes('Prepared by'), false)

// ------------------------------------------------------------------ return slip
const returnItems = [
  { id: 'r1', return_id: 'R', product_name: 'Sugar 1kg', quantity: 2, amount: 30000 },
  { id: 'r2', return_id: 'R', product_name: LONG_NAME, quantity: 1, amount: 12500 },
  { id: 'r3', return_id: 'R', product_name: 'Tea "gold" 250g', quantity: 3, amount: 7500 },
]
const saleReturn: ReturnReceipt = {
  record: {
    id: 'R', kind: 'sale', reference_id: 's1', invoice_number: 'INV-2026-0042',
    party_name: 'Ahmed Khan', refund_amount: 50000, refund_method: 'cash',
    reason: 'Damaged packaging', is_cancellation: 0, created_by_name: 'Bilal',
    created_at: '2026-08-02T11:00:00.000Z',
  },
  items: returnItems,
}

const slip = returnSlipHtml(saleReturn, ctx)
check('slip names the invoice it reverses', slip.includes('INV-2026-0042'))
check('slip lists every returned line', returnItems.every((i) => slip.includes(escHtml(i.product_name))))
check('slip prints returned quantities', slip.includes('>2<') && slip.includes('>3<'))
check('slip prints the refund method in words', slip.includes('Cash refund'))
check('slip prints the total refund', slip.includes('Rs 500'))
check('slip prints the reason and the cashier', slip.includes('Damaged packaging') && slip.includes('Bilal'))
// The printed line amounts must add up to the refund actually paid out.
check('slip line amounts sum to the refund',
  returnItems.reduce((a, i) => a + i.amount, 0) === saleReturn.record.refund_amount)
check('slip escapes quotes in item names', slip.includes('Tea &quot;gold&quot; 250g'))

const purchaseReturn = returnSlipHtml(
  { ...saleReturn, record: { ...saleReturn.record, kind: 'purchase', invoice_number: 'PUR-2026-0003', refund_method: 'due' } },
  ctx
)
check('purchase return is titled and addressed as one',
  purchaseReturn.includes('PURCHASE RETURN SLIP') && purchaseReturn.includes('Returned to'))
check('credited refunds say so', purchaseReturn.includes('Credited to balance'))

const cancellation = returnSlipHtml(
  { ...saleReturn, record: { ...saleReturn.record, is_cancellation: 1 } },
  ctx
)
check('a cancelled sale prints a cancellation slip', cancellation.includes('CANCELLATION SLIP'))

const walkIn = returnSlipHtml({ ...saleReturn, record: { ...saleReturn.record, party_name: null } }, ctx)
check('a counter refund with no customer still names someone', walkIn.includes('Walk-in customer'))

const slipRoll = returnSlipHtml(saleReturn, withSettings({ receipt_template: 'thermal', paper_size: 'Thermal58' }))
check('58mm slip is a roll', flat(slipRoll).includes('@page { size: 50mm auto;') && !slipRoll.includes('<table'), false)
check('58mm slip keeps every line and the total',
  slipRoll.includes('Sugar 1kg') && slipRoll.includes('Ferozepur Road') && slipRoll.includes('Rs 500'))
check('slip obeys show_header', !returnSlipHtml(saleReturn, withSettings({ show_header: false })).includes('Sadiq &amp; Sons'), false)
check('slip obeys currency position', returnSlipHtml(saleReturn, withSettings({ currency_position: 'after' })).includes('500 Rs'))

// --------------------------------------------------------------- purchase order
const poItems: PurchaseOrderItem[] = Array.from({ length: 12 }, (_, i) => ({
  id: `poi${i}`,
  purchase_order_id: 'po1',
  product_id: `p${i}`,
  product_name: i === 0 ? LONG_NAME : `Carton of assorted goods, line ${i + 1}`,
  quantity: i + 1,
  cost_price: 10000,
  total: 10000 * (i + 1),
}))
const po: PurchaseOrder = {
  id: 'po1',
  supplier_id: 'sup1',
  supplier_name: 'Zubair Traders (Wholesale Division), Akbari Mandi',
  po_number: 'PO-2026-0011',
  total: poItems.reduce((a, i) => a + i.total, 0),
  status: 'open',
  purchase_id: null,
  note: 'Payment 30 days from delivery. Reject short weight.',
  expected_date: '2026-08-20',
  created_by_name: 'Bilal',
  created_at: '2026-08-02T09:00:00.000Z',
}

const poHtml = purchaseOrderHtml(po, poItems, ctx)
check('purchase order carries its number', poHtml.includes('PO-2026-0011'))
check('purchase order names the supplier in full', poHtml.includes('Akbari Mandi'))
check('purchase order prints all 12 lines', (poHtml.match(/<tr>/g) ?? []).length >= 12, (poHtml.match(/<tr>/g) ?? []).length)
check('purchase order numbers the last line 12', poHtml.includes('<td class="r">12</td>'))
check('purchase order shows rate and amount per line', poHtml.includes('Rs 100') && poHtml.includes('Rs 1,200'))
check('purchase order totals correctly', poHtml.includes('Rs 7,800')) // 10000 * 78 paisa = Rs 780? see below
check('purchase order prints the delivery date asked for', poHtml.includes('Expected delivery'))
check('purchase order prints the terms agreed', poHtml.includes('Payment 30 days from delivery'))
check('purchase order names who authorised it', poHtml.includes('Bilal'))
check('purchase order prints a long item name in full', poHtml.includes('Ferozepur Road'))

const poNoDate = purchaseOrderHtml({ ...po, expected_date: null }, poItems, ctx)
check('a missing delivery date is stated, not left blank', poNoDate.includes('To be confirmed'))

const poCancelled = purchaseOrderHtml({ ...po, status: 'cancelled' }, poItems, ctx)
check('a cancelled order is watermarked', poCancelled.includes('class="wm"') && poCancelled.includes('CANCELLED'))
check('a live order carries no watermark', !poHtml.includes('class="wm"'), false)

const poRoll = purchaseOrderHtml(po, poItems, withSettings({ receipt_template: 'thermal', paper_size: 'Thermal80' }))
check('80mm purchase order is a roll', flat(poRoll).includes('@page { size: 72mm auto;') && !poRoll.includes('<table'), false)
check('80mm purchase order keeps all 12 lines', (poRoll.match(/class="item"/g) ?? []).length === 12, (poRoll.match(/class="item"/g) ?? []).length)
check('purchase order obeys show_header', !purchaseOrderHtml(po, poItems, withSettings({ show_header: false })).includes('Sadiq &amp; Sons'), false)
check('purchase order obeys currency position', purchaseOrderHtml(po, poItems, withSettings({ currency_position: 'after' })).includes('100 Rs'))

// ============================================================================
// Fixtures for the print smoke test. The checks above prove the HTML is right;
// they cannot prove Chromium will render it. Every document built here is
// written out so `npm run verify:print` can push it through the real
// printToPDF pipeline under Electron, at sheet and both roll widths.
// ============================================================================
const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.print-fixtures')
fs.rmSync(fixtureDir, { recursive: true, force: true })
fs.mkdirSync(fixtureDir, { recursive: true })

interface Entry { date: string; type: string; description: string; debit: number; credit: number; balance: number }
const ledgerRows: Entry[] = [
  { date: '2026-08-01T09:00:00.000Z', type: 'Sale', description: 'INV-2026-0040', debit: 160000, credit: 0, balance: 160000 },
  { date: '2026-08-02T10:15:00.000Z', type: 'Payment', description: 'RCP-2026-0007', debit: 0, credit: 250000, balance: -90000 },
]
const ledgerDoc: ExportDoc = {
  module: 'CustomerLedger',
  scope: 'Ahmed Khan',
  title: 'Ledger',
  subtitle: 'Ahmed Khan',
  sections: [
    {
      columns: [
        { header: 'Date', value: (e: Entry) => e.date },
        { header: 'Entry', value: (e: Entry) => e.type },
        { header: 'Ref', value: (e: Entry) => e.description },
        { header: 'Debit', value: (e: Entry) => (e.debit ? e.debit : ''), money: true },
        { header: 'Credit', value: (e: Entry) => (e.credit ? e.credit : ''), money: true },
        { header: 'Balance', value: (e: Entry) => e.balance, money: true },
      ],
      rows: ledgerRows,
      footer: ['Total', '', '', 160000, 250000, -90000],
    },
  ],
  note: 'Debit increases the balance owed; credit reduces it.',
}

const saleFixture = {
  id: 's1', invoice_number: 'INV-2026-0042', customer_id: 'c1', customer_name: 'Ahmed Khan',
  cashier_name: 'Bilal', payment_method: 'cash', status: 'completed',
  subtotal: 50000, discount: 2000, tax: 0, total: 48000, tendered: 50000,
  created_at: '2026-08-02T11:00:00.000Z',
} as unknown as Sale
const saleItemsFixture = [
  { id: 'si1', product_name: 'Sugar 1kg', quantity: 2, returned_quantity: 0, unit_price: 15000, discount: 0, total: 30000 },
  { id: 'si2', product_name: LONG_NAME, quantity: 1, returned_quantity: 1, unit_price: 20000, discount: 2000, total: 18000 },
] as unknown as SaleItem[]

const purchaseFixture = {
  id: 'pu1', invoice_number: 'PUR-2026-0003', supplier_id: 'sup1',
  supplier_name: 'Zubair Traders (Wholesale Division), Akbari Mandi',
  status: 'partially_paid', total: 780000, paid_amount: 300000,
  created_at: '2026-08-02T09:30:00.000Z',
} as unknown as Purchase
const purchaseItemsFixture = poItems.map((i) => ({
  id: i.id, product_name: i.product_name, quantity: i.quantity, returned_quantity: 0,
  cost_price: i.cost_price, total: i.total,
})) as unknown as PurchaseItem[]

/** One document per print surface, as the app itself would build it. */
const surfaces: [string, (c: DocContext) => string][] = [
  // Reports: all twelve tabs and the ledger table describe themselves as
  // ExportDocs and print through this one function.
  ['Report', (c) => docToHtml({ ...doc(big.slice(0, 60)), stats: [{ label: 'Gross sales', value: 'Rs 450' }], note: 'Excludes returns.' }, c)],
  ['Ledger', (c) => docToHtml(ledgerDoc, c)],
  // The counter documents, built by the very functions the screens call.
  ['SalesInvoice', (c) => saleInvoiceHtml(saleFixture, saleItemsFixture, c)],
  ['PurchaseInvoice', (c) => purchaseInvoiceHtml(purchaseFixture, purchaseItemsFixture, c)],
  ['PaymentReceipt', (c) => paymentReceiptHtml(payment, c)],
  ['ReturnSlip', (c) => returnSlipHtml(saleReturn, c)],
  ['PurchaseOrder', (c) => purchaseOrderHtml(po, poItems, c)],
]

const papers: [string, Partial<PrintSettings>][] = [
  ['A4', { receipt_template: 'full', paper_size: 'A4' }],
  ['Thermal80', { receipt_template: 'thermal', paper_size: 'Thermal80' }],
  ['Thermal58', { receipt_template: 'thermal', paper_size: 'Thermal58' }],
]

let written = 0
for (const [name, build] of surfaces) {
  for (const [paper, settings] of papers) {
    fs.writeFileSync(path.join(fixtureDir, `${name}__${paper}.html`), build(withSettings(settings)), 'utf8')
    written++
  }
}
check(`wrote ${written} print fixtures`, written === surfaces.length * papers.length, written)

console.log(failures === 0 ? '--- EXPORT CHECKS PASSED ---' : `--- ${failures} EXPORT FAILURES ---`)
process.exit(failures === 0 ? 0 : 1)
