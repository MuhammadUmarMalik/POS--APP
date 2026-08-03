import { app, dialog, BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import bcrypt from 'bcryptjs'
import { getDb } from '../db'
import { uid, now, AppError, audit } from './helpers'
import { imagesDir, deleteImageFiles } from './images'
import type { Session, Shop, User } from '../../src/shared/types'
import type { ShopSettingsInput, UserCreateInput } from '../../src/shared/schemas'

// recovery_code deliberately excluded — admins fetch it via settings:recoveryCode.
export const SHOP_COLUMNS =
  'id, name, currency, tax_percent, receipt_footer, owner_name, phone, email, address, city, ' +
  'business_type, ntn, strn, logo_url, local_logo_path, created_at'

export function getShop(shopId: string): Shop {
  return getDb()
    .prepare(`SELECT ${SHOP_COLUMNS} FROM shops WHERE id = ?`)
    .get(shopId) as Shop
}

export function updateShop(session: Session, input: ShopSettingsInput): Shop {
  const db = getDb()
  db.prepare(
    `UPDATE shops SET name = ?, currency = ?, tax_percent = ?, receipt_footer = ?,
       owner_name = ?, phone = ?, email = ?, address = ?, city = ?, business_type = ?,
       ntn = ?, strn = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    input.name, input.currency, input.tax_percent, input.receipt_footer,
    input.owner_name ?? null, input.phone ?? null, input.email ?? null,
    input.address ?? null, input.city ?? null, input.business_type ?? null,
    input.ntn ?? null, input.strn ?? null, now(), session.shopId
  )
  audit(session, 'shop.update', input)
  return getShop(session.shopId)
}

// ---- shop logo -----------------------------------------------------------------
// Stored beside product images so the existing pos-img:// protocol serves it to
// receipts and the renderer. local_logo_path is the file name; logo_url is a
// legacy column left over from an earlier hosted build and is never written now.

const LOGO_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const LOGO_MAX_BYTES = 2 * 1024 * 1024

export async function uploadLogo(session: Session): Promise<{ saved: boolean; shop?: Shop }> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Choose shop logo (recommended 500×500px)',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  })
  if (canceled || filePaths.length === 0) return { saved: false }

  const src = filePaths[0]
  const ext = path.extname(src).toLowerCase()
  if (!LOGO_EXT.has(ext)) throw new AppError('Logo must be a JPG, PNG or WEBP image')
  const stat = await fs.promises.stat(src)
  if (stat.size > LOGO_MAX_BYTES) throw new AppError('Logo must be under 2 MB')

  const name = `shop-logo-${uid()}${ext}`
  await fs.promises.copyFile(src, path.join(imagesDir(), name))

  const db = getDb()
  const old = db
    .prepare('SELECT local_logo_path FROM shops WHERE id = ?')
    .get(session.shopId) as { local_logo_path: string | null }
  db.prepare(
    "UPDATE shops SET local_logo_path = ?, logo_url = NULL, updated_at = ? WHERE id = ?"
  ).run(name, now(), session.shopId)
  if (old.local_logo_path) deleteImageFiles([old.local_logo_path])

  audit(session, 'shop.logo_upload', { file: name })
  return { saved: true, shop: getShop(session.shopId) }
}

export function removeLogo(session: Session): Shop {
  const db = getDb()
  const old = db
    .prepare('SELECT local_logo_path FROM shops WHERE id = ?')
    .get(session.shopId) as { local_logo_path: string | null }
  db.prepare(
    "UPDATE shops SET local_logo_path = NULL, logo_url = NULL, updated_at = ? WHERE id = ?"
  ).run(now(), session.shopId)
  if (old.local_logo_path) deleteImageFiles([old.local_logo_path])
  audit(session, 'shop.logo_remove', {})
  return getShop(session.shopId)
}

/** Admin-only: the offline password-recovery code. Generated on setup / migration. */
export function getRecoveryCode(session: Session): { recovery_code: string } {
  const db = getDb()
  let row = db
    .prepare('SELECT recovery_code FROM shops WHERE id = ?')
    .get(session.shopId) as { recovery_code: string | null }
  if (!row.recovery_code) {
    db.prepare('UPDATE shops SET recovery_code = upper(hex(randomblob(6))) WHERE id = ?').run(
      session.shopId
    )
    row = db
      .prepare('SELECT recovery_code FROM shops WHERE id = ?')
      .get(session.shopId) as { recovery_code: string | null }
  }
  return { recovery_code: row.recovery_code! }
}

export function listUsers(session: Session): User[] {
  return getDb()
    .prepare(
      'SELECT id, name, username, role, active, created_at FROM users WHERE shop_id = ? ORDER BY created_at'
    )
    .all(session.shopId) as User[]
}

export function createUser(session: Session, input: UserCreateInput): User {
  const db = getDb()
  const existing = db
    .prepare('SELECT id FROM users WHERE shop_id = ? AND username = ?')
    .get(session.shopId, input.username.toLowerCase())
  if (existing) throw new AppError('Username is already taken')
  const id = uid()
  db.prepare(
    `INSERT INTO users (id, shop_id, name, username, password_hash, role, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
  ).run(
    id,
    session.shopId,
    input.name,
    input.username.toLowerCase(),
    bcrypt.hashSync(input.password, 10),
    input.role,
    now()
  )
  audit(session, 'user.create', { id, username: input.username, role: input.role })
  return { id, name: input.name, username: input.username.toLowerCase(), role: input.role, active: 1, created_at: now() }
}

export function setUserActive(session: Session, input: { id: string; active: boolean }): void {
  if (input.id === session.userId) throw new AppError('You cannot deactivate your own account')
  const res = getDb()
    .prepare('UPDATE users SET active = ? WHERE id = ? AND shop_id = ?')
    .run(input.active ? 1 : 0, input.id, session.shopId)
  if (res.changes === 0) throw new AppError('User not found')
  audit(session, 'user.set_active', input)
}

export function resetPassword(session: Session, input: { id: string; password: string }): void {
  if (input.password.length < 4) throw new AppError('Password must be at least 4 characters')
  const res = getDb()
    .prepare('UPDATE users SET password_hash = ? WHERE id = ? AND shop_id = ?')
    .run(bcrypt.hashSync(input.password, 10), input.id, session.shopId)
  if (res.changes === 0) throw new AppError('User not found')
  audit(session, 'user.reset_password', { id: input.id })
}

export async function backupNow(session: Session): Promise<{ saved: boolean; path?: string }> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const stamp = new Date().toISOString().slice(0, 10)
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save backup',
    defaultPath: path.join(app.getPath('documents'), `pos-backup-${stamp}.db`),
    filters: [{ name: 'SQLite database', extensions: ['db'] }],
  })
  if (canceled || !filePath) return { saved: false }
  const db = getDb()
  db.pragma('wal_checkpoint(TRUNCATE)')
  await db.backup(filePath)
  audit(session, 'backup.create', { path: filePath })
  return { saved: true, path: filePath }
}
