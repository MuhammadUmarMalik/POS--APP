import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/ipc'
import { formatMoney, toPaisa, toRupees } from '../../lib/money'
import { useCurrency } from '../../stores/auth'
import type { Customer } from '../../shared/types'
import { Button, Field, Input, Modal, Select } from '../../components/ui'
import { toast } from '../../components/ui/toast'

export function ReceivePaymentModal({
  customer,
  onClose,
}: {
  customer: Customer
  onClose: () => void
}) {
  const currency = useCurrency()
  const qc = useQueryClient()
  const [amount, setAmount] = useState(String(toRupees(customer.due_balance)))
  const [method, setMethod] = useState<'cash' | 'card'>('cash')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const amountPaisa = toPaisa(amount) || 0

  const submit = async () => {
    if (amountPaisa <= 0) {
      toast.warning('Enter a valid amount')
      return
    }
    setSubmitting(true)
    try {
      await api('customers:receivePayment', {
        party_id: customer.id,
        amount: amountPaisa,
        method,
        note: note.trim() || undefined,
      })
      toast.success(`Received ${formatMoney(amountPaisa, currency)} from ${customer.name}`)
      void qc.invalidateQueries({ queryKey: ['customers'] })
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
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
