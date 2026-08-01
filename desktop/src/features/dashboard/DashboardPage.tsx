import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  CheckCircle2,
  CircleAlert,
  PackagePlus,
  Plus,
  ShieldCheck,
  ShoppingCart,
  Tags,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { api } from '../../lib/ipc'
import { useSession } from '../../stores/auth'
import { Badge, Button, Card, Spinner } from '../../components/ui'
import { cn } from '../../lib/utils'

interface DashboardOverview {
  stockHealth: { total: number; healthy: number; low: number; out: number }
  categories: { name: string; count: number }[]
  lowStock: { id: string; name: string; min_stock_alert: number; stock: number }[]
}

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function InventoryStat({
  label,
  value,
  detail,
  icon,
  tone,
}: {
  label: string
  value: number
  detail: string
  icon: ReactNode
  tone: 'blue' | 'green' | 'amber' | 'red'
}) {
  return (
    <Card className="flex items-start gap-3">
      <div
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
          tone === 'blue' && 'bg-blue-100 text-primary',
          tone === 'green' && 'bg-green-100 text-success',
          tone === 'amber' && 'bg-amber-100 text-warning',
          tone === 'red' && 'bg-red-100 text-danger'
        )}
      >
        {icon}
      </div>
      <div>
        <p className="text-xs font-medium text-muted">{label}</p>
        <p className="text-2xl font-bold leading-8">{value}</p>
        <p className="text-xs text-muted">{detail}</p>
      </div>
    </Card>
  )
}

function StockHealthChart({ health }: { health: DashboardOverview['stockHealth'] }) {
  const total = Math.max(health.total, 1)
  const healthyEnd = (health.healthy / total) * 100
  const lowEnd = healthyEnd + (health.low / total) * 100
  const background = health.total === 0
    ? '#e2e8f0'
    : `conic-gradient(#16a34a 0 ${healthyEnd}%, #f59e0b ${healthyEnd}% ${lowEnd}%, #dc2626 ${lowEnd}% 100%)`

  return (
    <Card>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Stock health</h2>
          <p className="text-xs text-muted">Current product availability</p>
        </div>
        <Link to="/inventory" className="text-xs text-primary hover:underline">View inventory</Link>
      </div>
      <div className="flex items-center justify-center gap-8">
        <div
          role="img"
          aria-label={`${health.healthy} healthy, ${health.low} low stock, ${health.out} out of stock`}
          className="relative h-40 w-40 shrink-0 rounded-full"
          style={{ background }}
        >
          <div className="absolute inset-5 flex flex-col items-center justify-center rounded-full bg-surface shadow-inner">
            <span className="text-3xl font-bold">{health.total}</span>
            <span className="text-xs text-muted">products</span>
          </div>
        </div>
        <div className="space-y-3 text-sm">
          <ChartLegend color="bg-success" label="Healthy" value={health.healthy} />
          <ChartLegend color="bg-warning" label="Low stock" value={health.low} />
          <ChartLegend color="bg-danger" label="Out of stock" value={health.out} />
        </div>
      </div>
    </Card>
  )
}

function ChartLegend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex min-w-32 items-center justify-between gap-5">
      <span className="flex items-center gap-2 text-muted">
        <span className={cn('h-2.5 w-2.5 rounded-full', color)} /> {label}
      </span>
      <span className="font-semibold">{value}</span>
    </div>
  )
}

