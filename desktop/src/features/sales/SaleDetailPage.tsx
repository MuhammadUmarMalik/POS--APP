import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Ban, Printer, Undo2 } from 'lucide-react'
import { api } from '../../lib/ipc'
import { formatMoney } from '../../lib/money'
import { formatDateTime } from '../../lib/utils'
import { useAuth, useCurrency, useSession } from '../../stores/auth'
import type { Payment, Sale, SaleItem } from '../../shared/types'
import { Button, Card, ConfirmDialog, PageTitle, Spinner } from '../../components/ui'
import { toast } from '../../components/ui/toast'
import { receiptHtml } from './receipt'
import { saleStatusBadge } from './SalesPage'
import { ReturnModal } from './ReturnModal'

export function SaleDetailPage() {
  const { id } = useParams<{ id: string }>()
  const currency = useCurrency()
  const session = useSession()
  const shop = useAuth((s) => s.state?.shop)
  const qc = useQueryClient()
  const [returnOpen, setReturnOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['sale', id],
    queryFn: () => api<{ sale: Sale; items: SaleItem[]; payments: Payment[] }>('sales:get', { id }),
    enabled: !!id,
  })

  const cancelSale = useMutation({
    mutationFn: () => api('sales:cancel', { id }),
    onSuccess: () => {
      setCancelOpen(false)
      toast.success('Sale cancelled — stock restored and payment reversed')
      void qc.invalidateQueries({ queryKey: ['sale', id] })
      void qc.invalidateQueries({ queryKey: ['sales'] })
      void qc.invalidateQueries({ queryKey: ['products'] })
    },
    onError: (e) => toast.error(e.message),
  })

  if (isLoading || !data) return <Spinner />
  const { sale, items } = data

  const reprint = async () => {
    if (!shop) return
    try {
      await api('print:html', { html: receiptHtml({ shop, sale, items }) })
      toast.success('Receipt sent to printer')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const returnable = items.some((i) => i.quantity > i.returned_quantity)

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/sales" className="mb-3 inline-flex items-center gap-1 text-muted hover:text-ink">
        <ArrowLeft size={15} /> Back to sales
      </Link>
      <PageTitle
        actions={
          <>
            <Button variant="secondary" onClick={reprint}>
              <Printer size={16} /> Reprint
            </Button>
            {session?.role === 'admin' && returnable && (
              <>
                <Button variant="secondary" onClick={() => setReturnOpen(true)}>
                  <Undo2 size={16} /> Return items
                </Button>
                <Button variant="danger" onClick={() => setCancelOpen(true)}>
                  <Ban size={16} /> Cancel sale
                </Button>
              </>
            )}
          </>
        }
      >
        {sale.invoice_number}
      </PageTitle>

      <Card className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Info label="Date" value={formatDateTime(sale.created_at)} />
        <Info label="Cashier" value={sale.cashier_name ?? '—'} />
        <Info label="Customer" value={sale.customer_name ?? 'Walk-in'} />
        <div>
          <div className="text-xs text-muted">Status</div>
          <div className="mt-1">{saleStatusBadge(sale.status)}</div>
        </div>
      </Card>

      <Card className="mb-4 overflow-x-auto p-0">
        <table className="w-full text-left">
          <thead className="bg-slate-50 text-xs uppercase text-muted">
            <tr>
              <th className="px-4 py-3">Item</th>
              <th className="px-4 py-3 text-right">Qty</th>
              <th className="px-4 py-3 text-right">Returned</th>
              <th className="px-4 py-3 text-right">Price</th>
              <th className="px-4 py-3 text-right">Discount</th>
              <th className="px-4 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-t border-line">
                <td className="px-4 py-2.5 font-medium">{i.product_name}</td>
                <td className="px-4 py-2.5 text-right">{i.quantity}</td>
                <td className="px-4 py-2.5 text-right text-danger">{i.returned_quantity || ''}</td>
                <td className="px-4 py-2.5 text-right">{formatMoney(i.unit_price, currency)}</td>
                <td className="px-4 py-2.5 text-right">{i.discount ? formatMoney(i.discount, currency) : '—'}</td>
                <td className="px-4 py-2.5 text-right font-medium">{formatMoney(i.total, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="ml-auto max-w-sm space-y-1.5">
        <Row label="Subtotal" value={formatMoney(sale.subtotal, currency)} />
        {sale.discount > 0 && <Row label="Discount" value={`-${formatMoney(sale.discount, currency)}`} />}
        {sale.tax > 0 && <Row label="Tax" value={formatMoney(sale.tax, currency)} />}
        <div className="flex justify-between border-t border-line pt-2 text-lg font-bold">
          <span>Total</span>
          <span>{formatMoney(sale.total, currency)}</span>
        </div>
        <Row label="Payment" value={sale.payment_method.toUpperCase()} />
        {sale.tendered != null && (
          <>
            <Row label="Tendered" value={formatMoney(sale.tendered, currency)} />
            <Row label="Change" value={formatMoney(sale.tendered - sale.total, currency)} />
          </>
        )}
      </Card>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => cancelSale.mutate()}
        title="Cancel sale"
        message={`Cancel ${sale.invoice_number}? All items return to stock and ${
          sale.payment_method === 'credit' ? "the amount is removed from the customer's due" : 'the payment is refunded in cash'
        }. This cannot be undone.`}
        confirmLabel="Cancel sale"
        danger
        loading={cancelSale.isPending}
      />
      {returnOpen && (
        <ReturnModal
          sale={sale}
          items={items}
          onClose={() => setReturnOpen(false)}
          onDone={() => {
            setReturnOpen(false)
            void qc.invalidateQueries({ queryKey: ['sale', id] })
            void qc.invalidateQueries({ queryKey: ['sales'] })
          }}
        />
      )}
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted">
      <span>{label}</span>
      <span className="text-ink">{value}</span>
    </div>
  )
}
