import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../../lib/ipc'
import { formatMoney } from '../../lib/money'
import { formatDateTime } from '../../lib/utils'
import { useCurrency } from '../../stores/auth'
import type { Paged, ReturnRecord } from '../../shared/types'
import { Badge, Button, Card, EmptyState, Input, PageTitle, Select, Spinner } from '../../components/ui'

const PAGE_SIZE = 25

export function ReturnsPage() {
  const currency = useCurrency()
  const [kind, setKind] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['returns', kind, from, to, page],
    queryFn: () =>
      api<Paged<ReturnRecord>>('returns:list', {
        kind: kind || undefined,
        from: from ? new Date(from + 'T00:00:00').toISOString() : undefined,
        to: to ? new Date(to + 'T23:59:59.999').toISOString() : undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
  })

  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE))

  return (
    <div>
      <PageTitle>Returns</PageTitle>

      <Card className="mb-4 flex flex-wrap items-end gap-3 p-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Type</span>
          <Select value={kind} onChange={(e) => { setKind(e.target.value); setPage(1) }} className="w-40">
            <option value="">All</option>
            <option value="sale">Sale returns</option>
            <option value="purchase">Purchase returns</option>
          </Select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">From</span>
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">To</span>
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} />
        </label>
      </Card>

      <Card className="overflow-x-auto p-0">
        {isLoading ? (
          <Spinner />
        ) : !data || data.rows.length === 0 ? (
          <EmptyState message="No returns recorded yet." />
        ) : (
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Party</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Refund via</th>
                <th className="px-4 py-3">By</th>
                <th className="px-4 py-3 text-right">Refund</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-t border-line hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-muted">{formatDateTime(r.created_at)}</td>
                  <td className="px-4 py-2.5">
                    {r.is_cancellation ? (
                      <Badge tone="red">Cancelled</Badge>
                    ) : r.kind === 'sale' ? (
                      <Badge tone="amber">Sale return</Badge>
                    ) : (
                      <Badge tone="blue">Purchase return</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs">
                    <Link
                      to={r.kind === 'sale' ? `/sales/${r.reference_id}` : `/purchases/${r.reference_id}`}
                      className="text-primary hover:underline"
                    >
                      {r.invoice_number}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">{r.party_name ?? '—'}</td>
                  <td className="max-w-48 truncate px-4 py-2.5 text-muted" title={r.reason ?? ''}>
                    {r.reason ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 uppercase text-muted">{r.refund_method}</td>
                  <td className="px-4 py-2.5 text-muted">{r.created_by_name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right font-medium">
                    {formatMoney(r.refund_amount, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted">
            Page {page} of {pages}
          </span>
          <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
