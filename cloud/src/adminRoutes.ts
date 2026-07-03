// Vendor admin API. Everything here sits behind requireAdmin except /login.
import { Router } from 'express'
import { z } from 'zod'
import path from 'node:path'
import fs from 'node:fs'
import { getDb, uid, now, DATA_DIR } from './db.js'
import { login, requireAdmin } from './auth.js'
import { generateKey, keyHash, type KeyPlan } from './licenses.js'
import { grantMembership } from './deviceRoutes.js'

export const adminRoutes = Router()

const loginSchema = z.object({ username: z.string().min(1), password: z.string().min(1) })

adminRoutes.post('/api/admin/login', (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Username and password required' })
  const token = login(parsed.data.username, parsed.data.password)
  if (!token) return res.status(401).json({ error: 'Invalid username or password' })
  res.json({ token })
})

adminRoutes.use('/api/admin', requireAdmin)

adminRoutes.get('/api/admin/overview', (_req, res) => {
  const db = getDb()
  const count = (sql: string) => (db.prepare(sql).get() as { c: number }).c
  res.json({
    shops: count('SELECT COUNT(*) AS c FROM shops'),
    pending_requests: count("SELECT COUNT(*) AS c FROM activation_requests WHERE status = 'pending'"),
    active: count("SELECT COUNT(*) AS c FROM subscriptions WHERE status IN ('membership_active','lifetime_active')"),
    trials: count("SELECT COUNT(*) AS c FROM subscriptions WHERE status = 'trial_active'"),
    expired: count("SELECT COUNT(*) AS c FROM subscriptions WHERE status IN ('trial_expired','membership_expired','suspended')"),
  })
})

// ---- shops --------------------------------------------------------------------

