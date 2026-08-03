import { getDb } from '../db'
import { uid } from './helpers'
import type { Session } from '../../src/shared/types'
import {
  ROLE_DEFAULT_PERMISSIONS,
  type PermissionKey,
} from '../../src/shared/permissions'

/** Permissions granted to a user. Admin is implicit full access; otherwise the
 * stored user_permissions rows win, falling back to the role defaults for
 * accounts created before the permission system existed. */
export function userPermissions(session: Pick<Session, 'shopId' | 'userId' | 'role'>): PermissionKey[] {
  if (session.role === 'admin') return [...ROLE_DEFAULT_PERMISSIONS.manager, 'users.manage', 'settings.manage', 'subscription.manage']
  const rows = getDb()
    .prepare('SELECT permission FROM user_permissions WHERE user_id = ? AND shop_id = ?')
    .all(session.userId, session.shopId) as { permission: PermissionKey }[]
  if (rows.length === 0) {
    return [...ROLE_DEFAULT_PERMISSIONS[session.role]]
  }
  return rows.map((r) => r.permission)
}

/** True when the session may perform `permission`. Admins always can. */
export function hasPermission(session: Pick<Session, 'shopId' | 'userId' | 'role'>, permission: PermissionKey): boolean {
  if (session.role === 'admin') return true
  return userPermissions(session).includes(permission)
}

/**
 * True when the session may see what the shop paid — cost prices, margins and
 * anything derived from them. Deliberately role-based rather than a permission
 * key: permission rows are stored per user, so a key added after those rows
 * were written would silently be missing and quietly re-open the leak.
 *
 * Cost is stripped in the main process, not hidden in the UI: a cashier
 * running devtools must not be able to read the buying price out of an IPC
 * response.
 */
export function canViewCost(session: Pick<Session, 'role'>): boolean {
  return session.role === 'admin' || session.role === 'manager'
}

/** The row without its cost, for handing back to someone who may not see it. */
export function stripCost<T extends { cost_price?: number }>(row: T): Omit<T, 'cost_price'> {
  const { cost_price: _cost, ...rest } = row
  return rest
}

/** `rows` as-is for management, cost-free for everyone else. */
export function costFiltered<T extends { cost_price?: number }>(
  session: Pick<Session, 'role'>,
  rows: T[]
): T[] {
  return canViewCost(session) ? rows : (rows.map(stripCost) as T[])
}

/** Replace a user's permission set with exactly `granted`. */
export function setUserPermissions(
  actor: Session,
  input: { user_id: string; permissions: PermissionKey[] }
): void {
  if (actor.userId === input.user_id) throw new Error('You cannot edit your own permissions')
  const db = getDb()
  const target = db
    .prepare('SELECT id, role FROM users WHERE id = ? AND shop_id = ?')
    .get(input.user_id, actor.shopId) as { id: string; role: Session['role'] } | undefined
  if (!target) throw new Error('User not found')
  if (target.role === 'admin') throw new Error('Admin users always have full access')

  const granted = [...new Set(input.permissions)]
  db.transaction(() => {
    db.prepare('DELETE FROM user_permissions WHERE user_id = ?').run(input.user_id)
    const ins = db.prepare(
      'INSERT INTO user_permissions (id, shop_id, user_id, permission, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    const ts = new Date().toISOString()
    for (const p of granted) ins.run(uid(), actor.shopId, input.user_id, p, ts)
  })()
}
