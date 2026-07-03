// Trial + membership lifecycle. Status is stored in subscription_settings and
// re-derived on every read so expiry takes effect without any background job.
// License keys validate fully offline via an HMAC-style checksum, with an
// optional online verification against the cloud API when reachable.
import { createHash, randomBytes } from 'node:crypto'
import { app, dialog, BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { getDb } from '../db'
import { uid, now, AppError, audit } from './helpers'
import {
  LICENSE_KEY_RE, LOCKED_MESSAGE, TRIAL_DAYS, canCreateSale, maskLicenseKey,
  type PlanType, type SubscriptionStatus,
} from '../../src/shared/subscription'
import type { Session, SubscriptionView } from '../../src/shared/types'
import type { ActivateLicenseInput, PaymentProofInput } from '../../src/shared/schemas'
import { cloudFetch } from './sync'

export interface SubscriptionRow {
  id: string
  shop_id: string
  plan_type: PlanType
  status: SubscriptionStatus
  trial_started_at: string | null
  trial_ends_at: string | null
  membership_started_at: string | null
  membership_ends_at: string | null
  license_key: string | null
  activation_method: string | null
  payment_reference: string | null
  payment_proof_url: string | null
  payment_proof_local_path: string | null
  activated_by_admin: number
  created_at: string
  updated_at: string
}

/** Fetch (or lazily create) the shop's subscription row, then apply expiry. */
export function ensureSubscription(shopId: string): SubscriptionRow {
  const db = getDb()
  let row = db
    .prepare('SELECT * FROM subscription_settings WHERE shop_id = ?')
    .get(shopId) as SubscriptionRow | undefined
  if (!row) {
    const ts = now()
    const trialEnd = new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString()
    db.prepare(
      `INSERT INTO subscription_settings
       (id, shop_id, plan_type, status, trial_started_at, trial_ends_at, created_at, updated_at)
       VALUES (?, ?, 'trial', 'trial_active', ?, ?, ?, ?)`
    ).run(uid(), shopId, ts, trialEnd, ts, ts)
    row = db
      .prepare('SELECT * FROM subscription_settings WHERE shop_id = ?')
      .get(shopId) as SubscriptionRow
  }
  return applyExpiry(row)
}

/** Downgrade trial_active/membership_active when their end date has passed. */
function applyExpiry(row: SubscriptionRow): SubscriptionRow {
  const nowIso = now()
  let next: SubscriptionStatus | null = null
  if (row.status === 'trial_active' && row.trial_ends_at && row.trial_ends_at < nowIso) {
    next = 'trial_expired'
  }
  if (row.status === 'membership_active' && row.membership_ends_at && row.membership_ends_at < nowIso) {
    next = 'membership_expired'
  }
  if (next) {
    getDb()
      .prepare('UPDATE subscription_settings SET status = ?, updated_at = ? WHERE id = ?')
      .run(next, nowIso, row.id)
    return { ...row, status: next }
  }
  return row
}

export function subscriptionStatus(shopId: string): SubscriptionStatus {
  return ensureSubscription(shopId).status
}

/** Hard server-side gate used by ipc.ts for sale/purchase-creating channels. */
export function assertCanTransact(shopId: string): void {
  const status = subscriptionStatus(shopId)
  if (!canCreateSale(status)) throw new AppError(LOCKED_MESSAGE)
}

export function getStatusView(session: Session): SubscriptionView {
  const row = ensureSubscription(session.shopId)
  const remaining = row.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(row.trial_ends_at).getTime() - Date.now()) / 86_400_000))
    : 0
  return {
    plan_type: row.plan_type,
    status: row.status,
    trial_started_at: row.trial_started_at,
    trial_ends_at: row.trial_ends_at,
    remaining_trial_days: row.status === 'trial_active' ? remaining : 0,
    membership_started_at: row.membership_started_at,
    membership_ends_at: row.membership_ends_at,
    license_key_masked: maskLicenseKey(row.license_key),
    activation_method: row.activation_method,
    payment_reference: row.payment_reference,
    payment_proof_uploaded: !!row.payment_proof_local_path,
  }
}

