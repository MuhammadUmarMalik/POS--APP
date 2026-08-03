import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/ipc'
import { formatMoney } from '../../lib/money'
import { rangeFromInputs, todayInput } from '../../lib/utils'
import { useCurrency } from '../../stores/auth'
import { Card, Input, PageTitle, Spinner } from '../../components/ui'
import { cn } from '../../lib/utils'
import { section } from '../../lib/export'
import { ReportExport, ReportTable, StatCard, Td, Th } from './shared'
import { SalesTab } from './SalesTab'
import { DayBookTab } from './DayBookTab'
import { ProductsTab } from './ProductsTab'
import { StockTab } from './StockTab'
import { PurchasesTab } from './PurchasesTab'
import { ReturnsTab } from './ReturnsTab'
import { PaymentsTab } from './PaymentsTab'
import { CashFlowTab } from './CashFlowTab'
import { DrawerTab } from './DrawerTab'
import { DuesTab } from './DuesTab'
import { LedgersTab } from './LedgersTab'
import { ExpiryTab } from './ExpiryTab'
import { useBatchTracking } from '../batches/useBatchSettings'

type Tab =
  | 'sales'
  | 'daybook'
  | 'pl'
  | 'products'
  | 'stock'
  | 'purchases'
  | 'returns'
  | 'payments'
  | 'cashflow'
  | 'drawer'
  | 'expenses'
  | 'dues'
  | 'customers'
  | 'suppliers'
  | 'ledgers'
  | 'expiry'

const TABS: [Tab, string][] = [
  ['sales', 'Sales'],
  ['daybook', 'Day Book'],
  ['pl', 'Profit / Loss'],
  ['products', 'Products'],
  ['stock', 'Stock'],
  ['purchases', 'Purchases'],
  ['returns', 'Returns'],
  ['payments', 'Payments'],
  ['cashflow', 'Cash Flow'],
  ['drawer', 'Cash Drawer'],
  ['expenses', 'Expenses'],
  ['dues', 'Dues'],
  ['customers', 'Customers'],
  ['suppliers', 'Suppliers'],
  ['ledgers', 'Ledgers'],
]

/** Tabs that filter by the shared date range. */
const RANGED: Tab[] = [
  'sales', 'daybook', 'pl', 'products', 'stock', 'purchases', 'returns', 'payments',
  'cashflow', 'drawer', 'expenses', 'customers', 'suppliers',
]

function inputDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const PRESETS: [string, () => { from: string; to: string }][] = [
  ['Today', () => ({ from: todayInput(), to: todayInput() })],
  ['Yesterday', () => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return { from: inputDate(d), to: inputDate(d) }
  }],
  ['7 days', () => {
    const from = new Date()
    from.setDate(from.getDate() - 6)
    return { from: inputDate(from), to: todayInput() }
  }],
  ['This month', () => {
    const from = new Date()
    from.setDate(1)
    return { from: inputDate(from), to: todayInput() }
  }],
  ['Last month', () => {
    const now = new Date()
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const to = new Date(now.getFullYear(), now.getMonth(), 0)
    return { from: inputDate(from), to: inputDate(to) }
  }],
  ['This year', () => {
    const from = new Date()
    from.setMonth(0, 1)
    return { from: inputDate(from), to: todayInput() }
  }],
]

