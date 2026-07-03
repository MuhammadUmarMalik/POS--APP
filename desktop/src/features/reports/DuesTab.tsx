// Dues reports: outstanding balances right now, plus how old that money is (aging).
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/ipc'
import { formatMoney } from '../../lib/money'
import { useCurrency } from '../../stores/auth'
import { Card, Spinner } from '../../components/ui'
import { ReportTable, Segmented, StatCard, Td, Th } from './shared'

interface DuesReport {
  customers: { id: string; name: string; phone: string | null; due_balance: number; credit_limit: number }[]
  suppliers: { id: string; name: string; phone: string | null; due_balance: number }[]
}

type Mode = 'outstanding' | 'aging'

export function DuesTab() {
  const [mode, setMode] = useState<Mode>('outstanding')
  return (
    <div className="space-y-4">
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          ['outstanding', 'Outstanding now'],
          ['aging', 'Aging (how old)'],
        ]}
      />
      {mode === 'outstanding' && <OutstandingView />}
      {mode === 'aging' && <AgingView />}
    </div>
  )
}

function OutstandingView() {
  const currency = useCurrency()
  const { data, isLoading } = useQuery({
    queryKey: ['report-dues'],
    queryFn: () => api<DuesReport>('reports:dues'),
  })
  if (isLoading || !data) return <Spinner />

  const customerTotal = data.customers.reduce((a, c) => a + c.due_balance, 0)
  const supplierTotal = data.suppliers.reduce((a, s) => a + s.due_balance, 0)

  return (
    <div className="grid grid-cols-2 gap-4">
      <Card>
        <h3 className="mb-1 font-semibold">Customers owe us</h3>
        <div className="mb-3 text-2xl font-bold text-danger">{formatMoney(customerTotal, currency)}</div>
        {data.customers.length === 0 ? (
          <p className="text-muted">No outstanding customer dues.</p>
        ) : (
          <table className="w-full text-left">
            <tbody>
              {data.customers.map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="py-2">{c.name}</td>
                  <td className="py-2 text-muted">{c.phone ?? ''}</td>
                  <td className="py-2 text-right font-medium">{formatMoney(c.due_balance, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card>
        <h3 className="mb-1 font-semibold">We owe suppliers</h3>
        <div className="mb-3 text-2xl font-bold text-warning">{formatMoney(supplierTotal, currency)}</div>
        {data.suppliers.length === 0 ? (
          <p className="text-muted">No outstanding supplier dues.</p>
        ) : (
          <table className="w-full text-left">
            <tbody>
              {data.suppliers.map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <td className="py-2">{s.name}</td>
                  <td className="py-2 text-muted">{s.phone ?? ''}</td>
                  <td className="py-2 text-right font-medium">{formatMoney(s.due_balance, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}

interface AgingRow {
  id: string
  name: string
  phone: string | null
  due_balance: number
  b0: number
  b1: number
  b2: number
  b3: number
}

interface AgingReport {
  customers: AgingRow[]
  suppliers: AgingRow[]
  customerTotals: { due: number; b0: number; b1: number; b2: number; b3: number }
  supplierTotals: { due: number; b0: number; b1: number; b2: number; b3: number }
}

function AgingView() {
  const currency = useCurrency()
  const { data, isLoading } = useQuery({
    queryKey: ['report-dues-aging'],
    queryFn: () => api<AgingReport>('reports:duesAging'),
  })
  if (isLoading || !data) return <Spinner />

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Owed to us — total" value={formatMoney(data.customerTotals.due, currency)} tone="red" />
        <StatCard label="Over 30 days old" value={formatMoney(data.customerTotals.b1 + data.customerTotals.b2 + data.customerTotals.b3, currency)} />
        <StatCard
          label="Over 90 days old (risky)"
          value={formatMoney(data.customerTotals.b3, currency)}
          tone={data.customerTotals.b3 > 0 ? 'red' : 'green'}
        />
        <StatCard label="We owe suppliers" value={formatMoney(data.supplierTotals.due, currency)} />
      </div>
      <AgingTable title="Customers owe us" rows={data.customers} totals={data.customerTotals} currency={currency} />
      <AgingTable title="We owe suppliers" rows={data.suppliers} totals={data.supplierTotals} currency={currency} />
      <p className="text-xs text-muted">
        Payments are assumed to settle the oldest invoices first, so what's still owed sits on the most recent ones.
        Money in the “over 90 days” column deserves a follow-up call.
      </p>
    </div>
  )
}

function AgingTable({
  title,
  rows,
  totals,
  currency,
}: {
  title: string
  rows: AgingRow[]
  totals: { due: number; b0: number; b1: number; b2: number; b3: number }
  currency: string
}) {
  const cell = (v: number, danger = false) =>
    v > 0 ? <span className={danger ? 'font-medium text-danger' : ''}>{formatMoney(v, currency)}</span> : <span className="text-muted">—</span>

  return (
    <div className="space-y-2">
      <h3 className="font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <Card><p className="text-muted">Nothing outstanding. 🎉</p></Card>
      ) : (
        <ReportTable
          head={
            <>
              <Th>Name</Th>
              <Th>Phone</Th>
              <Th right>0–30 days</Th>
              <Th right>31–60 days</Th>
              <Th right>61–90 days</Th>
              <Th right>Over 90 days</Th>
              <Th right>Total due</Th>
            </>
          }
        >
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-line">
              <Td className="font-medium">{r.name}</Td>
              <Td className="text-muted">{r.phone ?? '—'}</Td>
              <Td right>{cell(r.b0)}</Td>
              <Td right>{cell(r.b1)}</Td>
              <Td right>{cell(r.b2)}</Td>
              <Td right>{cell(r.b3, true)}</Td>
              <Td right className="font-bold">{formatMoney(r.due_balance, currency)}</Td>
            </tr>
          ))}
          <tr className="border-t-2 border-ink">
            <Td className="font-bold">Total</Td>
            <Td />
            <Td right className="font-bold">{formatMoney(totals.b0, currency)}</Td>
            <Td right className="font-bold">{formatMoney(totals.b1, currency)}</Td>
            <Td right className="font-bold">{formatMoney(totals.b2, currency)}</Td>
            <Td right className="font-bold text-danger">{formatMoney(totals.b3, currency)}</Td>
            <Td right className="font-bold">{formatMoney(totals.due, currency)}</Td>
          </tr>
        </ReportTable>
      )}
    </div>
  )
}