// ---- license key validation -------------------------------------------------
// Key format: PXXX-XXXX-XXXX-CCCC where the last group is a checksum of the
// first three, so keys issued by our generator validate with no internet.
// First character encodes the plan: L = lifetime, Y = yearly, anything else = monthly.

const KEY_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I
const KEY_SECRET = 'POS-DESKTOP-LK1' // must match the key generator / cloud issuer

function expectedChecksum(firstThreeGroups: string): string {
  const digest = createHash('sha256').update(`${KEY_SECRET}|${firstThreeGroups}`).digest()
  let out = ''
  for (let i = 0; i < 4; i++) out += KEY_CHARSET[digest[i] % KEY_CHARSET.length]
  return out
}

function keyHash(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/** Issue a key that validates offline. Vendor tooling + smoke test — not exposed over IPC. */
export function generateLicenseKey(plan: Exclude<PlanType, 'trial'> = 'monthly'): string {
  const first = plan === 'lifetime' ? 'L' : plan === 'yearly' ? 'Y' : 'M'
  const rand = randomBytes(11)
  let body = first
  for (let i = 0; i < 11; i++) body += KEY_CHARSET[rand[i] % KEY_CHARSET.length]
  const groups = [body.slice(0, 4), body.slice(4, 8), body.slice(8, 12)].join('-')
  return `${groups}-${expectedChecksum(groups)}`
}

export function planFromKey(key: string): PlanType {
  const c = key[0]
  if (c === 'L') return 'lifetime'
  if (c === 'Y') return 'yearly'
  return 'monthly'
}

/** Offline validation: checksum scheme, or a hash previously cached from the cloud. */
export function validateKeyOffline(key: string): { valid: boolean; plan_type: PlanType } {
  if (!LICENSE_KEY_RE.test(key)) return { valid: false, plan_type: 'monthly' }
  const groups = key.split('-')
  if (expectedChecksum(groups.slice(0, 3).join('-')) === groups[3]) {
    return { valid: true, plan_type: planFromKey(key) }
  }
  const cached = getDb()
    .prepare('SELECT plan_type FROM license_key_cache WHERE key_hash = ?')
    .get(keyHash(key)) as { plan_type: PlanType } | undefined
  if (cached) return { valid: true, plan_type: cached.plan_type }
  return { valid: false, plan_type: 'monthly' }
}

/** Cloud verification; returns null when offline / cloud not configured. */
async function verifyKeyOnline(
  key: string,
  shopId: string
): Promise<{ valid: boolean; plan_type: PlanType; expires_at?: string | null } | null> {
  const res = await cloudFetch('/api/subscription/verify-license', {
    method: 'POST',
    body: { license_key: key, shop_id: shopId },
  })
  if (!res) return null
  return res as { valid: boolean; plan_type: PlanType; expires_at?: string | null }
}

const PLAN_DURATION_DAYS: Record<Exclude<PlanType, 'trial' | 'lifetime'>, number> = {
  monthly: 30,
  yearly: 365,
}

export async function activateLicense(
  session: Session,
  input: ActivateLicenseInput
): Promise<SubscriptionView> {
  const key = input.license_key
  const row = ensureSubscription(session.shopId)

  // Online check is authoritative when reachable; offline checksum otherwise.
  const online = await verifyKeyOnline(key, session.shopId)
  const verdict = online ?? validateKeyOffline(key)
  if (!verdict.valid) throw new AppError('Invalid license key. Please check the key and try again.')

  const db = getDb()
  const ts = now()
  const plan = verdict.plan_type
  const status: SubscriptionStatus = plan === 'lifetime' ? 'lifetime_active' : 'membership_active'
  const endsAt =
    plan === 'lifetime'
      ? null
      : online?.expires_at ??
        new Date(Date.now() + PLAN_DURATION_DAYS[plan as 'monthly' | 'yearly'] * 86_400_000).toISOString()

  db.prepare(
    `UPDATE subscription_settings SET
       plan_type = ?, status = ?, membership_started_at = ?, membership_ends_at = ?,
       license_key = ?, activation_method = ?, updated_at = ?
     WHERE id = ?`
  ).run(plan, status, ts, endsAt, key, online ? 'license_key_online' : 'license_key_offline', ts, row.id)
  // Cache the accepted key so future offline re-checks pass regardless of scheme.
  db.prepare(
    'INSERT OR REPLACE INTO license_key_cache (key_hash, plan_type, cached_at) VALUES (?, ?, ?)'
  ).run(keyHash(key), plan, ts)

  audit(session, 'subscription.activate', { plan, status, key_last4: key.slice(-4) })
  return getStatusView(session)
}

// ---- payment proof ------------------------------------------------------------

const PROOF_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp'])

function proofsDir(): string {
  const dir = path.join(app.getPath('userData'), 'payment-proofs')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Pick a payment screenshot, store it locally, and mark the subscription
 * pending verification (unless the trial is still running — access is kept).
 * The file is uploaded to the cloud on the next successful sync.
 */
export async function uploadPaymentProof(
  session: Session,
  input: PaymentProofInput
): Promise<{ saved: boolean; view?: SubscriptionView }> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Choose payment screenshot',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  })
  if (canceled || filePaths.length === 0) return { saved: false }

  const src = filePaths[0]
  const ext = path.extname(src).toLowerCase()
  if (!PROOF_EXT.has(ext)) throw new AppError('Payment proof must be a JPG, PNG or WEBP image')
  const stat = await fs.promises.stat(src)
  if (stat.size > 5 * 1024 * 1024) throw new AppError('Screenshot must be under 5 MB')

  const name = `proof-${uid()}${ext}`
  await fs.promises.copyFile(src, path.join(proofsDir(), name))

  const row = ensureSubscription(session.shopId)
  const ts = now()
  // Only flip to pending_verification when access is already locked; an active
  // trial keeps running while the proof waits for admin verification.
  const nextStatus =
    row.status === 'trial_active' || row.status === 'membership_active' || row.status === 'lifetime_active'
      ? row.status
      : 'pending_verification'
  getDb()
    .prepare(
      `UPDATE subscription_settings SET
         status = ?, activation_method = 'payment_proof', payment_reference = ?,
         payment_proof_local_path = ?, payment_proof_url = NULL, updated_at = ?
       WHERE id = ?`
    )
    .run(nextStatus, input.reference ?? null, name, ts, row.id)

  audit(session, 'subscription.payment_proof', { file: name, reference: input.reference ?? null })
  // Best effort right away; the scheduler retries whenever we're offline now.
  await pushPendingActivationRequest(session.shopId).catch(() => {})
  return { saved: true, view: getStatusView(session) }
}

// ---- vendor-cloud round trip ----------------------------------------------------
// The activation request travels to the vendor admin panel; approval travels back
// via refreshSubscriptionFromCloud. Both are retried by the auto-sync scheduler and
// run regardless of expiry — a locked shop must still be able to get activated.

/** Send the saved payment proof + shop info to the vendor cloud (idempotent). */
export async function pushPendingActivationRequest(shopId: string): Promise<boolean> {
  const row = getDb()
    .prepare('SELECT * FROM subscription_settings WHERE shop_id = ?')
    .get(shopId) as SubscriptionRow | undefined
  if (!row?.payment_proof_local_path || row.payment_proof_url) return false

  const shop = getDb()
    .prepare('SELECT name, phone FROM shops WHERE id = ?')
    .get(shopId) as { name: string; phone: string | null } | undefined

  const file = path.join(proofsDir(), path.basename(row.payment_proof_local_path))
  let proofB64: string | null = null
  try {
    proofB64 = (await fs.promises.readFile(file)).toString('base64')
  } catch {
    proofB64 = null // file gone — still send the request without the image
  }

  const res = (await cloudFetch('/api/subscription/request-activation', {
    method: 'POST',
    timeoutMs: 60_000,
    body: {
      shop_id: shopId,
      client_request_id: row.payment_proof_local_path, // unique per proof → dedupes retries
      shop_name: shop?.name ?? '',
      phone: shop?.phone ?? null,
      reference: row.payment_reference,
      proof_base64: proofB64,
      proof_ext: proofB64 ? path.extname(file).toLowerCase() : null,
    },
  })) as { ok?: boolean; proof_url?: string | null } | null
  if (!res?.ok) return false

  getDb()
    .prepare('UPDATE subscription_settings SET payment_proof_url = ? WHERE id = ?')
    .run(res.proof_url ?? 'sent', row.id)
  return true
}

/**
 * Tell the vendor cloud what this shop's subscription looks like locally — offline
 * key activations and trial expiries happen with no internet, so the admin panel
 * only learns about them from this report. Sending the key hash also marks the
 * consumed key as "used" in the panel.
 */
export async function reportSubscriptionToCloud(shopId: string): Promise<boolean> {
  const row = getDb()
    .prepare('SELECT * FROM subscription_settings WHERE shop_id = ?')
    .get(shopId) as SubscriptionRow | undefined
  if (!row) return false
  const shop = getDb()
    .prepare('SELECT name, phone FROM shops WHERE id = ?')
    .get(shopId) as { name: string; phone: string | null } | undefined

  const res = (await cloudFetch('/api/subscription/report', {
    method: 'POST',
    body: {
      shop_id: shopId,
      shop_name: shop?.name ?? '',
      phone: shop?.phone ?? null,
      plan_type: row.plan_type,
      status: row.status,
      trial_started_at: row.trial_started_at,
      trial_ends_at: row.trial_ends_at,
      membership_started_at: row.membership_started_at,
      membership_ends_at: row.membership_ends_at,
      activation_method: row.activation_method,
      payment_reference: row.payment_reference,
      license_key_hash: row.license_key ? keyHash(row.license_key) : null,
      license_key_last4: row.license_key ? row.license_key.slice(-4) : null,
      updated_at: row.updated_at,
    },
  })) as { ok?: boolean } | null
  return !!res?.ok
}

interface CloudSubscription {
  status: SubscriptionStatus | null
  plan_type?: PlanType
  membership_started_at?: string | null
  membership_ends_at?: string | null
  activation_method?: string | null
  payment_reference?: string | null
  updated_at?: string
}

// Cloud decides memberships and suspensions; trials and pending markers stay local.
const CLOUD_AUTHORITATIVE: readonly SubscriptionStatus[] = [
  'membership_active', 'lifetime_active', 'membership_expired', 'suspended',
]

/** Pull the admin's decision. Returns true when the local status changed. */
export async function refreshSubscriptionFromCloud(shopId: string): Promise<boolean> {
  const res = (await cloudFetch(
    `/api/subscription/status?shop_id=${encodeURIComponent(shopId)}`
  )) as CloudSubscription | null
  if (!res?.status || !res.updated_at) return false
  if (!CLOUD_AUTHORITATIVE.includes(res.status)) return false

  const row = ensureSubscription(shopId)
  if (row.status === res.status && row.plan_type === res.plan_type) return false
  // Apply when the cloud state is newer — or when it unlocks a locked shop, so an
  // admin approval still lands even if the shop's clock runs ahead of the server.
  const grantsAccess = res.status === 'membership_active' || res.status === 'lifetime_active'
  const localLocked = !['membership_active', 'lifetime_active'].includes(row.status)
  if (res.updated_at <= row.updated_at && !(grantsAccess && localLocked)) return false

  getDb()
    .prepare(
      `UPDATE subscription_settings SET
         plan_type = ?, status = ?, membership_started_at = ?, membership_ends_at = ?,
         activation_method = ?, activated_by_admin = 1, updated_at = ?
       WHERE id = ?`
    )
    .run(
      res.plan_type ?? row.plan_type, res.status,
      res.membership_started_at ?? row.membership_started_at,
      res.membership_ends_at ?? null,
      res.activation_method ?? 'admin', res.updated_at, row.id
    )
  console.log(`[subscription] cloud update applied: ${row.status} → ${res.status}`)
  return true
}

/** UI "Check activation status": push any unsent request + our state, then pull the decision. */
export async function refreshSubscription(session: Session): Promise<SubscriptionView> {
  await pushPendingActivationRequest(session.shopId).catch(() => {})
  await reportSubscriptionToCloud(session.shopId).catch(() => {})
  await refreshSubscriptionFromCloud(session.shopId).catch(() => {})
  return getStatusView(session)
}
