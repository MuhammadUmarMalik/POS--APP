// Stock reports: current stock on hand + valuation, and the shop-wide movement log.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/ipc'
import { formatMoney } from '../../lib/money'
import { formatDateTime, rangeFromInputs } from '../../lib/utils'
import { useCurrency } from '../../stores/auth'
import type { ProductWithStock } from '../../shared/types'
import { Badge, Card, Spinner } from '../../components/ui'
import { stockTone } from '../products/ProductsPage'
import { section } from '../../lib/export'
import { ReportExport, ReportTable, Segmented, StatCard, Td, Th } from './shared'

type Mode = 'onhand' | 'movements'

export function StockTab({ from, to }: { from: string; to: string }) {
  const [mode, setMode] = useState<Mode>('onhand')
  return (
    <div className="space-y-4">
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          ['onhand', 'Stock on hand'],
          ['movements', 'Movement log'],
        ]}
      />
      {mode === 'onhand' && <OnHandView />}
      {mode === 'movements' && <MovementsView from={from} to={to} />}
    </div>
  )
}

function OnHandView() {
  const currency = useCurrency()
  const [lowOnly, setLowOnly] = useState(false)
  const { data: products, isLoading } = useQuery({
    queryKey: ['products', '', '', false],
    queryFn: () => api<ProductWithStock[]>('products:list'),
  })
  if (isLoading || !products) return <Spinner />

  const totalCost = products.reduce((a, p) => a + Math.max(0, p.stock) * (p.cost_price ?? 0), 0)
  const totalSale = products.reduce((a, p) => a + Math.max(0, p.stock) * p.sale_price, 0)
  const low = products.filter((p) => p.stock <= p.min_stock_alert)
  const rows = lowOnly ? low : products

  return (
    <div className="space-y-4">
      {/* Exports `rows`, not `products` — the low-stock checkbox must carry
          through to the file exactly as it filters the table on screen. */}
      <ReportExport
        module="StockReport-OnHand"
        title="Stock on Hand"
        meta={[
          ['Filter', lowOnly ? 'Low / out of stock only' : 'All products'],
          ['Snapshot', new Date().toLocaleString()],
        ]}
        stats={[
          { label: 'Products', value: String(products.length) },
          { label: 'Stock valuation (cost)', value: formatMoney(totalCost, currency) },
          { label: 'Stock valuation (sale price)', value: formatMoney(totalSale, currency) },
          { label: 'Low / out of stock', value: String(low.length) },
        ]}
        sections={[
          section({
            columns: [
              { header: 'Product', value: (p: ProductWithStock) => p.name },
              { header: 'Category', value: (p) => p.category_name ?? '' },
              { header: 'Stock', value: (p) => p.stock, align: 'right' },
              { header: 'Alert level', value: (p) => p.min_stock_alert, align: 'right' },
              { header: 'Unit cost', value: (p) => (p.cost_price ?? 0), money: true },
              { header: 'Value (cost)', value: (p) => Math.max(0, p.stock) * (p.cost_price ?? 0), money: true },
            ],
            rows,
            footer: [
              'Total',
              '',
              rows.reduce((a, p) => a + p.stock, 0),
              '',
              '',
              rows.reduce((a, p) => a + Math.max(0, p.stock) * (p.cost_price ?? 0), 0),
            ],
          }),
        ]}
        note="Snapshot of stock right now — the report date range does not apply to this view."
      />
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Products" value={String(products.length)} />
        <StatCard label="Stock valuation (cost)" value={formatMoney(totalCost, currency)} />
        <StatCard label="Stock valuation (sale price)" value={formatMoney(totalSale, currency)} tone="green" />
        <StatCard label="Low / out of stock" value={String(low.length)} tone={low.length > 0 ? 'red' : 'green'} />
      </div>
      <label className="no-print flex w-fit cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
        Show only low / out of stock
      </label>
      <ReportTable
        head={
          <>
            <Th>Product</Th>
            <Th>Category</Th>
            <Th right>Stock</Th>
            <Th right>Alert level</Th>
            <Th right>Unit cost</Th>
            <Th right>Value (cost)</Th>
          </>
        }
      >
        {rows.length === 0 ? (
          <tr>
            <td colSpan={6} className="px-4 py-6 text-center text-muted">
              {lowOnly ? 'Nothing is low on stock. 🎉' : 'No products yet.'}
            </td>
          </tr>
        ) : (
          rows.map((p) => (
            <tr key={p.id} className="border-t border-line">
              <Td>{p.name}</Td>
              <Td className="text-muted">{p.category_name ?? '—'}</Td>
              <Td right><Badge tone={stockTone(p)}>{p.stock}</Badge></Td>
              <Td right className="text-muted">{p.min_stock_alert}</Td>
              <Td right>{formatMoney((p.cost_price ?? 0), currency)}</Td>
              <Td right>{formatMoney(Math.max(0, p.stock) * (p.cost_price ?? 0), currency)}</Td>
            </tr>
          ))
        )}
      </ReportTable>
      <p className="text-xs text-muted">
        Snapshot of stock right now — the date range above doesn't apply to this view. For a product's full history,
        open Ledgers → Product ledger.
      </p>
    </div>
  )
}

interface StockMovementsReport {
  rows: {
    id: string
    created_at: string
    change_type: string
    quantity_change: number
    reason: string | null
    product: string | null
    user: string | null
  }[]
  byType: { change_type: string; count: number; units_in: number; units_out: number }[]
}

