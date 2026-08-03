// Payment reports: sales by tender + money movements by method, and the full cash book.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/ipc'
import { formatMoney } from '../../lib/money'
import { formatDateTime, rangeFromInputs } from '../../lib/utils'
import { useCurrency } from '../../stores/auth'
import { Card, Spinner } from '../../components/ui'
import { section } from '../../lib/export'
import { ReportExport, ReportTable, Segmented, StatCard, Td, Th } from './shared'

interface PaymentMethodReport {
  sales: { method: string; count: number; total: number }[]
  flows: { reference_type: string; method: 'cash' | 'card'; count: number; total: number; direction: 'in' | 'out' }[]
}

const FLOW_LABELS: Record<string, string> = {
  sale: 'Sales at the till',
  customer_payment: 'Customer due payments',
  purchase_refund: 'Refunds from suppliers',
  purchase: 'Paid on purchases',
  supplier_payment: 'Supplier due payments',
  sale_refund: 'Refunds to customers',
}

type Mode = 'summary' | 'cashbook'

export function PaymentsTab({ from, to }: { from: string; to: string }) {
  const [mode, setMode] = useState<Mode>('summary')
  return (
    <div className="space-y-4">
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          ['summary', 'Summary'],
          ['cashbook', 'Cash book'],
        ]}
      />
      {mode === 'summary' && <SummaryView from={from} to={to} />}
      {mode === 'cashbook' && <CashBookView from={from} to={to} />}
    </div>
  )
}

