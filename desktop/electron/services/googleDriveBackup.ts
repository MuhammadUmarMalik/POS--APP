import { app, safeStorage, shell } from 'electron'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { getDb } from '../db'
import {
  MAX_BACKUP_BYTES, assertNoShopExists, byteLimit, createArchive, extractArchive, replaceLocalData,
} from './backupArchive'
import { AppError, audit, now, uid } from './helpers'
import { restartAfterRestore } from './restart'
import type {
  DriveBackupFile,
  DriveBackupFrequency,
  DriveBackupLog,
  DriveBackupStatus,
  DriveRecoveryStatus,
  Session,
} from '../../src/shared/types'
import type { DriveBackupSettingsInput } from '../../src/shared/schemas'

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
const BACKUP_MIME = 'application/vnd.pos-desktop.backup+gzip'
const BACKUP_PREFIX = 'pos-desktop-backup-'
const OAUTH_TIMEOUT_MS = 3 * 60_000

interface OAuthConfig {
  clientId: string
  clientSecret?: string
}

interface StoredCredential {
  refreshToken: string
  email: string | null
}

interface AccessToken {
  value: string
  expiresAt: number
}

interface BackupSettingsRow {
  id: string
  shop_id: string
  auto_backup_frequency: DriveBackupFrequency
  backup_time: string
  include_images: number
  retention_count: number
  account_email: string | null
  last_backup_at: string | null
  last_backup_status: 'success' | 'failed' | 'in_progress' | null
  last_backup_error: string | null
  next_backup_at: string | null
  created_at: string
  updated_at: string
}

interface DriveFileResponse {
  id: string
  name: string
  size?: string
  createdTime?: string
  modifiedTime?: string
  appProperties?: Record<string, string>
}

let cachedToken: AccessToken | null = null
let backupInProgress = false
let scheduler: ReturnType<typeof setInterval> | null = null

function credentialsPath(): string {
  return path.join(app.getPath('userData'), 'google-drive-credentials.json')
}

function readOAuthConfig(): OAuthConfig | null {
  const envId = process.env.POS_GOOGLE_DRIVE_CLIENT_ID?.trim()
  if (envId) {
    return { clientId: envId, clientSecret: process.env.POS_GOOGLE_DRIVE_CLIENT_SECRET?.trim() }
  }

  const candidates = [
    path.join(app.getPath('userData'), 'google-drive-oauth.json'),
    path.join(process.resourcesPath, 'google-drive-oauth.json'),
    path.join(process.cwd(), 'resources', 'google-drive-oauth.json'),
  ]
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        client_id?: string
        client_secret?: string
        installed?: { client_id?: string; client_secret?: string }
      }
      const clientId = parsed.installed?.client_id ?? parsed.client_id
      const clientSecret = parsed.installed?.client_secret ?? parsed.client_secret
      if (clientId) return { clientId, clientSecret }
    } catch {
      // Missing/invalid candidate: try the next supported location.
    }
  }
  return null
}

function saveCredential(credential: StoredCredential) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new AppError('Secure credential storage is unavailable on this computer')
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(credential))
  const file = credentialsPath()
  fs.writeFileSync(file, JSON.stringify({ version: 1, encrypted: encrypted.toString('base64') }), {
    mode: 0o600,
  })
}

function loadCredential(): StoredCredential | null {
  try {
    const envelope = JSON.parse(fs.readFileSync(credentialsPath(), 'utf8')) as { encrypted: string }
    const plain = safeStorage.decryptString(Buffer.from(envelope.encrypted, 'base64'))
    const credential = JSON.parse(plain) as StoredCredential
    return credential.refreshToken ? credential : null
  } catch {
    return null
  }
}

function deleteCredential() {
  cachedToken = null
  try {
    fs.unlinkSync(credentialsPath())
  } catch {
    // Already disconnected.
  }
}

