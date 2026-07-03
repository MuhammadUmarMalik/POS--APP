import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../../../lib/ipc'
import { Button } from '../../../components/ui'
import { toast } from '../../../components/ui/toast'

/** Manual "Sync Now". Disabled while a sync runs — no concurrent syncs. */
export function SyncNowButton({ inProgress }: { inProgress: boolean }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    try {
      const res = await api<{ synced: number }>('sync:manual')
      toast.success(
        res.synced > 0 ? `Sync complete — ${res.synced} record(s) synced` : 'Sync complete — already up to date'
      )
    } catch (e) {
      // Offline/expired/failed — the result is already persisted to sync_logs.
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
      void qc.invalidateQueries({ queryKey: ['sync-status'] })
      void qc.invalidateQueries({ queryKey: ['sync-logs'] })
    }
  }

  return (
    <Button onClick={run} loading={busy || inProgress} disabled={busy || inProgress}>
      <RefreshCw size={15} /> Sync Now
    </Button>
  )
}
