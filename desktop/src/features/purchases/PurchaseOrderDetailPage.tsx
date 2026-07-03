import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Ban, PackageCheck } from 'lucide-react'
import { api } from '../../lib/ipc'
import { formatMoney, toPaisa } from '../../lib/money'
import { formatDateTime } from '../../lib/utils'
import { useCurrency } from '../../stores/auth'
import type { Purchase, PurchaseOrder, PurchaseOrderItem } from '../../shared/types'
import {
  Button, Card, ConfirmDialog, Field, Input, Modal, PageTitle, Select, Spinner,
} from '../../components/ui'
import { toast } from '../../components/ui/toast'
import { poStatusBadge } from './PurchasesPage'

export function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const currency = useCurrency()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [paid, setPaid] = useState('')
  const [method, setMethod] = useState<'cash' | 'card'>('cash')

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: () => api<{ order: PurchaseOrder; items: PurchaseOrderItem[] }>('purchaseOrders:get', { id }),
    enabled: !!id,
  })

  const receive = useMutation({
    mutationFn: () =>
      api<Purchase>('purchaseOrders:receive', {
        id,
        paid_amount: paid === '' ? 0 : toPaisa(paid) || 0,
        method,
      }),
    onSuccess: (purchase) => {
      toast.success(`Received — purchase ${purchase.invoice_number} created, stock updated`)
      void qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      void qc.invalidateQueries({ queryKey: ['purchases'] })
      void qc.invalidateQueries({ queryKey: ['products'] })
      void qc.invalidateQueries({ queryKey: ['suppliers'] })
      navigate(`/purchases/${purchase.id}`)
    },
    onError: (e) => toast.error(e.message),
  })

  const cancel = useMutation({
    mutationFn: () => api('purchaseOrders:cancel', { id }),
    onSuccess: () => {
      setCancelOpen(false)
      toast.success('Purchase order cancelled')
      void qc.invalidateQueries({ queryKey: ['purchase-order', id] })
      void qc.invalidateQueries({ queryKey: ['purchase-orders'] })
    },
    onError: (e) => toast.error(e.message),
  })

  if (isLoading || !data) return <Spinner />
  const { order, items } = data
  const paidPaisa = paid === '' ? 0 : toPaisa(paid) || 0

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/purchases" className="mb-3 inline-flex items-center gap-1 text-muted hover:text-ink">
        <ArrowLeft size={15} /> Back to purchases
      </Link>
      <PageTitle
        actions={
          order.status === 'open' ? (
            <>
              <Button variant="secondary" onClick={() => setCancelOpen(true)}>
                <Ban size={16} /> Cancel order
              </Button>
              <Button onClick={() => setReceiveOpen(true)}>
                <PackageCheck size={16} /> Receive
              </Button>
            </>
          ) : order.purchase_id ? (
            <Link to={`/purchases/${order.purchase_id}`}>
              <Button variant="secondary">View purchase invoice</Button>
            </Link>
          ) : undefined
        }
      >
        {order.po_number}
      </PageTitle>

      <Card className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <div>
          <div className="text-xs text-muted">Date</div>
          <div className="mt-1 font-medium">{formatDateTime(order.created_at)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Supplier</div>
          <div className="mt-1 font-medium">{order.supplier_name ?? '—'}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Status</div>
          <div className="mt-1">{poStatusBadge(order.status)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Total</div>
          <div className="mt-1 font-medium">{formatMoney(order.total, currency)}</div>
        </div>
      </Card>

      <Card className="mb-4 overflow-x-auto p-0">
        <table className="w-full text-left">
          <thead className="bg-slate-50 text-xs uppercase text-muted">
            <tr>
              <th className="px-4 py-3">Item</th>
              <th className="px-4 py-3 text-right">Qty</th>
              <th className="px-4 py-3 text-right">Unit cost</th>
              <th className="px-4 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-t border-line">
                <td className="px-4 py-2.5 font-medium">{i.product_name}</td>
                <td className="px-4 py-2.5 text-right">{i.quantity}</td>
                <td className="px-4 py-2.5 text-right">{formatMoney(i.cost_price, currency)}</td>
                <td className="px-4 py-2.5 text-right font-medium">{formatMoney(i.total, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {order.note && (
        <Card className="mb-4">
          <div className="text-xs text-muted">Note</div>
          <div className="mt-1">{order.note}</div>
        </Card>
      )}

      <Modal open={receiveOpen} onClose={() => setReceiveOpen(false)} title={`Receive ${order.po_number}`}>
        <p className="mb-4 text-sm text-muted">
          Receiving creates a purchase invoice: stock comes in and any unpaid amount goes to the
          supplier&apos;s due.
        </p>
        <div className="mb-4 flex justify-between text-lg font-bold">
          <span>Total</span>
          <span>{formatMoney(order.total, currency)}</span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Paid now">
            <Input
              type="number" step="0.01" min="0" autoFocus
              value={paid}
              onChange={(e) => setPaid(e.target.value)}
              placeholder="0.00"
              className="text-right"
            />
          </Field>
          <Field label="Method">
            <Select value={method} onChange={(e) => setMethod(e.target.value as 'cash' | 'card')}>
              <option value="cash">Cash</option>
              <option value="card">Card / bank</option>
            </Select>
          </Field>
        </div>
        {order.total - paidPaisa > 0 && (
          <div className="mt-3 flex justify-between rounded-md bg-amber-50 px-3 py-2 text-sm">
            <span className="text-muted">Added to supplier due</span>
            <span className="font-semibold text-warning">{formatMoney(order.total - paidPaisa, currency)}</span>
          </div>
        )}
        {paidPaisa > order.total && (
          <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-danger">
            Paid amount exceeds the order total.
          </div>
        )}
        <div className="mt-6 flex justify-between">
          <Button variant="secondary" onClick={() => setReceiveOpen(false)}>Cancel</Button>
          <Button
            onClick={() => receive.mutate()}
            loading={receive.isPending}
            disabled={paidPaisa > order.total}
          >
            Receive &amp; create invoice
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => cancel.mutate()}
        title="Cancel purchase order"
        message={`Cancel ${order.po_number}? The order never affected stock, so nothing else changes.`}
        confirmLabel="Cancel order"
        danger
        loading={cancel.isPending}
      />
    </div>
  )
}
