// Endpoints the desktop POS calls. Route paths must match desktop/electron/services/sync.ts
// and subscription.ts. Device auth is the shop_id itself (MVP) — see README for hardening.
import { Router } from 'express'
import { z } from 'zod'
import path from 'node:path'
import fs from 'node:fs'
import { getDb, touchShop, uid, now, DATA_DIR } from './db.js'
import { checksumValid, keyHash, planFromKey, type KeyPlan } from './licenses.js'

export const deviceRoutes = Router()

const PLAN_DURATION_DAYS: Record<Exclude<KeyPlan, 'lifetime'>, number> = { monthly: 30, yearly: 365 }

function endsAtFor(plan: KeyPlan, from = Date.now()): string | null {
  if (plan === 'lifetime') return null
  return new Date(from + PLAN_DURATION_DAYS[plan] * 86_400_000).toISOString()
}

function upsertSubscription(shopId: string, fields: Record<string, unknown>) {
  const db = getDb()
  const ts = now()
  const existing = db.prepare('SELECT shop_id FROM subscriptions WHERE shop_id = ?').get(shopId)
  if (!existing) {
    db.prepare('INSERT INTO subscriptions (shop_id, updated_at) VALUES (?, ?)').run(shopId, ts)
  }
  const keys = Object.keys(fields)
  if (keys.length > 0) {
    const sets = keys.map((k) => `${k} = ?`).join(', ')
    db.prepare(`UPDATE subscriptions SET ${sets}, updated_at = ? WHERE shop_id = ?`).run(
      ...keys.map((k) => fields[k] as never), ts, shopId
    )
  }
}

export function grantMembership(
  shopId: string,
  plan: KeyPlan,
  method: string,
  opts: { reference?: string | null; keyLast4?: string | null } = {}
) {
  const ts = now()
  const status = plan === 'lifetime' ? 'lifetime_active' : 'membership_active'
  const endsAt = endsAtFor(plan)
  upsertSubscription(shopId, {
    plan_type: plan,
    status,
    membership_started_at: ts,
    membership_ends_at: endsAt,
    activation_method: method,
    ...(opts.keyLast4 ? { license_key_last4: opts.keyLast4 } : {}),
    ...(opts.reference !== undefined ? { payment_reference: opts.reference } : {}),
  })
  return { status, plan_type: plan, expires_at: endsAt }
}

deviceRoutes.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'pos-cloud' })
})

// ---- sync ---------------------------------------------------------------------

const pushSchema = z.object({
  shop_id: z.string().min(1),
  tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
})

deviceRoutes.post('/api/sync/push', (req, res) => {
  const parsed = pushSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid push payload' })
  const { shop_id, tables } = parsed.data
  const db = getDb()

  let total = 0
  const upsert = db.prepare(
    `INSERT INTO synced_records (shop_id, table_name, record_id, payload, updated_at, received_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (shop_id, table_name, record_id) DO UPDATE SET
       payload = excluded.payload, updated_at = excluded.updated_at, received_at = excluded.received_at`
  )
  const run = db.transaction(() => {
    for (const [table, rows] of Object.entries(tables)) {
      if (!/^[a-z_]+$/.test(table)) continue
      for (const row of rows) {
        const id = typeof row.id === 'string' ? row.id : null
        if (!id) continue
        upsert.run(shop_id, table, id, JSON.stringify(row),
          typeof row.updated_at === 'string' ? row.updated_at : null, now())
        total++
        if (table === 'shops' && id === shop_id) {
          db.prepare(
            `UPDATE shops SET name = ?, owner_name = ?, phone = ?, email = ?, address = ?,
               city = ?, business_type = ?, currency = ? WHERE id = ?`
          ).run(
            (row.name as string) ?? '', (row.owner_name as string) ?? null, (row.phone as string) ?? null,
            (row.email as string) ?? null, (row.address as string) ?? null, (row.city as string) ?? null,
            (row.business_type as string) ?? null, (row.currency as string) ?? null, shop_id
          )
        }
      }
    }
  })
  touchShop({ id: shop_id })
  run()
  db.prepare('UPDATE shops SET last_sync_at = ?, last_seen_at = ? WHERE id = ?').run(now(), now(), shop_id)
  db.prepare('INSERT INTO sync_runs (id, shop_id, pushed_records, created_at) VALUES (?, ?, ?, ?)')
    .run(uid(), shop_id, total, now())
  res.json({ ok: true, received: total })
})

deviceRoutes.get('/api/sync/pull', (req, res) => {
  const shopId = String(req.query.shop_id ?? '')
  if (!shopId) return res.status(400).json({ error: 'shop_id required' })
  touchShop({ id: shopId })
  // Master data is not edited cloud-side in this version; nothing to merge back.
  res.json({ tables: {} })
})

