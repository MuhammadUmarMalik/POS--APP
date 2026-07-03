// Sales reports: range summary, daily breakdown, monthly breakdown.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/ipc'
import { formatMoney } from '../../lib/money'
import { rangeFromInputs } from '../../lib/utils'
import { useCurrency } from '../../stores/auth'
import { Card, Spinner } from '../../components/ui'
import { ReportTable, Segmented, StatCard, Td, Th } from './shared'

interface SalesReport {
  totals: { count: number; total: number; discount: number; tax: number }
  byMethod: { method: string; count: number; total: number }[]
  byCashier: { cashier: string; count: number; total: number }[]
  refunds: number
}

interface SalesSeries {
  rows: { bucket: string; count: number; total: number; discount: number; tax: number; profit: number }[]
  totals: { count: number; total: number; discount: number; tax: number; profit: number }
}

type Mode = 'summary' | 'daily' | 'monthly'

export function SalesTab({ from, to }: { from: string; to: string }) {
  const [mode, setMode] = useState<Mode>('summary')
  return (
    <div className="space-y-4">
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          ['summary', 'Summary'],
          ['daily', 'Daily'],
          ['monthly', 'Monthly'],
        ]}
      />
      {mode === 'summary' && <SummaryView from={from} to={to} />}
      {mode !== 'summary' && <SeriesView from={from} to={to} group={mode === 'daily' ? 'day' : 'month'} />}
    </div>
  )
}

function SummaryView({ from, to }: { from: string; to: string }) {
  const currency = useCurrency()
  const { data, isLoading } = useQuery({
    queryKey: ['report-sales', from, to],
    queryFn: () => api<SalesReport>('reports:sales', rangeFromInputs(from, to)),
  })
  if (isLoading || !data) return <Spinner />

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Transactions" value={String(data.totals.count)} />
        <StatCard label="Gross sales" value={formatMoney(data.totals.total, currency)} tone="green" />
        <StatCard label="Net sales (after refunds)" value={formatMoney(data.totals.total - data.refunds, currency)} tone="green" />
        <StatCard label="Discounts given" value={formatMoney(data.totals.discount, currency)} />
        <StatCard label="Tax collected" value={formatMoney(data.totals.tax, currency)} />
        <StatCard label="Refunds (cash + due)" value={formatMoney(data.refunds, currency)} tone="red" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <h3 className="mb-3 font-semibold">By payment method</h3>
          {data.byMethod.length === 0 ? (
            <p className="text-muted">No sales in range.</p>
          ) : (
            <table className="w-full text-left">
              <tbody>
                {data.byMethod.map((m) => (
                  <tr key={m.method} className="border-t border-line">
                    <td className="py-2 capitalize">{m.method}</td>
                    <td className="py-2 text-right text-muted">{m.count} sales</td>
                    <td className="py-2 text-right font-medium">{formatMoney(m.total, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card>
          <h3 className="mb-3 font-semibold">By cashier</h3>
          {data.byCashier.length === 0 ? (
            <p className="text-muted">No sales in range.</p>
          ) : (
            <table className="w-full text-left">
              <tbody>
                {data.byCashier.map((c) => (
                  <tr key={c.cashier} className="border-t border-line">
                    <td className="py-2">{c.cashier}</td>
                    <td className="py-2 text-right text-muted">{c.count} sales</td>
                    <td className="py-2 text-right font-medium">{formatMoney(c.total, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  )
}

function formatBucket(bucket: string, group: 'day' | 'month'): string {
  const d = new Date(group === 'month' ? `${bucket}-01T00:00:00` : `${bucket}T00:00:00`)
  return group === 'month'
    ? d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : d.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}

function SeriesView({ from, to, group }: { from: string; to: string; group: 'day' | 'month' }) {
  const currency = useCurrency()
  const { data, isLoading } = useQuery({
    queryKey: ['report-sales-series', from, to, group],
    queryFn: () => api<SalesSeries>('reports:salesSeries', { ...rangeFromInputs(from, to), group }),
  })
  if (isLoading || !data) return <Spinner />
  if (data.rows.length === 0) return <Card><p className="text-muted">No sales in range.</p></Card>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Transactions" value={String(data.totals.count)} />
        <StatCard label="Total sales" value={formatMoney(data.totals.total, currency)} tone="green" />
        <StatCard label="Discounts" value={formatMoney(data.totals.discount, currency)} />
        <StatCard
          label="Gross profit"
          value={formatMoney(data.totals.profit, currency)}
          tone={data.totals.profit >= 0 ? 'green' : 'red'}
        />
      </div>
      <ReportTable
        head={
          <>
            <Th>{group === 'day' ? 'Day' : 'Month'}</Th>
            <Th right>Sales</Th>
            <Th right>Discount</Th>
            <Th right>Tax</Th>
            <Th right>Total</Th>
            <Th right>Gross profit</Th>
          </>
        }
      >
        {data.rows.map((r) => (
          <tr key={r.bucket} className="border-t border-line">
            <Td className="font-medium">{formatBucket(r.bucket, group)}</Td>
            <Td right className="text-muted">{r.count}</Td>
            <Td right>{formatMoney(r.discount, currency)}</Td>
            <Td right>{formatMoney(r.tax, currency)}</Td>
            <Td right className="font-medium">{formatMoney(r.total, currency)}</Td>
            <Td right className={r.profit >= 0 ? 'text-success' : 'text-danger'}>
              {formatMoney(r.profit, currency)}
            </Td>
          </tr>
        ))}
      </ReportTable>
      <p className="text-xs text-muted">
        Gross profit = sales total − cost of the goods sold that {group === 'day' ? 'day' : 'month'}, both before any
        returns. Returns and shop expenses are not deducted here — see the Returns report and Profit / Loss for the
        full picture.
      </p>
    </div>
  )
}
