import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { getDb } from '../db'
import { uid, now, AppError, audit } from './helpers'
import { getSession, setSession } from './session'
import { assertNotRateLimited, recordAuthFailure, clearAuthFailures } from './rateLimit'
import type { AuthState, Session, Shop } from '../../src/shared/types'
import type {
  ChangePasswordInput, LoginInput, RecoverPasswordInput, SetupInput, UpdateProfileInput,
} from '../../src/shared/schemas'

// recovery_code is deliberately excluded — it must only reach admins (settings:recoveryCode).
import { SHOP_COLUMNS } from './settings'

function getShopRow(): Shop | null {
  return (
    (getDb()
      .prepare(`SELECT ${SHOP_COLUMNS} FROM shops LIMIT 1`)
      .get() as Shop | undefined) ?? null
  )
}

export function authState(): AuthState {
  const shop = getShopRow()
  return { needsSetup: !shop, session: getSession(), shop }
}

export function setup(input: SetupInput): AuthState {
  const db = getDb()
  if (getShopRow()) throw new AppError('Shop is already set up')
  const shopId = uid()
  const userId = uid()
  const ts = now()
  db.transaction(() => {
    db.prepare(
      'INSERT INTO shops (id, name, currency, tax_percent, recovery_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(shopId, input.shopName, input.currency, input.taxPercent, randomBytes(6).toString('hex').toUpperCase(), ts, ts)
    db.prepare(
      `INSERT INTO users (id, shop_id, name, username, password_hash, role, active, created_at)
       VALUES (?, ?, ?, ?, ?, 'admin', 1, ?)`
    ).run(userId, shopId, input.adminName, input.username.toLowerCase(), bcrypt.hashSync(input.password, 10), ts)
  })()
  setSession({
    userId,
    name: input.adminName,
    username: input.username.toLowerCase(),
    role: 'admin',
    shopId,
  })
  return authState()
}

export function login(input: LoginInput): AuthState {
  const rateKey = `login:${input.username.toLowerCase()}`
  assertNotRateLimited(rateKey)
  const row = getDb()
    .prepare('SELECT * FROM users WHERE username = ? AND active = 1')
    .get(input.username.toLowerCase()) as
    | { id: string; shop_id: string; name: string; username: string; password_hash: string; role: Session['role'] }
    | undefined
  if (!row || !bcrypt.compareSync(input.password, row.password_hash)) {
    recordAuthFailure(rateKey)
    throw new AppError('Invalid username or password')
  }
  clearAuthFailures(rateKey)
  setSession({
    userId: row.id,
    name: row.name,
    username: row.username,
    role: row.role,
    shopId: row.shop_id,
  })
  return authState()
}

export function logout(): AuthState {
  setSession(null)
  return authState()
}

export function changePassword(session: Session, input: ChangePasswordInput): void {
  const db = getDb()
  const row = db
    .prepare('SELECT password_hash FROM users WHERE id = ?')
    .get(session.userId) as { password_hash: string } | undefined
  if (!row || !bcrypt.compareSync(input.current_password, row.password_hash)) {
    throw new AppError('Current password is incorrect')
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
    bcrypt.hashSync(input.new_password, 10),
    session.userId
  )
  audit(session, 'user.change_password', { id: session.userId })
}

export function updateProfile(session: Session, input: UpdateProfileInput): AuthState {
  getDb().prepare('UPDATE users SET name = ? WHERE id = ?').run(input.name, session.userId)
  setSession({ ...session, name: input.name })
  return authState()
}

/**
 * Offline password recovery: the shop's recovery code (shown once in Settings)
 * lets a locked-out user reset their own password without an admin session.
 */
export function recoverPassword(input: RecoverPasswordInput): void {
  const rateKey = 'recover'
  assertNotRateLimited(rateKey)
  const db = getDb()
  const shop = db.prepare('SELECT id, recovery_code FROM shops LIMIT 1').get() as
    | { id: string; recovery_code: string | null }
    | undefined
  if (!shop?.recovery_code || shop.recovery_code !== input.recovery_code.toUpperCase()) {
    recordAuthFailure(rateKey)
    throw new AppError('Invalid recovery code')
  }
  clearAuthFailures(rateKey)
  const user = db
    .prepare('SELECT id FROM users WHERE shop_id = ? AND username = ? AND active = 1')
    .get(shop.id, input.username.toLowerCase()) as { id: string } | undefined
  if (!user) throw new AppError('No active user with that username')
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
    bcrypt.hashSync(input.new_password, 10),
    user.id
  )
  db.prepare(
    'INSERT INTO audit_logs (id, shop_id, user_id, action, details, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(uid(), shop.id, user.id, 'user.recover_password', JSON.stringify({ username: input.username }), now())
}
