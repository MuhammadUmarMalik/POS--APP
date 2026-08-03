import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/ipc'
import { formatMoney, toPaisa, toRupees } from '../../lib/money'
import { formatDateTime } from '../../lib/utils'
import { useCurrency } from '../../stores/auth'
import { useDocContext, usePrinter } from '../../lib/export'
import type { Customer, PaymentReceipt } from '../../shared/types'
import { Button, Field, Input, Modal, Select } from '../../components/ui'
import { ExportBar } from '../../components/ExportBar'
import { toast } from '../../components/ui/toast'
import { paymentReceiptHtml } from './receipt'

export function ReceivePaymentModal({
  customer,
  onClose,
}: {
  customer: Customer
  onClose: () => void
}) {
  const currency = useCurrency()
  const qc = useQueryClient()
  const ctx = useDocContext()
  const { print } = usePrinter()
  const [amount, setAmount] = useState(String(toRupees(customer.due_balance)))
  const [method, setMethod] = useState<'cash' | 'card'>('cash')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Once the money is taken the form is gone: what is left is a receipt to
  // print, not an entry to edit.
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null)

  const amountPaisa = toPaisa(amount) || 0

  // Same rule as the counter: print unprompted only if the shop asked for it,
  // and say so out loud when the printer refuses. The payment is already
  // recorded either way — the receipt can still be printed by hand below.
  const autoPrint = async (r: PaymentReceipt) => {
    if (!ctx.settings.auto_print_on_save) return
    try {
      await print(paymentReceiptHtml(r, ctx), ctx.settings, { silent: true })
    } catch (e) {
      toast.error(`Receipt not printed: ${(e as Error).message}. Print it from this window.`)
    }
  }

  const submit = async () => {
    if (amountPaisa <= 0) {
      toast.warning('Enter a valid amount')
      return
    }
    setSubmitting(true)
    try {
      const saved = await api<PaymentReceipt>('customers:receivePayment', {
        party_id: customer.id,
        amount: amountPaisa,
        method,
        note: note.trim() || undefined,
      })
      toast.success(`Received ${formatMoney(saved.amount, currency)} from ${saved.customer_name}`)
      void qc.invalidateQueries({ queryKey: ['customers'] })
      void qc.invalidateQueries({ queryKey: ['customer', customer.id] })
      setReceipt(saved)
      void autoPrint(saved)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (receipt) {
    return (
      <Modal open onClose={onClose} title={`Receipt ${receipt.receipt_number}`}>
        <div className="mb-4 rounded-md bg-emerald-50 px-4 py-3">
          <div className="text-xs text-muted">Received from {receipt.customer_name}</div>
          <div className="mt-1 text-2xl font-bold text-success">
            {formatMoney(receipt.amount, currency)}
          </div>
        </div>
        <dl className="mb-5 space-y-2 text-sm">
          <Row label="Method" value={receipt.method === 'cash' ? 'Cash' : 'Card / bank'} />
          <Row label="Previous balance" value={formatMoney(receipt.balance_before, currency)} />
          <Row
            label={receipt.balance_after < 0 ? 'Advance held' : 'Balance still due'}
            value={formatMoney(Math.abs(receipt.balance_after), currency)}
          />
          <Row label="Date" value={formatDateTime(receipt.created_at)} />
          <Row label="Received by" value={receipt.created_by_name ?? '—'} />
          {receipt.note && <Row label="Note" value={receipt.note} />}
        </dl>
        <div className="flex items-center justify-between border-t border-line pt-4">
          <ExportBar
            module="PaymentReceipt"
            scope={receipt.receipt_number}
            buildHtml={(docCtx) => paymentReceiptHtml(receipt, docCtx)}
          />
          <Button onClick={onClose}>Done</Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open onClose={onClose} title={`Receive payment — ${customer.name}`}>
      <div className="mb-4 flex justify-between rounded-md bg-red-50 px-4 py-3">
        <span className="text-muted">Current due</span>
        <span className="font-bold text-danger">{formatMoney(customer.due_balance, currency)}</span>
      </div>
      <div className="space-y-4">
        <Field label="Amount received" required>
          <Input
            type="number" step="0.01" min="0" autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="text-right text-lg font-semibold"
          />
        </Field>
        <Field label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value as 'cash' | 'card')}>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
          </Select>
        </Field>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>
        {amountPaisa > 0 && (
          <div className="flex justify-between rounded-md bg-slate-50 px-4 py-2 text-sm">
            <span className="text-muted">Remaining due after payment</span>
            <span className="font-semibold">{formatMoney(customer.due_balance - amountPaisa, currency)}</span>
          </div>
        )}
        <div className="flex justify-between pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="success" onClick={submit} loading={submitting}>Receive payment</Button>
        </div>
      </div>
    </Modal>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  )
}
