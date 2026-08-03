import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CloudUpload, DatabaseBackup, Link2, RotateCcw, ShieldCheck, Unlink } from 'lucide-react'
import { api } from '../../../lib/ipc'
import { formatDateTime } from '../../../lib/utils'
import type { DriveBackupFile, DriveBackupFrequency, DriveBackupStatus } from '../../../shared/types'
import { Badge, Button, Field, Input, Modal, Select, Spinner } from '../../../components/ui'
import { toast } from '../../../components/ui/toast'
import { useRestore } from '../../../stores/restore'
import { SettingsSection } from './SettingsLayout'

function formatBytes(bytes: number): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function statusTone(status: DriveBackupStatus['last_backup_status']): 'green' | 'red' | 'blue' | 'slate' {
  if (status === 'success') return 'green'
  if (status === 'failed') return 'red'
  if (status === 'in_progress') return 'blue'
  return 'slate'
}

export function GoogleDriveBackupSettings() {
  const queryClient = useQueryClient()
  const [restoreFile, setRestoreFile] = useState<DriveBackupFile | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const setRestorePhase = useRestore((s) => s.setPhase)

  const statusQuery = useQuery({
    queryKey: ['drive-backup-status'],
    queryFn: () => api<DriveBackupStatus>('driveBackup:status'),
    refetchInterval: 30_000,
  })
  const backupsQuery = useQuery({
    queryKey: ['drive-backups'],
    queryFn: () => api<DriveBackupFile[]>('driveBackup:list'),
    enabled: !!statusQuery.data?.connected,
  })

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['drive-backup-status'] }),
      queryClient.invalidateQueries({ queryKey: ['drive-backups'] }),
    ])
  }

  const connect = useMutation({
    mutationFn: () => api<DriveBackupStatus>('driveBackup:connect'),
    onSuccess: async () => {
      toast.success('Google Drive connected')
      await refresh()
    },
    onError: (error) => toast.error((error as Error).message),
  })
  const disconnect = useMutation({
    mutationFn: () => api<DriveBackupStatus>('driveBackup:disconnect'),
    onSuccess: async () => {
      toast.success('Google Drive disconnected')
      await refresh()
    },
    onError: (error) => toast.error((error as Error).message),
  })
  const backup = useMutation({
    mutationFn: () => api<DriveBackupFile>('driveBackup:run'),
    onSuccess: async (file) => {
      toast.success(`Backup saved to Google Drive (${formatBytes(file.size)})`)
      await refresh()
    },
    onError: (error) => toast.error((error as Error).message),
  })
  const restore = useMutation({
    // The download and the database swap both happen inside this call, so the
    // whole window is blocked for it rather than only the button.
    mutationFn: (fileId: string) => {
      setRestorePhase('restoring')
      return api<{ restarting: true }>('driveBackup:restore', {
        file_id: fileId,
        confirmation: 'RESTORE',
      })
    },
    onSuccess: () => {
      // Left in place: the app restarts under this screen a moment from now.
      setRestorePhase('restarting')
      toast.success('Backup restored. The app is restarting…')
    },
    onError: (error) => {
      setRestorePhase(null)
      toast.error((error as Error).message)
    },
  })

  const status = statusQuery.data
  if (statusQuery.isLoading || !status) {
    return (
      <SettingsSection title="Google Drive Backup" icon={<CloudUpload size={18} />}>
        <Spinner />
      </SettingsSection>
    )
  }

  const updateSettings = async (patch: Partial<{
    auto_backup_frequency: DriveBackupFrequency
    backup_time: string
    include_images: boolean
    retention_count: number
  }>) => {
    try {
      await api('driveBackup:updateSettings', {
        auto_backup_frequency: patch.auto_backup_frequency ?? status.auto_backup_frequency,
        backup_time: patch.backup_time ?? status.backup_time,
        include_images: patch.include_images ?? status.include_images,
        retention_count: patch.retention_count ?? status.retention_count,
      })
      await queryClient.invalidateQueries({ queryKey: ['drive-backup-status'] })
      toast.success('Backup settings saved')
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  return (
    <SettingsSection
      title="Google Drive Backup"
      description="Private full-app snapshots, similar to WhatsApp backups"
      icon={<CloudUpload size={18} />}
      actions={status.last_backup_status ? (
        <Badge tone={statusTone(status.last_backup_status)}>{status.last_backup_status.replace('_', ' ')}</Badge>
      ) : undefined}
    >
      {!status.configured ? (
        <div className="rounded-md border border-warning/30 bg-amber-50 p-3 text-sm">
          Google OAuth has not been configured for this build. Add a Desktop OAuth client as
          described in <span className="font-mono">resources/google-drive-oauth.example.json</span>,
          then rebuild the app.
        </div>
      ) : !status.connected ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-line bg-slate-50 p-4">
          <div>
            <div className="font-medium">Keep a private copy in Google Drive</div>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              POS Desktop can only access backups it creates in Drive&apos;s hidden app-data area.
              Your database remains local and the POS continues working offline.
            </p>
          </div>
          <Button onClick={() => connect.mutate()} loading={connect.isPending}>
            <Link2 size={15} /> Connect Google Drive
          </Button>
        </div>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-green-200 bg-green-50 p-3">
            <div className="flex items-center gap-2 text-sm">
              <ShieldCheck size={17} className="text-success" />
              <span>
                Connected{status.account_email ? <> as <strong>{status.account_email}</strong></> : ''}
              </span>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                if (window.confirm('Disconnect Google Drive? Existing backups will remain in Drive.')) disconnect.mutate()
              }}
              loading={disconnect.isPending}
            >
              <Unlink size={14} /> Disconnect
            </Button>
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
                {[3, 5, 7, 14, 30].map((count) => <option key={count} value={count}>{count}</option>)}
              </Select>
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={status.include_images}
                onChange={(event) => void updateSettings({ include_images: event.target.checked })}
              />
              Include product images
            </label>
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
            <Button variant="secondary" onClick={() => void backupsQuery.refetch()} loading={backupsQuery.isFetching}>
              <RotateCcw size={15} /> Refresh Backup List
            </Button>
          </div>

          <div className="overflow-hidden rounded-md border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-muted">
                <tr>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Size</th>
                  <th className="px-3 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {backupsQuery.isLoading ? (
                  <tr><td className="px-3 py-5" colSpan={3}><Spinner /></td></tr>
                ) : backupsQuery.isError ? (
                  <tr><td className="px-3 py-5 text-danger" colSpan={3}>{(backupsQuery.error as Error).message}</td></tr>
                ) : backupsQuery.data?.length ? backupsQuery.data.map((file) => (
                  <tr key={file.id} className="border-t border-line">
                    <td className="px-3 py-2.5 font-medium">{formatDateTime(file.created_at)}</td>
                    <td className="px-3 py-2.5 text-muted">{formatBytes(file.size)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Button size="sm" variant="secondary" onClick={() => { setRestoreFile(file); setConfirmation('') }}>
                        Restore
                      </Button>
                    </td>
                  </tr>
                )) : (
                  <tr><td className="px-3 py-5 text-center text-muted" colSpan={3}>No Google Drive backups yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Modal
        open={!!restoreFile}
        onClose={() => !restore.isPending && setRestoreFile(null)}
        title="Restore Google Drive backup"
      >
        <div className="rounded-md border border-danger/30 bg-red-50 p-3 text-sm">
          This replaces the current database and product images with the copy from{' '}
          <strong>{restoreFile?.created_at ? formatDateTime(restoreFile.created_at) : ''}</strong>.
          The app will restart and any changes made after that backup will be lost.
        </div>
        <Field label='Type "RESTORE" to continue' required>
          <Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoFocus />
        </Field>
        <div className="mt-5 flex justify-between">
          <Button variant="secondary" onClick={() => setRestoreFile(null)} disabled={restore.isPending}>Cancel</Button>
          <Button
            variant="danger"
            disabled={confirmation !== 'RESTORE' || !restoreFile}
            loading={restore.isPending}
            onClick={() => restoreFile && restore.mutate(restoreFile.id)}
          >
            Restore and Restart
          </Button>
        </div>
      </Modal>
    </SettingsSection>
  )
}
