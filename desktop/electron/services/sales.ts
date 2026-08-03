import { getDb } from '../db'
import { uid, now, AppError, audit, getStock, writeMovement, nextInvoiceNumber } from './helpers'
import { allocateFefo, allocateReturn, batchTrackingEnabled } from './batches'
import { costFiltered } from './permissions'
import type {
  HeldSale, Paged, ReturnItem, ReturnReceipt, ReturnRecord, Sale, SaleItem, Payment, Session,
} from '../../src/shared/types'
import type { CheckoutInput, HoldSaleInput, SaleReturnInput } from '../../src/shared/schemas'

interface ProductRow {
  id: string
  name: string
  sale_price: number
  cost_price: number
  tax_percent: number
  is_deleted: number
}

/** The sale this basket key already rang up in this shop, if any. */
function saleIdForKey(shopId: string, key: string | null | undefined): string | null {
  if (!key) return null
  const row = getDb()
    .prepare('SELECT id FROM sales WHERE shop_id = ? AND idempotency_key = ?')
    .get(shopId, key) as { id: string } | undefined
  return row?.id ?? null
}

export function checkout(session: Session, input: CheckoutInput): Sale {
  const db = getDb()
  const ts = now()

  const result = db.transaction(() => {
    // Duplicate submission guard. The till stamps one key per basket, so a
    // double-clicked Pay button, a held keystroke, or a retry after a slow reply
    // arrives here as the same key and gets back the sale that already exists
    // rather than a second one. The lookup is inside the transaction, and the
    // UNIQUE index on (shop_id, idempotency_key) is the real enforcement — a
    // check-then-insert on its own would still leave a window.
    const replayed = saleIdForKey(session.shopId, input.idempotency_key)
    if (replayed) return replayed

    // Server-side pricing: never trust client prices, only quantities and discounts.
    let subtotal = 0
    let itemDiscounts = 0
    let taxTotal = 0
    const lines: Omit<SaleItem, 'sale_id'>[] = []

    for (const item of input.items) {
      const p = db
        .prepare('SELECT id, name, sale_price, cost_price, tax_percent, is_deleted FROM products WHERE id = ? AND shop_id = ?')
        .get(item.product_id, session.shopId) as ProductRow | undefined
      if (!p || p.is_deleted) throw new AppError('Product not found')

      const stock = getStock(p.id)
      if (stock < item.quantity && !(input.allow_negative_stock && session.role === 'admin')) {
        throw new AppError(`Insufficient stock for "${p.name}" (available: ${stock})`)
      }

      const base = p.sale_price * item.quantity
      const discount = Math.min(item.discount, base)
      const tax = Math.round(((base - discount) * p.tax_percent) / 100)
      const total = base - discount + tax

      subtotal += base
      itemDiscounts += discount
      taxTotal += tax
      lines.push({
        id: uid(),
        product_id: p.id,
        product_name: p.name,
        quantity: item.quantity,
        returned_quantity: 0,
        unit_price: p.sale_price,
        cost_price: p.cost_price,
        discount,
        tax,
        total,
      })
    }

    const afterItems = subtotal - itemDiscounts + taxTotal
    const billDiscount = Math.min(input.bill_discount, afterItems)
    const total = afterItems - billDiscount
    const discount = itemDiscounts + billDiscount

    if (input.payment_method === 'cash') {
      if (input.tendered == null || input.tendered < total) {
        throw new AppError('Tendered cash is less than the total')
      }
    }

    let customerId: string | null = null
    if (input.payment_method === 'credit') {
      const c = db
        .prepare('SELECT id, credit_limit, due_balance FROM customers WHERE id = ? AND shop_id = ?')
        .get(input.customer_id, session.shopId) as
        | { id: string; credit_limit: number; due_balance: number }
        | undefined
      if (!c) throw new AppError('Customer not found')
      if (c.credit_limit > 0 && c.due_balance + total > c.credit_limit) {
        throw new AppError('Credit limit exceeded for this customer')
      }
      customerId = c.id
    } else if (input.customer_id) {
      customerId = input.customer_id
    }

    const saleId = uid()
    const invoice = nextInvoiceNumber(session.shopId, 'sale')

    db.prepare(
      `INSERT INTO sales
       (id, shop_id, invoice_number, customer_id, cashier_id, subtotal, discount, tax, total,
        payment_method, tendered, status, idempotency_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`
    ).run(
      saleId,
      session.shopId,
      invoice,
      customerId,
      session.userId,
      subtotal,
      discount,
      taxTotal,
      total,
      input.payment_method,
      input.payment_method === 'cash' ? input.tendered : null,
      input.idempotency_key ?? null,
      ts,
      ts
    )

    const insertItem = db.prepare(
      `INSERT INTO sale_items
       (id, sale_id, product_id, product_name, quantity, returned_quantity, unit_price, cost_price, discount, tax, total)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
    )
    // With batch tracking on, a line is deducted first-expiry-first-out and may
    // therefore write more than one ledger row. Off, it writes exactly one, as
    // it always did.
    const tracking = batchTrackingEnabled(session.shopId)
    for (const l of lines) {
      insertItem.run(
        l.id, saleId, l.product_id, l.product_name, l.quantity,
        l.unit_price, l.cost_price, l.discount, l.tax, l.total
      )
      const allocations = tracking
        ? allocateFefo(l.product_id, l.quantity)
        : [{ batch_id: null, quantity: l.quantity }]
      for (const a of allocations) {
        writeMovement({
          shopId: session.shopId,
          productId: l.product_id,
          changeType: 'sale',
          quantityChange: -a.quantity,
          referenceId: saleId,
          userId: session.userId,
          batchId: a.batch_id,
        })
      }
    }

    if (input.payment_method === 'credit') {
      db.prepare(
        "UPDATE customers SET due_balance = due_balance + ?, updated_at = ? WHERE id = ?"
      ).run(total, ts, customerId)
    } else {
      db.prepare(
        `INSERT INTO payments (id, shop_id, reference_type, reference_id, party_type, party_id, amount, method, created_by, created_at)
         VALUES (?, ?, 'sale', ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        uid(), session.shopId, saleId,
        customerId ? 'customer' : null, customerId,
        total, input.payment_method, session.userId, ts
      )
    }

    return saleId
  })

  let saleId: string
  try {
    saleId = result()
  } catch (e) {
    // The UNIQUE index fired, so the sale exists and this submission is the
    // loser of a race the guard above could not see — another process holding
    // the same database file, or a future writer. Hand back the sale that won
    // rather than an error the cashier cannot act on.
    const won = saleIdForKey(session.shopId, input.idempotency_key)
    if (!won) throw e
    saleId = won
  }

  return getSale(session, saleId).sale
}

