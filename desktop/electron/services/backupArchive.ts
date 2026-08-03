// The backup container format, shared by every backup route (Google Drive,
// local file, and the pre-setup recovery screens).
//
// Layout of a .posbackup.gz: gzip( MAGIC | uint32 manifest length | manifest
// JSON | file bytes in manifest order ). Every entry carries its own SHA-256,
// so a truncated or edited archive is rejected before anything on disk is
// touched.
//
// A plain SQLite file is also accepted for restore: `settings:backup` wrote
// bare .db files before this format existed, and shopkeepers keep those copies.
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip, createGunzip } from 'node:zlib'
import type DatabaseType from 'better-sqlite3'
import { LATEST_SCHEMA_VERSION, closeDb, getDb, openDb } from '../db'
import { imagesDir } from './images'
import { AppError, now } from './helpers'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as typeof DatabaseType

export const MAGIC = Buffer.from('POSBKP1\n')
export const MAX_BACKUP_BYTES = 512 * 1024 * 1024
export const MAX_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024

const GZIP_MAGIC = Buffer.from([0x1f, 0x8b])
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1')

interface ManifestEntry {
  path: string
  size: number
  sha256: string
}

export interface BackupManifest {
  formatVersion: 1
  appVersion: string
  createdAt: string
  shopId: string
  shopName: string
  files: ManifestEntry[]
}

/** A validated backup, staged in a temp directory and ready to be swapped in. */
export interface RestorePayload {
  db: string
  /** null = keep the current product images; a bare .db carries none. */
  images: string | null
  shopId: string
  shopName: string | null
  createdAt: string | null
  appVersion: string | null
  format: 'archive' | 'database'
}

export function databaseFile(): string {
  return path.join(app.getPath('userData'), 'pos.db')
}

/** Pre-setup recovery routes are public, so each one re-checks this itself. */
export function assertNoShopExists(message: string) {
  const row = getDb().prepare('SELECT COUNT(*) AS count FROM shops').get() as { count: number }
  if (row.count !== 0) throw new AppError(message)
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(fs.createReadStream(file), hash)
  return hash.digest('hex')
}

async function appendFile(output: fs.promises.FileHandle, source: string, position: number): Promise<number> {
  const input = await fs.promises.open(source, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let inputPosition = 0
    let reachedEnd = false
    while (!reachedEnd) {
      const { bytesRead } = await input.read(buffer, 0, buffer.length, inputPosition)
      if (!bytesRead) {
        reachedEnd = true
        continue
      }
      await output.write(buffer, 0, bytesRead, position)
      inputPosition += bytesRead
      position += bytesRead
    }
    return position
  } finally {
    await input.close()
  }
}

/**
 * Snapshots the live database (plus images) into a compressed archive inside a
 * fresh temp directory. Callers upload or copy `file`, then await `cleanup()`.
 */
export async function createArchive(
  shopId: string,
  includeImages: boolean,
  tempDir: string
): Promise<{ file: string; createdAt: string; shopName: string }> {
  const dbSnapshot = path.join(tempDir, 'pos.db')
  const container = path.join(tempDir, 'backup.bin')
  const compressed = path.join(tempDir, 'backup.posbackup.gz')
  await getDb().backup(dbSnapshot)

  const shop = getDb().prepare('SELECT name FROM shops WHERE id = ?').get(shopId) as { name: string } | undefined
  if (!shop) throw new AppError('Shop not found')
  const sources: { archivePath: string; file: string }[] = [{ archivePath: 'database/pos.db', file: dbSnapshot }]
  if (includeImages) {
    const entries = await fs.promises.readdir(imagesDir(), { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile()) {
        sources.push({ archivePath: `images/${path.basename(entry.name)}`, file: path.join(imagesDir(), entry.name) })
      }
    }
  }

  const files: ManifestEntry[] = []
  for (const source of sources) {
    const stat = await fs.promises.stat(source.file)
    files.push({ path: source.archivePath, size: stat.size, sha256: await sha256File(source.file) })
  }
  const createdAt = now()
  const manifest: BackupManifest = {
    formatVersion: 1,
    appVersion: app.getVersion(),
    createdAt,
    shopId,
    shopName: shop.name,
    files,
  }
  const manifestBytes = Buffer.from(JSON.stringify(manifest))
  const length = Buffer.alloc(4)
  length.writeUInt32BE(manifestBytes.length)
  const output = await fs.promises.open(container, 'w')
  try {
    let position = 0
    for (const bytes of [MAGIC, length, manifestBytes]) {
      await output.write(bytes, 0, bytes.length, position)
      position += bytes.length
    }
    for (const source of sources) position = await appendFile(output, source.file, position)
  } finally {
    await output.close()
  }
  await pipeline(fs.createReadStream(container), createGzip({ level: 6 }), fs.createWriteStream(compressed))
  await fs.promises.rm(container, { force: true }).catch(() => undefined)
  return { file: compressed, createdAt, shopName: shop.name }
}

