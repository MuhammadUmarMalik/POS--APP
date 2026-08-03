// Day Book: every transaction in the range in one chronological register.
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/ipc'
import { formatMoney } from '../../lib/money'
import { formatDateTime, rangeFromInputs } from '../../lib/utils'
import { useCurrency } from '../../stores/auth'
import { Badge, Card, Spinner } from '../../components/ui'
import { section } from '../../lib/export'
import { ReportExport, ReportTable, StatCard, Td, Th } from './shared'

interface DayBookReport {
  rows: {
    at: string
    type: string
    ref: string
    party: string | null
    amount: number
    cash_effect: number
    method: string | null
    user: string | null
  }[]
  summary: {
    sales: { count: number; total: number }
    purchases: { count: number; total: number }
    returns: { count: number; total: number }
    expenses: { count: number; total: number }
    cashIn: number
    cashOut: number
    netCash: number
  }
}

function typeTone(type: string): 'green' | 'amber' | 'red' | 'blue' | 'slate' {
  if (type.startsWith('Sale return') || type.startsWith('Sale cancelled') || type === 'Expense') return 'red'
  if (type.startsWith('Sale')) return 'green'
  if (type.startsWith('Purchase')) return 'blue'
  if (type.startsWith('Due collected')) return 'green'
  if (type.startsWith('Due paid')) return 'amber'
  return 'slate'
}

export function DayBookTab({ from, to }: { from: string; to: string }) {
  const currency = useCurrency()
  const { data, isLoading } = useQuery({
    queryKey: ['report-daybook', from, to],
    queryFn: () => api<DayBookReport>('reports:dayBook', rangeFromInputs(from, to)),
  })
  if (isLoading || !data) return <Spinner />

  const s = data.summary

  return (
    <div className="space-y-4">
      <ReportExport
        module="DayBook"
        from={from}
        to={to}
        title="Day Book"
        stats={[
          { label: `Sales (${s.sales.count})`, value: formatMoney(s.sales.total, currency) },
          { label: `Purchases (${s.purchases.count})`, value: formatMoney(s.purchases.total, currency) },
          { label: `Returns (${s.returns.count})`, value: formatMoney(s.returns.total, currency) },
          { label: `Expenses (${s.expenses.count})`, value: formatMoney(s.expenses.total, currency) },
          { label: 'Money received', value: formatMoney(s.cashIn, currency) },
          { label: 'Money paid out', value: formatMoney(s.cashOut, currency) },
          { label: 'Net money movement', value: formatMoney(s.netCash, currency) },
        ]}
        sections={[
          section({
            columns: [
              { header: 'Time', value: (r: DayBookReport['rows'][number]) => formatDateTime(r.at) },
              { header: 'Entry', value: (r) => r.type },
              { header: 'Ref / note', value: (r) => r.ref },
              { header: 'Party', value: (r) => r.party ?? '' },
              { header: 'Amount', value: (r) => r.amount, money: true },
              // Signed, so a spreadsheet can sum the column straight to netCash.
              { header: 'Money moved', value: (r) => r.cash_effect, money: true },
              { header: 'Method', value: (r) => r.method ?? '' },
              { header: 'By', value: (r) => r.user ?? '' },
            ],
            rows: data.rows,
            footer: ['Total', '', '', '', '', s.netCash, '', ''],
          }),
        ]}
        note="“Amount” is the size of the transaction; “Money moved” is the cash/card that actually changed hands with it. Credit sales and purchases move 0 — the money appears later as a due payment."
      />
      <div className="grid grid-cols-4 gap-4">
        <StatCard label={`Sales (${s.sales.count})`} value={formatMoney(s.sales.total, currency)} tone="green" />
        <StatCard label={`Purchases (${s.purchases.count})`} value={formatMoney(s.purchases.total, currency)} />
        <StatCard label={`Returns (${s.returns.count})`} value={formatMoney(s.returns.total, currency)} tone="red" />
        <StatCard label={`Expenses (${s.expenses.count})`} value={formatMoney(s.expenses.total, currency)} tone="red" />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Money received" value={formatMoney(s.cashIn, currency)} tone="green" />
        <StatCard label="Money paid out" value={formatMoney(s.cashOut, currency)} tone="red" />
        <StatCard label="Net money movement" value={formatMoney(s.netCash, currency)} tone={s.netCash >= 0 ? 'green' : 'red'} />
      </div>
      {data.rows.length === 0 ? (
        <Card><p className="text-muted">Nothing happened in this range.</p></Card>
      ) : (
        <ReportTable
          head={
            <>
              <Th>Time</Th>
              <Th>Entry</Th>
              <Th>Ref / note</Th>
              <Th>Party</Th>
              <Th right>Amount</Th>
              <Th right>Money moved</Th>
              <Th>Method</Th>
              <Th>By</Th>
            </>
          }
        >
          {data.rows.map((r, i) => (
            <tr key={i} className="border-t border-line">
              <Td className="whitespace-nowrap text-muted">{formatDateTime(r.at)}</Td>
              <Td><Badge tone={typeTone(r.type)}>{r.type}</Badge></Td>
              <Td className="max-w-40 truncate text-muted" >{r.ref || '—'}</Td>
              <Td>{r.party ?? '—'}</Td>
              <Td right className="font-medium">{formatMoney(r.amount, currency)}</Td>
              <Td
                right
                className={
                  r.cash_effect > 0 ? 'font-medium text-success' : r.cash_effect < 0 ? 'font-medium text-danger' : 'text-muted'
                }
              >
                {r.cash_effect === 0
                  ? 'on credit'
                  : `${r.cash_effect > 0 ? '+' : '-'}${formatMoney(Math.abs(r.cash_effect), currency)}`}
              </Td>
              <Td className="capitalize text-muted">{r.method ?? '—'}</Td>
              <Td className="text-muted">{r.user ?? '—'}</Td>
            </tr>
          ))}
        </ReportTable>
      )}
      <p className="text-xs text-muted">
        “Amount” is the size of the transaction; “Money moved” is the cash/card that actually changed hands with it.
        Credit sales and credit purchases show “on credit” — the money appears later as a due payment.
      </p>
    </div>
  )
}
