// Restoring a shop from a backup file on this computer — a USB stick, a network
// share, or the copy "Download Backup" wrote earlier. Deliberately independent
// of Google Drive: most shops here have no cloud account, and a restore is
// exactly when the internet tends to be unavailable.
//
// Two routes, same engine:
//   restoreFromFile   admin, inside the app, restores into the signed-in shop
//   restoreForSetup   public, before any shop exists, for a new/reinstalled PC
import { dialog, BrowserWindow } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assertNoShopExists, readBackupFile, replaceLocalData } from './backupArchive'
import { AppError, audit } from './helpers'
import { safetyBackup } from './localAutoBackup'
import { restartAfterRestore } from './restart'
import type { LocalRestoreResult, Session } from '../../src/shared/types'

const FILTERS = [
  { name: 'POS backup', extensions: ['gz', 'posbackup', 'db'] },
  { name: 'All files', extensions: ['*'] },
]

async function pickBackupFile(title: string): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title,
    properties: ['openFile'],
    filters: FILTERS,
  })
  return canceled || filePaths.length === 0 ? null : filePaths[0]
}

async function restoreFrom(
  file: string,
  expectedShopId: string | null,
  session: Session | null
): Promise<LocalRestoreResult> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pos-local-restore-'))
  try {
    const payload = await readBackupFile(file, expectedShopId, tempDir)
    // Re-checked after the (slow) validation so a shop created meanwhile through
    // the public setup route can never be overwritten.
    if (expectedShopId === null) assertNoShopExists('A shop already exists on this computer')
    // Only once the chosen file is known to be good: a copy of what is about to
    // be replaced, so restoring the wrong backup is recoverable. Nothing exists
    // to save during first-time setup.
    const safetyFile = session ? await safetyBackup(session.shopId) : null
    // Returns only once the restored database has been opened and migrated up
    // to this app's schema, or throws having put the previous data back.
    await replaceLocalData(payload)
    // The trail is written into the restored database, not the one just thrown
    // away, so the shop can always see why its records jumped back in time.
    if (session) {
      try {
        audit(session, 'backup.restore_local', {
          file: path.basename(file),
          format: payload.format,
          backup_created_at: payload.createdAt,
          // Written into the restored database, so the shop can find the copy
          // of the data this restore replaced.
          replaced_data_saved_to: safetyFile,
        })
      } catch {
        // A missing audit row is not worth failing a restore that has already
        // succeeded — the data is in place and verified.
      }
    }
    restartAfterRestore()
    return {
      restored: true,
      restarting: true,
      shop_name: payload.shopName,
      created_at: payload.createdAt,
      format: payload.format,
    }
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function restoreFromFile(
  session: Session,
  input: { confirmation: 'RESTORE' }
): Promise<LocalRestoreResult> {
  if (input.confirmation !== 'RESTORE') throw new AppError('Restore was not confirmed')
  const file = await pickBackupFile('Choose a POS backup file to restore')
  if (!file) return { restored: false }
  return restoreFrom(file, session.shopId, session)
}

export async function restoreForSetup(): Promise<LocalRestoreResult> {
  assertNoShopExists('Restoring from a file is only available before shop setup. Sign in and restore from Settings instead.')
  const file = await pickBackupFile('Choose the backup file for your shop')
  if (!file) return { restored: false }
  return restoreFrom(file, null, null)
}