function SummaryView({ from, to }: { from: string; to: string }) {
  const currency = useCurrency()
  const { data, isLoading } = useQuery({
    queryKey: ['report-payment-methods', from, to],
    queryFn: () => api<PaymentMethodReport>('reports:paymentMethods', rangeFromInputs(from, to)),
  })
  if (isLoading || !data) return <Spinner />

  const moneyIn = data.flows.filter((f) => f.direction === 'in')
  const moneyOut = data.flows.filter((f) => f.direction === 'out')

  const flowSection = (title: string, rows: PaymentMethodReport['flows']) =>
    section({
      title,
      columns: [
        {
          header: 'Entry',
          value: (r: PaymentMethodReport['flows'][number]) => FLOW_LABELS[r.reference_type] ?? r.reference_type,
        },
        { header: 'Method', value: (r) => r.method },
        { header: 'Count', value: (r) => r.count, align: 'right' },
        { header: 'Amount', value: (r) => r.total, money: true },
      ],
      rows,
      footer: ['Total', '', rows.reduce((a, r) => a + r.count, 0), rows.reduce((a, r) => a + r.total, 0)],
    })

  return (
    <div className="space-y-4">
      <ReportExport
        module="PaymentsReport"
        from={from}
        to={to}
        title="Payments Report — Summary"
        sections={[
          section({
            title: 'Sales by tender',
            columns: [
              { header: 'Tender', value: (m: PaymentMethodReport['sales'][number]) => m.method },
              { header: 'Sales', value: (m) => m.count, align: 'right' },
              { header: 'Total', value: (m) => m.total, money: true },
            ],
            rows: data.sales,
            footer: [
              'Total',
              data.sales.reduce((a, m) => a + m.count, 0),
              data.sales.reduce((a, m) => a + m.total, 0),
            ],
          }),
          flowSection('Money received', moneyIn),
          flowSection('Money paid out', moneyOut),
        ]}
        note="Credit sales add to customer dues — the cash arrives later as a due payment."
      />
      <Card>
        <h3 className="mb-3 font-semibold">Sales by tender</h3>
        {data.sales.length === 0 ? (
          <p className="text-muted">No sales in range.</p>
        ) : (
          <table className="w-full text-left">
            <tbody>
              {data.sales.map((m) => (
                <tr key={m.method} className="border-t border-line">
                  <td className="py-2 capitalize">{m.method}</td>
                  <td className="py-2 text-right text-muted">{m.count} sales</td>
                  <td className="py-2 text-right font-medium">{formatMoney(m.total, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-muted">
          Credit sales add to customer dues — the cash arrives later as a due payment.
        </p>
      </Card>
      <div className="grid grid-cols-2 gap-4">
        <FlowTable title="Money received" rows={moneyIn} currency={currency} tone="in" />
        <FlowTable title="Money paid out" rows={moneyOut} currency={currency} tone="out" />
      </div>
    </div>
  )
}

function FlowTable({
  title,
  rows,
  currency,
  tone,
}: {
  title: string
  rows: PaymentMethodReport['flows']
  currency: string
  tone: 'in' | 'out'
}) {
  const total = rows.reduce((a, r) => a + r.total, 0)
  return (
    <div className="space-y-2">
      <ReportTable
        head={
          <>
            <Th>{title}</Th>
            <Th>Method</Th>
            <Th right>Count</Th>
            <Th right>Amount</Th>
          </>
        }
      >
        {rows.length === 0 ? (
          <tr className="border-t border-line">
            <Td className="text-muted">Nothing in range.</Td>
            <Td /><Td /><Td />
          </tr>
        ) : (
          rows.map((r) => (
            <tr key={`${r.reference_type}-${r.method}`} className="border-t border-line">
              <Td>{FLOW_LABELS[r.reference_type] ?? r.reference_type}</Td>
              <Td className="capitalize text-muted">{r.method}</Td>
              <Td right className="text-muted">{r.count}</Td>
              <Td right className="font-medium">{formatMoney(r.total, currency)}</Td>
            </tr>
          ))
        )}
        <tr className="border-t-2 border-ink">
          <Td className="font-bold">Total</Td>
          <Td /><Td />
          <Td right className={tone === 'in' ? 'font-bold text-success' : 'font-bold text-danger'}>
            {formatMoney(total, currency)}
          </Td>
        </tr>
      </ReportTable>
    </div>
  )
}

interface CashBookReport {
  rows: {
    at: string
    type: string
    party: string | null
    note: string | null
    method: string | null
    in_amount: number
    out_amount: number
    balance: number
    user: string | null
  }[]
  totals: { in: number; out: number; net: number }
}

/** Cash Book: every money movement in order with a running net for the range. */
function CashBookView({ from, to }: { from: string; to: string }) {
  const currency = useCurrency()
  const { data, isLoading } = useQuery({
    queryKey: ['report-cash-book', from, to],
    queryFn: () => api<CashBookReport>('reports:cashBook', rangeFromInputs(from, to)),
  })
  if (isLoading || !data) return <Spinner />

  return (
    <div className="space-y-4">
      <ReportExport
        module="CashBook"
        from={from}
        to={to}
        title="Cash Book"
        stats={[
          { label: 'Total received', value: formatMoney(data.totals.in, currency) },
          { label: 'Total paid out', value: formatMoney(data.totals.out, currency) },
          { label: 'Net for range', value: formatMoney(data.totals.net, currency) },
        ]}
        sections={[
          section({
            columns: [
              { header: 'Time', value: (r: CashBookReport['rows'][number]) => formatDateTime(r.at) },
              { header: 'Entry', value: (r) => (r.note ? `${r.type} — ${r.note}` : r.type) },
              { header: 'Party', value: (r) => r.party ?? '' },
              { header: 'Method', value: (r) => r.method ?? '' },
              { header: 'In', value: (r) => (r.in_amount ? r.in_amount : ''), money: true },
              { header: 'Out', value: (r) => (r.out_amount ? r.out_amount : ''), money: true },
              { header: 'Running net', value: (r) => r.balance, money: true },
              { header: 'By', value: (r) => r.user ?? '' },
            ],
            rows: data.rows,
            footer: ['Total', '', '', '', data.totals.in, data.totals.out, data.totals.net, ''],
          }),
        ]}
        note="The running net starts at zero at the beginning of the range — it shows how money moved, not the drawer's absolute balance."
      />
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total received" value={formatMoney(data.totals.in, currency)} tone="green" />
        <StatCard label="Total paid out" value={formatMoney(data.totals.out, currency)} tone="red" />
        <StatCard label="Net for range" value={formatMoney(data.totals.net, currency)} tone={data.totals.net >= 0 ? 'green' : 'red'} />
      </div>
      {data.rows.length === 0 ? (
        <Card><p className="text-muted">No money moved in this range.</p></Card>
      ) : (
        <ReportTable
          head={
            <>
              <Th>Time</Th>
              <Th>Entry</Th>
              <Th>Party</Th>
              <Th>Method</Th>
              <Th right>In</Th>
              <Th right>Out</Th>
              <Th right>Running net</Th>
              <Th>By</Th>
            </>
          }
        >
          {data.rows.map((r, i) => (
            <tr key={i} className="border-t border-line">
              <Td className="whitespace-nowrap text-muted">{formatDateTime(r.at)}</Td>
              <Td>
                {r.type}
                {r.note ? <span className="text-muted"> — {r.note}</span> : null}
              </Td>
              <Td className="text-muted">{r.party ?? '—'}</Td>
              <Td className="capitalize text-muted">{r.method ?? '—'}</Td>
              <Td right className="text-success">{r.in_amount ? formatMoney(r.in_amount, currency) : ''}</Td>
              <Td right className="text-danger">{r.out_amount ? formatMoney(r.out_amount, currency) : ''}</Td>
              <Td right className={r.balance >= 0 ? 'font-medium' : 'font-medium text-danger'}>
                {formatMoney(r.balance, currency)}
              </Td>
              <Td className="text-muted">{r.user ?? '—'}</Td>
            </tr>
          ))}
          <tr className="border-t-2 border-ink">
            <Td className="font-bold">Total</Td>
            <Td /><Td /><Td />
            <Td right className="font-bold text-success">{formatMoney(data.totals.in, currency)}</Td>
            <Td right className="font-bold text-danger">{formatMoney(data.totals.out, currency)}</Td>
            <Td right className="font-bold">{formatMoney(data.totals.net, currency)}</Td>
            <Td />
          </tr>
        </ReportTable>
      )}
      <p className="text-xs text-muted">
        The running net starts at zero at the beginning of the range — it shows how money moved, not the drawer's
        absolute balance. Expenses have no cash/card method recorded, so their method shows “—”.
      </p>
    </div>
  )
}
