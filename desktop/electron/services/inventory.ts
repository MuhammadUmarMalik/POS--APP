import { getDb } from '../db'
import { audit, writeMovement } from './helpers'
import type { InventoryLog, Session } from '../../src/shared/types'
import type { AdjustmentInput } from '../../src/shared/schemas'

export function adjustStock(session: Session, input: AdjustmentInput): void {
  const db = getDb()
  db.transaction(() => {
    writeMovement({
      shopId: session.shopId,
      productId: input.product_id,
      changeType: 'adjustment',
      quantityChange: input.quantity_change,
      reason: input.note ? `${input.reason}: ${input.note}` : input.reason,
      userId: session.userId,
    })
    audit(session, 'stock.adjustment', input)
  })()
}

export function productMovements(session: Session, productId: string): InventoryLog[] {
  return getDb()
    .prepare(
      `SELECT l.*, u.name AS created_by_name
       FROM inventory_logs l
       LEFT JOIN users u ON u.id = l.created_by
       WHERE l.product_id = ? AND l.shop_id = ?
       ORDER BY l.created_at DESC LIMIT 200`
    )
    .all(productId, session.shopId) as InventoryLog[]
}

/**
 * Product stock ledger: full movement history with a running stock balance.
 * The balance is computed over the whole history, so the latest row always
 * equals current stock even when the list is capped.
 */
export function productLedger(session: Session, productId: string): (InventoryLog & { balance: number })[] {
  return getDb()
    .prepare(
      `SELECT l.*, u.name AS created_by_name,
              SUM(l.quantity_change) OVER (ORDER BY l.created_at, l.id) AS balance
       FROM inventory_logs l
       LEFT JOIN users u ON u.id = l.created_by
       WHERE l.product_id = ? AND l.shop_id = ?
       ORDER BY l.created_at DESC, l.id DESC LIMIT 300`
    )
    .all(productId, session.shopId) as (InventoryLog & { balance: number })[]
}
