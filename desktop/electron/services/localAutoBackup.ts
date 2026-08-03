// Unattended backups onto this computer.
//
// The Google Drive scheduler already does this for shops with an account and a
// connection; most of ours have neither. This one never touches the network:
// it writes the same `.posbackup.gz` container into a folder on disk — by
// default under the app's own data folder, or wherever the shop points it (a
// USB stick, a mapped network drive) — on a schedule and again when the app
// closes, then prunes the oldest files so the folder cannot grow forever.
//
// Restore is deliberately not here: `localBackup.ts` already restores any file
// this writes, through the same picker.
import { app, dialog, shell, BrowserWindow } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getDb } from '../db'
import { createArchive } from './backupArchive'
import { AppError, audit, now, uid } from './helpers'
import type {
  LocalAutoBackupFile,
  LocalAutoBackupLog,
  LocalAutoBackupStatus,
  Session,
} from '../../src/shared/types'
import type { LocalBackupSettingsInput } from '../../src/shared/schemas'

const FILE_PREFIX = 'pos-backup-'
const FILE_SUFFIX = '.posbackup.gz'
/** A stalled close-backup must never hold the app open. */
const ON_CLOSE_TIMEOUT_MS = 30_000

interface LocalBackupSettingsRow {
  id: string
  shop_id: string
  auto_backup_frequency: 'off' | 'daily' | 'weekly' | 'monthly'
  backup_time: string
  backup_on_close: number
  include_images: number
  retention_count: number
  folder: string | null
  last_backup_at: string | null
  last_backup_status: 'success' | 'failed' | 'in_progress' | null
  last_backup_error: string | null
  last_backup_file: string | null
  next_backup_at: string | null
  created_at: string
  updated_at: string
}

let backupInProgress = false
let scheduler: ReturnType<typeof setInterval> | null = null

/** Where backups go when the shop has not chosen a folder of its own. */
export function defaultBackupFolder(): string {
  return path.join(app.getPath('userData'), 'backups')
}

function folderOf(row: LocalBackupSettingsRow): string {
  return row.folder || defaultBackupFolder()
}