adminRoutes.get('/api/admin/shops', (_req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT s.id, s.name, s.owner_name, s.phone, s.city, s.business_type,
              s.created_at, s.last_seen_at, s.last_sync_at,
              sub.plan_type, sub.status, sub.membership_ends_at,
              (SELECT COUNT(*) FROM activation_requests r
                WHERE r.shop_id = s.id AND r.status = 'pending') AS pending_requests
       FROM shops s LEFT JOIN subscriptions sub ON sub.shop_id = s.id
       ORDER BY s.last_seen_at DESC NULLS LAST`
    )
    .all()
  res.json(rows)
})

adminRoutes.get('/api/admin/shops/:id', (req, res) => {
  const db = getDb()
  const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(req.params.id)
  if (!shop) return res.status(404).json({ error: 'Shop not found' })
  const subscription = db.prepare('SELECT * FROM subscriptions WHERE shop_id = ?').get(req.params.id) ?? null
  const requests = db
    .prepare('SELECT * FROM activation_requests WHERE shop_id = ? ORDER BY created_at DESC LIMIT 20')
    .all(req.params.id)
  const syncRuns = db
    .prepare('SELECT * FROM sync_runs WHERE shop_id = ? ORDER BY created_at DESC LIMIT 20')
    .all(req.params.id)
  const records = db
    .prepare('SELECT table_name, COUNT(*) AS count FROM synced_records WHERE shop_id = ? GROUP BY table_name')
    .all(req.params.id)
  res.json({ shop, subscription, requests, sync_runs: syncRuns, records })
})

const subUpdateSchema = z.object({
  plan_type: z.enum(['trial', 'monthly', 'yearly', 'lifetime']),
  status: z.enum([
    'trial_active', 'trial_expired', 'membership_active', 'membership_expired',
    'lifetime_active', 'suspended', 'pending_verification',
  ]),
  membership_started_at: z.string().nullable().optional(),
  membership_ends_at: z.string().nullable().optional(),
})

/** Manual override: extend, suspend or fix any shop's membership by hand. */
adminRoutes.put('/api/admin/shops/:id/subscription', (req, res) => {
  const parsed = subUpdateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid subscription update' })
  const db = getDb()
  if (!db.prepare('SELECT id FROM shops WHERE id = ?').get(req.params.id)) {
    return res.status(404).json({ error: 'Shop not found' })
  }
  const p = parsed.data
  const ts = now()
  db.prepare(
    `INSERT INTO subscriptions (shop_id, plan_type, status, membership_started_at, membership_ends_at, activation_method, updated_at)
     VALUES (?, ?, ?, ?, ?, 'admin', ?)
     ON CONFLICT (shop_id) DO UPDATE SET
       plan_type = excluded.plan_type, status = excluded.status,
       membership_started_at = excluded.membership_started_at,
       membership_ends_at = excluded.membership_ends_at,
       activation_method = 'admin', updated_at = excluded.updated_at`
  ).run(req.params.id, p.plan_type, p.status, p.membership_started_at ?? null, p.membership_ends_at ?? null, ts)
  res.json(db.prepare('SELECT * FROM subscriptions WHERE shop_id = ?').get(req.params.id))
})

/** Full backup of everything the shop has pushed, grouped per table. */
adminRoutes.get('/api/admin/shops/:id/backup', (req, res) => {
  const rows = getDb()
    .prepare('SELECT table_name, payload FROM synced_records WHERE shop_id = ?')
    .all(req.params.id) as { table_name: string; payload: string }[]
  const tables: Record<string, unknown[]> = {}
  for (const r of rows) {
    ;(tables[r.table_name] ??= []).push(JSON.parse(r.payload))
  }
  res.setHeader('content-disposition', `attachment; filename="shop-${req.params.id}-backup.json"`)
  res.json({ shop_id: req.params.id, exported_at: now(), tables })
})

// ---- activation requests ---------------------------------------------------------

adminRoutes.get('/api/admin/requests', (req, res) => {
  const status = String(req.query.status ?? 'pending')
  const rows = getDb()
    .prepare(
      status === 'all'
        ? 'SELECT * FROM activation_requests ORDER BY created_at DESC LIMIT 200'
        : 'SELECT * FROM activation_requests WHERE status = ? ORDER BY created_at DESC LIMIT 200'
    )
    .all(...(status === 'all' ? [] : [status]))
  res.json(rows)
})

adminRoutes.get('/api/admin/requests/:id/proof', (req, res) => {
  const row = getDb()
    .prepare('SELECT proof_path FROM activation_requests WHERE id = ?')
    .get(req.params.id) as { proof_path: string | null } | undefined
  if (!row?.proof_path) return res.status(404).json({ error: 'No proof uploaded' })
  const file = path.join(DATA_DIR, 'proofs', path.basename(row.proof_path))
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'File missing' })
  res.sendFile(file)
})

const approveSchema = z.object({ plan_type: z.enum(['monthly', 'yearly', 'lifetime']) })

adminRoutes.post('/api/admin/requests/:id/approve', (req, res) => {
  const parsed = approveSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'plan_type must be monthly, yearly or lifetime' })
  const db = getDb()
  const request = db
    .prepare("SELECT * FROM activation_requests WHERE id = ? AND status = 'pending'")
    .get(req.params.id) as { id: string; shop_id: string; reference: string | null } | undefined
  if (!request) return res.status(404).json({ error: 'Pending request not found' })

  const grant = grantMembership(request.shop_id, parsed.data.plan_type, 'admin', {
    reference: request.reference,
  })
  db.prepare("UPDATE activation_requests SET status = 'approved', decided_at = ? WHERE id = ?")
    .run(now(), request.id)
  res.json({ ok: true, shop_id: request.shop_id, ...grant })
})

adminRoutes.post('/api/admin/requests/:id/reject', (req, res) => {
  const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : null
  const changed = getDb()
    .prepare("UPDATE activation_requests SET status = 'rejected', note = ?, decided_at = ? WHERE id = ? AND status = 'pending'")
    .run(note, now(), req.params.id)
  if (changed.changes === 0) return res.status(404).json({ error: 'Pending request not found' })
  res.json({ ok: true })
})

// ---- license keys -----------------------------------------------------------------

const genKeysSchema = z.object({
  plan_type: z.enum(['monthly', 'yearly', 'lifetime']),
  count: z.number().int().min(1).max(50).default(1),
  note: z.string().max(200).nullable().optional(),
})

adminRoutes.post('/api/admin/keys', (req, res) => {
  const parsed = genKeysSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid key request' })
  const { plan_type, count, note } = parsed.data
  const db = getDb()
  const keys: string[] = []
  const insert = db.prepare(
    `INSERT INTO license_keys (id, key_hash, key_last4, plan_type, status, note, created_at)
     VALUES (?, ?, ?, ?, 'unused', ?, ?)`
  )
  for (let i = 0; i < count; i++) {
    const key = generateKey(plan_type as KeyPlan)
    insert.run(uid(), keyHash(key), key.slice(-4), plan_type, note ?? null, now())
    keys.push(key)
  }
  // Plaintext keys are returned exactly once — only hashes are stored.
  res.json({ keys })
})

adminRoutes.get('/api/admin/keys', (_req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT k.id, k.key_last4, k.plan_type, k.status, k.note, k.created_at, k.used_at,
              k.used_by_shop_id, s.name AS used_by_shop_name
       FROM license_keys k LEFT JOIN shops s ON s.id = k.used_by_shop_id
       ORDER BY k.created_at DESC LIMIT 500`
    )
    .all()
  res.json(rows)
})

adminRoutes.post('/api/admin/keys/:id/revoke', (req, res) => {
  const changed = getDb()
    .prepare("UPDATE license_keys SET status = 'revoked' WHERE id = ? AND status != 'revoked'")
    .run(req.params.id)
  if (changed.changes === 0) return res.status(404).json({ error: 'Key not found or already revoked' })
  res.json({ ok: true })
})