export function listSales(
  session: Session,
  args: {
    from?: string
    to?: string
    cashier_id?: string
    status?: string
    search?: string
    page?: number
    pageSize?: number
  }
): Paged<Sale> {
  const where: string[] = ['s.shop_id = ?']
  const params: unknown[] = [session.shopId]
  // Cashiers only ever see their own sales.
  if (session.role === 'cashier') {
    where.push('s.cashier_id = ?')
    params.push(session.userId)
  } else if (args.cashier_id) {
    where.push('s.cashier_id = ?')
    params.push(args.cashier_id)
  }
  if (args.from) {
    where.push('s.created_at >= ?')
    params.push(args.from)
  }
  if (args.to) {
    where.push('s.created_at <= ?')
    params.push(args.to)
  }
  if (args.status) {
    where.push('s.status = ?')
    params.push(args.status)
  }
  if (args.search) {
    where.push('(s.invoice_number LIKE ? OR c.name LIKE ?)')
    params.push(`%${args.search}%`, `%${args.search}%`)
  }
  const db = getDb()
  const base = `FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN users u ON u.id = s.cashier_id
    WHERE ${where.join(' AND ')}`
  const { total } = db.prepare(`SELECT COUNT(*) AS total ${base}`).get(...params) as {
    total: number
  }
  const page = args.page ?? 1
  const pageSize = args.pageSize ?? 25
  const rows = db
    .prepare(
      `SELECT s.*, c.name AS customer_name, u.name AS cashier_name ${base}
       ORDER BY s.created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, (page - 1) * pageSize) as Sale[]
  return { rows, total }
}

export function getSale(
  session: Session,
  id: string
): { sale: Sale; items: SaleItem[]; payments: Payment[] } {
  const db = getDb()
  const sale = db
    .prepare(
      `SELECT s.*, c.name AS customer_name, u.name AS cashier_name
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN users u ON u.id = s.cashier_id
       WHERE s.id = ? AND s.shop_id = ?`
    )
    .get(id, session.shopId) as Sale | undefined
  if (!sale) throw new AppError('Sale not found')
  if (session.role === 'cashier' && sale.cashier_id !== session.userId) {
    throw new AppError('Not allowed')
  }
  // Sale lines carry the cost at the time of sale — the margin on every bill.
  // Cashiers get the same sale without it.
  const items = costFiltered(
    session,
    db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(id) as SaleItem[]
  )
  const payments = db
    .prepare("SELECT * FROM payments WHERE reference_id = ? AND reference_type IN ('sale','sale_refund')")
    .all(id) as Payment[]
  return { sale, items, payments }
}

/**
 * Returns items from a sale and hands back the slip for the counter to print.
 * The line amounts stored with the event are the ones that sum to the refund
 * actually paid out — a bill-level discount is spread back over them — so the
 * printed slip can never disagree with the money that left the drawer.
 */
export function returnSale(
  session: Session,
  input: SaleReturnInput,
  isCancellation = false
): ReturnReceipt {
  const db = getDb()
  const ts = now()

  const trackingOn = batchTrackingEnabled(session.shopId)

  const returnId = db.transaction(() => {
    const { sale, items } = getSale(session, input.sale_id)
    if (sale.status === 'returned') throw new AppError('Sale is already fully returned')

    const itemTotalsSum = items.reduce((a, i) => a + i.total, 0)
    const lines: { product_name: string; quantity: number; amount: number }[] = []
    let refund = 0

    for (const ret of input.items) {
      const item = items.find((i) => i.id === ret.sale_item_id)
      if (!item) throw new AppError('Sale item not found')
      const returnable = item.quantity - item.returned_quantity
      if (ret.quantity > returnable) {
        throw new AppError(`Only ${returnable} of "${item.product_name}" can be returned`)
      }
      const lineRefund = Math.round((item.total * ret.quantity) / item.quantity)
      refund += lineRefund
      lines.push({ product_name: item.product_name, quantity: ret.quantity, amount: lineRefund })

      db.prepare('UPDATE sale_items SET returned_quantity = returned_quantity + ? WHERE id = ?').run(
        ret.quantity,
        item.id
      )
      // Returned stock goes back to the batches this sale actually took it from.
      const allocations = trackingOn
        ? allocateReturn(sale.id, item.product_id, ret.quantity)
        : [{ batch_id: null, quantity: ret.quantity }]
      for (const a of allocations) {
        writeMovement({
          shopId: session.shopId,
          productId: item.product_id,
          changeType: 'sale_return',
          quantityChange: a.quantity,
          reason: input.reason,
          referenceId: sale.id,
          userId: session.userId,
          batchId: a.batch_id,
        })
      }
    }
    if (lines.length === 0) throw new AppError('Nothing to return')

    // Scale refund down by bill-level discount factor (sale.total already excludes it).
    if (itemTotalsSum > 0 && sale.total < itemTotalsSum) {
      const gross = refund
      refund = Math.round((gross * sale.total) / itemTotalsSum)
      for (const l of lines) l.amount = Math.round((l.amount * sale.total) / itemTotalsSum)
      // Per-line rounding cannot be allowed to drift from the refund paid out;
      // the last line absorbs whatever paisa the division left over.
      const drift = refund - lines.reduce((a, l) => a + l.amount, 0)
      if (drift !== 0) lines[lines.length - 1].amount += drift
    }

    const remaining = db
      .prepare(
        'SELECT SUM(quantity - returned_quantity) AS left FROM sale_items WHERE sale_id = ?'
      )
      .get(sale.id) as { left: number }
    const newStatus = remaining.left === 0 ? 'returned' : 'partially_returned'
    db.prepare(
      "UPDATE sales SET status = ?, updated_at = ? WHERE id = ?"
    ).run(newStatus, ts, sale.id)

    if (input.refund_method === 'cash') {
      db.prepare(
        `INSERT INTO payments (id, shop_id, reference_type, reference_id, party_type, party_id, amount, method, note, created_by, created_at)
         VALUES (?, ?, 'sale_refund', ?, ?, ?, ?, 'cash', ?, ?, ?)`
      ).run(
        uid(), session.shopId, sale.id,
        sale.customer_id ? 'customer' : null, sale.customer_id,
        refund, input.reason, session.userId, ts
      )
    } else {
      if (!sale.customer_id) throw new AppError('This sale has no customer — refund in cash instead')
      db.prepare(
        "UPDATE customers SET due_balance = due_balance - ?, updated_at = ? WHERE id = ?"
      ).run(refund, ts, sale.customer_id)
    }

    const id = uid()
    db.prepare(
      `INSERT INTO returns (id, shop_id, kind, reference_id, invoice_number, party_name, refund_amount, refund_method, reason, is_cancellation, created_by, created_at)
       VALUES (?, ?, 'sale', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, session.shopId, sale.id, sale.invoice_number, sale.customer_name,
      refund, input.refund_method, input.reason, isCancellation ? 1 : 0, session.userId, ts
    )
    writeReturnItems(id, lines)

    audit(session, isCancellation ? 'sale.cancel' : 'sale.return', {
      sale_id: sale.id, refund, reason: input.reason, items: input.items,
    })
    return id
  })()

  return getReturn(session, returnId)
}