function ensureSettings(shopId: string): BackupSettingsRow {
  const db = getDb()
  let row = db.prepare('SELECT * FROM drive_backup_settings WHERE shop_id = ?').get(shopId) as
    | BackupSettingsRow
    | undefined
  if (!row) {
    const ts = now()
    db.prepare(
      `INSERT INTO drive_backup_settings
       (id, shop_id, next_backup_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
    ).run(uid(), shopId, nextOccurrence('daily', '02:00'), ts, ts)
    row = db.prepare('SELECT * FROM drive_backup_settings WHERE shop_id = ?').get(shopId) as BackupSettingsRow
  }
  if (!backupInProgress && row.last_backup_status === 'in_progress') {
    const ts = now()
    db.prepare(
      `UPDATE drive_backup_settings SET last_backup_status = 'failed',
       last_backup_error = 'Previous backup was interrupted', updated_at = ? WHERE id = ?`
    ).run(ts, row.id)
    db.prepare(
      `UPDATE drive_backup_logs SET status = 'failed', completed_at = ?,
       error_message = 'Backup was interrupted' WHERE shop_id = ? AND status = 'in_progress'`
    ).run(ts, shopId)
    row = db.prepare('SELECT * FROM drive_backup_settings WHERE shop_id = ?').get(shopId) as BackupSettingsRow
  }
  return row
}

function nextOccurrence(frequency: DriveBackupFrequency, hhmm: string, from = new Date()): string | null {
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

function publicStatus(row: BackupSettingsRow): DriveBackupStatus {
  return {
    configured: !!readOAuthConfig(),
    connected: !!loadCredential(),
    account_email: row.account_email,
    auto_backup_frequency: row.auto_backup_frequency,
    backup_time: row.backup_time,
    include_images: !!row.include_images,
    retention_count: row.retention_count,
    last_backup_at: row.last_backup_at,
    last_backup_status: row.last_backup_status,
    last_backup_error: row.last_backup_error,
    next_backup_at: row.next_backup_at,
    backup_in_progress: backupInProgress,
  }
}

function assertFreshInstallRecovery() {
  assertNoShopExists(
    'Drive recovery is only available before shop setup. Sign in and restore from Settings instead.'
  )
}

function recoveryStatus(): DriveRecoveryStatus {
  const credential = loadCredential()
  return {
    configured: !!readOAuthConfig(),
    connected: !!credential,
    account_email: credential?.email ?? null,
  }
}

export function getStatus(session: Session): DriveBackupStatus {
  return publicStatus(ensureSettings(session.shopId))
}

function base64Url(input: Buffer): string {
  return input.toString('base64url')
}

async function fetchAccountEmail(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) return null
    const payload = await response.json() as {
      email?: string
    }
    return payload.email ?? null
  } catch {
    return null
  }
}

async function tokenRequest(params: URLSearchParams): Promise<Record<string, unknown>> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params,
    signal: AbortSignal.timeout(30_000),
  })
  const data = (await response.json()) as Record<string, unknown>
  if (!response.ok) {
    const description = typeof data.error_description === 'string' ? data.error_description : 'Authorization failed'
    throw new AppError(description)
  }
  return data
}

async function authorizeGoogleDrive(): Promise<StoredCredential> {
  const config = readOAuthConfig()
  if (!config) {
    throw new AppError('Google Drive OAuth is not configured. Add a Desktop OAuth client to the app configuration.')
  }

  const verifier = base64Url(randomBytes(64))
  const challenge = base64Url(createHash('sha256').update(verifier).digest())
  const state = base64Url(randomBytes(24))

  const server = http.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new AppError('Could not start the secure Google sign-in callback')
  }
  const redirectUri = `http://127.0.0.1:${address.port}`

  const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authorization.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: `${DRIVE_SCOPE} openid email`,
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  }).toString()

  const codePromise = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new AppError('Google sign-in timed out')), OAUTH_TIMEOUT_MS)
    server.on('request', (request, response) => {
      const url = new URL(request.url ?? '/', redirectUri)
      const finish = (html: string) => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end(html)
      }
      if (url.searchParams.get('state') !== state) {
        finish('<h2>Sign-in could not be verified.</h2><p>Return to POS Desktop and try again.</p>')
        clearTimeout(timeout)
        reject(new AppError('Google sign-in state did not match'))
        return
      }
      const error = url.searchParams.get('error')
      const code = url.searchParams.get('code')
      clearTimeout(timeout)
      if (error || !code) {
        finish('<h2>Google Drive was not connected.</h2><p>You can close this tab.</p>')
        reject(new AppError(error === 'access_denied' ? 'Google Drive access was cancelled' : 'Google sign-in failed'))
      } else {
        finish('<h2>Google Drive connected.</h2><p>You can close this tab and return to POS Desktop.</p>')
        resolve(code)
      }
    })
  })

  try {
    await shell.openExternal(authorization.toString())
    const code = await codePromise
    const params = new URLSearchParams({
      client_id: config.clientId,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    })
    if (config.clientSecret) params.set('client_secret', config.clientSecret)
    const tokens = await tokenRequest(params)
    const refreshToken = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : null
    if (!refreshToken) throw new AppError('Google did not return an offline access token. Disconnect and try again.')
    const accessToken = typeof tokens.access_token === 'string' ? tokens.access_token : null
    if (!accessToken) throw new AppError('Google did not return an access token')
    const email = await fetchAccountEmail(accessToken)
    cachedToken = {
      value: accessToken,
      expiresAt: Date.now() + Number(tokens.expires_in ?? 3600) * 1000,
    }
    const credential = { refreshToken, email }
    saveCredential(credential)
    return credential
  } finally {
    server.close()
  }
}

