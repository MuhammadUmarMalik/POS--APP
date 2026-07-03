import { useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Undo2 } from 'lucide-react'
import { api } from '../../lib/ipc'
import { formatMoney } from '../../lib/money'
import { formatDateTime } from '../../lib/utils'
import { useCurrency } from '../../stores/auth'
import type { Payment, Purchase, PurchaseItem } from '../../shared/types'
import { Button, Card, Field, Input, Modal, PageTitle, Select, Spinner } from '../../components/ui'
import { toast } from '../../components/ui/toast'
import { purchaseStatusBadge } from './PurchasesPage'

export function PurchaseDetailPage() {
  const { id } = useParams<{ id: string }>()
  const currency = useCurrency()
  const qc = useQueryClient()
  const [returnOpen, setReturnOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['purchase', id],
    queryFn: () =>
      api<{ purchase: Purchase; items: PurchaseItem[]; payments: Payment[] }>('purchases:get', { id }),
    enabled: !!id,
  })

  if (isLoading || !data) return <Spinner />
  const { purchase, items } = data
  const returnable = items.some((i) => i.quantity > i.returned_quantity)

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/purchases" className="mb-3 inline-flex items-center gap-1 text-muted hover:text-ink">
        <ArrowLeft size={15} /> Back to purchases
      </Link>
      <PageTitle
        actions={
          returnable && (
            <Button variant="danger" onClick={() => setReturnOpen(true)}>
              <Undo2 size={16} /> Return items
            </Button>
          )
        }
      >
        {purchase.invoice_number}
      </PageTitle>

      <Card className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <div>
          <div className="text-xs text-muted">Date</div>
          <div className="mt-1 font-medium">{formatDateTime(purchase.created_at)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Supplier</div>
          <div className="mt-1 font-medium">{purchase.supplier_name}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Status</div>
          <div className="mt-1">{purchaseStatusBadge(purchase.status)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Paid / Total</div>
          <div className="mt-1 font-medium">
            {formatMoney(purchase.paid_amount, currency)} / {formatMoney(purchase.total, currency)}
          </div>
        </div>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-left">
          <thead className="bg-slate-50 text-xs uppercase text-muted">
            <tr>
              <th className="px-4 py-3">Item</th>
              <th className="px-4 py-3 text-right">Qty</th>
              <th className="px-4 py-3 text-right">Returned</th>
              <th className="px-4 py-3 text-right">Unit cost</th>
              <th className="px-4 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-t border-line">
                <td className="px-4 py-2.5 font-medium">{i.product_name}</td>
                <td className="px-4 py-2.5 text-right">{i.quantity}</td>
                <td className="px-4 py-2.5 text-right text-danger">{i.returned_quantity || ''}</td>
                <td className="px-4 py-2.5 text-right">{formatMoney(i.cost_price, currency)}</td>
                <td className="px-4 py-2.5 text-right font-medium">{formatMoney(i.total, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {returnOpen && (
        <PurchaseReturnModal
          purchase={purchase}
          items={items}
          onClose={() => setReturnOpen(false)}
          onDone={() => {
            setReturnOpen(false)
            void qc.invalidateQueries({ queryKey: ['purchase', id] })
            void qc.invalidateQueries({ queryKey: ['purchases'] })
            void qc.invalidateQueries({ queryKey: ['products'] })
          }}
        />
      )}
    </div>
  )
}

function PurchaseReturnModal({
  purchase,
  items,
  onClose,
  onDone,
}: {
  purchase: Purchase
  items: PurchaseItem[]
  onClose: () => void
  onDone: () => void
}) {
  const currency = useCurrency()
  const [qtys, setQtys] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')
  const [refundMethod, setRefundMethod] = useState<'cash' | 'due'>('due')
  const [submitting, setSubmitting] = useState(false)

  const returnable = items.filter((i) => i.quantity > i.returned_quantity)
  const estimate = useMemo(
    () => returnable.reduce((a, i) => a + i.cost_price * (qtys[i.id] ?? 0), 0),
    [returnable, qtys]
  )

  const submit = async () => {
    const selected = returnable
      .filter((i) => (qtys[i.id] ?? 0) > 0)
      .map((i) => ({ purchase_item_id: i.id, quantity: qtys[i.id] }))
    if (selected.length === 0) return toast.warning('Select at least one item')
    setSubmitting(true)
    try {
      await api('purchases:return', {
        purchase_id: purchase.id,
        reason: reason.trim() || 'Returned to supplier',
        refund_method: refundMethod,
        items: selected,
      })
      toast.success('Purchase return processed — stock reduced')
      onDone()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Return to supplier — ${purchase.invoice_number}`} wide>
      <table className="mb-4 w-full text-left">
        <thead className="text-xs uppercase text-muted">
          <tr>
            <th className="py-2">Item</th>
            <th className="py-2 text-right">Bought</th>
            <th className="py-2 text-right">Already returned</th>
            <th className="py-2 text-right">Return qty</th>
          </tr>
        </thead>
        <tbody>
          {returnable.map((i) => {
            const max = i.quantity - i.returned_quantity
            return (
              <tr key={i.id} className="border-t border-line">
                <td className="py-2 font-medium">{i.product_name}</td>
                <td className="py-2 text-right">{i.quantity}</td>
                <td className="py-2 text-right text-muted">{i.returned_quantity}</td>
                <td className="py-2 text-right">
                  <input
                    type="number" min={0} max={max} value={qtys[i.id] ?? 0}
                    onChange={(e) =>
                      setQtys((prev) => ({
                        ...prev,
                        [i.id]: Math.min(max, Math.max(0, parseInt(e.target.value) || 0)),
                      }))
                    }
                    className="w-20 rounded-md border border-line px-2 py-1 text-right focus:border-primary focus:outline-none"
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="mb-4 grid grid-cols-2 gap-4">
        <Field label="Reason" required>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. damaged on arrival" />
        </Field>
        <Field label="Refund via" required>
          <Select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value as 'cash' | 'due')}>
            <option value="due">Reduce what we owe supplier</option>
            <option value="cash">Cash back from supplier</option>
          </Select>
        </Field>
      </div>

      <div className="mb-4 flex justify-between rounded-md bg-slate-50 px-4 py-3 font-semibold">
        <span>Return value</span>
        <span>{formatMoney(estimate, currency)}</span>
      </div>

      <div className="flex justify-between">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={submit} loading={submitting} disabled={estimate === 0}>
          Process return
        </Button>
      </div>
    </Modal>
  )
}
