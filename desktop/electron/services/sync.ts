// Offline-first cloud sync. The local SQLite database is the source of truth;
// every synced table carries sync_status ('pending' | 'synced'). A run pushes
// pending rows, pulls cloud changes, resolves by updated_at, and writes a
// sync_logs record. A failed or offline sync NEVER affects local operation —
// rows simply stay 'pending' and are retried later.
import { getDb } from '../db'
import { uid, now, AppError, audit } from './helpers'
import { canCreateSale } from '../../src/shared/subscription'
import type { Session, SyncConflict, SyncLog, SyncStatusView } from '../../src/shared/types'
import type { SyncSettingsInput } from '../../src/shared/schemas'

// Cloud endpoint. Empty → this install has no cloud backend; everything stays
// local and sync attempts report "no internet / not configured" as pending.
const CLOUD_URL = (process.env.POS_CLOUD_URL ?? '').replace(/\/+$/, '')

let syncInProgress = false

// ---- HTTP helper (shared with subscription.ts) --------------------------------

/** POST/GET JSON against the cloud API. Returns null when offline/unconfigured. */
export async function cloudFetch(
  route: string,
  opts: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number } = {}
): Promise<unknown | null> {
  if (!CLOUD_URL) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000)
  try {
    const res = await fetch(`${CLOUD_URL}${route}`, {
      method: opts.method ?? 'GET',
      headers: { 'content-type': 'application/json' },
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`Cloud API ${route} → HTTP ${res.status}`)
    return (await res.json()) as unknown
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function isOnline(): Promise<boolean> {
  return (await cloudFetch('/api/health', { timeoutMs: 5000 })) != null
}

// ---- settings -----------------------------------------------------------------

interface SyncSettingsRow {
  id: string
  shop_id: string
  auto_sync_enabled: number
  sync_frequency: string
  sync_time: string
  last_sync_at: string | null
  next_sync_at: string | null
  last_sync_status: string | null
  last_sync_error: string | null
  manual_sync_allowed: number
  created_at: string
  updated_at: string
}

export function ensureSyncSettings(shopId: string): SyncSettingsRow {
  const db = getDb()
  let row = db
    .prepare('SELECT * FROM sync_settings WHERE shop_id = ?')
    .get(shopId) as SyncSettingsRow | undefined
  if (!row) {
    const ts = now()
    db.prepare(
      `INSERT INTO sync_settings (id, shop_id, next_sync_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(uid(), shopId, nextOccurrence('23:59'), ts, ts)
    row = db.prepare('SELECT * FROM sync_settings WHERE shop_id = ?').get(shopId) as SyncSettingsRow
  }
  return row
}

/** Next local occurrence of "HH:MM" as an ISO string (today if still ahead). */
function nextOccurrence(hhmm: string, from = new Date()): string {
  const [h, m] = hhmm.split(':').map(Number)
  const next = new Date(from)
  next.setHours(h, m, 0, 0)
  if (next <= from) next.setDate(next.getDate() + 1)
  return next.toISOString()
}

// Tables that participate in sync (all carry shop_id + sync_status).
const PUSH_TABLES = [
  'shops', 'products', 'customers', 'suppliers', 'sales', 'purchases',
  'purchase_orders', 'inventory_logs', 'payments', 'returns', 'expenses',
] as const
// Child rows ride along with their pending parent (they have no sync_status).
const CHILDREN: Partial<Record<(typeof PUSH_TABLES)[number], { table: string; fk: string }>> = {
  sales: { table: 'sale_items', fk: 'sale_id' },
  purchases: { table: 'purchase_items', fk: 'purchase_id' },
  purchase_orders: { table: 'purchase_order_items', fk: 'purchase_order_id' },
}
// Master data the cloud may edit; merged back by updated_at. Transaction rows
// (sales, ledger entries…) are push-only — the device that made them owns them.
const PULL_TABLES = new Set(['shops', 'products', 'customers', 'suppliers'])

function pendingCount(shopId: string): number {
  const db = getDb()
  let total = 0
  for (const t of PUSH_TABLES) {
    const where = t === 'shops' ? 'id = ?' : 'shop_id = ?'
    const { c } = db
      .prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE sync_status = 'pending' AND ${where}`)
      .get(shopId) as { c: number }
    total += c
  }
  return total
}

export function getSyncStatus(session: Session): SyncStatusView {
  const row = ensureSyncSettings(session.shopId)
  const { c } = getDb()
    .prepare(
      "SELECT COUNT(*) AS c FROM sync_conflicts WHERE shop_id = ? AND resolution_status = 'pending'"
    )
    .get(session.shopId) as { c: number }
  return {
    auto_sync_enabled: row.auto_sync_enabled,
    sync_frequency: row.sync_frequency,
    sync_time: row.sync_time,
    last_sync_at: row.last_sync_at,
    next_sync_at: row.next_sync_at,
    last_sync_status: row.last_sync_status as SyncStatusView['last_sync_status'],
    last_sync_error: row.last_sync_error,
    manual_sync_allowed: row.manual_sync_allowed,
    pending_changes: pendingCount(session.shopId),
    conflict_count: c,
    cloud_configured: !!CLOUD_URL,
    sync_in_progress: syncInProgress,
  }
}

export function updateSyncSettings(session: Session, input: SyncSettingsInput): SyncStatusView {
  const row = ensureSyncSettings(session.shopId)
  getDb()
    .prepare(
      `UPDATE sync_settings SET auto_sync_enabled = ?, sync_frequency = ?, sync_time = ?,
         next_sync_at = ?, updated_at = ? WHERE id = ?`
    )
    .run(
      input.auto_sync_enabled ? 1 : 0,
      input.sync_frequency,
      input.sync_time,
      input.auto_sync_enabled ? nextOccurrence(input.sync_time) : null,
      now(),
      row.id
    )
  audit(session, 'sync.settings_update', input)
  return getSyncStatus(session)
}

export function listSyncLogs(session: Session): SyncLog[] {
  return getDb()
    .prepare(
      `SELECT id, sync_type, status, started_at, completed_at, error_message, total_records_synced
       FROM sync_logs WHERE shop_id = ? ORDER BY started_at DESC LIMIT 50`
    )
    .all(session.shopId) as SyncLog[]
}

export function listSyncConflicts(session: Session): SyncConflict[] {
  return getDb()
    .prepare(
      `SELECT id, table_name, record_id, local_updated_at, cloud_updated_at, conflict_reason,
              resolution_status, created_at, resolved_at
       FROM sync_conflicts WHERE shop_id = ? ORDER BY created_at DESC LIMIT 100`
    )
    .all(session.shopId) as SyncConflict[]
}

// ---- sync run -----------------------------------------------------------------

function writeLog(shopId: string, log: Partial<SyncLog> & { sync_type: 'auto' | 'manual' }): string {
  const id = uid()
  getDb()
    .prepare(
      `INSERT INTO sync_logs (id, shop_id, sync_type, status, started_at, completed_at,
         error_message, total_records_synced, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id, shopId, log.sync_type, log.status ?? 'in_progress', log.started_at ?? now(),
      log.completed_at ?? null, log.error_message ?? null, log.total_records_synced ?? 0, now()
    )
  return id
}

function finalizeLog(id: string, status: string, error: string | null, total: number) {
  getDb()
    .prepare(
      'UPDATE sync_logs SET status = ?, completed_at = ?, error_message = ?, total_records_synced = ? WHERE id = ?'
    )
    .run(status, now(), error, total, id)
}

function setSettingsResult(shopId: string, status: string, error: string | null, synced: boolean) {
  const row = ensureSyncSettings(shopId)
  getDb()
    .prepare(
      `UPDATE sync_settings SET last_sync_status = ?, last_sync_error = ?,
         last_sync_at = COALESCE(?, last_sync_at),
         next_sync_at = CASE WHEN auto_sync_enabled = 1 THEN ? ELSE NULL END,
         updated_at = ?
       WHERE id = ?`
    )
    .run(status, error, synced ? now() : null, nextOccurrence(row.sync_time), now(), row.id)
}

interface CloudRow {
  id: string
  shop_id?: string
  updated_at?: string
  [k: string]: unknown
}

/** Column names of a table — used to whitelist keys on pulled rows. */
function tableColumns(table: string): Set<string> {
  const cols = getDb().prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return new Set(cols.map((c) => c.name))
}

/**
 * Merge one cloud row into a local table. Timestamp wins; a pending local row
 * with the same updated_at as a differing cloud row is ambiguous → conflict.
 * Rows are never deleted here.
 */
function applyCloudRow(shopId: string, table: string, row: CloudRow): 'applied' | 'skipped' | 'conflict' {
  if (!row.id || (table !== 'shops' && row.shop_id !== shopId)) return 'skipped'
  const db = getDb()
  const cols = tableColumns(table)
  const local = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(row.id) as
    | (CloudRow & { sync_status?: string })
    | undefined

  const cloudUpdated = typeof row.updated_at === 'string' ? row.updated_at : null
  if (local) {
    const localUpdated = typeof local.updated_at === 'string' ? local.updated_at : null
    if (!cloudUpdated || !localUpdated) return 'skipped'
    if (cloudUpdated < localUpdated) return 'skipped' // local newer → local wins
    if (cloudUpdated === localUpdated) {
      if (local.sync_status !== 'pending') return 'skipped' // identical, nothing to do
      db.prepare(
        `INSERT INTO sync_conflicts (id, shop_id, table_name, record_id, local_updated_at,
           cloud_updated_at, conflict_reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(uid(), shopId, table, row.id, localUpdated, cloudUpdated,
        'Same updated_at with unsynced local changes', now())
      return 'conflict'
    }
  }

  const keys = Object.keys(row).filter((k) => cols.has(k) && k !== 'sync_status')
  if (local) {
    const sets = keys.filter((k) => k !== 'id').map((k) => `${k} = ?`).join(', ')
    db.prepare(`UPDATE ${table} SET ${sets}, sync_status = 'synced' WHERE id = ?`).run(
      ...keys.filter((k) => k !== 'id').map((k) => row[k] as never),
      row.id
    )
  } else {
    const allKeys = [...keys, 'sync_status']
    db.prepare(
      `INSERT INTO ${table} (${allKeys.join(', ')}) VALUES (${allKeys.map(() => '?').join(', ')})`
    ).run(...keys.map((k) => row[k] as never), 'synced')
  }
  return 'applied'
}

/**
 * One full sync run. Returns the number of records synced.
 * Throws AppError only for the "offline" case so callers can message the user;
 * every outcome is persisted to sync_logs / sync_settings first.
 */
async function runSync(shopId: string, syncType: 'auto' | 'manual'): Promise<number> {
  if (syncInProgress) throw new AppError('A sync is already running')
  syncInProgress = true
  const logId = writeLog(shopId, { sync_type: syncType, status: 'in_progress' })
  const db = getDb()

  try {
    if (!(await isOnline())) {
      const msg = 'No internet connection. Sync will run when internet is available.'
      finalizeLog(logId, 'pending', msg, 0)
      setSettingsResult(shopId, 'pending', msg, false)
      throw new AppError(msg)
    }

    // 1. Collect local pending rows (children ride with their parents).
    const payload: Record<string, unknown[]> = {}
    const pendingIds: Record<string, string[]> = {}
    let pushCount = 0
    for (const table of PUSH_TABLES) {
      const where = table === 'shops' ? 'id = ?' : 'shop_id = ?'
      const rows = db
        .prepare(`SELECT * FROM ${table} WHERE sync_status = 'pending' AND ${where}`)
        .all(shopId) as CloudRow[]
      if (rows.length === 0) continue
      payload[table] = rows
      pendingIds[table] = rows.map((r) => r.id)
      pushCount += rows.length
      const child = CHILDREN[table]
      if (child) {
        const ph = rows.map(() => '?').join(', ')
        payload[child.table] = db
          .prepare(`SELECT * FROM ${child.table} WHERE ${child.fk} IN (${ph})`)
          .all(...rows.map((r) => r.id))
      }
    }

    // 2. Push. The cloud upserts by id (idempotent), so re-pushes are safe.
    if (pushCount > 0) {
      const res = await cloudFetch('/api/sync/push', {
        method: 'POST',
        body: { shop_id: shopId, tables: payload },
        timeoutMs: 60_000,
      })
      if (!res) throw new Error('Cloud rejected the push or the connection dropped')
      const mark = db.transaction(() => {
        for (const [table, ids] of Object.entries(pendingIds)) {
          const ph = ids.map(() => '?').join(', ')
          db.prepare(`UPDATE ${table} SET sync_status = 'synced' WHERE id IN (${ph})`).run(...ids)
        }
      })
      mark()
    }

    // 3. Pull cloud-side edits to master data since the last successful sync.
    const settings = ensureSyncSettings(shopId)
    const since = encodeURIComponent(settings.last_sync_at ?? '1970-01-01T00:00:00.000Z')
    const pull = (await cloudFetch(`/api/sync/pull?shop_id=${shopId}&since=${since}`, {
      timeoutMs: 60_000,
    })) as { tables?: Record<string, CloudRow[]> } | null

    let pullCount = 0
    let conflicts = 0
    if (pull?.tables) {
      for (const [table, rows] of Object.entries(pull.tables)) {
        if (!PULL_TABLES.has(table) || !Array.isArray(rows)) continue
        for (const row of rows) {
          const result = applyCloudRow(shopId, table, row)
          if (result === 'applied') pullCount++
          if (result === 'conflict') conflicts++
        }
      }
    }

    const total = pushCount + pullCount
    const status = conflicts > 0 ? 'conflict' : 'success'
    finalizeLog(logId, status, conflicts > 0 ? `${conflicts} conflict(s) need review` : null, total)
    setSettingsResult(shopId, status, null, true)
    return total
  } catch (err) {
    if (err instanceof AppError) throw err // offline path — already persisted
    const msg = err instanceof Error ? err.message : 'Sync failed'
    finalizeLog(logId, 'failed', msg, 0)
    setSettingsResult(shopId, 'failed', msg, false)
    throw new AppError(`Sync failed: ${msg}`)
  } finally {
    syncInProgress = false
  }
}

export async function manualSync(session: Session): Promise<{ synced: number }> {
  const settings = ensureSyncSettings(session.shopId)
  if (!settings.manual_sync_allowed) throw new AppError('Manual sync is disabled for this shop')
  // Subscription gate — expired shops keep local POS + backups, not cloud sync.
  const { subscriptionStatus } = await import('./subscription')
  if (!canCreateSale(subscriptionStatus(session.shopId))) {
    throw new AppError('Cloud sync requires an active trial or membership. Activate your membership to sync.')
  }
  const synced = await runSync(session.shopId, 'manual')
  // Reconcile membership state in the same breath so "Sync Now" also updates the
  // admin panel (and picks up an approval) without waiting for the scheduler.
  const sub = await import('./subscription')
  await sub.reportSubscriptionToCloud(session.shopId).catch(() => {})
  await sub.refreshSubscriptionFromCloud(session.shopId).catch(() => {})
  audit(session, 'sync.manual', { synced })
  return { synced }
}

// ---- auto sync scheduler --------------------------------------------------------

/**
 * Once a minute: run the daily sync when next_sync_at has passed (which also
 * covers "app was closed at sync time — run on next open"), and retry a
 * 'pending' (offline) result every 10 minutes until it goes through.
 */
let lastSubscriptionRefresh = 0

export function startAutoSyncScheduler() {
  const tick = async () => {
    try {
      const db = getDb()
      const shop = db.prepare('SELECT id FROM shops LIMIT 1').get() as { id: string } | undefined
      if (!shop) return

      // Vendor-cloud round trip runs BEFORE the subscription gate: an expired shop
      // must still deliver its activation request and receive the admin's approval.
      const sub = await import('./subscription')
      if (Date.now() - lastSubscriptionRefresh > 10 * 60_000) {
        lastSubscriptionRefresh = Date.now()
        await sub.pushPendingActivationRequest(shop.id).catch(() => {})
        await sub.reportSubscriptionToCloud(shop.id).catch(() => {})
        await sub.refreshSubscriptionFromCloud(shop.id).catch(() => {})
      }

      const settings = ensureSyncSettings(shop.id)
      if (!settings.auto_sync_enabled) return
      if (!canCreateSale(sub.subscriptionStatus(shop.id))) return

      const nowIso = now()
      const due =
        (settings.next_sync_at != null && settings.next_sync_at <= nowIso) ||
        settings.next_sync_at == null
      const retryPending =
        settings.last_sync_status === 'pending' &&
        (!settings.last_sync_at || Date.now() - new Date(settings.updated_at).getTime() > 10 * 60_000)

      if (due || retryPending) {
        await runSync(shop.id, 'auto').catch(() => {
          /* offline/failed — already logged; POS keeps working */
        })
      }
    } catch (err) {
      console.error('[auto-sync]', err)
    }
  }
  setTimeout(() => void tick(), 20_000) // first check shortly after launch
  setInterval(() => void tick(), 60_000)
}