export async function connect(session: Session): Promise<DriveBackupStatus> {
  const credential = await authorizeGoogleDrive()
  const row = ensureSettings(session.shopId)
  getDb().prepare(
    `UPDATE drive_backup_settings SET account_email = ?, next_backup_at = ?,
     last_backup_error = NULL, updated_at = ? WHERE id = ?`
  ).run(credential.email, nextOccurrence(row.auto_backup_frequency, row.backup_time), now(), row.id)
  audit(session, 'drive_backup.connect', { email: credential.email })
  return getStatus(session)
}

export function getRecoveryStatus(): DriveRecoveryStatus {
  assertFreshInstallRecovery()
  return recoveryStatus()
}

export async function connectForRecovery(): Promise<DriveRecoveryStatus> {
  assertFreshInstallRecovery()
  await authorizeGoogleDrive()
  return recoveryStatus()
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value
  const credential = loadCredential()
  const config = readOAuthConfig()
  if (!credential || !config) throw new AppError('Connect a Google Drive account first')
  const params = new URLSearchParams({
    client_id: config.clientId,
    refresh_token: credential.refreshToken,
    grant_type: 'refresh_token',
  })
  if (config.clientSecret) params.set('client_secret', config.clientSecret)
  const tokens = await tokenRequest(params)
  cachedToken = {
    value: String(tokens.access_token),
    expiresAt: Date.now() + Number(tokens.expires_in ?? 3600) * 1000,
  }
  return cachedToken.value
}

async function revokeAndDeleteCredential() {
  const credential = loadCredential()
  if (credential) {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: credential.refreshToken }),
      signal: AbortSignal.timeout(30_000),
    }).catch(() => undefined)
  }
  deleteCredential()
}

export async function disconnectForRecovery(): Promise<DriveRecoveryStatus> {
  assertFreshInstallRecovery()
  await revokeAndDeleteCredential()
  return recoveryStatus()
}

export async function disconnect(session: Session): Promise<DriveBackupStatus> {
  await revokeAndDeleteCredential()
  const row = ensureSettings(session.shopId)
  getDb().prepare(
    `UPDATE drive_backup_settings SET account_email = NULL, next_backup_at = NULL,
     last_backup_error = NULL, updated_at = ? WHERE id = ?`
  ).run(now(), row.id)
  audit(session, 'drive_backup.disconnect', {})
  return getStatus(session)
}

export function updateSettings(session: Session, input: DriveBackupSettingsInput): DriveBackupStatus {
  const row = ensureSettings(session.shopId)
  getDb().prepare(
    `UPDATE drive_backup_settings SET auto_backup_frequency = ?, backup_time = ?,
     include_images = ?, retention_count = ?, next_backup_at = ?, updated_at = ? WHERE id = ?`
  ).run(
    input.auto_backup_frequency,
    input.backup_time,
    input.include_images ? 1 : 0,
    input.retention_count,
    loadCredential() ? nextOccurrence(input.auto_backup_frequency, input.backup_time) : null,
    now(),
    row.id
  )
  audit(session, 'drive_backup.settings_update', input)
  return getStatus(session)
}

async function driveJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = await accessToken()
  const response = await fetch(url, {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
  })
  if (!response.ok) {
    if (response.status === 401) cachedToken = null
    const body = await response.text()
    throw new AppError(`Google Drive request failed (${response.status}): ${body.slice(0, 180)}`)
  }
  return (await response.json()) as T
}

async function uploadArchive(
  file: string,
  manifest: { shopId: string; shopName: string; createdAt: string }
): Promise<DriveFileResponse> {
  const stat = await fs.promises.stat(file)
  if (stat.size > MAX_BACKUP_BYTES) throw new AppError('Backup is larger than the supported 512 MB limit')
  const name = `${BACKUP_PREFIX}${manifest.shopId}-${manifest.createdAt.replace(/[:.]/g, '-')}.posbackup.gz`
  const token = await accessToken()
  const init = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,createdTime,modifiedTime,appProperties',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-type': BACKUP_MIME,
        'x-upload-content-length': String(stat.size),
      },
      body: JSON.stringify({
        name,
        parents: ['appDataFolder'],
        mimeType: BACKUP_MIME,
        appProperties: {
          app: 'pos-desktop', shopId: manifest.shopId, createdAt: manifest.createdAt,
          shopName: manifest.shopName.slice(0, 120), formatVersion: '1', appVersion: app.getVersion(),
        },
      }),
    }
  )
  if (!init.ok) throw new AppError(`Google Drive could not start the upload (${init.status})`)
  const location = init.headers.get('location')
  if (!location) throw new AppError('Google Drive did not return an upload location')
  const body = await fs.promises.readFile(file)
  const upload = await fetch(location, {
    method: 'PUT',
    headers: { 'content-type': BACKUP_MIME, 'content-length': String(body.length) },
    body,
  })
  if (!upload.ok) throw new AppError(`Google Drive upload failed (${upload.status})`)
  return (await upload.json()) as DriveFileResponse
}