// ---- license verification -------------------------------------------------------

const verifySchema = z.object({ license_key: z.string().min(19), shop_id: z.string().min(1) })

deviceRoutes.post('/api/subscription/verify-license', (req, res) => {
  const parsed = verifySchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' })
  const key = parsed.data.license_key.toUpperCase()
  const shopId = parsed.data.shop_id
  const db = getDb()
  touchShop({ id: shopId })

  const invalid = () => res.json({ valid: false, plan_type: 'monthly', expires_at: null })

  const row = db
    .prepare('SELECT id, plan_type, status, used_by_shop_id FROM license_keys WHERE key_hash = ?')
    .get(keyHash(key)) as
    | { id: string; plan_type: KeyPlan; status: string; used_by_shop_id: string | null }
    | undefined

  if (row) {
    if (row.status === 'revoked') return invalid()
    // One key, one shop: re-activation on the same shop is fine, another shop is not.
    if (row.status === 'used' && row.used_by_shop_id && row.used_by_shop_id !== shopId) return invalid()
    db.prepare("UPDATE license_keys SET status = 'used', used_by_shop_id = ?, used_at = COALESCE(used_at, ?) WHERE id = ?")
      .run(shopId, now(), row.id)
    const grant = grantMembership(shopId, row.plan_type, 'license_key_online', { keyLast4: key.slice(-4) })
    return res.json({ valid: true, plan_type: row.plan_type, expires_at: grant.expires_at })
  }

  // Not issued from the panel but carries a valid vendor checksum (e.g. generated
  // via the CLI script). Accept it and record it so it becomes one-shop-bound too.
  if (checksumValid(key)) {
    const plan = planFromKey(key)
    db.prepare(
      `INSERT INTO license_keys (id, key_hash, key_last4, plan_type, status, note, used_by_shop_id, created_at, used_at)
       VALUES (?, ?, ?, ?, 'used', 'accepted via checksum', ?, ?, ?)`
    ).run(uid(), keyHash(key), key.slice(-4), plan, shopId, now(), now())
    const grant = grantMembership(shopId, plan, 'license_key_online', { keyLast4: key.slice(-4) })
    return res.json({ valid: true, plan_type: plan, expires_at: grant.expires_at })
  }

  return invalid()
})

// ---- activation requests ---------------------------------------------------------

const requestSchema = z.object({
  shop_id: z.string().min(1),
  // Retried offline requests reuse the same id so the admin never sees duplicates.
  client_request_id: z.string().max(120).nullable().optional(),
  shop_name: z.string().max(200).default(''),
  phone: z.string().max(40).nullable().optional(),
  requested_plan: z.enum(['monthly', 'yearly', 'lifetime']).nullable().optional(),
  reference: z.string().max(200).nullable().optional(),
  proof_base64: z.string().max(8_000_000).nullable().optional(),
  proof_ext: z.enum(['.png', '.jpg', '.jpeg', '.webp']).nullable().optional(),
})