export function ReportsPage() {
  const [params] = useSearchParams()
  const batchTracking = useBatchTracking()
  // The inventory expiry banner links straight here with ?tab=expiry.
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'sales')
  const [from, setFrom] = useState(todayInput())
  const [to, setTo] = useState(todayInput())

  return (
    <div>
      {/* Print / PDF / CSV lives inside each tab — only the tab knows what its rows and totals are. */}
      <PageTitle>Reports</PageTitle>

      <div className="no-print mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg border border-line bg-surface p-1">
          {/* Expiry only exists for shops that date their stock. */}
          {[...TABS, ...(batchTracking ? ([['expiry', 'Expiry']] as [Tab, string][]) : [])].map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'rounded-md px-3 py-2 text-sm font-medium',
                tab === t ? 'bg-primary text-white' : 'text-muted hover:text-ink'
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {RANGED.includes(tab) && (
          <div className="flex items-end gap-3">
            <div className="flex gap-1">
              {PRESETS.map(([label, make]) => (
                <button
                  key={label}
                  onClick={() => {
                    const r = make()
                    setFrom(r.from)
                    setTo(r.to)
                  }}
                  className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-muted hover:text-ink"
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="text-xs text-muted">
              From
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1" />
            </label>
            <label className="text-xs text-muted">
              To
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1" />
            </label>
          </div>
        )}
      </div>

      <div className="print-area">
        {tab === 'sales' && <SalesTab from={from} to={to} />}
        {tab === 'daybook' && <DayBookTab from={from} to={to} />}
        {tab === 'pl' && <PlTab from={from} to={to} />}
        {tab === 'products' && <ProductsTab from={from} to={to} />}
        {tab === 'stock' && <StockTab from={from} to={to} />}
        {tab === 'purchases' && <PurchasesTab from={from} to={to} />}
        {tab === 'returns' && <ReturnsTab from={from} to={to} />}
        {tab === 'payments' && <PaymentsTab from={from} to={to} />}
        {tab === 'cashflow' && <CashFlowTab from={from} to={to} />}
        {tab === 'drawer' && <DrawerTab from={from} to={to} />}
        {tab === 'expenses' && <ExpensesTab from={from} to={to} />}
        {tab === 'dues' && <DuesTab />}
        {tab === 'customers' && <CustomersTab from={from} to={to} />}
        {tab === 'suppliers' && <SuppliersTab from={from} to={to} />}
        {tab === 'ledgers' && <LedgersTab />}
        {tab === 'expiry' && <ExpiryTab />}
      </div>
    </div>
  )
}

interface PlReport {
  revenue: number
  refunds: number
  netRevenue: number
  cogs: number
  discounts: number
  grossProfit: number
  expenses: number
  netProfit: number
}

interface ExpenseReport {
  byCategory: { category: string; count: number; total: number }[]
  byMonth: { month: string; total: number }[]
  total: number
}

interface CustomerReport {
  rows: { id: string; name: string; phone: string | null; due_balance: number; sale_count: number; sale_total: number }[]
  totals: { customers: number; sale_total: number; due_total: number }
}

interface SupplierReport {
  rows: { id: string; name: string; phone: string | null; due_balance: number; purchase_count: number; purchase_total: number }[]
  totals: { suppliers: number; purchase_total: number; due_total: number }
}

function pct(part: number, whole: number): string {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—'
}

function PlTab({ from, to }: { from: string; to: string }) {
  const currency = useCurrency()
  const { data, isLoading } = useQuery({
    queryKey: ['report-pl', from, to],
    queryFn: () => api<PlReport>('reports:profitLoss', rangeFromInputs(from, to)),
  })
  if (isLoading || !data) return <Spinner />

  const rows: [string, number][] = [
    ['Gross revenue (all sales)', data.revenue],
    ['Refunds (cash + due adjustments)', -data.refunds],
    ['Net revenue', data.netRevenue],
    ['Cost of goods sold', -data.cogs],
  ]

  return (
    <div className="space-y-4">
    <ReportExport
      module="ProfitAndLoss"
      from={from}
      to={to}
      title="Profit & Loss"
      stats={[
        { label: `Gross profit (${pct(data.grossProfit, data.netRevenue)} margin)`, value: formatMoney(data.grossProfit, currency) },
        { label: 'Shop expenses', value: formatMoney(data.expenses, currency) },
        { label: `Net profit (${pct(data.netProfit, data.netRevenue)} margin)`, value: formatMoney(data.netProfit, currency) },
      ]}
      sections={[
        section({
          columns: [
            { header: 'Line', value: (r: [string, number]) => r[0] },
            // Signed, so a spreadsheet reads deductions as negative rather than as text.
            { header: 'Amount', value: (r: [string, number]) => r[1], money: true },
          ],
          rows: [
            ...rows,
            ['Gross profit', data.grossProfit] as [string, number],
            ['Shop expenses', -data.expenses] as [string, number],
          ],
          footer: ['Net profit', data.netProfit],
        }),
      ]}
      note={`Discounts of ${formatMoney(data.discounts, currency)} are already reflected in revenue. Refunds include both cash refunds and returns credited against customer dues. COGS uses the cost recorded on each sale line at the time of sale, less the cost of returned items.`}
    />
    <Card className="mx-auto max-w-xl">
      <h3 className="mb-4 text-lg font-semibold">Profit &amp; Loss</h3>
      <table className="w-full">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-t border-line">
              <td className="py-2.5">{label}</td>
              <td className={cn('py-2.5 text-right font-medium', value < 0 && 'text-danger')}>
                {value < 0 ? `-${formatMoney(-value, currency)}` : formatMoney(value, currency)}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-ink">
            <td className="py-3 font-bold">
              Gross profit <span className="font-normal text-muted">({pct(data.grossProfit, data.netRevenue)} margin)</span>
            </td>
            <td className={cn('py-3 text-right font-bold', data.grossProfit >= 0 ? 'text-success' : 'text-danger')}>
              {formatMoney(data.grossProfit, currency)}
            </td>
          </tr>
          <tr className="border-t border-line">
            <td className="py-2.5">Shop expenses</td>
            <td className="py-2.5 text-right font-medium text-danger">
              -{formatMoney(data.expenses, currency)}
            </td>
          </tr>
          <tr className="border-t-2 border-ink">
            <td className="py-3 text-lg font-bold">
              Net profit <span className="text-sm font-normal text-muted">({pct(data.netProfit, data.netRevenue)} margin)</span>
            </td>
            <td className={cn('py-3 text-right text-lg font-bold', data.netProfit >= 0 ? 'text-success' : 'text-danger')}>
              {formatMoney(data.netProfit, currency)}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="mt-3 text-xs text-muted">
        Discounts of {formatMoney(data.discounts, currency)} are already reflected in revenue. Refunds include both
        cash refunds and returns credited against customer dues. COGS uses the cost recorded on each sale line at the
        time of sale, less the cost of returned items.
      </p>
    </Card>
    </div>
  )
}

function ExpensesTab({ from, to }: { from: string; to: string }) {
  const currency = useCurrency()
  const { data, isLoading } = useQuery({
    queryKey: ['report-expenses', from, to],
    queryFn: () => api<ExpenseReport>('reports:expenses', rangeFromInputs(from, to)),
  })
  if (isLoading || !data) return <Spinner />

  return (
    <div className="space-y-4">
      <ReportExport
        module="ExpensesReport"
        from={from}
        to={to}
        title="Expenses Report"
        stats={[
          { label: 'Total expenses', value: formatMoney(data.total, currency) },
          { label: 'Categories used', value: String(data.byCategory.length) },
          { label: 'Months in range', value: String(data.byMonth.length) },
        ]}
        sections={[
          section({
            title: 'By category',
            columns: [
              { header: 'Category', value: (c: ExpenseReport['byCategory'][number]) => c.category },
              { header: 'Entries', value: (c) => c.count, align: 'right' },
              { header: 'Share', value: (c) => pct(c.total, data.total), align: 'right' },
              { header: 'Total', value: (c) => c.total, money: true },
            ],
            rows: data.byCategory,
            footer: ['Total', data.byCategory.reduce((a, c) => a + c.count, 0), '', data.total],
            emptyText: 'No expenses in range.',
          }),
          section({
            title: 'By month',
            columns: [
              { header: 'Month', value: (m: ExpenseReport['byMonth'][number]) => m.month },
              { header: 'Total', value: (m) => m.total, money: true },
            ],
            rows: data.byMonth,
            footer: ['Total', data.total],
            emptyText: 'No expenses in range.',
          }),
        ]}
      />
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total expenses" value={formatMoney(data.total, currency)} tone="red" />
        <StatCard label="Categories used" value={String(data.byCategory.length)} />
        <StatCard label="Months in range" value={String(data.byMonth.length)} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <h3 className="mb-3 font-semibold">By category</h3>
          {data.byCategory.length === 0 ? (
            <p className="text-muted">No expenses in range.</p>
          ) : (
            <table className="w-full text-left">
              <tbody>
                {data.byCategory.map((c) => (
                  <tr key={c.category} className="border-t border-line">
                    <td className="py-2">{c.category}</td>
                    <td className="py-2 text-right text-muted">{c.count} entries</td>
                    <td className="py-2 text-right text-muted">{pct(c.total, data.total)}</td>
                    <td className="py-2 text-right font-medium">{formatMoney(c.total, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card>
          <h3 className="mb-3 font-semibold">By month</h3>
          {data.byMonth.length === 0 ? (
            <p className="text-muted">No expenses in range.</p>
          ) : (
            <table className="w-full text-left">
              <tbody>
                {data.byMonth.map((m) => (
                  <tr key={m.month} className="border-t border-line">
                    <td className="py-2">{m.month}</td>
                    <td className="py-2 text-right font-medium">{formatMoney(m.total, currency)}</td>
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

function CustomersTab({ from, to }: { from: string; to: string }) {
  const currency = useCurrency()
  const { data, isLoading } = useQuery({
    queryKey: ['report-customers', from, to],
    queryFn: () => api<CustomerReport>('reports:customers', rangeFromInputs(from, to)),
  })
  if (isLoading || !data) return <Spinner />

  return (
    <div className="space-y-4">
      <ReportExport
        module="CustomersReport"
        from={from}
        to={to}
        title="Customers Report"
        stats={[
          { label: 'Customers', value: String(data.totals.customers) },
          { label: 'Sales in range', value: formatMoney(data.totals.sale_total, currency) },
          { label: 'Outstanding dues', value: formatMoney(data.totals.due_total, currency) },
        ]}
        sections={[
          section({
            columns: [
              { header: 'Customer', value: (c: CustomerReport['rows'][number]) => c.name },
              { header: 'Phone', value: (c) => c.phone ?? '' },
              { header: 'Sales', value: (c) => c.sale_count, align: 'right' },
              { header: 'Total bought', value: (c) => c.sale_total, money: true },
              { header: 'Due', value: (c) => c.due_balance, money: true },
            ],
            rows: data.rows,
            footer: [
              'Total',
              '',
              data.rows.reduce((a, c) => a + c.sale_count, 0),
              data.totals.sale_total,
              data.totals.due_total,
            ],
          }),
        ]}
        note="“Sales” and “Total bought” count the selected range; “Due” is the balance owed right now, regardless of range."
      />
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Customers" value={String(data.totals.customers)} />
        <StatCard label="Sales in range" value={formatMoney(data.totals.sale_total, currency)} tone="green" />
        <StatCard label="Outstanding dues" value={formatMoney(data.totals.due_total, currency)} tone="red" />
      </div>
      <ReportTable
        head={
          <>
            <Th>Customer</Th>
            <Th>Phone</Th>
            <Th right>Sales</Th>
            <Th right>Total bought</Th>
            <Th right>Due</Th>
          </>
        }
      >
        {data.rows.map((c) => (
          <tr key={c.id} className="border-t border-line">
            <Td className="font-medium">{c.name}</Td>
            <Td className="text-muted">{c.phone ?? '—'}</Td>
            <Td right className="text-muted">{c.sale_count}</Td>
            <Td right className="font-medium">{formatMoney(c.sale_total, currency)}</Td>
            <Td right>
              {c.due_balance > 0 ? (
                <span className="font-medium text-danger">{formatMoney(c.due_balance, currency)}</span>
              ) : (
                <span className="text-muted">—</span>
              )}
            </Td>
          </tr>
        ))}
        <tr className="border-t-2 border-ink">
          <Td className="font-bold">Total</Td>
          <Td />
          <Td right className="font-bold">{data.rows.reduce((a, c) => a + c.sale_count, 0)}</Td>
          <Td right className="font-bold">{formatMoney(data.totals.sale_total, currency)}</Td>
          <Td right className="font-bold text-danger">{formatMoney(data.totals.due_total, currency)}</Td>
        </tr>
      </ReportTable>
      <p className="text-xs text-muted">
        “Sales” and “Total bought” count the selected range; “Due” is the balance owed right now, regardless of range.
      </p>
    </div>
  )
}

function SuppliersTab({ from, to }: { from: string; to: string }) {
  const currency = useCurrency()
  const { data, isLoading } = useQuery({
    queryKey: ['report-suppliers', from, to],
    queryFn: () => api<SupplierReport>('reports:suppliers', rangeFromInputs(from, to)),
  })
  if (isLoading || !data) return <Spinner />

  return (
    <div className="space-y-4">
      <ReportExport
        module="SuppliersReport"
        from={from}
        to={to}
        title="Suppliers Report"
        stats={[
          { label: 'Suppliers', value: String(data.totals.suppliers) },
          { label: 'Purchases in range', value: formatMoney(data.totals.purchase_total, currency) },
          { label: 'We owe', value: formatMoney(data.totals.due_total, currency) },
        ]}
        sections={[
          section({
            columns: [
              { header: 'Supplier', value: (s: SupplierReport['rows'][number]) => s.name },
              { header: 'Phone', value: (s) => s.phone ?? '' },
              { header: 'Purchases', value: (s) => s.purchase_count, align: 'right' },
              { header: 'Total bought', value: (s) => s.purchase_total, money: true },
              { header: 'We owe', value: (s) => s.due_balance, money: true },
            ],
            rows: data.rows,
            footer: [
              'Total',
              '',
              data.rows.reduce((a, s) => a + s.purchase_count, 0),
              data.totals.purchase_total,
              data.totals.due_total,
            ],
          }),
        ]}
        note="“Purchases” and “Total bought” count the selected range; “We owe” is the balance outstanding right now."
      />
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Suppliers" value={String(data.totals.suppliers)} />
        <StatCard label="Purchases in range" value={formatMoney(data.totals.purchase_total, currency)} />
        <StatCard label="We owe" value={formatMoney(data.totals.due_total, currency)} tone="red" />
      </div>
      <ReportTable
        head={
          <>
            <Th>Supplier</Th>
            <Th>Phone</Th>
            <Th right>Purchases</Th>
            <Th right>Total bought</Th>
            <Th right>We owe</Th>
          </>
        }
      >
        {data.rows.map((s) => (
          <tr key={s.id} className="border-t border-line">
            <Td className="font-medium">{s.name}</Td>
            <Td className="text-muted">{s.phone ?? '—'}</Td>
            <Td right className="text-muted">{s.purchase_count}</Td>
            <Td right className="font-medium">{formatMoney(s.purchase_total, currency)}</Td>
            <Td right>
              {s.due_balance > 0 ? (
                <span className="font-medium text-warning">{formatMoney(s.due_balance, currency)}</span>
              ) : (
                <span className="text-muted">—</span>
              )}
            </Td>
          </tr>
        ))}
        <tr className="border-t-2 border-ink">
          <Td className="font-bold">Total</Td>
          <Td />
          <Td right className="font-bold">{data.rows.reduce((a, s) => a + s.purchase_count, 0)}</Td>
          <Td right className="font-bold">{formatMoney(data.totals.purchase_total, currency)}</Td>
          <Td right className="font-bold text-warning">{formatMoney(data.totals.due_total, currency)}</Td>
        </tr>
      </ReportTable>
      <p className="text-xs text-muted">
        “Purchases” and “Total bought” count the selected range; “We owe” is the balance outstanding right now.
      </p>
    </div>
  )
}
