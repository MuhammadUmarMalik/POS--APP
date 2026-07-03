import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/ipc'
import { formatDateTime } from '../../lib/utils'
import type { InventoryLog, ProductWithStock } from '../../shared/types'
import { Badge, Modal, Spinner, EmptyState } from '../../components/ui'

const TYPE_LABEL: Record<string, { label: string; tone: 'green' | 'red' | 'blue' | 'amber' | 'slate' }> = {
  sale: { label: 'Sale', tone: 'red' },
  purchase: { label: 'Purchase', tone: 'green' },
  sale_return: { label: 'Sale return', tone: 'blue' },
  purchase_return: { label: 'Purchase return', tone: 'amber' },
  adjustment: { label: 'Adjustment', tone: 'slate' },
  opening: { label: 'Opening', tone: 'slate' },
}

export function MovementsModal({
  product,
  onClose,
}: {
  product: ProductWithStock
  onClose: () => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['movements', product.id],
    queryFn: () => api<InventoryLog[]>('inventory:movements', { product_id: product.id }),
  })

  return (
    <Modal open onClose={onClose} title={`Stock history — ${product.name}`} wide>
      {isLoading ? (
        <Spinner />
      ) : !data || data.length === 0 ? (
        <EmptyState message="No stock movements yet." />
      ) : (
        <table className="w-full text-left">
          <thead className="text-xs uppercase text-muted">
            <tr>
              <th className="py-2">Date</th>
              <th className="py-2">Type</th>
              <th className="py-2 text-right">Change</th>
              <th className="py-2">Reason</th>
              <th className="py-2">By</th>
            </tr>
          </thead>
          <tbody>
            {data.map((m) => {
              const t = TYPE_LABEL[m.change_type] ?? { label: m.change_type, tone: 'slate' as const }
              return (
                <tr key={m.id} className="border-t border-line">
                  <td className="py-2 text-muted">{formatDateTime(m.created_at)}</td>
                  <td className="py-2"><Badge tone={t.tone}>{t.label}</Badge></td>
                  <td className={`py-2 text-right font-semibold ${m.quantity_change < 0 ? 'text-danger' : 'text-success'}`}>
                    {m.quantity_change > 0 ? '+' : ''}{m.quantity_change}
                  </td>
                  <td className="py-2 text-muted">{m.reason ?? '—'}</td>
                  <td className="py-2 text-muted">{m.created_by_name ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </Modal>
  )
}