deviceRoutes.post('/api/subscription/request-activation', (req, res) => {
  const parsed = requestSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid activation request' })
  const p = parsed.data
  const db = getDb()
  touchShop({ id: p.shop_id, name: p.shop_name, phone: p.phone ?? undefined })

  if (p.client_request_id) {
    const dup = db
      .prepare('SELECT id, proof_path FROM activation_requests WHERE shop_id = ? AND client_request_id = ?')
      .get(p.shop_id, p.client_request_id) as { id: string; proof_path: string | null } | undefined
    if (dup) return res.json({ ok: true, request_id: dup.id, proof_url: dup.proof_path })
  }

  let proofPath: string | null = null
  if (p.proof_base64 && p.proof_ext) {
    const buf = Buffer.from(p.proof_base64, 'base64')
    if (buf.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Screenshot must be under 5 MB' })
    const dir = path.join(DATA_DIR, 'proofs')
    fs.mkdirSync(dir, { recursive: true })
    proofPath = `proof-${uid()}${p.proof_ext}`
    fs.writeFileSync(path.join(dir, proofPath), buf)
  }

  const id = uid()
  db.prepare(
    `INSERT INTO activation_requests (id, client_request_id, shop_id, shop_name, phone, requested_plan, reference, proof_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, p.client_request_id ?? null, p.shop_id, p.shop_name, p.phone ?? null, p.requested_plan ?? null,
    p.reference ?? null, proofPath, now())

  // Don't downgrade an already-active shop; otherwise mark it waiting for the admin.
  const sub = db.prepare('SELECT status FROM subscriptions WHERE shop_id = ?').get(p.shop_id) as
    | { status: string }
    | undefined
  if (!sub || !['membership_active', 'lifetime_active'].includes(sub.status)) {
    upsertSubscription(p.shop_id, { status: 'pending_verification', payment_reference: p.reference ?? null })
  }

  res.json({ ok: true, request_id: id, proof_url: proofPath })
})

// ---- subscription report (device tells the cloud its local state) -----------------
// Offline activations (checksum keys, trial expiry) happen with no internet; the shop
// reports them here on its next connection so the admin panel reflects reality and
// the used key gets marked/bound. The reported updated_at is stored verbatim so the
// device's own refresh never sees its report as "newer cloud state".

const reportSchema = z.object({
  shop_id: z.string().min(1),
  shop_name: z.string().max(200).default(''),
  phone: z.string().max(40).nullable().optional(),
  plan_type: z.enum(['trial', 'monthly', 'yearly', 'lifetime']),
  status: z.enum([
    'trial_active', 'trial_expired', 'membership_active', 'membership_expired',
    'lifetime_active', 'suspended', 'pending_verification',
  ]),
  trial_started_at: z.string().nullable().optional(),
  trial_ends_at: z.string().nullable().optional(),
  membership_started_at: z.string().nullable().optional(),
  membership_ends_at: z.string().nullable().optional(),
  activation_method: z.string().max(60).nullable().optional(),
  payment_reference: z.string().max(200).nullable().optional(),
  license_key_hash: z.string().length(64).nullable().optional(),
  license_key_last4: z.string().max(4).nullable().optional(),
  updated_at: z.string().min(1),
})

deviceRoutes.post('/api/subscription/report', (req, res) => {
  const parsed = reportSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid subscription report' })
  const p = parsed.data
  const db = getDb()
  touchShop({ id: p.shop_id, name: p.shop_name, phone: p.phone ?? undefined })

  // Mark the shop's key as used regardless of how old the report is — a key that
  // activated a shop is consumed either way. Keys already bound elsewhere are left
  // alone (the admin can spot the mismatch in the panel).
  if (p.license_key_hash) {
    const key = db
      .prepare('SELECT id, status, used_by_shop_id FROM license_keys WHERE key_hash = ?')
      .get(p.license_key_hash) as { id: string; status: string; used_by_shop_id: string | null } | undefined
    if (key && key.status !== 'revoked' && (!key.used_by_shop_id || key.used_by_shop_id === p.shop_id)) {
      db.prepare("UPDATE license_keys SET status = 'used', used_by_shop_id = ?, used_at = COALESCE(used_at, ?) WHERE id = ?")
        .run(p.shop_id, now(), key.id)
    }
  }

  const existing = db
    .prepare('SELECT updated_at FROM subscriptions WHERE shop_id = ?')
    .get(p.shop_id) as { updated_at: string } | undefined
  // Admin decisions (stored with a newer updated_at) always win over device reports.
  if (existing && existing.updated_at >= p.updated_at) return res.json({ ok: true, applied: false })

  db.prepare(
    `INSERT INTO subscriptions (shop_id, plan_type, status, trial_started_at, trial_ends_at,
       membership_started_at, membership_ends_at, license_key_last4, activation_method,
       payment_reference, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (shop_id) DO UPDATE SET
       plan_type = excluded.plan_type, status = excluded.status,
       trial_started_at = excluded.trial_started_at, trial_ends_at = excluded.trial_ends_at,
       membership_started_at = excluded.membership_started_at,
       membership_ends_at = excluded.membership_ends_at,
       license_key_last4 = COALESCE(excluded.license_key_last4, subscriptions.license_key_last4),
       activation_method = COALESCE(excluded.activation_method, subscriptions.activation_method),
       payment_reference = COALESCE(excluded.payment_reference, subscriptions.payment_reference),
       updated_at = excluded.updated_at`
  ).run(
    p.shop_id, p.plan_type, p.status, p.trial_started_at ?? null, p.trial_ends_at ?? null,
    p.membership_started_at ?? null, p.membership_ends_at ?? null,
    p.license_key_last4 ?? null, p.activation_method ?? null, p.payment_reference ?? null, p.updated_at
  )
  res.json({ ok: true, applied: true })
})

// ---- subscription status (device polls this to learn about admin approval) --------

deviceRoutes.get('/api/subscription/status', (req, res) => {
  const shopId = String(req.query.shop_id ?? '')
  if (!shopId) return res.status(400).json({ error: 'shop_id required' })
  touchShop({ id: shopId })
  const row = getDb()
    .prepare(
      `SELECT plan_type, status, membership_started_at, membership_ends_at,
              activation_method, payment_reference, updated_at
       FROM subscriptions WHERE shop_id = ?`
    )
    .get(shopId)
  res.json(row ?? { status: null })
})
