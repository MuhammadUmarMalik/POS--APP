import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  ShoppingCart,
  PackagePlus,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  Banknote,
  CalendarDays,
  TrendingUp,
  Wallet,
  Users,
  Truck,
  Plus,
  Receipt,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { api } from '../../lib/ipc'
import { formatMoney } from '../../lib/money'
import { cn, formatDateTime } from '../../lib/utils'
import { useCurrency, useSession } from '../../stores/auth'
import { Badge, Button, Card, Spinner } from '../../components/ui'
import { TrialBanner } from '../settings/TrialBanner'
import { saleStatusBadge } from '../sales/SalesPage'
import type { Sale } from '../../shared/types'

interface Dashboard {
  sales: {
    totals: { count: number; total: number; discount: number; tax: number }
    byMethod: { method: string; count: number; total: number }[]
    refunds: number
  }
  month: { total: number; count: number }
  todayProfit: number | null
  monthProfit: number | null
  week: { day: string; total: number; count: number }[]
  lowStock: { id: string; name: string; min_stock_alert: number; stock: number }[]
  dues: { customer_dues: number; supplier_dues: number }
  recent: {
    id: string
    invoice_number: string
    total: number
    payment_method: string
    status: Sale['status']
    created_at: string
    customer_name: string | null
  }[]
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function StatCard({
  label,
  value,
  hint,
  icon,
  iconClass,
  valueClass,
}: {
  label: string
  value: string
  hint?: ReactNode
  icon: ReactNode
  iconClass: string
  valueClass?: string
}) {
  return (
    <Card className="flex items-start gap-3">
      <div className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', iconClass)}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted">{label}</div>
        <div className={cn('truncate text-xl font-bold leading-7', valueClass)}>{value}</div>
        {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
      </div>
    </Card>
  )
}

/** "+12% vs yesterday" pill; hidden when yesterday had no sales. */
function DeltaHint({ today, yesterday }: { today: number; yesterday: number }) {
  if (yesterday <= 0) return <span>vs no sales yesterday</span>
  const pct = Math.round(((today - yesterday) / yesterday) * 100)
  const up = pct >= 0
  return (
    <span className={cn('inline-flex items-center gap-0.5 font-medium', up ? 'text-success' : 'text-danger')}>
      {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      {Math.abs(pct)}% vs yesterday
    </span>
  )
}

/** Lightweight 7-day bar chart — plain SVG, no chart library. */
function WeekChart({ week, currency }: { week: Dashboard['week']; currency: string }) {
  const max = Math.max(...week.map((d) => d.total), 1)
  const W = 700
  const H = 160
  const gap = 14
  const barW = (W - gap * (week.length + 1)) / week.length

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H + 22}`} className="w-full" role="img" aria-label="Sales for the last 7 days">
        {week.map((d, i) => {
          const h = Math.max(Math.round((d.total / max) * (H - 8)), d.total > 0 ? 4 : 2)
          const x = gap + i * (barW + gap)
          const date = new Date(d.day + 'T00:00:00')
          const isToday = i === week.length - 1
          return (
            <g key={d.day}>
              <title>{`${date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}: ${formatMoney(d.total, currency)} · ${d.count} sales`}</title>
              <rect x={x} y={0} width={barW} height={H} rx={6} className="fill-slate-100" />
              <rect
                x={x}
                y={H - h}
                width={barW}
                height={h}
                rx={6}
                className={isToday ? 'fill-primary' : 'fill-primary/45'}
              />
              <text
                x={x + barW / 2}
                y={H + 16}
                textAnchor="middle"
                className={cn('text-[11px]', isToday ? 'fill-ink font-semibold' : 'fill-muted')}
              >
                {date.toLocaleDateString(undefined, { weekday: 'short' })}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** Stacked bar showing today's cash / card / credit split. */
function PaymentSplit({ byMethod, currency }: { byMethod: Dashboard['sales']['byMethod']; currency: string }) {
  const methods = [
    { key: 'cash', label: 'Cash', bar: 'bg-success', dot: 'bg-success' },
    { key: 'card', label: 'Card', bar: 'bg-primary', dot: 'bg-primary' },
    { key: 'credit', label: 'Credit', bar: 'bg-warning', dot: 'bg-warning' },
  ]
  const amount = (k: string) => byMethod.find((m) => m.method === k)?.total ?? 0
  const total = methods.reduce((a, m) => a + amount(m.key), 0)

  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
        {total > 0 &&
          methods.map((m) =>
            amount(m.key) > 0 ? (
              <div key={m.key} className={m.bar} style={{ width: `${(amount(m.key) / total) * 100}%` }} />
            ) : null
          )}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {methods.map((m) => (
          <div key={m.key} className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <span className={cn('h-2 w-2 rounded-full', m.dot)} /> {m.label}
            </div>
            <div className="truncate text-sm font-semibold">{formatMoney(amount(m.key), currency)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function DashboardPage() {
  const currency = useCurrency()
  const session = useSession()
  const isAdmin = session?.role === 'admin'

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<Dashboard>('reports:dashboard'),
    refetchInterval: 30_000,
  })

  if (isLoading || !data) return <Spinner />

  const yesterday = data.week.length >= 2 ? data.week[data.week.length - 2].total : 0
  const avgSale = data.sales.totals.count > 0 ? Math.round(data.sales.totals.total / data.sales.totals.count) : 0

  return (
    <div>
      <TrialBanner />
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {greeting()}
            {session?.name ? `, ${session.name.split(' ')[0]}` : ''}
          </h1>
          <p className="mt-0.5 text-sm text-muted">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <>
              <Link to="/products">
                <Button variant="secondary">
                  <Plus size={16} /> Add Product
                </Button>
              </Link>
              <Link to="/purchases/new">
                <Button variant="secondary">
                  <PackagePlus size={16} /> New Purchase
                </Button>
              </Link>
            </>
          )}
          <Link to="/pos">
            <Button size="lg">
              <ShoppingCart size={18} /> New Sale (F2)
            </Button>
          </Link>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Today's sales"
          value={formatMoney(data.sales.totals.total, currency)}
          valueClass="text-success"
          icon={<Banknote size={18} className="text-success" />}
          iconClass="bg-green-100"
          hint={<DeltaHint today={data.sales.totals.total} yesterday={yesterday} />}
        />
        <StatCard
          label="This month"
          value={formatMoney(data.month.total, currency)}
          icon={<CalendarDays size={18} className="text-primary" />}
          iconClass="bg-blue-100"
          hint={`${data.month.count} transactions`}
        />
        {isAdmin && data.todayProfit != null ? (
          <StatCard
            label="Today's profit"
            value={formatMoney(data.todayProfit, currency)}
            valueClass={data.todayProfit >= 0 ? 'text-success' : 'text-danger'}
            icon={<TrendingUp size={18} className="text-violet-600" />}
            iconClass="bg-violet-100"
            hint="revenue − cost of goods"
          />
        ) : (
          <StatCard
            label="Transactions today"
            value={String(data.sales.totals.count)}
            icon={<Receipt size={18} className="text-violet-600" />}
            iconClass="bg-violet-100"
            hint={avgSale > 0 ? `avg ${formatMoney(avgSale, currency)} per sale` : 'no sales yet'}
          />
        )}
        {isAdmin && data.monthProfit != null ? (
          <StatCard
            label="Monthly profit"
            value={formatMoney(data.monthProfit, currency)}
            valueClass={data.monthProfit >= 0 ? 'text-success' : 'text-danger'}
            icon={<Wallet size={18} className="text-amber-600" />}
            iconClass="bg-amber-100"
            hint="after expenses"
          />
        ) : (
          <StatCard
            label="Average sale"
            value={avgSale > 0 ? formatMoney(avgSale, currency) : '—'}
            icon={<Wallet size={18} className="text-amber-600" />}
            iconClass="bg-amber-100"
            hint="today"
          />
        )}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold">Last 7 days</h3>
            {isAdmin && (
              <Link to="/reports" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                Full reports <ArrowRight size={11} />
              </Link>
            )}
          </div>
          <WeekChart week={data.week} currency={currency} />
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <h3 className="mb-3 font-semibold">Today by payment method</h3>
            <PaymentSplit byMethod={data.sales.byMethod} currency={currency} />
          </Card>
          {isAdmin && (
            <div className="grid grid-cols-2 gap-4">
              <Card className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-100">
                  <Users size={18} className="text-danger" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-muted">Customers owe</div>
                  <div className="truncate text-lg font-bold text-danger">
                    {formatMoney(data.dues.customer_dues, currency)}
                  </div>
                  <Link to="/reports" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    Dues report <ArrowRight size={11} />
                  </Link>
                </div>
              </Card>
              <Card className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100">
                  <Truck size={18} className="text-warning" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-muted">We owe suppliers</div>
                  <div className="truncate text-lg font-bold text-warning">
                    {formatMoney(data.dues.supplier_dues, currency)}
                  </div>
                  <Link to="/suppliers" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    Suppliers <ArrowRight size={11} />
                  </Link>
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h3 className="font-semibold">Recent sales</h3>
            <Link to="/sales" className="text-xs text-primary hover:underline">View all</Link>
          </div>
          {data.recent.length === 0 ? (
            <div className="p-6 text-center text-muted">No sales yet today. Press F2 to start.</div>
          ) : (
            <table className="w-full text-left">
              <tbody>
                {data.recent.map((s) => (
                  <tr key={s.id} className="border-t border-line first:border-t-0 hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <Link to={`/sales/${s.id}`} className="font-medium text-primary hover:underline">
                        {s.invoice_number}
                      </Link>
                      <div className="text-xs text-muted">{s.customer_name ?? 'Walk-in'}</div>
                    </td>
                    <td className="px-4 py-2.5 text-xs capitalize text-muted">{s.payment_method}</td>
                    <td className="px-4 py-2.5">{s.status !== 'completed' && saleStatusBadge(s.status)}</td>
                    <td className="px-4 py-2.5 text-xs text-muted">{formatDateTime(s.created_at)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold">{formatMoney(s.total, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {isAdmin && (
          <Card className="p-0">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h3 className="flex items-center gap-2 font-semibold">
                <AlertTriangle size={16} className="text-warning" /> Low stock
                {data.lowStock.length > 0 && <Badge tone="amber">{data.lowStock.length}</Badge>}
              </h3>
              <Link to="/inventory" className="text-xs text-primary hover:underline">Inventory</Link>
            </div>
            {data.lowStock.length === 0 ? (
              <div className="p-6 text-center text-muted">All products are above their alert levels.</div>
            ) : (
              <table className="w-full text-left">
                <tbody>
                  {data.lowStock.map((p) => (
                    <tr key={p.id} className="border-t border-line first:border-t-0">
                      <td className="px-4 py-2.5 font-medium">{p.name}</td>
                      <td className="px-4 py-2.5 text-right">
                        <Badge tone={p.stock <= 0 ? 'red' : 'amber'}>
                          {p.stock} left (alert at {p.min_stock_alert})
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="border-t border-line p-3">
              <Link to="/purchases/new">
                <Button variant="secondary" size="sm" className="w-full">
                  <PackagePlus size={15} /> Restock via purchase
                </Button>
              </Link>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