/** Stores the lines a return event took back. Shared by sale and purchase returns. */
export function writeReturnItems(
  returnId: string,
  lines: { product_name: string; quantity: number; amount: number }[]
): void {
  const ins = getDb().prepare(
    'INSERT INTO return_items (id, return_id, product_name, quantity, amount) VALUES (?, ?, ?, ?, ?)'
  )
  for (const l of lines) ins.run(uid(), returnId, l.product_name, l.quantity, l.amount)
}

/** A single return event with its lines — the source for the printed slip. */
export function getReturn(session: Session, id: string): ReturnReceipt {
  const db = getDb()
  const record = db
    .prepare(
      `SELECT r.*, u.name AS created_by_name FROM returns r
       LEFT JOIN users u ON u.id = r.created_by
       WHERE r.id = ? AND r.shop_id = ?`
    )
    .get(id, session.shopId) as ReturnRecord | undefined
  if (!record) throw new AppError('Return not found')
  const items = db
    .prepare('SELECT * FROM return_items WHERE return_id = ? ORDER BY rowid')
    .all(id) as ReturnItem[]
  return { record, items }
}

/**
 * Cancel Sale = full return of everything still un-returned, in one step.
 * Credit sales roll the amount off the customer's due; paid sales refund cash.
 */
export function cancelSale(session: Session, args: { id: string; reason?: string }): ReturnReceipt {
  const { sale, items } = getSale(session, args.id)
  if (sale.status === 'returned') throw new AppError('Sale is already fully returned')
  const remaining = items
    .filter((i) => i.quantity - i.returned_quantity > 0)
    .map((i) => ({ sale_item_id: i.id, quantity: i.quantity - i.returned_quantity }))
  if (remaining.length === 0) throw new AppError('Nothing left to cancel')
  return returnSale(
    session,
    {
      sale_id: sale.id,
      reason: args.reason?.trim() || 'Sale cancelled',
      refund_method: sale.payment_method === 'credit' ? 'due' : 'cash',
      items: remaining,
    },
    true
  )
}

