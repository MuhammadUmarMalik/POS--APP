// Purchase report: totals, outstanding dues, and per-supplier breakdown for a range.
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/ipc'
import { formatMoney } from '../../lib/money'
import { rangeFromInputs } from '../../lib/utils'
import { useCurrency } from '../../stores/auth'
import { Card, Spinner } from '../../components/ui'
import { section } from '../../lib/export'
import { ReportExport, ReportTable, StatCard, Td, Th } from './shared'

interface PurchaseReport {
  totals: { count: number; total: number; paid: number; due: number }
  bySupplier: { supplier: string; count: number; total: number; paid: number }[]
  returns: { count: number; total: number }
}

export function PurchasesTab({ from, to }: { from: string; to: string }) {
  const currency = useCurrency()
  const { data, isLoading } = useQuery({
    queryKey: ['report-purchases', from, to],
    queryFn: () => api<PurchaseReport>('reports:purchases', rangeFromInputs(from, to)),
  })
  if (isLoading || !data) return <Spinner />

  return (
    <div className="space-y-4">
      <ReportExport
        module="PurchasesReport"
        from={from}
        to={to}
        title="Purchases Report"
        stats={[
          { label: 'Purchases', value: String(data.totals.count) },
          { label: 'Total purchased', value: formatMoney(data.totals.total, currency) },
          { label: 'Paid', value: formatMoney(data.totals.paid, currency) },
          { label: 'Bought on credit', value: formatMoney(data.totals.due, currency) },
        ]}
        sections={[
          section({
            title: 'By supplier',
            columns: [
              { header: 'Supplier', value: (s: PurchaseReport['bySupplier'][number]) => s.supplier },
              { header: 'Purchases', value: (s) => s.count, align: 'right' },
              { header: 'Total', value: (s) => s.total, money: true },
              { header: 'Paid', value: (s) => s.paid, money: true },
              { header: 'On credit', value: (s) => s.total - s.paid, money: true },
            ],
            rows: data.bySupplier,
            footer: ['Total', data.totals.count, data.totals.total, data.totals.paid, data.totals.due],
          }),
        ]}
        note={
          data.returns.count > 0
            ? `${data.returns.count} purchase return(s) in this range worth ${formatMoney(data.returns.total, currency)} — see the Returns report.`
            : undefined
        }
      />
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Purchases" value={String(data.totals.count)} />
        <StatCard label="Total purchased" value={formatMoney(data.totals.total, currency)} />
        <StatCard label="Paid" value={formatMoney(data.totals.paid, currency)} tone="green" />
        <StatCard label="Bought on credit" value={formatMoney(data.totals.due, currency)} tone="red" />
      </div>
      {data.returns.count > 0 && (
        <Card>
          <span className="text-sm text-muted">
            {data.returns.count} purchase return{data.returns.count === 1 ? '' : 's'} in this range worth{' '}
            <span className="font-medium text-ink">{formatMoney(data.returns.total, currency)}</span> — see the
            Returns report for details.
          </span>
        </Card>
      )}
      {data.bySupplier.length === 0 ? (
        <Card><p className="text-muted">No purchases in range.</p></Card>
      ) : (
        <ReportTable
          head={
            <>
              <Th>Supplier</Th>
              <Th right>Purchases</Th>
              <Th right>Total</Th>
              <Th right>Paid</Th>
              <Th right>On credit</Th>
            </>
          }
        >
          {data.bySupplier.map((s) => (
            <tr key={s.supplier} className="border-t border-line">
              <Td className="font-medium">{s.supplier}</Td>
              <Td right className="text-muted">{s.count}</Td>
              <Td right className="font-medium">{formatMoney(s.total, currency)}</Td>
              <Td right className="text-success">{formatMoney(s.paid, currency)}</Td>
              <Td right className={s.total - s.paid > 0 ? 'text-danger' : 'text-muted'}>
                {s.total - s.paid > 0 ? formatMoney(s.total - s.paid, currency) : '—'}
              </Td>
            </tr>
          ))}
          <tr className="border-t-2 border-ink">
            <Td className="font-bold">Total</Td>
            <Td right className="font-bold">{data.totals.count}</Td>
            <Td right className="font-bold">{formatMoney(data.totals.total, currency)}</Td>
            <Td right className="font-bold text-success">{formatMoney(data.totals.paid, currency)}</Td>
            <Td right className="font-bold text-danger">
              {data.totals.due > 0 ? formatMoney(data.totals.due, currency) : '—'}
            </Td>
          </tr>
        </ReportTable>
      )}
      <p className="text-xs text-muted">
        “On credit” is the part of these purchases not yet paid when they were recorded — supplier due payments made
        later appear in the Payments and Cash Flow reports.
      </p>
    </div>
  )
}