export function byteLimit(limit: number, label: string): Transform {
  let total = 0
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length
      callback(total <= limit ? null : new AppError(`${label} exceeds the supported size limit`), chunk)
    },
  })
}

async function readExactly(file: fs.promises.FileHandle, length: number, position: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length)
  const { bytesRead } = await file.read(buffer, 0, length, position)
  if (bytesRead !== length) throw new AppError('Backup is incomplete')
  return buffer
}

async function readHeader(file: string, length: number): Promise<Buffer> {
  const handle = await fs.promises.open(file, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

export async function extractArchive(
  compressed: string,
  expectedShopId: string | null,
  tempDir: string
): Promise<{ db: string; images: string; manifest: BackupManifest }> {
  const container = path.join(tempDir, 'restore.bin')
  await pipeline(
    fs.createReadStream(compressed),
    createGunzip(),
    byteLimit(MAX_UNCOMPRESSED_BYTES, 'Uncompressed backup'),
    fs.createWriteStream(container)
  )
  const input = await fs.promises.open(container, 'r')
  try {
    const magic = await readExactly(input, MAGIC.length, 0)
    if (!magic.equals(MAGIC)) throw new AppError('This is not a supported POS backup')
    const manifestLength = (await readExactly(input, 4, MAGIC.length)).readUInt32BE(0)
    if (manifestLength < 2 || manifestLength > 1024 * 1024) throw new AppError('Backup manifest is invalid')
    const manifest = JSON.parse((await readExactly(input, manifestLength, MAGIC.length + 4)).toString('utf8')) as BackupManifest
    if (
      manifest.formatVersion !== 1 ||
      typeof manifest.shopId !== 'string' || !manifest.shopId || manifest.shopId.length > 100 ||
      typeof manifest.shopName !== 'string' || manifest.shopName.length > 200 ||
      (expectedShopId !== null && manifest.shopId !== expectedShopId)
    ) {
      throw new AppError('This backup belongs to a different shop or app version')
    }
    if (!Array.isArray(manifest.files) || manifest.files.length > 10_000) throw new AppError('Backup file list is invalid')

    const outputRoot = path.join(tempDir, 'extracted')
    const imageOutput = path.join(outputRoot, 'product-images')
    await fs.promises.mkdir(imageOutput, { recursive: true })
    let position = MAGIC.length + 4 + manifestLength
    let databasePath = ''
    const seenPaths = new Set<string>()
    for (const entry of manifest.files) {
      const validPath = entry.path === 'database/pos.db' ||
        (entry.path.startsWith('images/') && path.basename(entry.path) === entry.path.slice('images/'.length))
      if (!validPath || !Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
        throw new AppError('Backup contains an unsafe or invalid file entry')
      }
      if (seenPaths.has(entry.path)) throw new AppError('Backup contains duplicate file entries')
      seenPaths.add(entry.path)
      const destination = entry.path === 'database/pos.db'
        ? path.join(outputRoot, 'pos.db')
        : path.join(imageOutput, path.basename(entry.path))
      const output = await fs.promises.open(destination, 'w')
      const hash = createHash('sha256')
      try {
        let remaining = entry.size
        const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, Math.max(1, remaining)))
        while (remaining > 0) {
          const wanted = Math.min(buffer.length, remaining)
          const { bytesRead } = await input.read(buffer, 0, wanted, position)
          if (!bytesRead) throw new AppError('Backup is incomplete')
          await output.write(buffer, 0, bytesRead)
          hash.update(buffer.subarray(0, bytesRead))
          remaining -= bytesRead
          position += bytesRead
        }
      } finally {
        await output.close()
      }
      if (hash.digest('hex') !== entry.sha256) throw new AppError(`Backup checksum failed for ${entry.path}`)
      if (entry.path === 'database/pos.db') databasePath = destination
    }
    const stat = await input.stat()
    if (position !== stat.size || !databasePath) throw new AppError('Backup contents are invalid')
    validateDatabase(databasePath, manifest.shopId)
    return { db: databasePath, images: imageOutput, manifest }
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('Backup is damaged or unreadable')
  } finally {
    await input.close()
  }
}