function ensureSettings(shopId: string): LocalBackupSettingsRow {
  const db = getDb()
  let row = db.prepare('SELECT * FROM local_backup_settings WHERE shop_id = ?').get(shopId) as
    | LocalBackupSettingsRow
    | undefined
  if (!row) {
    const ts = now()
    db.prepare(
      `INSERT INTO local_backup_settings (id, shop_id, next_backup_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(uid(), shopId, nextOccurrence('daily', '21:00'), ts, ts)
    row = db.prepare('SELECT * FROM local_backup_settings WHERE shop_id = ?').get(shopId) as LocalBackupSettingsRow
  }
  // A backup that was running when the app was killed left a row claiming it is
  // still in progress. Nothing is running now, so say so.
  if (!backupInProgress && row.last_backup_status === 'in_progress') {
    const ts = now()
    db.prepare(
      `UPDATE local_backup_settings SET last_backup_status = 'failed',
       last_backup_error = 'Previous backup was interrupted', updated_at = ? WHERE id = ?`
    ).run(ts, row.id)
    db.prepare(
      `UPDATE local_backup_logs SET status = 'failed', completed_at = ?,
       error_message = 'Backup was interrupted' WHERE shop_id = ? AND status = 'in_progress'`
    ).run(ts, shopId)
    row = db.prepare('SELECT * FROM local_backup_settings WHERE shop_id = ?').get(shopId) as LocalBackupSettingsRow
  }
  return row
}

function nextOccurrence(
  frequency: LocalBackupSettingsRow['auto_backup_frequency'],
  hhmm: string,
  from = new Date()
): string | null {
  if (frequency === 'off') return null
  const [hour, minute] = hhmm.split(':').map(Number)
  const next = new Date(from)
  next.setHours(hour, minute, 0, 0)
  if (frequency === 'daily') {
    if (next <= from) next.setDate(next.getDate() + 1)
  } else if (frequency === 'weekly') {
    next.setDate(next.getDate() + 7)
  } else {
    next.setMonth(next.getMonth() + 1)
  }
  return next.toISOString()
}

function publicStatus(row: LocalBackupSettingsRow): LocalAutoBackupStatus {
  return {
    folder: folderOf(row),
    using_default_folder: !row.folder,
    auto_backup_frequency: row.auto_backup_frequency,
    backup_time: row.backup_time,
    backup_on_close: !!row.backup_on_close,
    include_images: !!row.include_images,
    retention_count: row.retention_count,
    last_backup_at: row.last_backup_at,
    last_backup_status: row.last_backup_status,
    last_backup_error: row.last_backup_error,
    last_backup_file: row.last_backup_file,
    next_backup_at: row.next_backup_at,
    backup_in_progress: backupInProgress,
  }
}

export function getStatus(session: Session): LocalAutoBackupStatus {
  return publicStatus(ensureSettings(session.shopId))
}

export function updateSettings(session: Session, input: LocalBackupSettingsInput): LocalAutoBackupStatus {
  const row = ensureSettings(session.shopId)
  getDb()
    .prepare(
      `UPDATE local_backup_settings SET auto_backup_frequency = ?, backup_time = ?, backup_on_close = ?,
       include_images = ?, retention_count = ?, next_backup_at = ?, updated_at = ? WHERE id = ?`
    )
    .run(
      input.auto_backup_frequency,
      input.backup_time,
      input.backup_on_close ? 1 : 0,
      input.include_images ? 1 : 0,
      input.retention_count,
      nextOccurrence(input.auto_backup_frequency, input.backup_time),
      now(),
      row.id
    )
  audit(session, 'local_backup.settings', input)
  return publicStatus(ensureSettings(session.shopId))
}

/** Point the backups at another folder — a USB stick or a network share. */
export async function chooseFolder(session: Session): Promise<LocalAutoBackupStatus> {
  const row = ensureSettings(session.shopId)
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Choose a folder for automatic backups',
    defaultPath: folderOf(row),
    properties: ['openDirectory', 'createDirectory'],
  })
  if (canceled || filePaths.length === 0) return publicStatus(row)
  const folder = filePaths[0]
  // Fail here, with the picker still fresh in mind, rather than silently at 21:00.
  await fs.promises.mkdir(folder, { recursive: true })
  await fs.promises.access(folder, fs.constants.W_OK).catch(() => {
    throw new AppError('That folder cannot be written to. Choose another one.')
  })
  getDb()
    .prepare('UPDATE local_backup_settings SET folder = ?, updated_at = ? WHERE id = ?')
    .run(folder, now(), row.id)
  audit(session, 'local_backup.folder', { folder })
  return publicStatus(ensureSettings(session.shopId))
}

/** Back to the app's own backups folder. */
export function useDefaultFolder(session: Session): LocalAutoBackupStatus {
  const row = ensureSettings(session.shopId)
  getDb()
    .prepare('UPDATE local_backup_settings SET folder = NULL, updated_at = ? WHERE id = ?')
    .run(now(), row.id)
  audit(session, 'local_backup.folder', { folder: null })
  return publicStatus(ensureSettings(session.shopId))
}

export async function openFolder(session: Session): Promise<{ opened: boolean }> {
  const folder = folderOf(ensureSettings(session.shopId))
  await fs.promises.mkdir(folder, { recursive: true }).catch(() => undefined)
  const error = await shell.openPath(folder)
  if (error) throw new AppError(error)
  return { opened: true }
}

/** `2026-08-03T18:04:22.913Z` → `2026-08-03_18-04-22`, sortable and legal on NTFS. */
function stamp(iso: string): string {
  return iso.slice(0, 19).replace('T', '_').replace(/:/g, '-')
}

function isBackupFile(name: string): boolean {
  return name.startsWith(FILE_PREFIX) && name.endsWith(FILE_SUFFIX)
}

/**
 * Two backups inside the same second — "Back Up Now" pressed twice — would
 * otherwise overwrite each other. The `_2` suffix sorts after the plain name,
 * so newest-first ordering still holds.
 */
async function freePath(folder: string, base: string): Promise<string> {
  for (let n = 1; n < 100; n += 1) {
    const file = path.join(folder, `${FILE_PREFIX}${base}${n === 1 ? '' : `_${n}`}${FILE_SUFFIX}`)
    try {
      await fs.promises.access(file)
    } catch {
      return file
    }
  }
  throw new AppError('Too many backups were made in the same second')
}

async function listFiles(folder: string): Promise<LocalAutoBackupFile[]> {
  let entries: fs.Dirent[]
  try {
    entries = await fs.promises.readdir(folder, { withFileTypes: true })
  } catch {
    // No folder yet — nothing has been backed up.
    return []
  }
  const files: LocalAutoBackupFile[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !isBackupFile(entry.name)) continue
    const full = path.join(folder, entry.name)
    try {
      const stat = await fs.promises.stat(full)
      files.push({ name: entry.name, path: full, size: stat.size, created_at: stat.mtime.toISOString() })
    } catch {
      // Vanished between readdir and stat — skip it.
    }
  }
  // Newest first. The timestamp is in the name, so this holds even if a file
  // was copied around and lost its original mtime. Compared by code unit, not
  // by locale: collation may ignore the `_` in a same-second `_2` suffix and
  // then retention would delete the newer of the two.
  return files.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0))
}

export async function listBackups(session: Session): Promise<LocalAutoBackupFile[]> {
  return listFiles(folderOf(ensureSettings(session.shopId)))
}

export function listLogs(session: Session): LocalAutoBackupLog[] {
  return getDb()
    .prepare(
      `SELECT id, backup_type, status, started_at, completed_at, file_path, file_size, error_message
       FROM local_backup_logs WHERE shop_id = ? ORDER BY started_at DESC LIMIT 50`
    )
    .all(session.shopId) as LocalAutoBackupLog[]
}

/**
 * Keep the newest `keep` files and delete the rest. Only files this app wrote
 * are ever considered — the shop may have pointed the setting at a folder that
 * holds its own documents.
 */
async function enforceRetention(folder: string, keep: number): Promise<number> {
  const files = await listFiles(folder)
  let removed = 0
  for (const file of files.slice(keep)) {
    try {
      await fs.promises.rm(file.path, { force: true })
      removed += 1
    } catch {
      // A locked or read-only file is not worth failing the backup over.
    }
  }
  return removed
}

async function runBackup(shopId: string, type: 'auto' | 'manual' | 'on_close'): Promise<LocalAutoBackupFile> {
  if (backupInProgress) throw new AppError('A local backup is already running')
  const settings = ensureSettings(shopId)
  const folder = folderOf(settings)
  backupInProgress = true
  const logId = uid()
  const startedAt = now()
  getDb()
    .prepare(
      `INSERT INTO local_backup_logs (id, shop_id, backup_type, status, started_at, created_at)
       VALUES (?, ?, ?, 'in_progress', ?, ?)`
    )
    .run(logId, shopId, type, startedAt, startedAt)
  getDb()
    .prepare(
      `UPDATE local_backup_settings SET last_backup_status = 'in_progress', last_backup_error = NULL,
       updated_at = ? WHERE id = ?`
    )
    .run(startedAt, settings.id)

  let tempDir: string | null = null
  try {
    await fs.promises.mkdir(folder, { recursive: true })
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pos-local-backup-'))
    const archive = await createArchive(shopId, !!settings.include_images, tempDir)
    const destination = await freePath(folder, stamp(archive.createdAt))
    // copy + unlink rather than rename: the target folder is very often on
    // another device (a USB stick), where rename fails with EXDEV.
    await fs.promises.copyFile(archive.file, destination)
    const size = (await fs.promises.stat(destination)).size

    const completed = now()
    getDb()
      .prepare(
        `UPDATE local_backup_logs SET status = 'success', completed_at = ?, file_path = ?, file_size = ?
         WHERE id = ?`
      )
      .run(completed, destination, size, logId)
    getDb()
      .prepare(
        `UPDATE local_backup_settings SET last_backup_at = ?, last_backup_status = 'success',
         last_backup_error = NULL, last_backup_file = ?, next_backup_at = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        completed,
        destination,
        nextOccurrence(settings.auto_backup_frequency, settings.backup_time),
        completed,
        settings.id
      )
    await enforceRetention(folder, settings.retention_count)
    return { name: path.basename(destination), path: destination, size, created_at: archive.createdAt }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Backup failed'
    const completed = now()
    getDb()
      .prepare('UPDATE local_backup_logs SET status = \'failed\', completed_at = ?, error_message = ? WHERE id = ?')
      .run(completed, message, logId)
    // Retry in 15 minutes rather than waiting a whole day — a full disk or an
    // unplugged USB stick is usually fixed within the shift.
    const retryAt = new Date(Date.now() + 15 * 60_000).toISOString()
    getDb()
      .prepare(
        `UPDATE local_backup_settings SET last_backup_status = 'failed', last_backup_error = ?,
         next_backup_at = ?, updated_at = ? WHERE id = ?`
      )
      .run(message, settings.auto_backup_frequency === 'off' ? null : retryAt, completed, settings.id)
    throw error instanceof AppError ? error : new AppError(message)
  } finally {
    backupInProgress = false
    if (tempDir) await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function backupNow(session: Session): Promise<LocalAutoBackupFile> {
  const file = await runBackup(session.shopId, 'manual')
  audit(session, 'local_backup.create', { file: file.name, size: file.size })
  return file
}

/**
 * A copy of what is about to be overwritten, taken just before a restore.
 * replaceLocalData already rolls back a *failed* restore; this is for the
 * restore that succeeds and turns out to have been the wrong file. Never
 * throws — a shop must still be able to restore onto a full disk.
 */
export async function safetyBackup(shopId: string): Promise<string | null> {
  try {
    const file = await runBackup(shopId, 'manual')
    return file.path
  } catch {
    return null
  }
}

/** Manual prune, so a shop can reclaim the folder without waiting for a backup. */
export async function pruneNow(session: Session): Promise<{ removed: number }> {
  const settings = ensureSettings(session.shopId)
  const removed = await enforceRetention(folderOf(settings), settings.retention_count)
  if (removed > 0) audit(session, 'local_backup.prune', { removed })
  return { removed }
}

export function startLocalBackupScheduler() {
  if (scheduler) return
  const tick = async () => {
    if (backupInProgress) return
    try {
      const shop = getDb().prepare('SELECT id FROM shops LIMIT 1').get() as { id: string } | undefined
      if (!shop) return
      const settings = ensureSettings(shop.id)
      if (settings.auto_backup_frequency === 'off') return
      if (!settings.next_backup_at) {
        getDb()
          .prepare('UPDATE local_backup_settings SET next_backup_at = ?, updated_at = ? WHERE id = ?')
          .run(nextOccurrence(settings.auto_backup_frequency, settings.backup_time), now(), settings.id)
        return
      }
      if (settings.next_backup_at <= now()) await runBackup(shop.id, 'auto').catch(() => undefined)
    } catch {
      // Startup, migration and transient disk failures are retried next tick.
    }
  }
  void tick()
  scheduler = setInterval(() => void tick(), 60_000)
}

/**
 * One last backup as the app closes, for the shop that shuts the till before
 * the scheduled time ever arrives. Never throws and never runs longer than
 * ON_CLOSE_TIMEOUT_MS: quitting must not depend on a healthy disk.
 */
export async function backupOnClose(): Promise<void> {
  try {
    const shop = getDb().prepare('SELECT id FROM shops LIMIT 1').get() as { id: string } | undefined
    if (!shop) return
    const settings = ensureSettings(shop.id)
    if (!settings.backup_on_close) return
    await Promise.race([
      runBackup(shop.id, 'on_close'),
      new Promise((resolve) => setTimeout(resolve, ON_CLOSE_TIMEOUT_MS)),
    ])
  } catch {
    // The failure is already recorded in local_backup_logs; the app still quits.
  }
}