function CategoryChart({ categories }: { categories: DashboardOverview['categories'] }) {
  const max = Math.max(...categories.map((category) => category.count), 1)

  return (
    <Card>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Product mix</h2>
          <p className="text-xs text-muted">Products grouped by category</p>
        </div>
        <Tags size={18} className="text-primary" />
      </div>
      {categories.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-muted">Add products to see category insights.</div>
      ) : (
        <div className="space-y-4">
          {categories.map((category) => (
            <div key={category.name}>
              <div className="mb-1.5 flex items-center justify-between gap-4 text-sm">
                <span className="truncate font-medium">{category.name}</span>
                <span className="text-muted">{category.count}</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300"
                  style={{ width: `${Math.max((category.count / max) * 100, 4)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

export function DashboardPage() {
  const session = useSession()
  const isAdmin = session?.role === 'admin'
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: () => api<DashboardOverview>('reports:dashboard'),
    enabled: isAdmin,
    refetchInterval: 30_000,
  })

  if (isAdmin && isLoading) return <Spinner />

  const lowStock = data?.lowStock ?? []
  const stockHealth = data?.stockHealth ?? { total: 0, healthy: 0, low: 0, out: 0 }
  const categories = data?.categories ?? []

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {greeting()}
            {session?.name ? `, ${session.name.split(' ')[0]}` : ''}
          </h1>
          <p className="mt-0.5 text-sm text-muted">
            {new Date().toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin ? (
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
          ) : null}
          <Link to="/pos">
            <Button size="lg">
              <ShoppingCart size={18} /> New Sale (F2)
            </Button>
          </Link>
        </div>
      </div>

      <Card className="mb-4 flex items-start justify-between gap-4 border-blue-200 bg-blue-50">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-100">
            <ShieldCheck size={21} className="text-primary" />
          </div>
          <div>
            <h2 className="font-semibold">Financial information is protected</h2>
            <p className="mt-1 text-sm text-muted">
              Sales totals, profit, dues and payment-method details are not displayed on the dashboard.
              {isAdmin ? ' Open Reports when you need to review them.' : ' Only administrators can open financial reports.'}
            </p>
          </div>
        </div>
        {isAdmin ? (
          <Link to="/reports">
            <Button variant="secondary">
              <BarChart3 size={16} /> Open Reports
            </Button>
          </Link>
        ) : null}
      </Card>

      {isAdmin ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <InventoryStat
              label="Total products"
              value={stockHealth.total}
              detail="active catalogue items"
              icon={<Boxes size={19} />}
              tone="blue"
            />
            <InventoryStat
              label="Healthy stock"
              value={stockHealth.healthy}
              detail="above alert level"
              icon={<CheckCircle2 size={19} />}
              tone="green"
            />
            <InventoryStat
              label="Low stock"
              value={stockHealth.low}
              detail="restock soon"
              icon={<AlertTriangle size={19} />}
              tone="amber"
            />
            <InventoryStat
              label="Out of stock"
              value={stockHealth.out}
              detail="needs attention"
              icon={<CircleAlert size={19} />}
              tone="red"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <StockHealthChart health={stockHealth} />
            <CategoryChart categories={categories} />
          </div>

          <Card className="p-0">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="flex items-center gap-2 font-semibold">
                <AlertTriangle size={16} className="text-warning" /> Items requiring attention
                {lowStock.length > 0 ? <Badge tone="amber">{lowStock.length}</Badge> : null}
              </h2>
              <Link to="/inventory" className="text-xs text-primary hover:underline">Inventory</Link>
            </div>
            {lowStock.length === 0 ? (
              <div className="p-8 text-center text-muted">All products are above their alert levels.</div>
            ) : (
              <div className="grid grid-cols-1 divide-y divide-line lg:grid-cols-2 lg:divide-x lg:divide-y-0">
                {lowStock.map((product) => (
                  <div key={product.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="truncate font-medium">{product.name}</span>
                    <Badge tone={product.stock <= 0 ? 'red' : 'amber'}>
                      {product.stock} left
                    </Badge>
                  </div>
                ))}
              </div>
            )}
            <div className="border-t border-line p-3">
              <Link to="/purchases/new">
                <Button variant="secondary" size="sm" className="w-full">
                  <PackagePlus size={15} /> Restock via purchase
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      ) : (
        <Card className="py-10 text-center">
          <ShoppingCart className="mx-auto text-primary" size={30} />
          <h2 className="mt-3 text-lg font-semibold">Ready for the next customer</h2>
          <p className="mt-1 text-muted">Press F2 or use New Sale to open the POS screen.</p>
        </Card>
      )}
    </div>
  )
}
