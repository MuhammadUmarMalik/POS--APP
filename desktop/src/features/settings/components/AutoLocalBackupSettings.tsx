import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DatabaseBackup, FolderOpen, HardDrive, RotateCcw, Trash2 } from 'lucide-react'
import { api } from '../../../lib/ipc'
import { formatDateTime } from '../../../lib/utils'
import type {
  DriveBackupFrequency,
  LocalAutoBackupFile,
  LocalAutoBackupStatus,
} from '../../../shared/types'
import { Badge, Button, Field, Input, Select, Spinner } from '../../../components/ui'
import { toast } from '../../../components/ui/toast'
import { SettingsSection } from './SettingsLayout'

function formatBytes(bytes: number): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function statusTone(status: LocalAutoBackupStatus['last_backup_status']): 'green' | 'red' | 'blue' | 'slate' {
  if (status === 'success') return 'green'
  if (status === 'failed') return 'red'
  if (status === 'in_progress') return 'blue'
  return 'slate'
}

export function AutoLocalBackupSettings() {
  const queryClient = useQueryClient()

  const statusQuery = useQuery({
    queryKey: ['local-auto-backup-status'],
    queryFn: () => api<LocalAutoBackupStatus>('localAutoBackup:status'),
    refetchInterval: 30_000,
  })
  const filesQuery = useQuery({
    queryKey: ['local-auto-backups'],
    queryFn: () => api<LocalAutoBackupFile[]>('localAutoBackup:list'),
  })

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['local-auto-backup-status'] }),
      queryClient.invalidateQueries({ queryKey: ['local-auto-backups'] }),
    ])
  }

  const backup = useMutation({
    mutationFn: () => api<LocalAutoBackupFile>('localAutoBackup:run'),
    onSuccess: async (file) => {
      toast.success(`Backup saved (${formatBytes(file.size)})`)
      await refresh()
    },
    onError: (error) => toast.error((error as Error).message),
  })
  const chooseFolder = useMutation({
    mutationFn: () => api<LocalAutoBackupStatus>('localAutoBackup:chooseFolder'),
    onSuccess: async () => { await refresh() },
    onError: (error) => toast.error((error as Error).message),
  })
  const useDefaultFolder = useMutation({
    mutationFn: () => api<LocalAutoBackupStatus>('localAutoBackup:useDefaultFolder'),
    onSuccess: async () => { await refresh() },
    onError: (error) => toast.error((error as Error).message),
  })
  const openFolder = useMutation({
    mutationFn: () => api<{ opened: boolean }>('localAutoBackup:openFolder'),
    onError: (error) => toast.error((error as Error).message),
  })
  const prune = useMutation({
    mutationFn: () => api<{ removed: number }>('localAutoBackup:prune'),
    onSuccess: async (result) => {
      toast.success(result.removed ? `Removed ${result.removed} old backup file(s)` : 'Nothing to remove')
      await refresh()
    },
    onError: (error) => toast.error((error as Error).message),
  })

  const status = statusQuery.data
  if (statusQuery.isLoading || !status) {
    return (
      <SettingsSection title="Automatic Backup on This Computer" icon={<HardDrive size={18} />}>
        <Spinner />
      </SettingsSection>
    )
  }

  const updateSettings = async (patch: Partial<{
    auto_backup_frequency: DriveBackupFrequency
    backup_time: string
    backup_on_close: boolean
    include_images: boolean
    retention_count: number
  }>) => {
    try {
      await api('localAutoBackup:updateSettings', {
        auto_backup_frequency: patch.auto_backup_frequency ?? status.auto_backup_frequency,
        backup_time: patch.backup_time ?? status.backup_time,
        backup_on_close: patch.backup_on_close ?? status.backup_on_close,
        include_images: patch.include_images ?? status.include_images,
        retention_count: patch.retention_count ?? status.retention_count,
      })
      await queryClient.invalidateQueries({ queryKey: ['local-auto-backup-status'] })
      toast.success('Automatic backup settings saved')
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  return (
    <SettingsSection
      title="Automatic Backup on This Computer"
      description="Unattended backups to a folder, USB drive or network share — no internet needed"
      icon={<HardDrive size={18} />}
      actions={status.last_backup_status ? (
        <Badge tone={statusTone(status.last_backup_status)}>{status.last_backup_status.replace('_', ' ')}</Badge>
      ) : undefined}
    >
      <p className="mb-4 max-w-2xl text-sm text-muted">
        The app backs itself up on a schedule and again when you close it, then keeps only the
        most recent copies. Point it at a USB drive or a network folder so a failure of this
        computer cannot take your records with it.
      </p>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-slate-50 p-3">
        <div className="min-w-0">
          <div className="text-xs text-muted">Backup folder</div>
          <div className="mt-0.5 truncate font-mono text-sm" title={status.folder}>{status.folder}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => openFolder.mutate()} loading={openFolder.isPending}>
            <FolderOpen size={14} /> Open
          </Button>
          <Button size="sm" variant="secondary" onClick={() => chooseFolder.mutate()} loading={chooseFolder.isPending}>
            Change Folder
          </Button>
          {!status.using_default_folder && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => useDefaultFolder.mutate()}
              loading={useDefaultFolder.isPending}
            >
              Use Default
            </Button>
          )}
        </div>
      </div>

      <div className="mb-5 grid gap-4 md:grid-cols-4">
        <Field label="Automatic backup">
          <Select
            value={status.auto_backup_frequency}
            onChange={(event) => void updateSettings({ auto_backup_frequency: event.target.value as DriveBackupFrequency })}
          >
            <option value="off">Off</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </Select>
        </Field>
        <Field label="Backup time">
          <Input
            type="time"
            defaultValue={status.backup_time}
            disabled={status.auto_backup_frequency === 'off'}
            onBlur={(event) => {
              if (event.target.value && event.target.value !== status.backup_time) {
                void updateSettings({ backup_time: event.target.value })
              }
            }}
          />
        </Field>
        <Field label="Copies to keep">
          <Select
            value={status.retention_count}
            onChange={(event) => void updateSettings({ retention_count: Number(event.target.value) })}
          >
            {[7, 14, 30, 60, 90, 180, 365].map((count) => <option key={count} value={count}>{count}</option>)}
          </Select>
        </Field>
        <div className="flex flex-col justify-end gap-2 pb-2">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={status.backup_on_close}
              onChange={(event) => void updateSettings({ backup_on_close: event.target.checked })}
            />
            Back up when closing
          </label>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={status.include_images}
              onChange={(event) => void updateSettings({ include_images: event.target.checked })}
            />
            Include product images
          </label>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-line bg-slate-50 px-3 py-2.5">
          <div className="text-xs text-muted">Last backup</div>
          <div className="mt-0.5 text-sm font-medium">
            {status.last_backup_at ? formatDateTime(status.last_backup_at) : 'No backup yet'}
          </div>
        </div>
        <div className="rounded-md border border-line bg-slate-50 px-3 py-2.5">
          <div className="text-xs text-muted">Next backup</div>
          <div className="mt-0.5 text-sm font-medium">
            {status.next_backup_at ? formatDateTime(status.next_backup_at) : 'Automatic backup off'}
          </div>
        </div>
      </div>
      {status.last_backup_error && (
        <p className="mb-4 text-sm text-danger">Last backup failed: {status.last_backup_error}</p>
      )}

      <div className="mb-5 flex flex-wrap gap-2">
        <Button onClick={() => backup.mutate()} loading={backup.isPending || status.backup_in_progress}>
          <DatabaseBackup size={15} /> Back Up Now
        </Button>
        <Button variant="secondary" onClick={() => void filesQuery.refetch()} loading={filesQuery.isFetching}>
          <RotateCcw size={15} /> Refresh List
        </Button>
        <Button variant="secondary" onClick={() => prune.mutate()} loading={prune.isPending}>
          <Trash2 size={15} /> Remove Old Copies
        </Button>
      </div>

      <div className="overflow-hidden rounded-md border border-line">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2.5">File</th>
              <th className="px-3 py-2.5">Date</th>
              <th className="px-3 py-2.5 text-right">Size</th>
            </tr>
          </thead>
          <tbody>
            {filesQuery.isLoading ? (
              <tr><td className="px-3 py-5" colSpan={3}><Spinner /></td></tr>
            ) : filesQuery.isError ? (
              <tr><td className="px-3 py-5 text-danger" colSpan={3}>{(filesQuery.error as Error).message}</td></tr>
            ) : filesQuery.data?.length ? filesQuery.data.map((file) => (
              <tr key={file.path} className="border-t border-line">
                <td className="px-3 py-2.5 font-mono text-xs">{file.name}</td>
                <td className="px-3 py-2.5 font-medium">{formatDateTime(file.created_at)}</td>
                <td className="px-3 py-2.5 text-right text-muted">{formatBytes(file.size)}</td>
              </tr>
            )) : (
              <tr><td className="px-3 py-5 text-center text-muted" colSpan={3}>No backups in this folder yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-muted">
        To bring one of these back, use <strong>Restore from File</strong> above and pick the file
        you want.
      </p>
    </SettingsSection>
  )
}
