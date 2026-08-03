// Describes a customer due payment for the shared bill layout. This is the
// shop's cash receipt: the only proof the customer walks away with that money
// was handed over against their balance, so it is described here once and
// rendered through whichever template the shop chose, exactly like a sales
// invoice.
import { billHtml, type BillDoc, type DocContext } from '../../lib/export'
import { formatDateTime } from '../../lib/utils'
import type { PaymentReceipt } from '../../shared/types'

const METHOD_LABEL: Record<PaymentReceipt['method'], string> = {
  cash: 'Cash',
  card: 'Card / bank',
}

export function paymentReceiptHtml(receipt: PaymentReceipt, ctx: DocContext): string {
  // A payment has no line items — the amount is the document. Declaring no
  // columns tells the template to print the figures alone instead of an empty
  // item grid.
  const bill: BillDoc<never> = {
    title: 'PAYMENT RECEIPT',
    number: receipt.receipt_number,
    meta: [
      ['Date', formatDateTime(receipt.created_at)],
      ['Method', METHOD_LABEL[receipt.method]],
    ],
    party: { label: 'Received from', lines: [receipt.customer_name] },
    columns: [],
    rows: [],
    totals: [
      { label: 'Previous balance', value: receipt.balance_before },
      { label: 'Amount received', value: receipt.amount, strong: true },
      // An overpayment leaves the shop holding the customer's money. Printing
      // that as a negative "due" would read as the customer still owing.
      receipt.balance_after < 0
        ? { label: 'Advance held', value: -receipt.balance_after }
        : { label: receipt.balance_after > 0 ? 'Balance still due' : 'Balance', value: receipt.balance_after },
    ],
    // Prepared by carries the real cashier; the payment note is the shop's own
    // reference for this receipt, so it prints as the document's note.
    fields: { preparedBy: receipt.created_by_name, notes: receipt.note },
  }

  return billHtml(bill, ctx)
}
