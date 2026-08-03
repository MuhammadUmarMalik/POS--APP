import { getDb } from '../db'
import { audit, getStock, uid, writeMovement } from './helpers'
import { allocateFefo, batchTrackingEnabled, ensureBatch } from './batches'
import type { InventoryLog, Session } from '../../src/shared/types'
import type { AdjustmentInput } from '../../src/shared/schemas'

export function adjustStock(session: Session, input: AdjustmentInput): void {
  const db = getDb()
  const tracking = batchTrackingEnabled(session.shopId)
  db.transaction(() => {
    const reason = input.note ? `${input.reason}: ${input.note}` : input.reason
    // A write-off names the batch it is writing off (expired goods, damage to a
    // specific lot). Without one, stock leaves first-expiry-first-out and stock
    // added lands on the unbatched pool.
    let allocations = [{ batch_id: null as string | null, quantity: Math.abs(input.quantity_change) }]
    if (tracking && input.batch_id) {
      allocations = [{ batch_id: input.batch_id, quantity: Math.abs(input.quantity_change) }]
    } else if (tracking && input.batch_number) {
      allocations = [
        {
          batch_id: ensureBatch(session.shopId, input.product_id, input.batch_number, input.expiry_date),
          quantity: Math.abs(input.quantity_change),
        },
      ]
    } else if (tracking && input.quantity_change < 0) {
      allocations = allocateFefo(input.product_id, -input.quantity_change)
    }
    const sign = input.quantity_change < 0 ? -1 : 1
    for (const a of allocations) {
      writeMovement({
        shopId: session.shopId,
        productId: input.product_id,
        changeType: 'adjustment',
        quantityChange: sign * a.quantity,
        reason,
        userId: session.userId,
        batchId: a.batch_id,
      })
    }
    audit(session, 'stock.adjustment', input)
  })()
}

/**
 * Move quantity between two products (pack-size splits / unit corrections).
 * The source product must have enough stock; if it is ever negative we refuse
 * unless the current session is admin (mirrors sales.ts negative-stock rule).
 */
export function transferStock(
  session: Session,
  input: { from_product_id: string; to_product_id: string; quantity: number; note?: string }
): void {
  if (input.from_product_id === input.to_product_id) {
    throw new Error('Source and target products must be different')
  }
  const db = getDb()
  db.transaction(() => {
    const products = db
      .prepare('SELECT id, name FROM products WHERE id IN (?, ?) AND shop_id = ?')
      .all(input.from_product_id, input.to_product_id, session.shopId) as {
      id: string
      name: string
    }[]
    if (products.length !== 2) throw new Error('Both products must exist in this shop')

    const fromStock = getStock(input.from_product_id)
    if (fromStock < input.quantity && session.role !== 'admin') {
      throw new Error(
        `Only ${fromStock} available to transfer from "${products.find((p) => p.id === input.from_product_id)!.name}"`
      )
    }

    const referenceId = uid()
    const reason = input.note
      ? `Transfer to ${products.find((p) => p.id === input.to_product_id)!.name}: ${input.note}`
      : `Transfer to ${products.find((p) => p.id === input.to_product_id)!.name}`
    writeMovement({
      shopId: session.shopId,
      productId: input.from_product_id,
      changeType: 'transfer_out',
      quantityChange: -input.quantity,
      reason,
      referenceId,
      userId: session.userId,
    })
    writeMovement({
      shopId: session.shopId,
      productId: input.to_product_id,
      changeType: 'transfer_in',
      quantityChange: input.quantity,
      reason: `Transfer from ${products.find((p) => p.id === input.from_product_id)!.name}${
        input.note ? `: ${input.note}` : ''
      }`,
      referenceId,
      userId: session.userId,
    })
    audit(session, 'stock.transfer', input)
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
