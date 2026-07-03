// Cash Drawer report: expected cash in the till per user for the range.
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/ipc'
import { formatMoney } from '../../lib/money'
import { rangeFromInputs } from '../../lib/utils'
import { useCurrency } from '../../stores/auth'
import { Card, Spinner } from '../../components/ui'
import { ReportTable, StatCard, Td, Th } from './shared'

interface DrawerReport {
  rows: {
    user: string
    cash_sales: number
    cash_sale_count: number
    card_sales: number
    credit_sales: number
    due_collected_cash: number
    refunds_paid_cash: number
    expected_cash: number
  }[]
  totals: {
    cash_sales: number
    card_sales: number
    credit_sales: number
    due_collected_cash: number
    refunds_paid_cash: number
    expected_cash: number
  }
}

export function DrawerTab({ from, to }: { from: string; to: string }) {
  const currency = useCurrency()
  const { data, isLoading } = useQuery({
    queryKey: ['report-drawer', from, to],
    queryFn: () => api<DrawerReport>('reports:cashDrawer', rangeFromInputs(from, to)),
  })
  if (isLoading || !data) return <Spinner />

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Cash from sales" value={formatMoney(data.totals.cash_sales, currency)} tone="green" />
        <StatCard label="Cash dues collected" value={formatMoney(data.totals.due_collected_cash, currency)} tone="green" />
        <StatCard label="Cash refunds handed out" value={formatMoney(data.totals.refunds_paid_cash, currency)} tone="red" />
        <StatCard
          label="Expected cash (all users)"
          value={formatMoney(data.totals.expected_cash, currency)}
          tone={data.totals.expected_cash >= 0 ? 'green' : 'red'}
        />
      </div>
      {data.rows.length === 0 ? (
        <Card><p className="text-muted">No activity in this range.</p></Card>
      ) : (
        <ReportTable
          head={
            <>
              <Th>User</Th>
              <Th right>Cash sales</Th>
              <Th right>Dues collected (cash)</Th>
              <Th right>Refunds paid (cash)</Th>
              <Th right>Expected cash in drawer</Th>
              <Th right>Card sales</Th>
              <Th right>Credit sales</Th>
            </>
          }
        >
          {data.rows.map((r) => (
            <tr key={r.user} className="border-t border-line">
              <Td className="font-medium">{r.user}</Td>
              <Td right>
                {formatMoney(r.cash_sales, currency)}
                <span className="text-muted"> ({r.cash_sale_count})</span>
              </Td>
              <Td right>{r.due_collected_cash ? formatMoney(r.due_collected_cash, currency) : '—'}</Td>
              <Td right className={r.refunds_paid_cash ? 'text-danger' : 'text-muted'}>
                {r.refunds_paid_cash ? `-${formatMoney(r.refunds_paid_cash, currency)}` : '—'}
              </Td>
              <Td right className="font-bold">{formatMoney(r.expected_cash, currency)}</Td>
              <Td right className="text-muted">{r.card_sales ? formatMoney(r.card_sales, currency) : '—'}</Td>
              <Td right className="text-muted">{r.credit_sales ? formatMoney(r.credit_sales, currency) : '—'}</Td>
            </tr>
          ))}
          <tr className="border-t-2 border-ink">
            <Td className="font-bold">Total</Td>
            <Td right className="font-bold">{formatMoney(data.totals.cash_sales, currency)}</Td>
            <Td right className="font-bold">{formatMoney(data.totals.due_collected_cash, currency)}</Td>
            <Td right className="font-bold text-danger">
              {data.totals.refunds_paid_cash ? `-${formatMoney(data.totals.refunds_paid_cash, currency)}` : '—'}
            </Td>
            <Td right className="font-bold">{formatMoney(data.totals.expected_cash, currency)}</Td>
            <Td right className="font-bold text-muted">{formatMoney(data.totals.card_sales, currency)}</Td>
            <Td right className="font-bold text-muted">{formatMoney(data.totals.credit_sales, currency)}</Td>
          </tr>
        </ReportTable>
      )}
      <p className="text-xs text-muted">
        Expected cash = cash sales + customer dues collected in cash − cash refunds handed out, per user. Count the
        drawer against this figure at shift end. Purchases and supplier payments made from the drawer are not split by
        user — see the Cash Flow report for the shop-wide picture.
      </p>
    </div>
  )
}
