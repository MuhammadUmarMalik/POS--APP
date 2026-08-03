// Describes a purchase for the shared bill layout. As with sales, this is the
// only description of a purchase document: the shop's chosen template decides
// whether it prints as a sheet invoice or a roll receipt.
import { billHtml, type BillDoc, type DocContext } from '../../lib/export'
import { formatDateTime } from '../../lib/utils'
import type { Purchase, PurchaseItem } from '../../shared/types'

export function purchaseInvoiceHtml(
  purchase: Purchase,
  items: PurchaseItem[],
  ctx: DocContext
): string {
  const balance = purchase.total - purchase.paid_amount

  const bill: BillDoc<PurchaseItem> = {
    title: 'PURCHASE INVOICE',
    number: purchase.invoice_number,
    meta: [
      ['Date', formatDateTime(purchase.created_at)],
      ['Status', purchase.status.replace(/_/g, ' ').toUpperCase()],
    ],
    party: { label: 'Supplier', lines: [purchase.supplier_name ?? '—'] },
    columns: [
      { header: 'Item', value: (i) => i.product_name },
      { header: 'Qty', value: (i) => i.quantity, align: 'right' },
      { header: 'Returned', value: (i) => i.returned_quantity || '', align: 'right' },
      { header: 'Unit cost', value: (i) => i.cost_price, money: true },
      { header: 'Total', value: (i) => i.total, money: true },
    ],
    rows: items,
    totals: [
      { label: 'Total', value: purchase.total, strong: true },
      { label: 'Paid', value: purchase.paid_amount },
      { label: balance > 0 ? 'Balance payable' : 'Balance', value: balance },
    ],
    // A purchase has no cashier of its own, so Prepared by prints as a blank
    // line to sign when the shop has that toggle on.
    fields: { preparedBy: null, notes: null },
    watermark: purchase.status === 'returned' ? 'RETURNED' : undefined,
  }

  return billHtml(bill, ctx)
}
