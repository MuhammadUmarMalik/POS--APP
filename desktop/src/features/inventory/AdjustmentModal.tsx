import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/ipc'
import type { ProductWithStock } from '../../shared/types'
import { ADJUSTMENT_REASONS, type AdjustmentReason } from '../../shared/schemas'
import { Button, Field, Input, Modal, Select } from '../../components/ui'
import { toast } from '../../components/ui/toast'

export function AdjustmentModal({
  product,
  onClose,
}: {
  product: ProductWithStock
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [direction, setDirection] = useState<'add' | 'remove'>('remove')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState<AdjustmentReason>('correction')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const quantity = parseInt(qty) || 0
  const change = direction === 'add' ? quantity : -quantity
  const newStock = product.stock + change

  // "Expired" cannot add stock and "Opening stock" cannot remove it, so the list
  // only offers what the chosen direction can honestly mean.
  const wanted = direction === 'add' ? 'in' : 'out'
  const reasons = ADJUSTMENT_REASONS.filter((r) => r.sign === 'both' || r.sign === wanted)

  const switchDirection = (next: 'add' | 'remove') => {
    setDirection(next)
    const allowed = next === 'add' ? 'in' : 'out'
    const stillValid = ADJUSTMENT_REASONS.find((r) => r.value === reason)
    if (stillValid && stillValid.sign !== 'both' && stillValid.sign !== allowed) setReason('correction')
  }

  const submit = async () => {
    if (quantity <= 0) {
      toast.warning('Enter a quantity')
      return
    }
    if (newStock < 0) {
      toast.error(`Stock cannot go below zero (current: ${product.stock})`)
      return
    }
    setSubmitting(true)
    try {
      await api('inventory:adjust', {
        product_id: product.id,
        quantity_change: change,
        reason,
        note: note.trim() || undefined,
      })
      toast.success(`Stock adjusted: ${product.name} ${change > 0 ? '+' : ''}${change}`)
      void qc.invalidateQueries({ queryKey: ['products'] })
      void qc.invalidateQueries({ queryKey: ['movements', product.id] })
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Adjust stock — ${product.name}`}>
      <div className="mb-4 flex justify-between rounded-md bg-slate-50 px-4 py-3">
        <span className="text-muted">Current stock</span>
        <span className="font-bold">{product.stock} {product.unit}</span>
      </div>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => switchDirection('remove')}
            className={direction === 'remove'
              ? 'rounded-md border-2 border-danger bg-red-50 py-2.5 font-medium text-danger'
              : 'rounded-md border border-line py-2.5 text-muted'}
          >
            − Remove stock
          </button>
          <button
            onClick={() => switchDirection('add')}
            className={direction === 'add'
              ? 'rounded-md border-2 border-success bg-green-50 py-2.5 font-medium text-success'
              : 'rounded-md border border-line py-2.5 text-muted'}
          >
            + Add stock
          </button>
        </div>
        <Field label="Quantity" required>
          <Input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
        </Field>
        <Field label="Reason" required>
          <Select value={reason} onChange={(e) => setReason(e.target.value as AdjustmentReason)}>
            {reasons.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional details" />
        </Field>
        {quantity > 0 && (
          <div className="flex justify-between rounded-md bg-slate-50 px-4 py-2">
            <span className="text-muted">New stock</span>
            <span className={`font-bold ${newStock < 0 ? 'text-danger' : ''}`}>{newStock} {product.unit}</span>
          </div>
        )}
        <div className="flex justify-between pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={submitting}>Save adjustment</Button>
        </div>
      </div>
    </Modal>
  )
}
