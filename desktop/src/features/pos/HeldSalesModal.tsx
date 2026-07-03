import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PlayCircle, Trash2 } from 'lucide-react'
import { api } from '../../lib/ipc'
import type { HeldCartLine, HeldSale } from '../../shared/types'
import { Button, EmptyState, Modal, Spinner } from '../../components/ui'
import { toast } from '../../components/ui/toast'

export function HeldSalesModal({
  open,
  onClose,
  onResume,
}: {
  open: boolean
  onClose: () => void
  onResume: (lines: HeldCartLine[], label: string | null) => void
}) {
  const qc = useQueryClient()
  const { data: held, isLoading } = useQuery({
    queryKey: ['held-sales'],
    queryFn: () => api<HeldSale[]>('sales:heldList'),
    enabled: open,
  })

  const resume = useMutation({
    mutationFn: (id: string) => api<HeldSale>('sales:resumeHeld', { id }),
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: ['held-sales'] })
      try {
        onResume(JSON.parse(row.cart_json) as HeldCartLine[], row.label)
        onClose()
      } catch {
        toast.error('Could not read the held cart')
      }
    },
    onError: (e) => toast.error(e.message),
  })

  const del = useMutation({
    mutationFn: (id: string) => api('sales:deleteHeld', { id }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['held-sales'] })
      toast.success('Held sale discarded')
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <Modal open={open} onClose={onClose} title="Held sales" wide>
      {isLoading ? (
        <Spinner />
      ) : !held || held.length === 0 ? (
        <EmptyState message="No held sales. Use the Hold button to park a cart for later." />
      ) : (
        <div className="divide-y divide-line">
          {held.map((h) => {
            let count = 0
            try {
              count = (JSON.parse(h.cart_json) as HeldCartLine[]).reduce((a, l) => a + l.quantity, 0)
            } catch {
              /* unreadable cart — still listed so it can be discarded */
            }
            return (
              <div key={h.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{h.label || 'Unnamed cart'}</div>
                  <div className="text-xs text-muted">
                    {count} item(s) · {new Date(h.created_at).toLocaleString()}
                    {h.cashier_name ? ` · ${h.cashier_name}` : ''}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" onClick={() => resume.mutate(h.id)} loading={resume.isPending}>
                    <PlayCircle size={14} /> Resume
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => window.confirm('Discard this held sale?') && del.mutate(h.id)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