const TYPE_LABELS: Record<string, string> = {
  sale: 'Sale',
  purchase: 'Purchase',
  sale_return: 'Sale return',
  purchase_return: 'Purchase return',
  adjustment: 'Adjustment',
  opening: 'Opening stock',
}

function movementTone(type: string): 'green' | 'amber' | 'red' | 'blue' | 'slate' {
  switch (type) {
    case 'sale': return 'red'
    case 'purchase': return 'green'
    case 'sale_return': return 'blue'
    case 'purchase_return': return 'amber'
    case 'adjustment': return 'slate'
    default: return 'slate'
  }
}

function MovementsView({ from, to }: { from: string; to: string }) {
  const [type, setType] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['report-stock-movements', from, to, type],
    queryFn: () =>
      api<StockMovementsReport>('reports:stockMovements', {
        ...rangeFromInputs(from, to),
        ...(type ? { change_type: type } : {}),
      }),
  })
  if (isLoading || !data) return <Spinner />

  const unitsIn = data.byType.reduce((a, t) => a + t.units_in, 0)
  const unitsOut = data.byType.reduce((a, t) => a + t.units_out, 0)

  return (
    <div className="space-y-4">
      <ReportExport
        module="StockReport-Movements"
        from={from}
        to={to}
        title="Stock Movement Log"
        meta={[['Movement type', type ? (TYPE_LABELS[type] ?? type) : 'All']]}
        stats={[
          { label: 'Units in', value: `+${unitsIn}` },
          { label: 'Units out', value: `-${unitsOut}` },
          { label: 'Net change', value: String(unitsIn - unitsOut) },
        ]}
        sections={[
          section({
            title: 'By movement type',
            columns: [
              {
                header: 'Type',
                value: (t: StockMovementsReport['byType'][number]) => TYPE_LABELS[t.change_type] ?? t.change_type,
              },
              { header: 'Entries', value: (t) => t.count, align: 'right' },
              { header: 'Units in', value: (t) => t.units_in, align: 'right' },
              { header: 'Units out', value: (t) => t.units_out, align: 'right' },
            ],
            rows: data.byType,
            footer: ['Total', data.byType.reduce((a, t) => a + t.count, 0), unitsIn, unitsOut],
          }),
          section({
            title: 'Movements',
            columns: [
              { header: 'Time', value: (r: StockMovementsReport['rows'][number]) => formatDateTime(r.created_at) },
              { header: 'Product', value: (r) => r.product ?? '' },
              { header: 'Type', value: (r) => TYPE_LABELS[r.change_type] ?? r.change_type },
              { header: 'Change', value: (r) => r.quantity_change, align: 'right' },
              { header: 'Reason', value: (r) => r.reason ?? '' },
              { header: 'By', value: (r) => r.user ?? '' },
            ],
            rows: data.rows,
          }),
        ]}
        note="Every stock change in the shop, newest first (latest 500). Stock is never edited directly — this log is the source of truth."
      />
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Units in" value={`+${unitsIn}`} tone="green" />
        <StatCard label="Units out" value={`-${unitsOut}`} tone="red" />
        <StatCard label="Net change" value={String(unitsIn - unitsOut)} tone={unitsIn - unitsOut >= 0 ? 'green' : 'red'} />
      </div>
      {data.byType.length > 0 && (
        <Card>
          <h3 className="mb-3 font-semibold">By movement type</h3>
          <table className="w-full text-left">
            <tbody>
              {data.byType.map((t) => (
                <tr key={t.change_type} className="border-t border-line">
                  <td className="py-2">{TYPE_LABELS[t.change_type] ?? t.change_type}</td>
                  <td className="py-2 text-right text-muted">{t.count} entries</td>
                  <td className="py-2 text-right text-success">{t.units_in ? `+${t.units_in}` : '—'}</td>
                  <td className="py-2 text-right text-danger">{t.units_out ? `-${t.units_out}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Segmented
        value={type}
        onChange={setType}
        options={[
          ['', 'All'],
          ['sale', 'Sales'],
          ['purchase', 'Purchases'],
          ['sale_return', 'Sale returns'],
          ['purchase_return', 'Purchase returns'],
          ['adjustment', 'Adjustments'],
        ]}
      />
      {data.rows.length === 0 ? (
        <Card><p className="text-muted">No stock movements in range.</p></Card>
      ) : (
        <ReportTable
          head={
            <>
              <Th>Time</Th>
              <Th>Product</Th>
              <Th>Type</Th>
              <Th right>Change</Th>
              <Th>Reason</Th>
              <Th>By</Th>
            </>
          }
        >
          {data.rows.map((r) => (
            <tr key={r.id} className="border-t border-line">
              <Td className="whitespace-nowrap text-muted">{formatDateTime(r.created_at)}</Td>
              <Td className="font-medium">{r.product ?? '—'}</Td>
              <Td><Badge tone={movementTone(r.change_type)}>{TYPE_LABELS[r.change_type] ?? r.change_type}</Badge></Td>
              <Td right className={r.quantity_change >= 0 ? 'font-medium text-success' : 'font-medium text-danger'}>
                {r.quantity_change >= 0 ? `+${r.quantity_change}` : r.quantity_change}
              </Td>
              <Td className="max-w-56 truncate text-muted">{r.reason ?? '—'}</Td>
              <Td className="text-muted">{r.user ?? '—'}</Td>
            </tr>
          ))}
        </ReportTable>
      )}
      <p className="text-xs text-muted">
        Every stock change in the shop, newest first (latest 500 shown). Stock is never edited directly — this log is
        the source of truth.
      </p>
    </div>
  )
}
