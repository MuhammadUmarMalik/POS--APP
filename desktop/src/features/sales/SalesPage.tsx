import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../../lib/ipc'
import { formatMoney } from '../../lib/money'
import { formatDateTime, rangeFromInputs, todayInput } from '../../lib/utils'
import { useCurrency } from '../../stores/auth'
import type { Paged, Sale } from '../../shared/types'
import { Badge, Button, Card, EmptyState, Input, PageTitle, Select, Spinner } from '../../components/ui'

export function saleStatusBadge(status: Sale['status']) {
  if (status === 'completed') return <Badge tone="green">Completed</Badge>
  if (status === 'partially_returned') return <Badge tone="amber">Partial return</Badge>
  return <Badge tone="red">Returned</Badge>
}

const PAGE_SIZE = 25

export function SalesPage() {
  const currency = useCurrency()
  const [from, setFrom] = useState(todayInput())
  const [to, setTo] = useState(todayInput())
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['sales', from, to, status, search, page],
    queryFn: () =>
      api<Paged<Sale>>('sales:list', {
        ...rangeFromInputs(from, to),
        status: status || undefined,
        search: search || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
  })

  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE))

  return (
    <div>
      <PageTitle>Sales</PageTitle>
      <Card className="mb-4 flex flex-wrap items-end gap-3 p-3">
        <label className="text-xs text-muted">
          From
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} className="mt-1" />
        </label>
        <label className="text-xs text-muted">
          To
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} className="mt-1" />
        </label>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className="max-w-40">
          <option value="">All statuses</option>
          <option value="completed">Completed</option>
          <option value="partially_returned">Partial return</option>
          <option value="returned">Returned</option>
        </Select>
        <Input
          placeholder="Invoice # or customer…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          className="max-w-56"
        />
      </Card>

      <Card className="overflow-x-auto p-0">
        {isLoading ? (
          <Spinner />
        ) : !data || data.rows.length === 0 ? (
          <EmptyState message="No sales in this range." />
        ) : (
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Cashier</th>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((s) => (
                <tr key={s.id} className="border-t border-line hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <Link to={`/sales/${s.id}`} className="font-medium text-primary hover:underline">
                      {s.invoice_number}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{formatDateTime(s.created_at)}</td>
                  <td className="px-4 py-2.5">{s.customer_name ?? 'Walk-in'}</td>
                  <td className="px-4 py-2.5 text-muted">{s.cashier_name}</td>
                  <td className="px-4 py-2.5 capitalize text-muted">{s.payment_method}</td>
                  <td className="px-4 py-2.5">{saleStatusBadge(s.status)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold">{formatMoney(s.total, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-3">
          <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="text-xs text-muted">Page {page} of {pages}</span>
          <Button variant="secondary" size="sm" disabled={page === pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
