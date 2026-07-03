import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CloudUpload, DatabaseBackup, History, AlertTriangle } from 'lucide-react'
import { api } from '../../../lib/ipc'
import { formatDateTime } from '../../../lib/utils'
import type { SyncStatusView } from '../../../shared/types'
import { Button, Input, Modal, Spinner } from '../../../components/ui'
import { toast } from '../../../components/ui/toast'
import { SettingsSection } from './SettingsLayout'
import { SyncNowButton } from './SyncNowButton'
import { SyncHistoryTable, SyncStatusBadge } from './SyncHistoryTable'

function InfoTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-slate-50/50 px-3 py-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 text-sm font-medium">{value}</div>
    </div>
  )
}

export function CloudSyncSettings() {
  const qc = useQueryClient()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)

  const { data: status, isLoading } = useQuery({
    queryKey: ['sync-status'],
    queryFn: () => api<SyncStatusView>('sync:status'),
    refetchInterval: 30_000,
  })

  const saveSettings = async (patch: Partial<{ auto_sync_enabled: boolean; sync_time: string }>) => {
    if (!status) return
    try {
      await api('sync:updateSettings', {
        auto_sync_enabled: patch.auto_sync_enabled ?? !!status.auto_sync_enabled,
        sync_frequency: 'daily',
        sync_time: patch.sync_time ?? status.sync_time,
      })
      void qc.invalidateQueries({ queryKey: ['sync-status'] })
      toast.success('Sync settings saved')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const downloadBackup = async () => {
    setBackupBusy(true)
    try {
      const res = await api<{ saved: boolean; path?: string }>('settings:backup')
      if (res.saved) toast.success(`Backup saved to ${res.path}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBackupBusy(false)
    }
  }

  if (isLoading || !status) {
    return (
      <SettingsSection title="Backup & Cloud Sync" icon={<CloudUpload size={18} />}>
        <Spinner />
      </SettingsSection>
    )
  }

  const neverSynced = !status.last_sync_at

  return (
    <SettingsSection
      title="Backup & Cloud Sync"
      description="Your data lives on this computer; the cloud is a daily copy"
      icon={<CloudUpload size={18} />}
      actions={status.last_sync_status ? <SyncStatusBadge status={status.last_sync_status} /> : undefined}
    >
      {!status.cloud_configured && (
        <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-muted">
          Cloud backup is not configured on this install. Everything keeps working locally — use
          Download Backup below to keep manual copies safe.
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <InfoTile
          label="Last sync"
          value={
            neverSynced ? (
              <span className="text-muted">This device has not synced with cloud yet.</span>
            ) : (
              formatDateTime(status.last_sync_at!)
            )
          }
        />
        <InfoTile
          label="Next auto sync"
          value={
            status.auto_sync_enabled && status.next_sync_at
              ? formatDateTime(status.next_sync_at)
              : 'Auto sync off'
          }
        />
        <InfoTile label="Unsynced changes" value={`${status.pending_changes} record(s)`} />
        <InfoTile
          label="Conflicts"
          value={
            status.conflict_count > 0 ? (
              <span className="inline-flex items-center gap-1 text-warning">
                <AlertTriangle size={13} /> {status.conflict_count} need review
              </span>
            ) : (
              'None'
            )
          }
        />
      </div>

      {status.last_sync_error && status.last_sync_status !== 'success' && (
        <p className="mb-4 text-xs text-muted">Last result: {status.last_sync_error}</p>
      )}

      <div className="mb-5 flex flex-wrap items-end gap-4">
        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={!!status.auto_sync_enabled}
            onChange={(e) => void saveSettings({ auto_sync_enabled: e.target.checked })}
          />
          <span className="text-sm font-medium">Auto sync daily</span>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Sync time</span>
          <Input
            type="time"
            className="w-32"
            defaultValue={status.sync_time}
            disabled={!status.auto_sync_enabled}
            onBlur={(e) => {
              if (e.target.value && e.target.value !== status.sync_time) {
                void saveSettings({ sync_time: e.target.value })
              }
            }}
          />
        </label>
        <p className="max-w-xs text-xs text-muted">
          If the app is closed at sync time, it syncs on the next open. No internet? It retries
          automatically — your POS keeps working either way.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <SyncNowButton inProgress={status.sync_in_progress} />
        <Button variant="secondary" onClick={() => setHistoryOpen(true)}>
          <History size={15} /> View Sync History
        </Button>
        <Button variant="secondary" onClick={downloadBackup} loading={backupBusy}>
          <DatabaseBackup size={15} /> Download Backup
        </Button>
      </div>

      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title="Sync history" wide>
        <SyncHistoryTable />
      </Modal>
    </SettingsSection>
  )
}
