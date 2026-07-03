import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { api } from '../../lib/ipc'
import { formatMoney } from '../../lib/money'
import { formatDateTime } from '../../lib/utils'
import { useCurrency } from '../../stores/auth'
import type { Paged, Purchase, PurchaseOrder } from '../../shared/types'
import { Badge, Button, Card, EmptyState, Input, PageTitle, Spinner } from '../../components/ui'

const PAGE_SIZE = 25

export function purchaseStatusBadge(status: Purchase['status']) {
  if (status === 'completed') return <Badge tone="green">Completed</Badge>
  if (status === 'partially_returned') return <Badge tone="amber">Partial return</Badge>
  return <Badge tone="red">Returned</Badge>
}

export function poStatusBadge(status: PurchaseOrder['status']) {
  if (status === 'open') return <Badge tone="blue">Open</Badge>
  if (status === 'received') return <Badge tone="green">Received</Badge>
  return <Badge tone="slate">Cancelled</Badge>
}

export function PurchasesPage() {
  const currency = useCurrency()
  const [tab, setTab] = useState<'invoices' | 'orders'>('invoices')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['purchases', search, page],
    queryFn: () =>
      api<Paged<Purchase>>('purchases:list', {
        search: search || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    enabled: tab === 'invoices',
  })
  const { data: orders, isLoading: ordersLoading } = useQuery({
    queryKey: ['purchase-orders', search, page],
    queryFn: () =>
      api<Paged<PurchaseOrder>>('purchaseOrders:list', {
        search: search || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    enabled: tab === 'orders',
  })

  const activeTotal = tab === 'invoices' ? data?.total : orders?.total
  const pages = Math.max(1, Math.ceil((activeTotal ?? 0) / PAGE_SIZE))

  return (
    <div>
      <PageTitle
        actions={
          <Link to="/purchases/new">
            <Button><Plus size={16} /> New purchase</Button>
          </Link>
        }
      >
        Purchases
      </PageTitle>

      <Card className="mb-4 flex items-center gap-3 p-3">
        <div className="flex gap-1 rounded-md bg-slate-100 p-1">
          {(
            [
              ['invoices', 'Invoices'],
              ['orders', 'Purchase orders'],
            ] as const
          ).map(([t, label]) => (
            <button
              key={t}
              onClick={() => { setTab(t); setPage(1) }}
              className={
                tab === t
                  ? 'rounded bg-surface px-3 py-1.5 text-sm font-medium shadow-sm'
                  : 'rounded px-3 py-1.5 text-sm font-medium text-muted hover:text-ink'
              }
            >
              {label}
            </button>
          ))}
        </div>
        <Input
          placeholder={tab === 'invoices' ? 'Search invoice # or supplier…' : 'Search PO # or supplier…'}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          className="max-w-sm"
        />
      </Card>

      {tab === 'orders' && (
        <Card className="overflow-x-auto p-0">
          {ordersLoading ? (
            <Spinner />
          ) : !orders || orders.rows.length === 0 ? (
            <EmptyState message='No purchase orders yet. Use "Save as purchase order" on the New purchase screen.' />
          ) : (
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">PO #</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {orders.rows.map((o) => (
                  <tr key={o.id} className="border-t border-line hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <Link to={`/purchases/orders/${o.id}`} className="font-medium text-primary hover:underline">
                        {o.po_number}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-muted">{formatDateTime(o.created_at)}</td>
                    <td className="px-4 py-2.5">{o.supplier_name}</td>
                    <td className="px-4 py-2.5">{poStatusBadge(o.status)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold">{formatMoney(o.total, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {tab === 'invoices' && (
      <Card className="overflow-x-auto p-0">
        {isLoading ? (
          <Spinner />
        ) : !data || data.rows.length === 0 ? (
          <EmptyState message="No purchases recorded yet." />
        ) : (
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3 text-right">Due</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((p) => (
                <tr key={p.id} className="border-t border-line hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <Link to={`/purchases/${p.id}`} className="font-medium text-primary hover:underline">
                      {p.invoice_number}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{formatDateTime(p.created_at)}</td>
                  <td className="px-4 py-2.5">{p.supplier_name}</td>
                  <td className="px-4 py-2.5">{purchaseStatusBadge(p.status)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold">{formatMoney(p.total, currency)}</td>
                  <td className="px-4 py-2.5 text-right text-muted">{formatMoney(p.paid_amount, currency)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {p.total - p.paid_amount > 0 ? (
                      <span className="font-medium text-warning">{formatMoney(p.total - p.paid_amount, currency)}</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      )}

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-3">
          <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-xs text-muted">Page {page} of {pages}</span>
          <Button variant="secondary" size="sm" disabled={page === pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  )
}
