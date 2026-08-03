// Sales-return and purchase-return report for a range.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/ipc'
import { formatMoney } from '../../lib/money'
import { formatDateTime, rangeFromInputs } from '../../lib/utils'
import { useCurrency } from '../../stores/auth'
import { Badge, Card, Spinner } from '../../components/ui'
import { section } from '../../lib/export'
import { ReportExport, ReportTable, Segmented, StatCard, Td, Th } from './shared'

interface ReturnsReport {
  sale: { count: number; total: number }
  purchase: { count: number; total: number }
  rows: {
    id: string
    kind: 'sale' | 'purchase'
    invoice_number: string
    party_name: string | null
    refund_amount: number
    refund_method: string
    reason: string | null
    is_cancellation: number
    created_at: string
    created_by_name: string | null
  }[]
}

type Filter = 'all' | 'sale' | 'purchase'

export function ReturnsTab({ from, to }: { from: string; to: string }) {
  const currency = useCurrency()
  const [filter, setFilter] = useState<Filter>('all')
  const { data, isLoading } = useQuery({
    queryKey: ['report-returns', from, to],
    queryFn: () => api<ReturnsReport>('reports:returns', rangeFromInputs(from, to)),
  })
  if (isLoading || !data) return <Spinner />

  const rows = filter === 'all' ? data.rows : data.rows.filter((r) => r.kind === filter)

  const kindLabel = (r: ReturnsReport['rows'][number]) =>
    r.is_cancellation ? 'Cancellation' : r.kind === 'sale' ? 'Sale return' : 'Purchase return'

  return (
    <div className="space-y-4">
      {/* Exports `rows`, so the All / Sales / Purchase segmented filter carries
          into the file exactly as it filters the table. */}
      <ReportExport
        module="ReturnsReport"
        from={from}
        to={to}
        title="Returns Report"
        meta={[['Filter', filter === 'all' ? 'All returns' : filter === 'sale' ? 'Sales returns' : 'Purchase returns']]}
        stats={[
          { label: 'Sales returns', value: String(data.sale.count) },
          { label: 'Refunded to customers', value: formatMoney(data.sale.total, currency) },
          { label: 'Purchase returns', value: String(data.purchase.count) },
          { label: 'Recovered from suppliers', value: formatMoney(data.purchase.total, currency) },
        ]}
        sections={[
          section({
            columns: [
              { header: 'Date', value: (r: ReturnsReport['rows'][number]) => formatDateTime(r.created_at) },
              { header: 'Type', value: kindLabel },
              { header: 'Invoice', value: (r) => r.invoice_number },
              { header: 'Party', value: (r) => r.party_name ?? '' },
              { header: 'Amount', value: (r) => r.refund_amount, money: true },
              { header: 'Method', value: (r) => r.refund_method },
              { header: 'Reason', value: (r) => r.reason ?? '' },
              { header: 'By', value: (r) => r.created_by_name ?? '' },
            ],
            rows,
            footer: [
              `Total (${rows.length})`,
              '', '', '',
              rows.reduce((a, r) => a + r.refund_amount, 0),
              '', '', '',
            ],
          }),
        ]}
        note="“Method” shows where the refund went: cash was handed back; due was knocked off the party's balance."
      />
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Sales returns" value={String(data.sale.count)} />
        <StatCard label="Refunded to customers" value={formatMoney(data.sale.total, currency)} tone="red" />
        <StatCard label="Purchase returns" value={String(data.purchase.count)} />
        <StatCard label="Recovered from suppliers" value={formatMoney(data.purchase.total, currency)} tone="green" />
      </div>
      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          ['all', 'All'],
          ['sale', 'Sales returns'],
          ['purchase', 'Purchase returns'],
        ]}
      />
      {rows.length === 0 ? (
        <Card><p className="text-muted">No returns in range.</p></Card>
      ) : (
        <ReportTable
          head={
            <>
              <Th>Date</Th>
              <Th>Type</Th>
              <Th>Invoice</Th>
              <Th>Party</Th>
              <Th right>Amount</Th>
              <Th>Method</Th>
              <Th>Reason</Th>
              <Th>By</Th>
            </>
          }
        >
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-line">
              <Td className="whitespace-nowrap text-muted">{formatDateTime(r.created_at)}</Td>
              <Td>
                <Badge tone={r.kind === 'sale' ? 'red' : 'amber'}>
                  {r.is_cancellation ? 'Cancellation' : r.kind === 'sale' ? 'Sale return' : 'Purchase return'}
                </Badge>
              </Td>
              <Td className="font-medium">{r.invoice_number}</Td>
              <Td className="text-muted">{r.party_name ?? '—'}</Td>
              <Td right className="font-medium">{formatMoney(r.refund_amount, currency)}</Td>
              <Td className="capitalize text-muted">{r.refund_method}</Td>
              <Td className="max-w-48 truncate text-muted" >{r.reason ?? '—'}</Td>
              <Td className="text-muted">{r.created_by_name ?? '—'}</Td>
            </tr>
          ))}
          <tr className="border-t-2 border-ink">
            <Td className="font-bold" colSpan={4}>Total ({rows.length})</Td>
            <Td right className="font-bold">
              {formatMoney(rows.reduce((a, r) => a + r.refund_amount, 0), currency)}
            </Td>
            <Td /><Td /><Td />
          </tr>
        </ReportTable>
      )}
      <p className="text-xs text-muted">
        “Method” shows where the refund went: <span className="font-medium">cash</span> was handed back;{' '}
        <span className="font-medium">due</span> was knocked off the party's balance instead.
      </p>
    </div>
  )
}
