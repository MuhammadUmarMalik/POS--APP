// Product performance reports: product-wise sales, best sellers, slow movers, category-wise.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/ipc'
import { formatMoney } from '../../lib/money'
import { formatDate, rangeFromInputs } from '../../lib/utils'
import { useCurrency } from '../../stores/auth'
import { Card, Spinner } from '../../components/ui'
import { ReportTable, Segmented, StatCard, Td, Th } from './shared'

interface ProductSalesRow {
  id: string
  name: string
  category: string | null
  qty: number
  returned: number
  revenue: number
  cogs: number
  profit: number
}

interface CategorySalesRow {
  category: string
  products: number
  qty: number
  revenue: number
  profit: number
}

interface SlowMoverRow {
  id: string
  name: string
  category: string | null
  stock: number
  stock_value: number
  qty_sold: number
  last_sold_at: string | null
}

type Mode = 'products' | 'best' | 'slow' | 'category'

export function ProductsTab({ from, to }: { from: string; to: string }) {
  const [mode, setMode] = useState<Mode>('products')
  return (
    <div className="space-y-4">
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          ['products', 'Product sales'],
          ['best', 'Best sellers'],
          ['slow', 'Slow movers'],
          ['category', 'By category'],
        ]}
      />
      {(mode === 'products' || mode === 'best') && <ProductSalesView from={from} to={to} best={mode === 'best'} />}
      {mode === 'slow' && <SlowMoversView from={from} to={to} />}
      {mode === 'category' && <CategoryView from={from} to={to} />}
    </div>
  )
}

function ProductSalesView({ from, to, best }: { from: string; to: string; best: boolean }) {
  const currency = useCurrency()
  const { data, isLoading } = useQuery({
    queryKey: ['report-product-sales', from, to],
    queryFn: () => api<ProductSalesRow[]>('reports:productSales', rangeFromInputs(from, to)),
  })
  if (isLoading || !data) return <Spinner />
  if (data.length === 0) return <Card><p className="text-muted">No sales in range.</p></Card>

  const rows = best ? [...data].sort((a, b) => b.qty - a.qty).slice(0, 20) : data
  const totals = data.reduce(
    (a, r) => ({ qty: a.qty + r.qty, revenue: a.revenue + r.revenue, profit: a.profit + r.profit }),
    { qty: 0, revenue: 0, profit: 0 }
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Products sold" value={String(data.length)} />
        <StatCard label="Units sold" value={String(totals.qty)} />
        <StatCard label="Revenue" value={formatMoney(totals.revenue, currency)} tone="green" />
        <StatCard
          label="Gross profit"
          value={formatMoney(totals.profit, currency)}
          tone={totals.profit >= 0 ? 'green' : 'red'}
        />
      </div>
      <ReportTable
        head={
          <>
            {best && <Th>#</Th>}
            <Th>Product</Th>
            <Th>Category</Th>
            <Th right>Qty sold</Th>
            <Th right>Returned</Th>
            <Th right>Revenue</Th>
            <Th right>Gross profit</Th>
          </>
        }
      >
        {rows.map((r, i) => (
          <tr key={r.id} className="border-t border-line">
            {best && <Td className="text-muted">{i + 1}</Td>}
            <Td className="font-medium">{r.name}</Td>
            <Td className="text-muted">{r.category ?? '—'}</Td>
            <Td right>{r.qty}</Td>
            <Td right className="text-muted">{r.returned || '—'}</Td>
            <Td right className="font-medium">{formatMoney(r.revenue, currency)}</Td>
            <Td right className={r.profit >= 0 ? 'text-success' : 'text-danger'}>
              {formatMoney(r.profit, currency)}
            </Td>
          </tr>
        ))}
        {!best && (
          <tr className="border-t-2 border-ink">
            <Td className="font-bold">Total</Td>
            <Td />
            <Td right className="font-bold">{totals.qty}</Td>
            <Td />
            <Td right className="font-bold">{formatMoney(totals.revenue, currency)}</Td>
            <Td right className="font-bold">{formatMoney(totals.profit, currency)}</Td>
          </tr>
        )}
      </ReportTable>
      <p className="text-xs text-muted">
        Revenue and gross profit are before returns — returned quantities are shown in their own column, and refund
        amounts live in the Returns report.
      </p>
    </div>
  )
}

function SlowMoversView({ from, to }: { from: string; to: string }) {
  const currency = useCurrency()
  const { data, isLoading } = useQuery({
    queryKey: ['report-slow-movers', from, to],
    queryFn: () => api<SlowMoverRow[]>('reports:slowMovers', rangeFromInputs(from, to)),
  })
  if (isLoading || !data) return <Spinner />
  if (data.length === 0) return <Card><p className="text-muted">No products yet.</p></Card>

  const deadStockValue = data.filter((r) => r.qty_sold === 0).reduce((a, r) => a + Math.max(0, r.stock_value), 0)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Slow / unsold products" value={String(data.length)} />
        <StatCard label="Not sold at all in range" value={String(data.filter((r) => r.qty_sold === 0).length)} />
        <StatCard label="Cost tied up in unsold stock" value={formatMoney(deadStockValue, currency)} tone="red" />
      </div>
      <ReportTable
        head={
          <>
            <Th>Product</Th>
            <Th>Category</Th>
            <Th right>Sold in range</Th>
            <Th right>Stock on hand</Th>
            <Th right>Stock value (cost)</Th>
            <Th right>Last sold</Th>
          </>
        }
      >
        {data.map((r) => (
          <tr key={r.id} className="border-t border-line">
            <Td className="font-medium">{r.name}</Td>
            <Td className="text-muted">{r.category ?? '—'}</Td>
            <Td right className={r.qty_sold === 0 ? 'font-medium text-danger' : ''}>{r.qty_sold}</Td>
            <Td right>{r.stock}</Td>
            <Td right>{formatMoney(Math.max(0, r.stock_value), currency)}</Td>
            <Td right className="text-muted">{r.last_sold_at ? formatDate(r.last_sold_at) : 'Never'}</Td>
          </tr>
        ))}
      </ReportTable>
      <p className="text-xs text-muted">
        Products ordered by fewest units sold in the selected range. “Last sold” looks at all time, not just the range.
      </p>
    </div>
  )
}

