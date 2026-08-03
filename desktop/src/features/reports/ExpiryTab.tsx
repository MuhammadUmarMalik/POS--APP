import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/ipc'
import { formatMoney } from '../../lib/money'
import { useCurrency } from '../../stores/auth'
import { Card, Select, Spinner } from '../../components/ui'
import { section } from '../../lib/export'
import type { ExpiryReport, ExpiryRow } from '../../shared/types'
import { ReportExport, ReportTable, StatCard, Td, Th } from './shared'

/**
 * Batches at or past their expiry date, with the stock still on the shelf and
 * what it cost. Only reachable when the shop tracks batches, so it never has to
 * explain itself to a shop that does not.
 */
export function ExpiryTab() {
  const currency = useCurrency()
  const [days, setDays] = useState<number | undefined>(undefined)
  const { data, isLoading } = useQuery({
    queryKey: ['report-expiry', days ?? 'default'],
    queryFn: () => api<ExpiryReport>('reports:expiry', days ? { days } : {}),
  })
  if (isLoading || !data) return <Spinner />

  if (!data.enabled) {
    return (
      <Card>
        <p className="text-muted">
          Batch &amp; expiry tracking is off. Turn it on in Settings to use this report.
        </p>
      </Card>
    )
  }

  const label = (r: ExpiryRow) =>
    r.days_left < 0 ? `Expired ${-r.days_left}d ago` : `${r.days_left}d left`

  return (
    <div className="space-y-4">
      <ReportExport
        module="ExpiryReport"
        title="Expiry Report"
        stats={[
          { label: 'Expired batches', value: String(data.totals.expired) },
          { label: `Expiring within ${data.threshold_days} days`, value: String(data.totals.expiring) },
          { label: 'Stock value at risk', value: formatMoney(data.totals.value ?? 0, currency) },
        ]}
        sections={[
          section({
            columns: [
              { header: 'Product', value: (r: ExpiryRow) => r.product_name },
              { header: 'SKU', value: (r) => r.sku ?? '' },
              { header: 'Category', value: (r) => r.category_name ?? '' },
              { header: 'Batch', value: (r) => r.batch_number ?? '' },
              { header: 'Expiry', value: (r) => r.expiry_date },
              { header: 'Status', value: (r) => label(r) },
              { header: 'Stock', value: (r) => r.stock, align: 'right' },
              { header: 'Value at cost', value: (r) => r.value, money: true },
            ],
            rows: data.rows,
            footer: ['Total', '', '', '', '', '', data.rows.reduce((a, r) => a + r.stock, 0), data.totals.value],
            emptyText: 'Nothing expired or expiring.',
          }),
        ]}
        note={`Counts batches with stock remaining whose expiry date is within ${data.threshold_days} days or already past. Value is at cost price.`}
      />

      <div className="no-print flex items-end gap-3">
        <label className="text-xs text-muted">
          Window
          <Select
            value={String(days ?? data.threshold_days)}
            onChange={(e) => setDays(Number(e.target.value))}
            className="mt-1"
          >
            <option value="30">30 days</option>
            <option value="60">60 days</option>
            <option value="90">90 days</option>
            <option value="180">180 days</option>
          </Select>
        </label>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Expired batches" value={String(data.totals.expired)} tone="red" />
        <StatCard
          label={`Expiring within ${data.threshold_days} days`}
          value={String(data.totals.expiring)}
        />
        <StatCard label="Stock value at risk" value={formatMoney(data.totals.value ?? 0, currency)} tone="red" />
      </div>

      <ReportTable
        head={
          <>
            <Th>Product</Th>
            <Th>Batch</Th>
            <Th>Expiry</Th>
            <Th>Status</Th>
            <Th right>Stock</Th>
            <Th right>Value at cost</Th>
          </>
        }
      >
        {data.rows.map((r) => (
          <tr key={r.batch_id} className="border-t border-line">
            <Td className="font-medium">
              {r.product_name}
              {r.category_name && <span className="ml-2 text-xs text-muted">{r.category_name}</span>}
            </Td>
            <Td className="text-muted">{r.batch_number ?? '—'}</Td>
            <Td className="text-muted">{r.expiry_date}</Td>
            <Td>
              <span className={r.days_left < 0 ? 'font-medium text-danger' : 'text-warning'}>{label(r)}</span>
            </Td>
            <Td right>{r.stock}</Td>
            <Td right className="font-medium">{formatMoney(r.value ?? 0, currency)}</Td>
          </tr>
        ))}
        {data.rows.length > 0 && (
          <tr className="border-t-2 border-ink">
            <Td className="font-bold">Total</Td>
            <Td />
            <Td />
            <Td />
            <Td right className="font-bold">{data.rows.reduce((a, r) => a + r.stock, 0)}</Td>
            <Td right className="font-bold text-danger">{formatMoney(data.totals.value ?? 0, currency)}</Td>
          </tr>
        )}
      </ReportTable>
      {data.rows.length === 0 && <p className="text-muted">Nothing expired or expiring.</p>}
    </div>
  )
}
