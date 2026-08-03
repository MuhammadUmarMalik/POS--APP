// Optional batch / expiry tracking.
//
// Everything here is inert unless the shop turns `batch_tracking_enabled` on.
// Batch stock is derived from inventory_logs.batch_id — there is no per-batch
// stock column, exactly as for product stock.
import { getDb } from '../db'
import { AppError, audit, now, uid } from './helpers'
import { canViewCost } from './permissions'
import type { Session } from '../../src/shared/types'

export interface BatchSettings {
  batch_tracking_enabled: boolean
  expiry_alert_days: number
}

export function getBatchSettings(shopId: string): BatchSettings {
  const row = getDb()
    .prepare('SELECT batch_tracking_enabled, expiry_alert_days FROM shops WHERE id = ?')
    .get(shopId) as { batch_tracking_enabled: number; expiry_alert_days: number } | undefined
  return {
    batch_tracking_enabled: !!row?.batch_tracking_enabled,
    expiry_alert_days: row?.expiry_alert_days ?? 30,
  }
}

export function batchTrackingEnabled(shopId: string): boolean {
  return getBatchSettings(shopId).batch_tracking_enabled
}

export function updateBatchSettings(
  session: Session,
  input: { batch_tracking_enabled: boolean; expiry_alert_days: number }
): BatchSettings {
  getDb()
    .prepare('UPDATE shops SET batch_tracking_enabled = ?, expiry_alert_days = ? WHERE id = ?')
    .run(input.batch_tracking_enabled ? 1 : 0, input.expiry_alert_days, session.shopId)
  audit(session, 'settings.batch_tracking', input)
  return getBatchSettings(session.shopId)
}

/**
 * Find or create the batch row for a (product, batch number, expiry) triple.
 * Returns null when both identifiers are blank — that stock lives in the
 * unbatched pool and needs no batch row.
 */
