import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { DatabaseBackup, HardDriveDownload, RotateCcw } from 'lucide-react'
import { api } from '../../../lib/ipc'
import type { LocalRestoreResult } from '../../../shared/types'
import { Button, Field, Input, Modal } from '../../../components/ui'
import { toast } from '../../../components/ui/toast'
import { useRestore } from '../../../stores/restore'
import { SettingsSection } from './SettingsLayout'

export function LocalBackupSettings() {
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')

  const backup = useMutation({
    mutationFn: () => api<{ saved: boolean; path?: string }>('settings:backup'),
    onSuccess: (result) => {
      if (result.saved) toast.success(`Backup saved to ${result.path}`)
    },
    onError: (error) => toast.error((error as Error).message),
  })

  const setRestorePhase = useRestore((s) => s.setPhase)

  const restore = useMutation({
    // Blocks the window for the whole operation: the file picker sits on top of
    // it, and the moment a file is chosen the database starts being replaced.
    mutationFn: () => {
      setRestorePhase('restoring')
      return api<LocalRestoreResult>('localBackup:restore', { confirmation: 'RESTORE' })
    },
    onSuccess: (result) => {
      // The picker was closed without choosing a file — leave the modal open.
      if (!result.restored) {
        setRestorePhase(null)
        return
      }
      setRestoreOpen(false)
      setRestorePhase('restarting')
      toast.success('Backup restored. The app is restarting…')
    },
    onError: (error) => {
      setRestorePhase(null)
      toast.error((error as Error).message)
    },
  })

  return (
    <SettingsSection
      title="Backup File on This Computer"
      description="Save a copy you can keep on a USB drive, and restore it on this or another computer"
      icon={<DatabaseBackup size={18} />}
    >
      <p className="mb-4 max-w-2xl text-sm text-muted">
        A backup holds every sale, product, customer and payment up to the moment it was made.
        Keep a copy somewhere other than this computer — a USB drive or another PC — so a hardware
        failure cannot take your records with it.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => backup.mutate()} loading={backup.isPending}>
          <HardDriveDownload size={15} /> Download Backup
        </Button>
        <Button variant="secondary" onClick={() => { setConfirmation(''); setRestoreOpen(true) }}>
          <RotateCcw size={15} /> Restore from File
        </Button>
      </div>

      <Modal
        open={restoreOpen}
        onClose={() => !restore.isPending && setRestoreOpen(false)}
        title="Restore from a backup file"
      >
        <div className="rounded-md border border-danger/30 bg-red-50 p-3 text-sm">
          This replaces everything currently in this app with the contents of the backup file you
          choose. The app will restart and any sales, payments or changes recorded after that
          backup was made will be lost.
        </div>
        <p className="mt-3 text-sm text-muted">
          A copy of your current data is saved to the automatic backup folder first, so you can
          come back to it if you pick the wrong file.
        </p>
        <Field label='Type "RESTORE" to continue' required>
          <Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoFocus />
        </Field>
        <div className="mt-5 flex justify-between">
          <Button variant="secondary" onClick={() => setRestoreOpen(false)} disabled={restore.isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={confirmation !== 'RESTORE'}
            loading={restore.isPending}
            onClick={() => restore.mutate()}
          >
            Choose File and Restore
          </Button>
        </div>
      </Modal>
    </SettingsSection>
  )
}
