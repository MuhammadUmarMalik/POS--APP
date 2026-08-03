import { getDb } from '../db'
import { uid, now, AppError, audit, getStock, writeMovement, nextInvoiceNumber } from './helpers'
import { getReturn, writeReturnItems } from './sales'
import { allocateReturn, batchTrackingEnabled, ensureBatch } from './batches'
import type {
  Paged, Purchase, PurchaseItem, PurchaseOrder, PurchaseOrderItem, Payment,
  ReturnReceipt, Session,
} from '../../src/shared/types'
import type {
  PurchaseInput, PurchaseOrderInput, PurchaseReturnInput, ReceivePurchaseOrderInput,
} from '../../src/shared/schemas'

export function createPurchase(session: Session, input: PurchaseInput): Purchase {
  const db = getDb()
  const ts = now()

  const purchaseId = db.transaction(() => {
    const supplier = db
      .prepare('SELECT id FROM suppliers WHERE id = ? AND shop_id = ?')
      .get(input.supplier_id, session.shopId) as { id: string } | undefined
    if (!supplier) throw new AppError('Supplier not found')

    // Received batches are only recorded while the shop has tracking on.
    const tracking = batchTrackingEnabled(session.shopId)
    let total = 0
    const lines: {
      id: string; product_id: string; product_name: string; quantity: number
      cost_price: number; total: number
      batch_number: string | null; expiry_date: string | null
    }[] = []
    for (const item of input.items) {
      const p = db
        .prepare('SELECT id, name, is_deleted FROM products WHERE id = ? AND shop_id = ?')
        .get(item.product_id, session.shopId) as { id: string; name: string; is_deleted: number } | undefined
      if (!p || p.is_deleted) throw new AppError('Product not found')
      const lineTotal = item.cost_price * item.quantity
      total += lineTotal
      lines.push({
        id: uid(),
        product_id: p.id,
        product_name: p.name,
        quantity: item.quantity,
        cost_price: item.cost_price,
        total: lineTotal,
        batch_number: tracking ? item.batch_number?.trim() || null : null,
        expiry_date: tracking ? item.expiry_date?.trim() || null : null,
      })
    }
    if (input.paid_amount > total) throw new AppError('Paid amount exceeds purchase total')

    const id = uid()
    const invoice = nextInvoiceNumber(session.shopId, 'purchase')
    db.prepare(
      `INSERT INTO purchases (id, shop_id, supplier_id, invoice_number, total, paid_amount, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`
    ).run(id, session.shopId, input.supplier_id, invoice, total, input.paid_amount, session.userId, ts, ts)

    const insertItem = db.prepare(
      `INSERT INTO purchase_items (id, purchase_id, product_id, product_name, quantity, returned_quantity, cost_price, total, batch_number, expiry_date)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
    )
    for (const l of lines) {
      insertItem.run(
        l.id, id, l.product_id, l.product_name, l.quantity, l.cost_price, l.total,
        l.batch_number, l.expiry_date
      )
      // Receiving a batch that does not exist yet creates it; receiving more of
      // an existing one just adds another ledger row against it.
      const batchId = tracking
        ? ensureBatch(session.shopId, l.product_id, l.batch_number, l.expiry_date)
        : null
      writeMovement({
        shopId: session.shopId,
        productId: l.product_id,
        changeType: 'purchase',
        quantityChange: l.quantity,
        referenceId: id,
        userId: session.userId,
        batchId,
      })
      // Keep product cost price current with the latest purchase cost.
      db.prepare(
        "UPDATE products SET cost_price = ?, updated_at = ? WHERE id = ?"
      ).run(l.cost_price, ts, l.product_id)
    }

    if (input.paid_amount > 0) {
      db.prepare(
        `INSERT INTO payments (id, shop_id, reference_type, reference_id, party_type, party_id, amount, method, created_by, created_at)
         VALUES (?, ?, 'purchase', ?, 'supplier', ?, ?, ?, ?, ?)`
      ).run(uid(), session.shopId, id, input.supplier_id, input.paid_amount, input.method, session.userId, ts)
    }
    const due = total - input.paid_amount
    if (due > 0) {
      db.prepare(
        "UPDATE suppliers SET due_balance = due_balance + ?, updated_at = ? WHERE id = ?"
      ).run(due, ts, input.supplier_id)
    }
    audit(session, 'purchase.create', { purchase_id: id, total, paid: input.paid_amount })
    return id
  })()

  return getPurchase(session, purchaseId).purchase
}

export function listPurchases(
  session: Session,
  args: { from?: string; to?: string; search?: string; page?: number; pageSize?: number }
): Paged<Purchase> {
  const where: string[] = ['p.shop_id = ?']
  const params: unknown[] = [session.shopId]
  if (args.from) { where.push('p.created_at >= ?'); params.push(args.from) }
  if (args.to) { where.push('p.created_at <= ?'); params.push(args.to) }
  if (args.search) {
    where.push('(p.invoice_number LIKE ? OR s.name LIKE ?)')
    params.push(`%${args.search}%`, `%${args.search}%`)
  }
  const db = getDb()
  const base = `FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE ${where.join(' AND ')}`
  const { total } = db.prepare(`SELECT COUNT(*) AS total ${base}`).get(...params) as { total: number }
  const page = args.page ?? 1
  const pageSize = args.pageSize ?? 25
  const rows = db
    .prepare(`SELECT p.*, s.name AS supplier_name ${base} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize) as Purchase[]
  return { rows, total }
}

export function getPurchase(
  session: Session,
  id: string
): { purchase: Purchase; items: PurchaseItem[]; payments: Payment[] } {
  const db = getDb()
  const purchase = db
    .prepare(
      `SELECT p.*, s.name AS supplier_name FROM purchases p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.id = ? AND p.shop_id = ?`
    )
    .get(id, session.shopId) as Purchase | undefined
  if (!purchase) throw new AppError('Purchase not found')
  const items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(id) as PurchaseItem[]
  const payments = db
    .prepare("SELECT * FROM payments WHERE reference_id = ? AND reference_type IN ('purchase','purchase_refund')")
    .all(id) as Payment[]
  return { purchase, items, payments }
}

export function returnPurchase(session: Session, input: PurchaseReturnInput): ReturnReceipt {
  const db = getDb()
  const ts = now()
  const returnTracking = batchTrackingEnabled(session.shopId)

  const returnId = db.transaction(() => {
    const { purchase, items } = getPurchase(session, input.purchase_id)
    if (purchase.status === 'returned') throw new AppError('Purchase is already fully returned')

    const lines: { product_name: string; quantity: number; amount: number }[] = []
    let refund = 0
    for (const ret of input.items) {
      const item = items.find((i) => i.id === ret.purchase_item_id)
      if (!item) throw new AppError('Purchase item not found')
      const returnable = item.quantity - item.returned_quantity
      if (ret.quantity > returnable) {
        throw new AppError(`Only ${returnable} of "${item.product_name}" can be returned`)
      }
      const stock = getStock(item.product_id)
      if (stock < ret.quantity) {
        throw new AppError(
          `Cannot return ${ret.quantity} of "${item.product_name}" — only ${stock} left in stock`
        )
      }
      const lineRefund = item.cost_price * ret.quantity
      refund += lineRefund
      lines.push({ product_name: item.product_name, quantity: ret.quantity, amount: lineRefund })
      db.prepare('UPDATE purchase_items SET returned_quantity = returned_quantity + ? WHERE id = ?').run(
        ret.quantity,
        item.id
      )
      // Send the goods back out of the batches this purchase brought in.
      const allocations = returnTracking
        ? allocateReturn(purchase.id, item.product_id, ret.quantity)
        : [{ batch_id: null, quantity: ret.quantity }]
      for (const a of allocations) {
        writeMovement({
          shopId: session.shopId,
          productId: item.product_id,
          changeType: 'purchase_return',
          quantityChange: -a.quantity,
          reason: input.reason,
          referenceId: purchase.id,
          userId: session.userId,
          batchId: a.batch_id,
        })
      }
    }

    const remaining = db
      .prepare('SELECT SUM(quantity - returned_quantity) AS left FROM purchase_items WHERE purchase_id = ?')
      .get(purchase.id) as { left: number }
    db.prepare(
      "UPDATE purchases SET status = ?, updated_at = ? WHERE id = ?"
    ).run(remaining.left === 0 ? 'returned' : 'partially_returned', ts, purchase.id)

    if (input.refund_method === 'cash') {
      db.prepare(
        `INSERT INTO payments (id, shop_id, reference_type, reference_id, party_type, party_id, amount, method, note, created_by, created_at)
         VALUES (?, ?, 'purchase_refund', ?, 'supplier', ?, ?, 'cash', ?, ?, ?)`
      ).run(uid(), session.shopId, purchase.id, purchase.supplier_id, refund, input.reason, session.userId, ts)
    } else {
      db.prepare(
        "UPDATE suppliers SET due_balance = due_balance - ?, updated_at = ? WHERE id = ?"
      ).run(refund, ts, purchase.supplier_id)
    }
    const id = uid()
    db.prepare(
      `INSERT INTO returns (id, shop_id, kind, reference_id, invoice_number, party_name, refund_amount, refund_method, reason, is_cancellation, created_by, created_at)
       VALUES (?, ?, 'purchase', ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(
      id, session.shopId, purchase.id, purchase.invoice_number, purchase.supplier_name,
      refund, input.refund_method, input.reason, session.userId, ts
    )
    writeReturnItems(id, lines)

    audit(session, 'purchase.return', { purchase_id: purchase.id, refund, reason: input.reason })
    return id
  })()

  return getReturn(session, returnId)
}

// ---- Purchase orders (no stock/due impact until received) ----

export function createPurchaseOrder(session: Session, input: PurchaseOrderInput): PurchaseOrder {
  const db = getDb()
  const ts = now()
  const id = db.transaction(() => {
    const supplier = db
      .prepare('SELECT id FROM suppliers WHERE id = ? AND shop_id = ?')
      .get(input.supplier_id, session.shopId) as { id: string } | undefined
    if (!supplier) throw new AppError('Supplier not found')

    let total = 0
    const lines: { product_id: string; product_name: string; quantity: number; cost_price: number; total: number }[] = []
    for (const item of input.items) {
      const p = db
        .prepare('SELECT id, name, is_deleted FROM products WHERE id = ? AND shop_id = ?')
        .get(item.product_id, session.shopId) as { id: string; name: string; is_deleted: number } | undefined
      if (!p || p.is_deleted) throw new AppError('Product not found')
      const lineTotal = item.cost_price * item.quantity
      total += lineTotal
      lines.push({ product_id: p.id, product_name: p.name, quantity: item.quantity, cost_price: item.cost_price, total: lineTotal })
    }

    const poId = uid()
    const poNumber = nextInvoiceNumber(session.shopId, 'purchase_order')
    db.prepare(
      `INSERT INTO purchase_orders (id, shop_id, supplier_id, po_number, total, status, note, expected_date, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`
    ).run(
      poId, session.shopId, input.supplier_id, poNumber, total,
      input.note?.trim() || null, input.expected_date || null, session.userId, ts, ts
    )

    const ins = db.prepare(
      `INSERT INTO purchase_order_items (id, purchase_order_id, product_id, product_name, quantity, cost_price, total)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    for (const l of lines) ins.run(uid(), poId, l.product_id, l.product_name, l.quantity, l.cost_price, l.total)

    audit(session, 'purchase_order.create', { purchase_order_id: poId, total })
    return poId
  })()
  return getPurchaseOrder(session, id).order
}

export function listPurchaseOrders(
  session: Session,
  args: { status?: string; search?: string; page?: number; pageSize?: number } = {}
): Paged<PurchaseOrder> {
  const where: string[] = ['po.shop_id = ?']
  const params: unknown[] = [session.shopId]
  if (args.status) { where.push('po.status = ?'); params.push(args.status) }
  if (args.search) {
    where.push('(po.po_number LIKE ? OR s.name LIKE ?)')
    params.push(`%${args.search}%`, `%${args.search}%`)
  }
  const db = getDb()
  const base = `FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id WHERE ${where.join(' AND ')}`
  const { total } = db.prepare(`SELECT COUNT(*) AS total ${base}`).get(...params) as { total: number }
  const page = args.page ?? 1
  const pageSize = args.pageSize ?? 25
  const rows = db
    .prepare(`SELECT po.*, s.name AS supplier_name ${base} ORDER BY po.created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize) as PurchaseOrder[]
  return { rows, total }
}

export function getPurchaseOrder(
  session: Session,
  id: string
): { order: PurchaseOrder; items: PurchaseOrderItem[] } {
  const db = getDb()
  const order = db
    .prepare(
      // created_by_name prints as "Authorised by" on the PO sent to the supplier.
      `SELECT po.*, s.name AS supplier_name, u.name AS created_by_name FROM purchase_orders po
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN users u ON u.id = po.created_by
       WHERE po.id = ? AND po.shop_id = ?`
    )
    .get(id, session.shopId) as PurchaseOrder | undefined
  if (!order) throw new AppError('Purchase order not found')
  const items = db
    .prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?')
    .all(id) as PurchaseOrderItem[]
  return { order, items }
}

/** Receiving converts the PO into a real purchase invoice (stock in + supplier due). */
export function receivePurchaseOrder(session: Session, input: ReceivePurchaseOrderInput): Purchase {
  const db = getDb()
  const { order, items } = getPurchaseOrder(session, input.id)
  if (order.status !== 'open') throw new AppError(`Purchase order is already ${order.status}`)

  const byItem = new Map((input.batches ?? []).map((b) => [b.item_id, b]))
  const purchase = createPurchase(session, {
    supplier_id: order.supplier_id,
    paid_amount: input.paid_amount,
    method: input.method,
    items: items.map((i) => ({
      product_id: i.product_id,
      quantity: i.quantity,
      cost_price: i.cost_price,
      batch_number: byItem.get(i.id)?.batch_number ?? null,
      expiry_date: byItem.get(i.id)?.expiry_date ?? null,
    })),
  })
  db.prepare(
    "UPDATE purchase_orders SET status = 'received', purchase_id = ?, updated_at = ? WHERE id = ?"
  ).run(purchase.id, now(), order.id)
  audit(session, 'purchase_order.receive', { purchase_order_id: order.id, purchase_id: purchase.id })
  return purchase
}

export function cancelPurchaseOrder(session: Session, id: string): void {
  const db = getDb()
  const res = db
    .prepare(
      "UPDATE purchase_orders SET status = 'cancelled', updated_at = ? WHERE id = ? AND shop_id = ? AND status = 'open'"
    )
    .run(now(), id, session.shopId)
  if (res.changes === 0) throw new AppError('Only open purchase orders can be cancelled')
  audit(session, 'purchase_order.cancel', { purchase_order_id: id })
}