export function ensureBatch(
  shopId: string,
  productId: string,
  batchNumber: string | null | undefined,
  expiryDate: string | null | undefined
): string | null {
  const bn = batchNumber?.trim() || null
  const ex = expiryDate?.trim() || null
  if (!bn && !ex) return null
  const db = getDb()
  const existing = db
    .prepare(
      `SELECT id FROM product_batches
       WHERE product_id = ? AND IFNULL(batch_number, '') = ? AND IFNULL(expiry_date, '') = ?`
    )
    .get(productId, bn ?? '', ex ?? '') as { id: string } | undefined
  if (existing) return existing.id
  const id = uid()
  db.prepare(
    `INSERT INTO product_batches (id, shop_id, product_id, batch_number, expiry_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, shopId, productId, bn, ex, now())
  return id
}

export interface BatchStock {
  batch_id: string | null
  batch_number: string | null
  expiry_date: string | null
  stock: number
}

/** Per-batch derived stock for one product, expiry-soonest first, unbatched last. */
export function batchStock(productId: string): BatchStock[] {
  return getDb()
    .prepare(
      `SELECT l.batch_id AS batch_id, b.batch_number AS batch_number, b.expiry_date AS expiry_date,
              SUM(l.quantity_change) AS stock
       FROM inventory_logs l
       LEFT JOIN product_batches b ON b.id = l.batch_id
       WHERE l.product_id = ?
       GROUP BY l.batch_id
       ORDER BY (b.expiry_date IS NULL) ASC, b.expiry_date ASC, b.created_at ASC`
    )
    .all(productId) as BatchStock[]
}

export interface Allocation {
  batch_id: string | null
  quantity: number
}

/**
 * First-expiry-first-out split of an outgoing quantity across the batches that
 * actually hold stock. Batches without an expiry, and the unbatched pool, are
 * consumed last. Any shortfall is left on the unbatched pool so a deliberate
 * negative-stock sale still records a single coherent movement.
 */
export function allocateFefo(productId: string, quantity: number): Allocation[] {
  if (quantity <= 0) return []
  const out: Allocation[] = []
  let left = quantity
  for (const b of batchStock(productId)) {
    if (left <= 0) break
    if (b.stock <= 0) continue
    const take = Math.min(left, b.stock)
    out.push({ batch_id: b.batch_id, quantity: take })
    left -= take
  }
  if (left > 0) {
    const unbatched = out.find((a) => a.batch_id === null)
    if (unbatched) unbatched.quantity += left
    else out.push({ batch_id: null, quantity: left })
  }
  return out
}

/**
 * Put returned/cancelled stock back where it came from. Reads the movements the
 * original document wrote for this product and hands the quantity back in the
 * same proportions, netting off anything already returned.
 */
export function allocateReturn(
  referenceId: string,
  productId: string,
  quantity: number
): Allocation[] {
  if (quantity <= 0) return []
  const rows = getDb()
    .prepare(
      `SELECT l.batch_id AS batch_id, SUM(l.quantity_change) AS net
       FROM inventory_logs l
       LEFT JOIN product_batches b ON b.id = l.batch_id
       WHERE l.reference_id = ? AND l.product_id = ?
       GROUP BY l.batch_id
       HAVING SUM(l.quantity_change) <> 0
       ORDER BY (b.expiry_date IS NULL) ASC, b.expiry_date ASC`
    )
    .all(referenceId, productId) as { batch_id: string | null; net: number }[]

  // Outgoing documents (sales) leave a negative net; incoming ones (purchases)
  // a positive one. Either way the magnitude is what is still outstanding.
  const out: Allocation[] = []
  let left = quantity
  for (const r of rows) {
    if (left <= 0) break
    const outstanding = Math.abs(r.net)
    if (outstanding <= 0) continue
    const take = Math.min(left, outstanding)
    out.push({ batch_id: r.batch_id, quantity: take })
    left -= take
  }
  if (left > 0) {
    const unbatched = out.find((a) => a.batch_id === null)
    if (unbatched) unbatched.quantity += left
    else out.push({ batch_id: null, quantity: left })
  }
  return out
}

export interface ExpiryRow {
  batch_id: string
  product_id: string
  product_name: string
  sku: string | null
  category_name: string | null
  batch_number: string | null
  expiry_date: string
  days_left: number
  stock: number
  /** Cost and the money at risk are omitted for roles that may not see cost. */
  cost_price?: number
  value?: number
}

/**
 * Batches holding stock that expire within `days` (or already have).
 * `days` defaults to the shop's configured alert threshold.
 */
export function expiryReport(session: Session, input?: { days?: number }): {
  enabled: boolean
  threshold_days: number
  rows: ExpiryRow[]
  totals: { expired: number; expiring: number; value?: number }
} {
  const settings = getBatchSettings(session.shopId)
  const threshold = input?.days ?? settings.expiry_alert_days
  const showCost = canViewCost(session)
  if (!settings.batch_tracking_enabled) {
    return {
      enabled: false,
      threshold_days: threshold,
      rows: [],
      totals: { expired: 0, expiring: 0, ...(showCost ? { value: 0 } : {}) },
    }
  }
  const cutoff = new Date(Date.now() + threshold * 86_400_000).toISOString().slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)
  const rows = getDb()
    .prepare(
      `SELECT b.id AS batch_id, b.product_id AS product_id, p.name AS product_name, p.sku AS sku,
              c.name AS category_name, b.batch_number AS batch_number, b.expiry_date AS expiry_date,
              COALESCE(s.stock, 0) AS stock, p.cost_price AS cost_price
       FROM product_batches b
       JOIN products p ON p.id = b.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN (
         SELECT batch_id, SUM(quantity_change) AS stock
         FROM inventory_logs WHERE batch_id IS NOT NULL GROUP BY batch_id
       ) s ON s.batch_id = b.id
       WHERE b.shop_id = ? AND b.expiry_date IS NOT NULL AND b.expiry_date <= ?
         AND p.is_deleted = 0 AND COALESCE(s.stock, 0) > 0
       ORDER BY b.expiry_date ASC`
    )
    .all(session.shopId, cutoff) as (Omit<ExpiryRow, 'days_left' | 'value'> & { cost_price: number })[]

  const dayMs = 86_400_000
  const todayMs = Date.parse(today)
  const full: ExpiryRow[] = rows.map((r) => {
    const days_left = Math.round((Date.parse(r.expiry_date) - todayMs) / dayMs)
    // Which batches expire when is operational information every till needs;
    // what they cost is not, so cost and the money at risk are dropped here.
    if (!showCost) {
      const { cost_price: _cost, ...rest } = r
      return { ...rest, days_left }
    }
    return { ...r, days_left, value: r.stock * r.cost_price }
  })
  return {
    enabled: true,
    threshold_days: threshold,
    rows: full,
    totals: {
      expired: full.filter((r) => r.days_left < 0).length,
      expiring: full.filter((r) => r.days_left >= 0).length,
      ...(showCost ? { value: full.reduce((a, r) => a + (r.value ?? 0), 0) } : {}),
    },
  }
}

/** Batch-level stock for one product — powers the product detail batch table. */
export function productBatches(session: Session, productId: string): BatchStock[] {
  if (!batchTrackingEnabled(session.shopId)) return []
  const owned = getDb()
    .prepare('SELECT id FROM products WHERE id = ? AND shop_id = ?')
    .get(productId, session.shopId)
  if (!owned) throw new AppError('Product not found')
  return batchStock(productId).filter((b) => b.batch_id !== null || b.stock !== 0)
}