function CategoryView({ from, to }: { from: string; to: string }) {
  const currency = useCurrency()
  const { data, isLoading } = useQuery({
    queryKey: ['report-category-sales', from, to],
    queryFn: () => api<CategorySalesRow[]>('reports:categorySales', rangeFromInputs(from, to)),
  })
  if (isLoading || !data) return <Spinner />
  if (data.length === 0) return <Card><p className="text-muted">No sales in range.</p></Card>

  const revenueTotal = data.reduce((a, r) => a + r.revenue, 0)

  return (
    <ReportTable
      head={
        <>
          <Th>Category</Th>
          <Th right>Products</Th>
          <Th right>Units sold</Th>
          <Th right>Revenue</Th>
          <Th right>Share</Th>
          <Th right>Gross profit</Th>
        </>
      }
    >
      {data.map((r) => (
        <tr key={r.category} className="border-t border-line">
          <Td className="font-medium">{r.category}</Td>
          <Td right className="text-muted">{r.products}</Td>
          <Td right>{r.qty}</Td>
          <Td right className="font-medium">{formatMoney(r.revenue, currency)}</Td>
          <Td right className="text-muted">
            {revenueTotal > 0 ? `${((r.revenue / revenueTotal) * 100).toFixed(1)}%` : '—'}
          </Td>
          <Td right className={r.profit >= 0 ? 'text-success' : 'text-danger'}>
            {formatMoney(r.profit, currency)}
          </Td>
        </tr>
      ))}
      <tr className="border-t-2 border-ink">
        <Td className="font-bold">Total</Td>
        <Td right className="font-bold">{data.reduce((a, r) => a + r.products, 0)}</Td>
        <Td right className="font-bold">{data.reduce((a, r) => a + r.qty, 0)}</Td>
        <Td right className="font-bold">{formatMoney(revenueTotal, currency)}</Td>
        <Td right className="font-bold text-muted">100%</Td>
        <Td right className="font-bold">{formatMoney(data.reduce((a, r) => a + r.profit, 0), currency)}</Td>
      </tr>
    </ReportTable>
  )
}