async function listAllDriveFiles(): Promise<DriveFileResponse[]> {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name contains '${BACKUP_PREFIX}' and trashed = false`,
    orderBy: 'createdTime desc',
    pageSize: '100',
    fields: 'files(id,name,size,createdTime,modifiedTime,appProperties)',
  })
  const result = await driveJson<{ files?: DriveFileResponse[] }>(`https://www.googleapis.com/drive/v3/files?${params}`)
  return (result.files ?? []).filter((file) =>
    file.appProperties?.app === 'pos-desktop' && !!file.appProperties.shopId
  )
}

async function listDriveFiles(shopId: string): Promise<DriveFileResponse[]> {
  return (await listAllDriveFiles()).filter((file) => file.appProperties?.shopId === shopId)
}

function toBackupFile(file: DriveFileResponse): DriveBackupFile {
  return {
    id: file.id,
    name: file.name,
    size: Number(file.size ?? 0),
    created_at: file.createdTime ?? file.modifiedTime ?? '',
    app_version: file.appProperties?.appVersion ?? null,
    shop_id: file.appProperties?.shopId ?? null,
    shop_name: file.appProperties?.shopName ?? null,
  }
}

async function enforceRetention(shopId: string, keep: number) {
  const files = await listDriveFiles(shopId)
  for (const file of files.slice(keep)) {
    const token = await accessToken()
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}`, {
      method: 'DELETE', headers: { authorization: `Bearer ${token}` },
    })
    if (!response.ok && response.status !== 404) throw new Error(`Could not remove old backup (${response.status})`)
  }
}

async function runBackup(shopId: string, type: 'auto' | 'manual'): Promise<DriveBackupFile> {
  if (backupInProgress) throw new AppError('A Google Drive backup is already running')
  if (!loadCredential()) throw new AppError('Connect a Google Drive account first')
  backupInProgress = true
  const settings = ensureSettings(shopId)
  const logId = uid()
  const startedAt = now()
  getDb().prepare(
    `INSERT INTO drive_backup_logs (id, shop_id, backup_type, status, started_at, created_at)
     VALUES (?, ?, ?, 'in_progress', ?, ?)`
  ).run(logId, shopId, type, startedAt, startedAt)
  getDb().prepare(
    `UPDATE drive_backup_settings SET last_backup_status = 'in_progress', last_backup_error = NULL,
     updated_at = ? WHERE id = ?`
  ).run(startedAt, settings.id)

  let tempDir: string | null = null
  try {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pos-drive-backup-'))
    const archive = await createArchive(shopId, !!settings.include_images, tempDir)
    const { createdAt, shopName } = archive
    const driveFile = await uploadArchive(archive.file, { shopId, shopName, createdAt })
    const size = Number(driveFile.size ?? (await fs.promises.stat(archive.file)).size)
    const completed = now()
    getDb().prepare(
      `UPDATE drive_backup_logs SET status = 'success', completed_at = ?, drive_file_id = ?,
       file_size = ? WHERE id = ?`
    ).run(completed, driveFile.id, size, logId)
    getDb().prepare(
      `UPDATE drive_backup_settings SET last_backup_at = ?, last_backup_status = 'success',
       last_backup_error = NULL, next_backup_at = ?, updated_at = ? WHERE id = ?`
    ).run(completed, nextOccurrence(settings.auto_backup_frequency, settings.backup_time), completed, settings.id)
    await enforceRetention(shopId, settings.retention_count).catch(() => undefined)
    return {
      id: driveFile.id,
      name: driveFile.name,
      size,
      created_at: driveFile.createdTime ?? createdAt,
      app_version: app.getVersion(),
      shop_id: shopId,
      shop_name: shopName,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Backup failed'
    const completed = now()
    getDb().prepare(
      `UPDATE drive_backup_logs SET status = 'failed', completed_at = ?, error_message = ? WHERE id = ?`
    ).run(completed, message, logId)
    const retryAt = new Date(Date.now() + 15 * 60_000).toISOString()
    getDb().prepare(
      `UPDATE drive_backup_settings SET last_backup_status = 'failed', last_backup_error = ?,
       next_backup_at = ?, updated_at = ? WHERE id = ?`
    ).run(message, retryAt, completed, settings.id)
    throw error instanceof AppError ? error : new AppError(message)
  } finally {
    backupInProgress = false
    if (tempDir) await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function backupNow(session: Session): Promise<DriveBackupFile> {
  const result = await runBackup(session.shopId, 'manual')
  audit(session, 'drive_backup.create', { driveFileId: result.id, size: result.size })
  return result
}

export async function listBackups(session: Session): Promise<DriveBackupFile[]> {
  const files = await listDriveFiles(session.shopId)
  return files.map(toBackupFile)
}

export async function listRecoveryBackups(): Promise<DriveBackupFile[]> {
  assertFreshInstallRecovery()
  if (!loadCredential()) throw new AppError('Connect the Google account containing your backup first')
  return (await listAllDriveFiles()).map(toBackupFile)
}

export function listLogs(session: Session): DriveBackupLog[] {
  return getDb().prepare(
    `SELECT id, backup_type, status, started_at, completed_at, drive_file_id, file_size, error_message
     FROM drive_backup_logs WHERE shop_id = ? ORDER BY started_at DESC LIMIT 50`
  ).all(session.shopId) as DriveBackupLog[]
}

async function downloadBackup(fileId: string, destination: string) {
  const token = await accessToken()
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!response.ok || !response.body) throw new AppError(`Could not download the backup (${response.status})`)
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > MAX_BACKUP_BYTES) throw new AppError('Backup is larger than the supported 512 MB limit')
  await pipeline(response.body as never, byteLimit(MAX_BACKUP_BYTES, 'Downloaded backup'), fs.createWriteStream(destination))
}

export async function restore(session: Session, input: { file_id: string; confirmation: 'RESTORE' }): Promise<{ restarting: true }> {
  if (backupInProgress) throw new AppError('Wait for the current backup to finish')
  const files = await listDriveFiles(session.shopId)
  if (!files.some((file) => file.id === input.file_id)) throw new AppError('Backup was not found for this shop')
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pos-drive-restore-'))
  try {
    const downloaded = path.join(tempDir, 'download.posbackup.gz')
    await downloadBackup(input.file_id, downloaded)
    const extracted = await extractArchive(downloaded, session.shopId, tempDir)
    await replaceLocalData(extracted)
    // Written after the swap, so the trail lands in the restored database
    // instead of the one that was just discarded.
    try {
      audit(session, 'drive_backup.restore', { driveFileId: input.file_id })
    } catch {
      // The restore itself has already succeeded and been verified.
    }
    restartAfterRestore()
    return { restarting: true }
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function restoreForRecovery(
  input: { file_id: string; confirmation: 'RESTORE' }
): Promise<{ restarting: true }> {
  assertFreshInstallRecovery()
  if (backupInProgress) throw new AppError('Wait for the current backup operation to finish')
  const files = await listAllDriveFiles()
  if (!files.some((file) => file.id === input.file_id)) {
    throw new AppError('Backup was not found in this Google account')
  }

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pos-drive-recovery-'))
  try {
    const downloaded = path.join(tempDir, 'download.posbackup.gz')
    await downloadBackup(input.file_id, downloaded)
    const extracted = await extractArchive(downloaded, null, tempDir)
    // Re-check after the network/download work so a concurrently completed setup
    // can never be overwritten through this public recovery route.
    assertFreshInstallRecovery()
    await replaceLocalData(extracted)
    restartAfterRestore()
    return { restarting: true }
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export function startGoogleDriveBackupScheduler() {
  if (scheduler) return
  const tick = async () => {
    if (backupInProgress || !loadCredential()) return
    try {
      const shop = getDb().prepare('SELECT id FROM shops LIMIT 1').get() as { id: string } | undefined
      if (!shop) return
      const settings = ensureSettings(shop.id)
      if (settings.auto_backup_frequency === 'off') return
      if (!settings.next_backup_at) {
        getDb().prepare('UPDATE drive_backup_settings SET next_backup_at = ?, updated_at = ? WHERE id = ?')
          .run(nextOccurrence(settings.auto_backup_frequency, settings.backup_time), now(), settings.id)
        return
      }
      if (settings.next_backup_at <= now()) await runBackup(shop.id, 'auto').catch(() => undefined)
    } catch {
      // App startup/migration/temporary credential failures are retried next tick.
    }
  }
  void tick()
  scheduler = setInterval(() => void tick(), 60_000)
}
