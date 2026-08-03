// Ledgers: pick a customer, supplier or product and see its full history with a running balance.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/ipc'
import { formatMoney } from '../../lib/money'
import { formatDateTime } from '../../lib/utils'
import { useCurrency } from '../../stores/auth'
import type { InventoryLog, ProductWithStock } from '../../shared/types'
import { Badge, Card, Select, Spinner } from '../../components/ui'
import { LedgerTable } from '../../components/LedgerTable'
import { section } from '../../lib/export'
import { ReportExport, ReportTable, Segmented, Td, Th } from './shared'

interface Party {
  id: string
  name: string
  phone: string | null
  due_balance: number
}

type Kind = 'customer' | 'supplier' | 'product'

export function LedgersTab() {
  const [kind, setKind] = useState<Kind>('customer')
  return (
    <div className="space-y-4">
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          ['customer', 'Customer ledger'],
          ['supplier', 'Supplier ledger'],
          ['product', 'Product ledger'],
        ]}
      />
      {kind === 'product' ? <ProductLedger /> : <PartyLedger kind={kind} key={kind} />}
    </div>
  )
}

function PartyLedger({ kind }: { kind: 'customer' | 'supplier' }) {
  const currency = useCurrency()
  const [partyId, setPartyId] = useState('')

  const listChannel = kind === 'customer' ? 'customers:list' : 'suppliers:list'
  const { data: parties, isLoading } = useQuery({
    queryKey: [listChannel],
    queryFn: () => api<Party[]>(listChannel),
  })
  const selected = parties?.find((p) => p.id === partyId)

  return (
    <div className="space-y-4">
      <div className="no-print flex items-end gap-4">
        {isLoading ? (
          <Spinner />
        ) : (
          <Select value={partyId} onChange={(e) => setPartyId(e.target.value)} className="max-w-72">
            <option value="">Select a {kind}…</option>
            {(parties ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.phone ? ` (${p.phone})` : ''}
              </option>
            ))}
          </Select>
        )}
      </div>
      {!partyId ? (
        <Card>
          <p className="text-muted">
            Choose a {kind} to see every credit {kind === 'customer' ? 'sale' : 'purchase'}, payment and return with a
            running balance. Debit means the {kind === 'customer' ? 'customer owes more' : 'shop owes more'}; credit
            means the balance went down.
          </p>
        </Card>
      ) : (
        <Card>
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="font-semibold">{selected?.name}</h3>
            <div className="text-sm text-muted">
              Current balance:{' '}
              <span className={selected && selected.due_balance > 0 ? 'font-semibold text-danger' : 'font-semibold text-ink'}>
                {formatMoney(selected?.due_balance ?? 0, currency)}
              </span>
            </div>
          </div>
          {/* The rows live inside LedgerTable's own query, so the export is rendered there. */}
          <LedgerTable
            channel={kind === 'customer' ? 'customers:ledger' : 'suppliers:ledger'}
            partyId={partyId}
            exportModule={kind === 'customer' ? 'CustomerLedger' : 'SupplierLedger'}
            exportScope={selected?.name}
            exportTitle={kind === 'customer' ? 'Customer Ledger' : 'Supplier Ledger'}
          />
        </Card>
      )}
    </div>
  )
}

const MOVEMENT_LABELS: Record<string, string> = {
  sale: 'Sale',
  purchase: 'Purchase',
  sale_return: 'Sale return',
  purchase_return: 'Purchase return',
  adjustment: 'Adjustment',
  opening: 'Opening stock',
}

function ProductLedger() {
  const [productId, setProductId] = useState('')
  const { data: products, isLoading } = useQuery({
    queryKey: ['products', '', '', false],
    queryFn: () => api<ProductWithStock[]>('products:list'),
  })
  const selected = products?.find((p) => p.id === productId)

  const { data: rows, isLoading: rowsLoading } = useQuery({
    queryKey: ['product-ledger', productId],
    queryFn: () => api<(InventoryLog & { balance: number })[]>('inventory:ledger', { product_id: productId }),
    enabled: !!productId,
  })

  return (
    <div className="space-y-4">
      <div className="no-print flex items-end gap-4">
        {isLoading ? (
          <Spinner />
        ) : (
          <Select value={productId} onChange={(e) => setProductId(e.target.value)} className="max-w-72">
            <option value="">Select a product…</option>
            {(products ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        )}
      </div>
      {!productId ? (
        <Card>
          <p className="text-muted">
            Choose a product to see every stock movement — sales, purchases, returns and adjustments — with the stock
            level after each one.
          </p>
        </Card>
      ) : rowsLoading || !rows ? (
        <Spinner />
      ) : (
        <div className="space-y-3">
          <ReportExport
            module="ProductLedger"
            scope={selected?.name}
            title="Product Ledger"
            subtitle={selected?.name}
            meta={[
              ['Product', selected?.name ?? ''],
              ['Current stock', String(selected?.stock ?? '')],
            ]}
            sections={[
              section({
                columns: [
                  { header: 'Time', value: (r: (typeof rows)[number]) => formatDateTime(r.created_at) },
                  { header: 'Type', value: (r) => MOVEMENT_LABELS[r.change_type] ?? r.change_type },
                  // Signed so a spreadsheet can sum the column.
                  { header: 'Change', value: (r) => r.quantity_change, align: 'right' },
                  { header: 'Stock after', value: (r) => r.balance, align: 'right' },
                  { header: 'Reason', value: (r) => r.reason ?? '' },
                  { header: 'By', value: (r) => r.created_by_name ?? '' },
                ],
                rows,
              }),
            ]}
            note="Newest first (latest 300 shown). “Stock after” is the stock level right after that movement — the top row always matches current stock."
          />
          <div className="flex items-baseline justify-between">
            <h3 className="font-semibold">{selected?.name}</h3>
            <div className="text-sm text-muted">
              Current stock: <span className="font-semibold text-ink">{selected?.stock ?? '—'}</span>
            </div>
          </div>
          {rows.length === 0 ? (
            <Card><p className="text-muted">No stock movements for this product yet.</p></Card>
          ) : (
            <ReportTable
              head={
                <>
                  <Th>Time</Th>
                  <Th>Type</Th>
                  <Th right>Change</Th>
                  <Th right>Stock after</Th>
                  <Th>Reason</Th>
                  <Th>By</Th>
                </>
              }
            >
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <Td className="whitespace-nowrap text-muted">{formatDateTime(r.created_at)}</Td>
                  <Td>
                    <Badge tone={r.quantity_change >= 0 ? 'green' : 'red'}>
                      {MOVEMENT_LABELS[r.change_type] ?? r.change_type}
                    </Badge>
                  </Td>
                  <Td right className={r.quantity_change >= 0 ? 'font-medium text-success' : 'font-medium text-danger'}>
                    {r.quantity_change >= 0 ? `+${r.quantity_change}` : r.quantity_change}
                  </Td>
                  <Td right className="font-bold">{r.balance}</Td>
                  <Td className="max-w-56 truncate text-muted">{r.reason ?? '—'}</Td>
                  <Td className="text-muted">{r.created_by_name ?? '—'}</Td>
                </tr>
              ))}
            </ReportTable>
          )}
          <p className="text-xs text-muted">
            Newest first (latest 300 shown). “Stock after” is the stock level right after that movement — the top row
            always matches current stock.
          </p>
        </div>
      )}
    </div>
  )
}