/**
 * Opens a candidate database read-only and refuses anything the running app
 * could not serve: a corrupt file, a different shop, or a schema written by a
 * newer POS Desktop (restoring that would leave migrations un-run).
 */
export function validateDatabase(file: string, shopId: string | null): { id: string; name: string } {
  let candidate: DatabaseType.Database
  try {
    candidate = new Database(file, { readonly: true, fileMustExist: true })
  } catch {
    throw new AppError('This file is not a POS database')
  }
  try {
    const integrity = candidate.pragma('integrity_check') as { integrity_check: string }[]
    if (integrity[0]?.integrity_check !== 'ok') throw new AppError('The backup database failed its integrity check')
    const migrations = candidate
      .prepare('SELECT MAX(version) AS version FROM schema_migrations')
      .get() as { version: number | null }
    if (!migrations.version) throw new AppError('The backup database is not initialised')
    if (migrations.version > LATEST_SCHEMA_VERSION) {
      throw new AppError('This backup was made by a newer version of POS Desktop. Update the app, then restore again.')
    }
    const shops = candidate.prepare('SELECT id, name FROM shops').all() as { id: string; name: string }[]
    if (shopId !== null) {
      const shop = shops.find((row) => row.id === shopId)
      if (!shop) throw new AppError('This backup belongs to a different shop')
      return shop
    }
    if (shops.length !== 1) throw new AppError('The backup does not contain exactly one shop')
    return shops[0]
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('This file is not a POS database')
  } finally {
    candidate.close()
  }
}

/**
 * Copies a bare .db aside together with any -wal/-shm sitting next to it and
 * folds the journal into the file itself.
 *
 * A pos.db lifted straight out of another computer's data folder is in WAL
 * mode, so its most recent sales live in the companion -wal. Copying only the
 * .db would restore a shop that is silently missing its last day of trading.
 */
async function stageDatabaseFile(file: string, tempDir: string): Promise<string> {
  const staged = path.join(tempDir, 'restored.db')
  await fs.promises.copyFile(file, staged)
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(`${file}${suffix}`)) {
      await fs.promises.copyFile(`${file}${suffix}`, `${staged}${suffix}`)
    }
  }
  let candidate: DatabaseType.Database
  try {
    candidate = new Database(staged, { fileMustExist: true })
  } catch {
    throw new AppError('This file is not a POS database')
  }
  try {
    candidate.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    // Nothing to fold in, or a journal this SQLite build will not replay; the
    // .db alone still restores and validateDatabase decides whether it is sane.
  } finally {
    candidate.close()
  }
  await fs.promises.rm(`${staged}-wal`, { force: true }).catch(() => undefined)
  await fs.promises.rm(`${staged}-shm`, { force: true }).catch(() => undefined)
  return staged
}

/**
 * Validates any supported backup file and stages it for restore. Nothing on
 * disk changes here — a rejected backup leaves the live shop untouched.
 */