// ---- Held (draft) sales ----

export function holdSale(session: Session, input: HoldSaleInput): HeldSale {
  const db = getDb()
  const id = uid()
  db.prepare(
    'INSERT INTO held_sales (id, shop_id, cashier_id, label, cart_json, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, session.shopId, session.userId, input.label?.trim() || null, JSON.stringify(input.items), now())
  return db.prepare('SELECT * FROM held_sales WHERE id = ?').get(id) as HeldSale
}

export function listHeldSales(session: Session): HeldSale[] {
  const params: unknown[] = [session.shopId]
  // Cashiers only see their own parked carts; admins see all.
  let sql = `SELECT h.*, u.name AS cashier_name FROM held_sales h
    LEFT JOIN users u ON u.id = h.cashier_id WHERE h.shop_id = ?`
  if (session.role === 'cashier') {
    sql += ' AND h.cashier_id = ?'
    params.push(session.userId)
  }
  sql += ' ORDER BY h.created_at DESC'
  return getDb().prepare(sql).all(...params) as HeldSale[]
}

/** Atomically claim a held sale: returns its cart and removes the row. */
export function resumeHeldSale(session: Session, id: string): HeldSale {
  const db = getDb()
  return db.transaction(() => {
    const row = db
      .prepare('SELECT * FROM held_sales WHERE id = ? AND shop_id = ?')
      .get(id, session.shopId) as HeldSale | undefined
    if (!row) throw new AppError('Held sale not found — it may have been resumed already')
    if (session.role === 'cashier' && row.cashier_id !== session.userId) {
      throw new AppError('Not allowed')
    }
    db.prepare('DELETE FROM held_sales WHERE id = ?').run(id)
    return row
  })()
}

export function deleteHeldSale(session: Session, id: string): void {
  const db = getDb()
  const row = db
    .prepare('SELECT cashier_id FROM held_sales WHERE id = ? AND shop_id = ?')
    .get(id, session.shopId) as { cashier_id: string } | undefined
  if (!row) throw new AppError('Held sale not found')
  if (session.role === 'cashier' && row.cashier_id !== session.userId) {
    throw new AppError('Not allowed')
  }
  db.prepare('DELETE FROM held_sales WHERE id = ?').run(id)
}

// ---- Return history ----

export function listReturns(
  session: Session,
  args: { from?: string; to?: string; kind?: string; page?: number; pageSize?: number } = {}
): Paged<ReturnRecord> {
  const where: string[] = ['r.shop_id = ?']
  const params: unknown[] = [session.shopId]
  if (args.kind) { where.push('r.kind = ?'); params.push(args.kind) }
  if (args.from) { where.push('r.created_at >= ?'); params.push(args.from) }
  if (args.to) { where.push('r.created_at <= ?'); params.push(args.to) }
  const db = getDb()
  const base = `FROM returns r LEFT JOIN users u ON u.id = r.created_by WHERE ${where.join(' AND ')}`
  const { total } = db.prepare(`SELECT COUNT(*) AS total ${base}`).get(...params) as { total: number }
  const page = args.page ?? 1
  const pageSize = args.pageSize ?? 25
  const rows = db
    .prepare(`SELECT r.*, u.name AS created_by_name ${base} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize) as ReturnRecord[]
  return { rows, total }
}
