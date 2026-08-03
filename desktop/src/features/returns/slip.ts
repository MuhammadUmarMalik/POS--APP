// Describes a return event for the shared bill layout. A refund puts cash back
// across the counter or knocks money off a balance, so it needs the same
// printed proof a sale does — and it is described once here, for both the slip
// printed at the moment of the return and any later reprint from Returns.
import { billHtml, type BillDoc, type DocContext } from '../../lib/export'
import { formatDateTime } from '../../lib/utils'
import type { ReturnItem, ReturnReceipt } from '../../shared/types'

const REFUND_LABEL: Record<ReturnReceipt['record']['refund_method'], string> = {
  cash: 'Cash refund',
  due: 'Credited to balance',
}

export function returnSlipHtml(receipt: ReturnReceipt, ctx: DocContext): string {
  const r = receipt.record
  const sale = r.kind === 'sale'

  const bill: BillDoc<ReturnItem> = {
    title: r.is_cancellation ? 'CANCELLATION SLIP' : sale ? 'SALES RETURN SLIP' : 'PURCHASE RETURN SLIP',
    // A return has no number of its own; the invoice it reverses is what both
    // sides of the counter will look it up by.
    number: `Against ${r.invoice_number}`,
    meta: [
      ['Date', formatDateTime(r.created_at)],
      ['Original invoice', r.invoice_number],
      ['Refund method', REFUND_LABEL[r.refund_method]],
    ],
    party: {
      label: sale ? 'Returned by' : 'Returned to',
      lines: [r.party_name ?? (sale ? 'Walk-in customer' : '—')],
    },
    columns: [
      { header: 'Item', value: (i) => i.product_name },
      { header: 'Qty returned', value: (i) => i.quantity, align: 'right' },
      { header: 'Amount', value: (i) => i.amount, money: true },
    ],
    rows: receipt.items,
    totals: [
      { label: 'Refund method', text: REFUND_LABEL[r.refund_method] },
      { label: 'Total refund', value: r.refund_amount, strong: true },
    ],
    fields: { preparedBy: r.created_by_name ?? null, notes: r.reason },
  }

  return billHtml(bill, ctx)
}
