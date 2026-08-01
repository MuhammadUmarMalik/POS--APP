import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  BarChart3,
  PackagePlus,
  Plus,
  ShieldCheck,
  ShoppingCart,
} from 'lucide-react'
import { api } from '../../lib/ipc'
import { useSession } from '../../stores/auth'
import { Badge, Button, Card, Spinner } from '../../components/ui'
import { TrialBanner } from '../settings/TrialBanner'

interface DashboardOverview {
  lowStock: { id: string; name: string; min_stock_alert: number; stock: number }[]
}

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
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
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="flex items-center gap-2 font-semibold">
              <AlertTriangle size={16} className="text-warning" /> Low stock
              {lowStock.length > 0 ? <Badge tone="amber">{lowStock.length}</Badge> : null}
            </h2>
            <Link to="/inventory" className="text-xs text-primary hover:underline">Inventory</Link>
          </div>
          {lowStock.length === 0 ? (
            <div className="p-8 text-center text-muted">All products are above their alert levels.</div>
          ) : (
            <table className="w-full text-left">
              <tbody>
                {lowStock.map((product) => (
                  <tr key={product.id} className="border-t border-line first:border-t-0">
                    <td className="px-4 py-3 font-medium">{product.name}</td>
                    <td className="px-4 py-3 text-right">
                      <Badge tone={product.stock <= 0 ? 'red' : 'amber'}>
                        {product.stock} left (alert at {product.min_stock_alert})
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
