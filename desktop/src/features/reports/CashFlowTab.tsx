// Cash Flow Summary: money in vs money out for a range.
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/ipc'
import { formatMoney } from '../../lib/money'
import { rangeFromInputs } from '../../lib/utils'
import { useCurrency } from '../../stores/auth'
import { Card, Spinner } from '../../components/ui'
import { ReportTable, StatCard, Td, Th } from './shared'
import { cn } from '../../lib/utils'

interface CashFlowReport {
  inflows: { sales: number; customerPayments: number; purchaseRefunds: number; total: number }
  outflows: { purchases: number; supplierPayments: number; saleRefunds: number; expenses: number; total: number }
  net: number
  byMethod: {
    cash: { in: number; out: number; net: number }
    card: { in: number; out: number; net: number }
  }
}

export function CashFlowTab({ from, to }: { from: string; to: string }) {
  const currency = useCurrency()
  const { data, isLoading } = useQuery({
    queryKey: ['report-cash-flow', from, to],
    queryFn: () => api<CashFlowReport>('reports:cashFlow', rangeFromInputs(from, to)),
  })
  if (isLoading || !data) return <Spinner />

  const inRows: [string, number][] = [
    ['Sales at the till', data.inflows.sales],
    ['Customer due payments', data.inflows.customerPayments],
    ['Refunds from suppliers', data.inflows.purchaseRefunds],
  ]
  const outRows: [string, number][] = [
    ['Paid on purchases', data.outflows.purchases],
    ['Supplier due payments', data.outflows.supplierPayments],
    ['Refunds to customers', data.outflows.saleRefunds],
    ['Shop expenses', data.outflows.expenses],
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Money in" value={formatMoney(data.inflows.total, currency)} tone="green" />
        <StatCard label="Money out" value={formatMoney(data.outflows.total, currency)} tone="red" />
        <StatCard label="Net cash flow" value={formatMoney(data.net, currency)} tone={data.net >= 0 ? 'green' : 'red'} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FlowCard title="Money in" rows={inRows} total={data.inflows.total} currency={currency} positive />
        <FlowCard title="Money out" rows={outRows} total={data.outflows.total} currency={currency} />
      </div>
      <ReportTable
        head={
          <>
            <Th>Method</Th>
            <Th right>In</Th>
            <Th right>Out</Th>
            <Th right>Net</Th>
          </>
        }
      >
        {(['cash', 'card'] as const).map((m) => (
          <tr key={m} className="border-t border-line">
            <Td className="font-medium capitalize">{m}</Td>
            <Td right className="text-success">{formatMoney(data.byMethod[m].in, currency)}</Td>
            <Td right className="text-danger">{formatMoney(data.byMethod[m].out, currency)}</Td>
            <Td right className={cn('font-medium', data.byMethod[m].net >= 0 ? 'text-success' : 'text-danger')}>
              {formatMoney(data.byMethod[m].net, currency)}
            </Td>
          </tr>
        ))}
      </ReportTable>
      <p className="text-xs text-muted">
        Credit sales and credit purchases don't appear here until money actually changes hands. Shop expenses have no
        payment method recorded, so they're excluded from the cash/card split above.
      </p>
    </div>
  )
}

function FlowCard({
  title,
  rows,
  total,
  currency,
  positive,
}: {
  title: string
  rows: [string, number][]
  total: number
  currency: string
  positive?: boolean
}) {
  return (
    <Card>
      <h3 className="mb-3 font-semibold">{title}</h3>
      <table className="w-full">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-t border-line">
              <td className="py-2">{label}</td>
              <td className="py-2 text-right font-medium">{formatMoney(value, currency)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-ink">
            <td className="py-2.5 font-bold">Total</td>
            <td className={cn('py-2.5 text-right font-bold', positive ? 'text-success' : 'text-danger')}>
              {formatMoney(total, currency)}
            </td>
          </tr>
        </tbody>
      </table>
    </Card>
  )
}
