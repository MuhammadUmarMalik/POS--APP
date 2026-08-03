// Describes a sale for the shared bill layout. This is the only description of
// a sales document in the app: the counter receipt, the reprint and the PDF all
// render from it, and the shop's chosen template (full / thermal / compact)
// decides what it looks like.
import { billHtml, type BillDoc, type DocContext } from '../../lib/export'
import { formatDateTime } from '../../lib/utils'
import type { Sale, SaleItem } from '../../shared/types'

function saleBill(sale: Sale, items: SaleItem[]): BillDoc<SaleItem> {
  const meta: [string, string][] = [
    ['Date', formatDateTime(sale.created_at)],
    ['Cashier', sale.cashier_name ?? '—'],
    ['Payment', sale.payment_method.toUpperCase()],
    ['Status', sale.status.toUpperCase()],
  ]

  const totals = [
    { label: 'Subtotal', value: sale.subtotal },
    ...(sale.discount > 0 ? [{ label: 'Discount', value: -sale.discount }] : []),
    ...(sale.tax > 0 ? [{ label: 'Tax', value: sale.tax }] : []),
    { label: 'Total', value: sale.total, strong: true },
    {
      label: 'Paid',
      text: sale.payment_method === 'credit' ? 'ON CREDIT' : undefined,
      value: sale.payment_method === 'credit' ? undefined : (sale.tendered ?? sale.total),
    },
    ...(sale.tendered != null ? [{ label: 'Change', value: sale.tendered - sale.total }] : []),
  ]

  return {
    title: 'SALES INVOICE',
    number: sale.invoice_number,
    meta,
    party: { label: 'Billed to', lines: [sale.customer_name ?? 'Walk-in customer'] },
    columns: [
      { header: 'Item', value: (i) => i.product_name },
      { header: 'Qty', value: (i) => i.quantity, align: 'right' },
      { header: 'Returned', value: (i) => i.returned_quantity || '', align: 'right' },
      { header: 'Price', value: (i) => i.unit_price, money: true },
      { header: 'Discount', value: (i) => (i.discount ? i.discount : ''), money: true },
      { header: 'Total', value: (i) => i.total, money: true },
    ],
    rows: items,
    totals,
    // Shown only where the shop has turned these fields on; the footer note is
    // resolved from the print settings by the template.
    fields: { preparedBy: sale.cashier_name, notes: null },
    watermark: sale.status === 'returned' ? 'RETURNED' : undefined,
  }
}

export function saleInvoiceHtml(sale: Sale, items: SaleItem[], ctx: DocContext): string {
  return billHtml(saleBill(sale, items), ctx)
}
