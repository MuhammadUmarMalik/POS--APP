import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CloudDownload, Link2, RefreshCw, ShieldCheck, Unlink } from 'lucide-react'
import { api } from '../../lib/ipc'
import { formatDateTime } from '../../lib/utils'
import type { DriveBackupFile, DriveRecoveryStatus } from '../../shared/types'
import { Button, Card, Field, Input, Modal, Spinner } from '../../components/ui'
import { toast } from '../../components/ui/toast'
import { useRestore } from '../../stores/restore'

function formatBytes(bytes: number): string {
  if (!bytes) return 'Size unavailable'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

export function DriveRecovery({ onBack }: { onBack: () => void }) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<DriveBackupFile | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const setRestorePhase = useRestore((s) => s.setPhase)

  const statusQuery = useQuery({
    queryKey: ['drive-recovery-status'],
    queryFn: () => api<DriveRecoveryStatus>('driveRecovery:status'),
  })
  const backupsQuery = useQuery({
    queryKey: ['drive-recovery-backups'],
    queryFn: () => api<DriveBackupFile[]>('driveRecovery:list'),
    enabled: !!statusQuery.data?.connected,
  })

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['drive-recovery-status'] }),
      queryClient.invalidateQueries({ queryKey: ['drive-recovery-backups'] }),
    ])
  }

  const connect = useMutation({
    mutationFn: () => api<DriveRecoveryStatus>('driveRecovery:connect'),
    onSuccess: async () => {
      toast.success('Google Drive connected — looking for backups')
      await refresh()
    },
    onError: (error) => toast.error((error as Error).message),
  })
  const disconnect = useMutation({
    mutationFn: () => api<DriveRecoveryStatus>('driveRecovery:disconnect'),
    onSuccess: async () => {
      setSelected(null)
      toast.success('Google account disconnected')
      await refresh()
    },
    onError: (error) => toast.error((error as Error).message),
  })
  const restore = useMutation({
    // The download and the database swap both happen inside this call, so the
    // whole window is blocked for it rather than only the button.
    mutationFn: (fileId: string) => {
      setRestorePhase('restoring')
      return api<{ restarting: true }>('driveRecovery:restore', {
        file_id: fileId,
        confirmation: 'RESTORE',
      })
    },
    onSuccess: () => {
      // Left in place: the app restarts under this screen a moment from now.
      setRestorePhase('restarting')
      toast.success('Backup restored. POS Desktop is restarting…')
    },
    onError: (error) => {
      setRestorePhase(null)
      toast.error((error as Error).message)
    },
  })

  const status = statusQuery.data
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-3xl p-8">
        <button
          type="button"
          onClick={onBack}
          className="mb-5 flex items-center gap-2 text-sm font-medium text-muted hover:text-ink"
        >
          <ArrowLeft size={16} /> Back to new shop setup
        </button>

        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-lg bg-primary p-2.5 text-white"><CloudDownload size={22} /></div>
          <div>
            <h1 className="text-2xl font-bold">Restore from Google Drive</h1>
            <p className="text-muted">Connect the same Google account used on your old device.</p>
          </div>
        </div>

        {statusQuery.isLoading || !status ? (
          <Spinner />
        ) : !status.configured ? (
          <div className="rounded-md border border-warning/30 bg-amber-50 p-4 text-sm">
            Google Drive recovery is not configured in this build. Add the Desktop OAuth configuration
            and reinstall the app before attempting recovery.
          </div>
        ) : !status.connected ? (
          <div className="rounded-lg border border-line bg-slate-50 p-6 text-center">
            <ShieldCheck className="mx-auto mb-3 text-primary" size={30} />
            <h2 className="font-semibold">Your backups stay in your private Drive app data</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
              POS Desktop requests access only to backup files created by this app. It cannot browse your
              normal Google Drive documents.
            </p>
            <Button className="mt-5" onClick={() => connect.mutate()} loading={connect.isPending}>
              <Link2 size={16} /> Continue with Google
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-green-200 bg-green-50 p-3">
              <div className="flex items-center gap-2 text-sm">
                <ShieldCheck size={17} className="text-success" />
                Connected{status.account_email ? <> as <strong>{status.account_email}</strong></> : ''}
              </div>
              <Button size="sm" variant="secondary" onClick={() => disconnect.mutate()} loading={disconnect.isPending}>
                <Unlink size={14} /> Use another account
              </Button>
            </div>

            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Available backups</h2>
                <p className="text-sm text-muted">Choose a backup to recover the shop, users, sales, stock and images.</p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => void backupsQuery.refetch()} loading={backupsQuery.isFetching}>
                <RefreshCw size={14} /> Refresh
              </Button>
            </div>

            <div className="overflow-hidden rounded-md border border-line">
              {backupsQuery.isLoading ? (
                <div className="p-8"><Spinner /></div>
              ) : backupsQuery.isError ? (
                <div className="p-5 text-sm text-danger">{(backupsQuery.error as Error).message}</div>
              ) : backupsQuery.data?.length ? (
                <div className="divide-y divide-line">
                  {backupsQuery.data.map((backup) => (
                    <div key={backup.id} className="flex flex-wrap items-center justify-between gap-4 p-4">
                      <div>
                        <div className="font-medium">{backup.shop_name || 'POS shop backup'}</div>
                        <div className="mt-0.5 text-sm text-muted">
                          {formatDateTime(backup.created_at)} · {formatBytes(backup.size)}
                          {backup.app_version ? ` · App ${backup.app_version}` : ''}
                        </div>
                      </div>
                      <Button onClick={() => { setSelected(backup); setConfirmation('') }}>
                        Restore this backup
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-sm text-muted">
                  No POS Desktop backup was found in this Google account. Try another account or create a new shop.
                </div>
              )}
            </div>
          </>
        )}
      </Card>

      <Modal open={!!selected} onClose={() => !restore.isPending && setSelected(null)} title="Restore shop backup">
        <div className="rounded-md border border-primary/20 bg-blue-50 p-3 text-sm">
          This will recover <strong>{selected?.shop_name || 'your shop'}</strong> and restart POS Desktop.
          After restart, sign in with the username and password from the backup.
        </div>
        <Field label='Type "RESTORE" to continue' required>
          <Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoFocus />
        </Field>
        <div className="mt-5 flex justify-between">
          <Button variant="secondary" onClick={() => setSelected(null)} disabled={restore.isPending}>Cancel</Button>
          <Button
            disabled={confirmation !== 'RESTORE' || !selected}
            loading={restore.isPending}
            onClick={() => selected && restore.mutate(selected.id)}
          >
            Restore and Restart
          </Button>
        </div>
      </Modal>
    </div>
  )
}
