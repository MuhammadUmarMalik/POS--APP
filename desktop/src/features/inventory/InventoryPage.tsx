import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SlidersHorizontal, History } from 'lucide-react'
import { api } from '../../lib/ipc'
import { formatMoney } from '../../lib/money'
import { useCurrency } from '../../stores/auth'
import type { ProductWithStock } from '../../shared/types'
import { Badge, Button, Card, EmptyState, Input, PageTitle, Spinner } from '../../components/ui'
import { stockTone } from '../products/ProductsPage'
import { AdjustmentModal } from './AdjustmentModal'
import { MovementsModal } from './MovementsModal'

export function InventoryPage() {
  const currency = useCurrency()
  const [search, setSearch] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const [adjusting, setAdjusting] = useState<ProductWithStock | null>(null)
  const [movementsFor, setMovementsFor] = useState<ProductWithStock | null>(null)

  const { data: products, isLoading } = useQuery({
    queryKey: ['products', search, '', lowOnly],
    queryFn: () =>
      api<ProductWithStock[]>('products:list', {
        search: search || undefined,
        low_stock_only: lowOnly || undefined,
      }),
  })

  const valuation = useMemo(() => {
    let cost = 0, retail = 0
    for (const p of products ?? []) {
      if (p.stock > 0) {
        cost += p.stock * p.cost_price
        retail += p.stock * p.sale_price
      }
    }
    return { cost, retail }
  }, [products])

  return (
    <div>
      <PageTitle>Inventory</PageTitle>

      <div className="mb-4 grid grid-cols-3 gap-4">
        <Card>
          <div className="text-xs text-muted">Products</div>
          <div className="text-2xl font-bold">{products?.length ?? '—'}</div>
        </Card>
        <Card>
          <div className="text-xs text-muted">Stock value (cost)</div>
          <div className="text-2xl font-bold">{formatMoney(valuation.cost, currency)}</div>
        </Card>
        <Card>
          <div className="text-xs text-muted">Stock value (retail)</div>
          <div className="text-2xl font-bold">{formatMoney(valuation.retail, currency)}</div>
        </Card>
      </div>

      <Card className="mb-4 flex items-center gap-3 p-3">
        <Input
          placeholder="Search products…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
          Low stock only
        </label>
      </Card>

      <Card className="overflow-x-auto p-0">
        {isLoading ? (
          <Spinner />
        ) : !products || products.length === 0 ? (
          <EmptyState message={lowOnly ? 'Nothing is low on stock. 🎉' : 'No products found.'} />
        ) : (
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Stock</th>
                <th className="px-4 py-3 text-right">Alert level</th>
                <th className="px-4 py-3 text-right">Value (cost)</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-t border-line hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium">{p.name}</td>
                  <td className="px-4 py-2.5 text-muted">{p.category_name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Badge tone={stockTone(p)}>{p.stock} {p.unit}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right text-muted">{p.min_stock_alert}</td>
                  <td className="px-4 py-2.5 text-right">
                    {p.stock > 0 ? formatMoney(p.stock * p.cost_price, currency) : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      <Button variant="secondary" size="sm" onClick={() => setAdjusting(p)}>
                        <SlidersHorizontal size={13} /> Adjust
                      </Button>
                      <button
                        title="History"
                        className="rounded p-1.5 text-muted hover:bg-slate-200"
                        onClick={() => setMovementsFor(p)}
                      >
                        <History size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {adjusting && <AdjustmentModal product={adjusting} onClose={() => setAdjusting(null)} />}
      {movementsFor && <MovementsModal product={movementsFor} onClose={() => setMovementsFor(null)} />}
    </div>
  )
}
