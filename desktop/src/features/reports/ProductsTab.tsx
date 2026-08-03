// Product performance reports: product-wise sales, best sellers, slow movers, category-wise.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/ipc'
import { formatMoney } from '../../lib/money'
import { formatDate, rangeFromInputs } from '../../lib/utils'
import { useCurrency } from '../../stores/auth'
import { Card, Spinner } from '../../components/ui'
import { section } from '../../lib/export'
import { ReportExport, ReportTable, Segmented, StatCard, Td, Th } from './shared'

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

  // `rows` is what the table shows — best sellers is a top-20 slice, so the
  // export follows the slice rather than the full result set.
  const rows = best ? [...data].sort((a, b) => b.qty - a.qty).slice(0, 20) : data
  const totals = data.reduce(
    (a, r) => ({ qty: a.qty + r.qty, revenue: a.revenue + r.revenue, profit: a.profit + r.profit }),
    { qty: 0, revenue: 0, profit: 0 }
  )

  const exportBar = (
    <ReportExport
      module={best ? 'BestSellersReport' : 'ProductSalesReport'}
      from={from}
      to={to}
      title={best ? 'Best Sellers (top 20 by units sold)' : 'Product Sales Report'}
      stats={[
        { label: 'Products sold', value: String(data.length) },
        { label: 'Units sold', value: String(totals.qty) },
        { label: 'Revenue', value: formatMoney(totals.revenue, currency) },
        { label: 'Gross profit', value: formatMoney(totals.profit, currency) },
      ]}
      sections={[
        section({
          columns: [
            { header: 'Product', value: (r: ProductSalesRow) => r.name },
            { header: 'Category', value: (r: ProductSalesRow) => r.category ?? '' },
            { header: 'Qty sold', value: (r: ProductSalesRow) => r.qty, align: 'right' },
            { header: 'Returned', value: (r: ProductSalesRow) => r.returned, align: 'right' },
            { header: 'Revenue', value: (r: ProductSalesRow) => r.revenue, money: true },
            { header: 'Gross profit', value: (r: ProductSalesRow) => r.profit, money: true },
          ],
          rows,
          footer: best
            ? undefined
            : ['Total', '', totals.qty, data.reduce((a, r) => a + r.returned, 0), totals.revenue, totals.profit],
        }),
      ]}
      note="Revenue and gross profit are before returns — refund amounts live in the Returns report."
    />
  )

  if (data.length === 0) {
    return (
      <div className="space-y-4">
        {exportBar}
        <Card><p className="text-muted">No sales in range.</p></Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {exportBar}
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
      <ReportExport
        module="SlowMoversReport"
        from={from}
        to={to}
        title="Slow Movers"
        stats={[
          { label: 'Slow / unsold products', value: String(data.length) },
          { label: 'Not sold at all in range', value: String(data.filter((r) => r.qty_sold === 0).length) },
          { label: 'Cost tied up in unsold stock', value: formatMoney(deadStockValue, currency) },
        ]}
        sections={[
          section({
            columns: [
              { header: 'Product', value: (r: SlowMoverRow) => r.name },
              { header: 'Category', value: (r) => r.category ?? '' },
              { header: 'Sold in range', value: (r) => r.qty_sold, align: 'right' },
              { header: 'Stock on hand', value: (r) => r.stock, align: 'right' },
              { header: 'Stock value (cost)', value: (r) => Math.max(0, r.stock_value), money: true },
              { header: 'Last sold', value: (r) => (r.last_sold_at ? formatDate(r.last_sold_at) : 'Never') },
            ],
            rows: data,
            footer: [
              'Total',
              '',
              data.reduce((a, r) => a + r.qty_sold, 0),
              data.reduce((a, r) => a + r.stock, 0),
              data.reduce((a, r) => a + Math.max(0, r.stock_value), 0),
              '',
            ],
          }),
        ]}
        note="Ordered by fewest units sold in the range. “Last sold” looks at all time, not just the range."
      />
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
  const share = (revenue: number) => (revenueTotal > 0 ? `${((revenue / revenueTotal) * 100).toFixed(1)}%` : '')

  return (
    <div className="space-y-4">
    <ReportExport
      module="CategorySalesReport"
      from={from}
      to={to}
      title="Sales by Category"
      sections={[
        section({
          columns: [
            { header: 'Category', value: (r: CategorySalesRow) => r.category },
            { header: 'Products', value: (r) => r.products, align: 'right' },
            { header: 'Units sold', value: (r) => r.qty, align: 'right' },
            { header: 'Revenue', value: (r) => r.revenue, money: true },
            { header: 'Share', value: (r) => share(r.revenue), align: 'right' },
            { header: 'Gross profit', value: (r) => r.profit, money: true },
          ],
          rows: data,
          footer: [
            'Total',
            data.reduce((a, r) => a + r.products, 0),
            data.reduce((a, r) => a + r.qty, 0),
            revenueTotal,
            revenueTotal > 0 ? '100%' : '',
            data.reduce((a, r) => a + r.profit, 0),
          ],
        }),
      ]}
    />
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
          <Td right className="text-muted">{share(r.revenue) || '—'}</Td>
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
    </div>
  )
}
