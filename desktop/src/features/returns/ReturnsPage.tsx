import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../../lib/ipc'
import { formatMoney } from '../../lib/money'
import { formatDateTime } from '../../lib/utils'
import { useCurrency } from '../../stores/auth'
import type { Paged, ReturnReceipt, ReturnRecord } from '../../shared/types'
import { Badge, Button, Card, EmptyState, Input, Modal, PageTitle, Select, Spinner } from '../../components/ui'
import { ExportBar } from '../../components/ExportBar'
import { returnSlipHtml } from './slip'

const PAGE_SIZE = 25

export function ReturnsPage() {
  const currency = useCurrency()
  const [kind, setKind] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  // A customer who lost the slip, or a supplier disputing a credit note, needs
  // the same document reprinted — not a new return.
  const [slipId, setSlipId] = useState<string | null>(null)

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
                <th className="px-4 py-3 text-right">Slip</th>
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
                  <td className="px-4 py-2.5 text-right">
                    <Button variant="secondary" size="sm" onClick={() => setSlipId(r.id)}>
                      Reprint
                    </Button>
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

      {slipId && <ReturnSlipModal id={slipId} onClose={() => setSlipId(null)} />}
    </div>
  )
}

/** Loads one stored return event and offers it for printing, unchanged. */
function ReturnSlipModal({ id, onClose }: { id: string; onClose: () => void }) {
  const currency = useCurrency()
  const { data, isLoading, error } = useQuery({
    queryKey: ['return', id],
    queryFn: () => api<ReturnReceipt>('returns:get', { id }),
  })

  return (
    <Modal open onClose={onClose} title="Return slip">
      {isLoading ? (
        <Spinner />
      ) : error || !data ? (
        <EmptyState message={(error as Error)?.message ?? 'This return could not be loaded.'} />
      ) : (
        <>
          <div className="mb-4 flex justify-between rounded-md bg-slate-50 px-4 py-3">
            <div>
              <div className="font-mono text-xs text-muted">{data.record.invoice_number}</div>
              <div className="text-sm">{data.record.party_name ?? '—'}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted">{formatDateTime(data.record.created_at)}</div>
              <div className="font-semibold">{formatMoney(data.record.refund_amount, currency)}</div>
            </div>
          </div>
          <table className="mb-5 w-full text-left text-sm">
            <thead className="text-xs uppercase text-muted">
              <tr>
                <th className="py-1.5">Item</th>
                <th className="py-1.5 text-right">Qty</th>
                <th className="py-1.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.id} className="border-t border-line">
                  <td className="py-1.5">{i.product_name}</td>
                  <td className="py-1.5 text-right">{i.quantity}</td>
                  <td className="py-1.5 text-right">{formatMoney(i.amount, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-line pt-4">
            <ExportBar
              module="ReturnSlip"
              scope={data.record.invoice_number}
              buildHtml={(docCtx) => returnSlipHtml(data, docCtx)}
            />
            <Button variant="secondary" onClick={onClose}>Close</Button>
          </div>
        </>
      )}
    </Modal>
  )
}
