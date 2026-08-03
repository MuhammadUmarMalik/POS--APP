// Describes a purchase order for the shared bill layout. Unlike the other
// documents in the app this one leaves the building: it is what the supplier
// receives, so it carries the delivery date asked for, the terms agreed and the
// name of whoever authorised it.
import { billHtml, type BillDoc, type DocContext } from '../../lib/export'
import { formatDateTime } from '../../lib/utils'
import type { PurchaseOrder, PurchaseOrderItem } from '../../shared/types'

/** ISO date (YYYY-MM-DD) in the machine's locale, without inventing a time. */
function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString()
}

export function purchaseOrderHtml(
  order: PurchaseOrder,
  items: PurchaseOrderItem[],
  ctx: DocContext
): string {
  const bill: BillDoc<PurchaseOrderItem> = {
    title: 'PURCHASE ORDER',
    number: order.po_number,
    meta: [
      ['Date', formatDateTime(order.created_at)],
      ['Expected delivery', order.expected_date ? formatDate(order.expected_date) : 'To be confirmed'],
      ['Status', order.status.toUpperCase()],
    ],
    party: { label: 'Supplier', lines: [order.supplier_name ?? '—'] },
    columns: [
      { header: 'Item', value: (i) => i.product_name },
      { header: 'Qty', value: (i) => i.quantity, align: 'right' },
      { header: 'Rate', value: (i) => i.cost_price, money: true },
      { header: 'Amount', value: (i) => i.total, money: true },
    ],
    rows: items,
    totals: [{ label: 'Order total', value: order.total, strong: true }],
    // The order's note is the terms agreed with the supplier, and the user who
    // raised it is the authorising name — both belong on the supplier's copy.
    fields: { preparedBy: order.created_by_name ?? null, notes: order.note },
    // A cancelled order must never be mistaken for a live one in a supplier's
    // paperwork.
    watermark: order.status === 'cancelled' ? 'CANCELLED' : undefined,
  }

  return billHtml(bill, ctx)
}