export async function readBackupFile(
  file: string,
  expectedShopId: string | null,
  tempDir: string
): Promise<RestorePayload> {
  if (path.resolve(file) === path.resolve(databaseFile())) {
    throw new AppError('That is the database this app is running on. Choose a backup copy instead.')
  }
  const stat = await fs.promises.stat(file).catch(() => null)
  if (!stat?.isFile()) throw new AppError('Backup file could not be read')
  if (stat.size > MAX_BACKUP_BYTES) throw new AppError('Backup is larger than the supported 512 MB limit')

  const header = await readHeader(file, SQLITE_MAGIC.length)
  if (header.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC)) {
    const staged = await stageDatabaseFile(file, tempDir)
    const shop = validateDatabase(staged, expectedShopId)
    return {
      db: staged,
      images: null,
      shopId: shop.id,
      shopName: shop.name,
      createdAt: stat.mtime.toISOString(),
      appVersion: null,
      format: 'database',
    }
  }
  if (!header.subarray(0, GZIP_MAGIC.length).equals(GZIP_MAGIC)) {
    throw new AppError('This is not a POS backup file')
  }
  const extracted = await extractArchive(file, expectedShopId, tempDir)
  return {
    db: extracted.db,
    images: extracted.images,
    shopId: extracted.manifest.shopId,
    shopName: extracted.manifest.shopName,
    createdAt: extracted.manifest.createdAt,
    appVersion: extracted.manifest.appVersion,
    format: 'archive',
  }
}

/**
 * Swaps the staged backup in. The current database and images are moved aside
 * first and put back if any step fails, so a failed restore is a no-op.
 *
 * The restored database is opened and migrated up to the running app's schema
 * before this returns. That has to happen here, while the previous data is
 * still on disk to roll back to: a restore that only failed on the *next*
 * launch would leave the shop with an app that cannot start and no way back.
 */
export async function replaceLocalData(payload: { db: string; images: string | null }) {
  const userData = app.getPath('userData')
  const database = databaseFile()
  const currentImages = path.join(userData, 'product-images')
  const stamp = Date.now()
  const rollbackDb = path.join(userData, `pos-before-restore-${stamp}.db`)
  const rollbackImages = path.join(userData, `product-images-before-restore-${stamp}`)
  closeDb()
  let dbMoved = false
  let imagesMoved = false

  const rollback = async () => {
    await fs.promises.rm(database, { force: true }).catch(() => undefined)
    await removeJournals(database)
    if (dbMoved) await fs.promises.rename(rollbackDb, database).catch(() => undefined)
    if (payload.images) {
      // A half-copied image folder is discarded whether or not the original was
      // moved aside — only a complete restore may leave images behind.
      await fs.promises.rm(currentImages, { recursive: true, force: true }).catch(() => undefined)
      if (imagesMoved) await fs.promises.rename(rollbackImages, currentImages).catch(() => undefined)
    }
    try {
      openDb()
    } catch {
      // Reported by the caller's own error; main.ts surfaces it at next launch.
    }
  }

  try {
    if (fs.existsSync(database)) {
      await fs.promises.rename(database, rollbackDb)
      dbMoved = true
    }
    // The old WAL/SHM belong to the database just moved aside and would corrupt
    // the incoming one, so they go before it is copied in — never after.
    await removeJournals(database)
    await fs.promises.copyFile(payload.db, database)
    if (payload.images) {
      if (fs.existsSync(currentImages)) {
        await fs.promises.rename(currentImages, rollbackImages)
        imagesMoved = true
      }
      await fs.promises.cp(payload.images, currentImages, { recursive: true })
    }
  } catch (error) {
    await rollback()
    throw error
  }

  // Older backups are migrated forward here, so the app that starts next is
  // always looking at the schema it was built for.
  try {
    openDb()
  } catch (error) {
    await rollback()
    throw new AppError(
      'The backup could not be upgraded to this version of POS Desktop, so your existing data was ' +
        `put back and nothing was changed. (${error instanceof Error ? error.message : String(error)})`
    )
  }

  await fs.promises.rm(rollbackDb, { force: true }).catch(() => undefined)
  await fs.promises.rm(rollbackImages, { recursive: true, force: true }).catch(() => undefined)
}

async function removeJournals(database: string) {
  for (const suffix of ['-wal', '-shm']) {
    await fs.promises.rm(`${database}${suffix}`, { force: true }).catch(() => undefined)
  }
}
