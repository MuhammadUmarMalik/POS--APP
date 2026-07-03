import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import type { Session } from '../../src/shared/types'

export const uid = () => randomUUID()
export const now = () => new Date().toISOString()

export class AppError extends Error {}

export function audit(session: Session, action: string, details: unknown) {
  getDb()
    .prepare(
      'INSERT INTO audit_logs (id, shop_id, user_id, action, details, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(uid(), session.shopId, session.userId, action, JSON.stringify(details), now())
}

/** Derived stock — the only legal way to read a stock level. */
export function getStock(productId: string): number {
  const row = getDb()
    .prepare(
      'SELECT COALESCE(SUM(quantity_change), 0) AS stock FROM inventory_logs WHERE product_id = ?'
    )
    .get(productId) as { stock: number }
  return row.stock
}

/** Append a stock movement row. Callers must run inside a transaction when part of a larger op. */
export function writeMovement(args: {
  shopId: string
  productId: string
  changeType: string
  quantityChange: number
  reason?: string | null
  referenceId?: string | null
  userId?: string | null
}) {
  getDb()
    .prepare(
      `INSERT INTO inventory_logs
       (id, shop_id, product_id, change_type, quantity_change, reason, reference_id, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      uid(),
      args.shopId,
      args.productId,
      args.changeType,
      args.quantityChange,
      args.reason ?? null,
      args.referenceId ?? null,
      args.userId ?? null,
      now()
    )
}

const INVOICE_KINDS = {
  sale: { col: 'sale_seq', prefix: 'INV' },
  purchase: { col: 'purchase_seq', prefix: 'PUR' },
  purchase_order: { col: 'po_seq', prefix: 'PO' },
} as const

export function nextInvoiceNumber(shopId: string, kind: keyof typeof INVOICE_KINDS): string {
  const { col, prefix } = INVOICE_KINDS[kind]
  const db = getDb()
  db.prepare(`UPDATE shops SET ${col} = ${col} + 1 WHERE id = ?`).run(shopId)
  const { seq } = db.prepare(`SELECT ${col} AS seq FROM shops WHERE id = ?`).get(shopId) as {
    seq: number
  }
  return `${prefix}-${String(seq).padStart(6, '0')}`
}
