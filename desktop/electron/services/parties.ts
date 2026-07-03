// Customers & suppliers: CRUD, dues, payments against balance, ledgers.
import { getDb } from '../db'
import { uid, now, AppError, audit } from './helpers'
import type {
  Customer, LedgerEntry, Supplier, Session, Payment, Sale, Purchase,
} from '../../src/shared/types'
import type { CustomerInput, SupplierInput, PartyPaymentInput } from '../../src/shared/schemas'

function runningBalance(rows: Omit<LedgerEntry, 'balance'>[]): LedgerEntry[] {
  rows.sort((a, b) => a.date.localeCompare(b.date))
  let balance = 0
  return rows.map((r) => {
    balance += r.debit - r.credit
    return { ...r, balance }
  })
}

// ---- Customers ----

export function listCustomers(session: Session, args: { search?: string } = {}): Customer[] {
  const params: unknown[] = [session.shopId]
  let sql = 'SELECT * FROM customers WHERE shop_id = ?'
  if (args.search) {
    sql += ' AND (name LIKE ? OR phone LIKE ?)'
    params.push(`%${args.search}%`, `%${args.search}%`)
  }
  sql += ' ORDER BY name COLLATE NOCASE'
  return getDb().prepare(sql).all(...params) as Customer[]
}

export function createCustomer(session: Session, input: CustomerInput): Customer {
  const id = uid()
  const ts = now()
  getDb()
    .prepare(
      `INSERT INTO customers (id, shop_id, name, phone, credit_limit, due_balance, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(id, session.shopId, input.name, input.phone || null, input.credit_limit, ts, ts)
  return getDb().prepare('SELECT * FROM customers WHERE id = ?').get(id) as Customer
}

export function updateCustomer(session: Session, input: CustomerInput & { id: string }): void {
  const res = getDb()
    .prepare(
      `UPDATE customers SET name = ?, phone = ?, credit_limit = ?, updated_at = ?, sync_status = 'pending'
       WHERE id = ? AND shop_id = ?`
    )
    .run(input.name, input.phone || null, input.credit_limit, now(), input.id, session.shopId)
  if (res.changes === 0) throw new AppError('Customer not found')
}

export function customerDetail(session: Session, id: string) {
  const db = getDb()
  const customer = db
    .prepare('SELECT * FROM customers WHERE id = ? AND shop_id = ?')
    .get(id, session.shopId) as Customer | undefined
  if (!customer) throw new AppError('Customer not found')
  const sales = db
    .prepare(
      `SELECT s.*, NULL AS customer_name, u.name AS cashier_name FROM sales s
       LEFT JOIN users u ON u.id = s.cashier_id
       WHERE s.customer_id = ? ORDER BY s.created_at DESC LIMIT 50`
    )
    .all(id) as Sale[]
  const payments = db
    .prepare(
      "SELECT * FROM payments WHERE party_type = 'customer' AND party_id = ? ORDER BY created_at DESC LIMIT 50"
    )
    .all(id) as Payment[]
  return { customer, sales, payments }
}

/**
 * Dues ledger: every event that moved the customer's balance, oldest first,
 * with a running balance. Debit = owes more, credit = owes less.
 */
export function customerLedger(session: Session, id: string): LedgerEntry[] {
  const db = getDb()
  const customer = db
    .prepare('SELECT id FROM customers WHERE id = ? AND shop_id = ?')
    .get(id, session.shopId)
  if (!customer) throw new AppError('Customer not found')

  const entries: Omit<LedgerEntry, 'balance'>[] = []
  const creditSales = db
    .prepare(
      "SELECT created_at, invoice_number, total FROM sales WHERE customer_id = ? AND payment_method = 'credit'"
    )
    .all(id) as { created_at: string; invoice_number: string; total: number }[]
  for (const s of creditSales) {
    entries.push({ date: s.created_at, type: 'Credit sale', description: s.invoice_number, debit: s.total, credit: 0 })
  }
  const pays = db
    .prepare(
      "SELECT created_at, amount, method, note FROM payments WHERE party_type = 'customer' AND party_id = ? AND reference_type = 'customer_payment'"
    )
    .all(id) as { created_at: string; amount: number; method: string; note: string | null }[]
  for (const p of pays) {
    entries.push({
      date: p.created_at, type: 'Payment received',
      description: p.note || p.method, debit: 0, credit: p.amount,
    })
  }
  const dueRefunds = db
    .prepare(
      `SELECT r.created_at, r.invoice_number, r.refund_amount FROM returns r
       JOIN sales s ON s.id = r.reference_id
       WHERE r.kind = 'sale' AND r.refund_method = 'due' AND s.customer_id = ?`
    )
    .all(id) as { created_at: string; invoice_number: string; refund_amount: number }[]
  for (const r of dueRefunds) {
    entries.push({ date: r.created_at, type: 'Return (due reduced)', description: r.invoice_number, debit: 0, credit: r.refund_amount })
  }
  return runningBalance(entries)
}

export function receiveCustomerPayment(session: Session, input: PartyPaymentInput): void {
  const db = getDb()
  const ts = now()
  db.transaction(() => {
    const c = db
      .prepare('SELECT id, due_balance FROM customers WHERE id = ? AND shop_id = ?')
      .get(input.party_id, session.shopId) as { id: string; due_balance: number } | undefined
    if (!c) throw new AppError('Customer not found')
    db.prepare(
      `INSERT INTO payments (id, shop_id, reference_type, party_type, party_id, amount, method, note, created_by, created_at)
       VALUES (?, ?, 'customer_payment', 'customer', ?, ?, ?, ?, ?, ?)`
    ).run(uid(), session.shopId, c.id, input.amount, input.method, input.note ?? null, session.userId, ts)
    db.prepare(
      "UPDATE customers SET due_balance = due_balance - ?, updated_at = ?, sync_status = 'pending' WHERE id = ?"
    ).run(input.amount, ts, c.id)
    audit(session, 'customer.payment', { customer_id: c.id, amount: input.amount })
  })()
}

// ---- Suppliers ----

export function listSuppliers(session: Session, args: { search?: string } = {}): Supplier[] {
  const params: unknown[] = [session.shopId]
  let sql = 'SELECT * FROM suppliers WHERE shop_id = ?'
  if (args.search) {
    sql += ' AND (name LIKE ? OR phone LIKE ?)'
    params.push(`%${args.search}%`, `%${args.search}%`)
  }
  sql += ' ORDER BY name COLLATE NOCASE'
  return getDb().prepare(sql).all(...params) as Supplier[]
}

export function createSupplier(session: Session, input: SupplierInput): Supplier {
  const id = uid()
  const ts = now()
  getDb()
    .prepare(
      `INSERT INTO suppliers (id, shop_id, name, phone, due_balance, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`
    )
    .run(id, session.shopId, input.name, input.phone || null, ts, ts)
  return getDb().prepare('SELECT * FROM suppliers WHERE id = ?').get(id) as Supplier
}

export function updateSupplier(session: Session, input: SupplierInput & { id: string }): void {
  const res = getDb()
    .prepare(
      `UPDATE suppliers SET name = ?, phone = ?, updated_at = ?, sync_status = 'pending'
       WHERE id = ? AND shop_id = ?`
    )
    .run(input.name, input.phone || null, now(), input.id, session.shopId)
  if (res.changes === 0) throw new AppError('Supplier not found')
}

export function supplierDetail(session: Session, id: string) {
  const db = getDb()
  const supplier = db
    .prepare('SELECT * FROM suppliers WHERE id = ? AND shop_id = ?')
    .get(id, session.shopId) as Supplier | undefined
  if (!supplier) throw new AppError('Supplier not found')
  const purchases = db
    .prepare(
      'SELECT p.*, NULL AS supplier_name FROM purchases p WHERE p.supplier_id = ? ORDER BY p.created_at DESC LIMIT 50'
    )
    .all(id) as Purchase[]
  const payments = db
    .prepare(
      "SELECT * FROM payments WHERE party_type = 'supplier' AND party_id = ? ORDER BY created_at DESC LIMIT 50"
    )
    .all(id) as Payment[]
  return { supplier, purchases, payments }
}

/** Supplier dues ledger. Debit = we owe more, credit = we owe less. */
export function supplierLedger(session: Session, id: string): LedgerEntry[] {
  const db = getDb()
  const supplier = db
    .prepare('SELECT id FROM suppliers WHERE id = ? AND shop_id = ?')
    .get(id, session.shopId)
  if (!supplier) throw new AppError('Supplier not found')

  const entries: Omit<LedgerEntry, 'balance'>[] = []
  const purchases = db
    .prepare('SELECT created_at, invoice_number, total FROM purchases WHERE supplier_id = ?')
    .all(id) as { created_at: string; invoice_number: string; total: number }[]
  for (const p of purchases) {
    entries.push({ date: p.created_at, type: 'Purchase', description: p.invoice_number, debit: p.total, credit: 0 })
  }
  const pays = db
    .prepare(
      `SELECT created_at, amount, method, note, reference_type FROM payments
       WHERE party_type = 'supplier' AND party_id = ? AND reference_type IN ('purchase','supplier_payment')`
    )
    .all(id) as { created_at: string; amount: number; method: string; note: string | null; reference_type: string }[]
  for (const p of pays) {
    entries.push({
      date: p.created_at,
      type: p.reference_type === 'purchase' ? 'Paid on purchase' : 'Payment made',
      description: p.note || p.method,
      debit: 0,
      credit: p.amount,
    })
  }
  const dueRefunds = db
    .prepare(
      `SELECT r.created_at, r.invoice_number, r.refund_amount FROM returns r
       JOIN purchases p ON p.id = r.reference_id
       WHERE r.kind = 'purchase' AND r.refund_method = 'due' AND p.supplier_id = ?`
    )
    .all(id) as { created_at: string; invoice_number: string; refund_amount: number }[]
  for (const r of dueRefunds) {
    entries.push({ date: r.created_at, type: 'Return (due reduced)', description: r.invoice_number, debit: 0, credit: r.refund_amount })
  }
  return runningBalance(entries)
}

export function paySupplier(session: Session, input: PartyPaymentInput): void {
  const db = getDb()
  const ts = now()
  db.transaction(() => {
    const s = db
      .prepare('SELECT id FROM suppliers WHERE id = ? AND shop_id = ?')
      .get(input.party_id, session.shopId) as { id: string } | undefined
    if (!s) throw new AppError('Supplier not found')
    db.prepare(
      `INSERT INTO payments (id, shop_id, reference_type, party_type, party_id, amount, method, note, created_by, created_at)
       VALUES (?, ?, 'supplier_payment', 'supplier', ?, ?, ?, ?, ?, ?)`
    ).run(uid(), session.shopId, s.id, input.amount, input.method, input.note ?? null, session.userId, ts)
    db.prepare(
      "UPDATE suppliers SET due_balance = due_balance - ?, updated_at = ?, sync_status = 'pending' WHERE id = ?"
    ).run(input.amount, ts, s.id)
    audit(session, 'supplier.payment', { supplier_id: s.id, amount: input.amount })
  })()
}
