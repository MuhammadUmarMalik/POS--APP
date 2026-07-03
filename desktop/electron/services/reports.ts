import { getDb } from '../db'
import { expenseTotal } from './expenses'
import type { Session } from '../../src/shared/types'

export interface DateRange {
  from: string // ISO
  to: string // ISO
}

export function salesReport(session: Session, range: DateRange) {
  const db = getDb()
  const cashierFilter = session.role === 'cashier' ? 'AND s.cashier_id = ?' : ''
  const params: unknown[] = [session.shopId, range.from, range.to]
  if (session.role === 'cashier') params.push(session.userId)

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(s.total),0) AS total,
              COALESCE(SUM(s.discount),0) AS discount, COALESCE(SUM(s.tax),0) AS tax
       FROM sales s WHERE s.shop_id = ? AND s.created_at >= ? AND s.created_at <= ? ${cashierFilter}`
    )
    .get(...params) as { count: number; total: number; discount: number; tax: number }

  const byMethod = db
    .prepare(
      `SELECT s.payment_method AS method, COUNT(*) AS count, COALESCE(SUM(s.total),0) AS total
       FROM sales s WHERE s.shop_id = ? AND s.created_at >= ? AND s.created_at <= ? ${cashierFilter}
       GROUP BY s.payment_method`
    )
    .all(...params) as { method: string; count: number; total: number }[]

  const byCashier = db
    .prepare(
      `SELECT u.name AS cashier, COUNT(*) AS count, COALESCE(SUM(s.total),0) AS total
       FROM sales s JOIN users u ON u.id = s.cashier_id
       WHERE s.shop_id = ? AND s.created_at >= ? AND s.created_at <= ? ${cashierFilter}
       GROUP BY s.cashier_id ORDER BY total DESC`
    )
    .all(...params) as { cashier: string; count: number; total: number }[]

  // All sale refunds — cash AND those knocked off customer dues (returns table has both;
  // the payments table only sees cash refunds).
  const refunds = db
    .prepare(
      `SELECT COALESCE(SUM(refund_amount),0) AS total FROM returns
       WHERE shop_id = ? AND kind = 'sale' AND created_at >= ? AND created_at <= ?`
    )
    .get(session.shopId, range.from, range.to) as { total: number }

  return { totals, byMethod, byCashier, refunds: refunds.total }
}

export function profitLoss(session: Session, range: DateRange) {
  const db = getDb()
  const revenue = db
    .prepare(
      `SELECT COALESCE(SUM(total),0) AS v FROM sales
       WHERE shop_id = ? AND created_at >= ? AND created_at <= ?`
    )
    .get(session.shopId, range.from, range.to) as { v: number }
  // Cash refunds + refunds credited against customer dues.
  const refunds = db
    .prepare(
      `SELECT COALESCE(SUM(refund_amount),0) AS v FROM returns
       WHERE shop_id = ? AND kind = 'sale' AND created_at >= ? AND created_at <= ?`
    )
    .get(session.shopId, range.from, range.to) as { v: number }
  const cogs = db
    .prepare(
      `SELECT COALESCE(SUM(si.cost_price * (si.quantity - si.returned_quantity)),0) AS v
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE s.shop_id = ? AND s.created_at >= ? AND s.created_at <= ?`
    )
    .get(session.shopId, range.from, range.to) as { v: number }
  const discounts = db
    .prepare(
      `SELECT COALESCE(SUM(discount),0) AS v FROM sales
       WHERE shop_id = ? AND created_at >= ? AND created_at <= ?`
    )
    .get(session.shopId, range.from, range.to) as { v: number }

  const netRevenue = revenue.v - refunds.v
  const grossProfit = netRevenue - cogs.v
  const expenses = expenseTotal(session, range)
  return {
    revenue: revenue.v,
    refunds: refunds.v,
    netRevenue,
    cogs: cogs.v,
    discounts: discounts.v,
    grossProfit,
    expenses,
    netProfit: grossProfit - expenses,
  }
}

export function duesReport(session: Session) {
  const db = getDb()
  const customers = db
    .prepare(
      'SELECT id, name, phone, due_balance, credit_limit FROM customers WHERE shop_id = ? AND due_balance != 0 ORDER BY due_balance DESC'
    )
    .all(session.shopId)
  const suppliers = db
    .prepare(
      'SELECT id, name, phone, due_balance FROM suppliers WHERE shop_id = ? AND due_balance != 0 ORDER BY due_balance DESC'
    )
    .all(session.shopId)
  return { customers, suppliers }
}

/** Revenue − COGS for a range (profit before expenses). Cashiers never see this. */
function grossProfitFor(session: Session, range: DateRange): number {
  const db = getDb()
  const revenue = db
    .prepare('SELECT COALESCE(SUM(total),0) AS v FROM sales WHERE shop_id = ? AND created_at >= ? AND created_at <= ?')
    .get(session.shopId, range.from, range.to) as { v: number }
  const refunds = db
    .prepare(
      "SELECT COALESCE(SUM(refund_amount),0) AS v FROM returns WHERE shop_id = ? AND kind = 'sale' AND created_at >= ? AND created_at <= ?"
    )
    .get(session.shopId, range.from, range.to) as { v: number }
  const cogs = db
    .prepare(
      `SELECT COALESCE(SUM(si.cost_price * (si.quantity - si.returned_quantity)),0) AS v
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE s.shop_id = ? AND s.created_at >= ? AND s.created_at <= ?`
    )
    .get(session.shopId, range.from, range.to) as { v: number }
  return revenue.v - refunds.v - cogs.v
}

/** Last 7 local days of sales (zero-filled), cashier-scoped for cashiers. */
function weekSeries(session: Session): { day: string; total: number; count: number }[] {
  const db = getDb()
  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - 6)
  weekStart.setHours(0, 0, 0, 0)
  const weekEnd = new Date()
  weekEnd.setHours(23, 59, 59, 999)

  const cashierFilter = session.role === 'cashier' ? 'AND s.cashier_id = ?' : ''
  const params: unknown[] = [session.shopId, weekStart.toISOString(), weekEnd.toISOString()]
  if (session.role === 'cashier') params.push(session.userId)

  const rows = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', s.created_at, 'localtime') AS day,
              COUNT(*) AS count, COALESCE(SUM(s.total),0) AS total
       FROM sales s
       WHERE s.shop_id = ? AND s.created_at >= ? AND s.created_at <= ? ${cashierFilter}
       GROUP BY day`
    )
    .all(...params) as { day: string; count: number; total: number }[]

  const byDay = new Map(rows.map((r) => [r.day, r]))
  const series: { day: string; total: number; count: number }[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart)
    d.setDate(weekStart.getDate() + i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const row = byDay.get(key)
    series.push({ day: key, total: row?.total ?? 0, count: row?.count ?? 0 })
  }
  return series
}

export function dashboard(session: Session) {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const range = { from: start.toISOString(), to: end.toISOString() }

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const monthRange = { from: monthStart.toISOString(), to: end.toISOString() }

  const sales = salesReport(session, range)
  const monthSales = salesReport(session, monthRange)

  // Profit numbers are admin-only — cashiers get nulls.
  const isAdmin = session.role === 'admin'
  const todayProfit = isAdmin ? grossProfitFor(session, range) : null
  const monthProfit = isAdmin
    ? grossProfitFor(session, monthRange) - expenseTotal(session, monthRange)
    : null

  const db = getDb()
  const lowStock = db
    .prepare(
      `SELECT p.id, p.name, p.min_stock_alert, COALESCE(s.stock,0) AS stock
       FROM products p
       LEFT JOIN (SELECT product_id, SUM(quantity_change) AS stock FROM inventory_logs GROUP BY product_id) s
         ON s.product_id = p.id
       WHERE p.shop_id = ? AND p.is_deleted = 0 AND COALESCE(s.stock,0) <= p.min_stock_alert
       ORDER BY stock ASC LIMIT 10`
    )
    .all(session.shopId) as { id: string; name: string; min_stock_alert: number; stock: number }[]

  const dues = db
    .prepare(
      `SELECT
        (SELECT COALESCE(SUM(due_balance),0) FROM customers WHERE shop_id = ? AND due_balance > 0) AS customer_dues,
        (SELECT COALESCE(SUM(due_balance),0) FROM suppliers WHERE shop_id = ? AND due_balance > 0) AS supplier_dues`
    )
    .get(session.shopId, session.shopId) as { customer_dues: number; supplier_dues: number }

  const recentParams: unknown[] =
    session.role === 'cashier' ? [session.shopId, session.userId] : [session.shopId]
  const recent = db
    .prepare(
      `SELECT s.id, s.invoice_number, s.total, s.payment_method, s.status, s.created_at, c.name AS customer_name
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.shop_id = ? ${session.role === 'cashier' ? 'AND s.cashier_id = ?' : ''}
       ORDER BY s.created_at DESC LIMIT 8`
    )
    .all(...recentParams)

  return {
    sales,
    month: { total: monthSales.totals.total, count: monthSales.totals.count },
    todayProfit,
    monthProfit,
    week: weekSeries(session),
    lowStock,
    dues,
    recent,
  }
}

/** Sales grouped per local day or month: Daily Sales / Monthly Sales reports.
 * Revenue and COGS are both gross of returns (returns live in the Returns report),
 * so per-bucket profit compares like with like. */
export function salesSeries(session: Session, args: DateRange & { group: 'day' | 'month' }) {
  const db = getDb()
  const fmt = args.group === 'month' ? '%Y-%m' : '%Y-%m-%d'
  const rows = db
    .prepare(
      `SELECT strftime('${fmt}', s.created_at, 'localtime') AS bucket,
              COUNT(*) AS count,
              COALESCE(SUM(s.total),0) AS total,
              COALESCE(SUM(s.discount),0) AS discount,
              COALESCE(SUM(s.tax),0) AS tax,
              COALESCE(SUM(c.cogs),0) AS cogs
       FROM sales s
       LEFT JOIN (SELECT sale_id, SUM(cost_price * quantity) AS cogs
                  FROM sale_items GROUP BY sale_id) c ON c.sale_id = s.id
       WHERE s.shop_id = ? AND s.created_at >= ? AND s.created_at <= ?
       GROUP BY bucket ORDER BY bucket DESC`
    )
    .all(session.shopId, args.from, args.to) as {
    bucket: string; count: number; total: number; discount: number; tax: number; cogs: number
  }[]
  const withProfit = rows.map((r) => ({ ...r, profit: r.total - r.cogs }))
  const totals = withProfit.reduce(
    (a, r) => ({
      count: a.count + r.count,
      total: a.total + r.total,
      discount: a.discount + r.discount,
      tax: a.tax + r.tax,
      profit: a.profit + r.profit,
    }),
    { count: 0, total: 0, discount: 0, tax: 0, profit: 0 }
  )
  return { rows: withProfit, totals }
}

/** Per-product sales for a range: Product-wise Sales + Best Selling Products. */
export function productSales(session: Session, range: DateRange) {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT si.product_id AS id,
              COALESCE(p.name, si.product_name) AS name,
              cat.name AS category,
              SUM(si.quantity) AS qty,
              SUM(si.returned_quantity) AS returned,
              COALESCE(SUM(si.total),0) AS revenue,
              COALESCE(SUM(si.cost_price * si.quantity),0) AS cogs
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       LEFT JOIN products p ON p.id = si.product_id
       LEFT JOIN categories cat ON cat.id = p.category_id
       WHERE s.shop_id = ? AND s.created_at >= ? AND s.created_at <= ?
       GROUP BY si.product_id
       ORDER BY revenue DESC`
    )
    .all(session.shopId, range.from, range.to) as {
    id: string; name: string; category: string | null
    qty: number; returned: number; revenue: number; cogs: number
  }[]
  return rows.map((r) => ({ ...r, profit: r.revenue - r.cogs }))
}

/** Sales grouped by product category for a range. */
export function categorySales(session: Session, range: DateRange) {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT COALESCE(cat.name, 'Uncategorised') AS category,
              COUNT(DISTINCT si.product_id) AS products,
              SUM(si.quantity) AS qty,
              COALESCE(SUM(si.total),0) AS revenue,
              COALESCE(SUM(si.cost_price * si.quantity),0) AS cogs
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       LEFT JOIN products p ON p.id = si.product_id
       LEFT JOIN categories cat ON cat.id = p.category_id
       WHERE s.shop_id = ? AND s.created_at >= ? AND s.created_at <= ?
       GROUP BY cat.id
       ORDER BY revenue DESC`
    )
    .all(session.shopId, range.from, range.to) as {
    category: string; products: number; qty: number; revenue: number; cogs: number
  }[]
  return rows.map((r) => ({ ...r, profit: r.revenue - r.cogs }))
}

/** Slow Moving Products: active products with the fewest units sold in range. */
export function slowMovers(session: Session, range: DateRange) {
  const db = getDb()
  return db
    .prepare(
      `SELECT p.id, p.name, c.name AS category,
              COALESCE(st.stock, 0) AS stock,
              COALESCE(st.stock, 0) * p.cost_price AS stock_value,
              COALESCE(sr.qty, 0) AS qty_sold,
              ls.last_sold AS last_sold_at
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN (SELECT product_id, SUM(quantity_change) AS stock
                  FROM inventory_logs GROUP BY product_id) st ON st.product_id = p.id
       LEFT JOIN (SELECT si.product_id, SUM(si.quantity) AS qty
                  FROM sale_items si JOIN sales s ON s.id = si.sale_id
                  WHERE s.shop_id = ? AND s.created_at >= ? AND s.created_at <= ?
                  GROUP BY si.product_id) sr ON sr.product_id = p.id
       LEFT JOIN (SELECT si.product_id, MAX(s.created_at) AS last_sold
                  FROM sale_items si JOIN sales s ON s.id = si.sale_id
                  WHERE s.shop_id = ?
                  GROUP BY si.product_id) ls ON ls.product_id = p.id
       WHERE p.shop_id = ? AND p.is_deleted = 0
       ORDER BY qty_sold ASC, stock_value DESC
       LIMIT 100`
    )
    .all(session.shopId, range.from, range.to, session.shopId, session.shopId) as {
    id: string; name: string; category: string | null
    stock: number; stock_value: number; qty_sold: number; last_sold_at: string | null
  }[]
}

/** Purchase Report: totals + per-supplier breakdown for a range. */
export function purchaseReport(session: Session, range: DateRange) {
  const db = getDb()
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total, COALESCE(SUM(paid_amount),0) AS paid
       FROM purchases WHERE shop_id = ? AND created_at >= ? AND created_at <= ?`
    )
    .get(session.shopId, range.from, range.to) as { count: number; total: number; paid: number }
  const bySupplier = db
    .prepare(
      `SELECT su.name AS supplier, COUNT(*) AS count,
              COALESCE(SUM(p.total),0) AS total, COALESCE(SUM(p.paid_amount),0) AS paid
       FROM purchases p JOIN suppliers su ON su.id = p.supplier_id
       WHERE p.shop_id = ? AND p.created_at >= ? AND p.created_at <= ?
       GROUP BY p.supplier_id ORDER BY total DESC`
    )
    .all(session.shopId, range.from, range.to) as {
    supplier: string; count: number; total: number; paid: number
  }[]
  const returns = db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(refund_amount),0) AS total FROM returns
       WHERE shop_id = ? AND kind = 'purchase' AND created_at >= ? AND created_at <= ?`
    )
    .get(session.shopId, range.from, range.to) as { count: number; total: number }
  return { totals: { ...totals, due: totals.total - totals.paid }, bySupplier, returns }
}

/** Sale + purchase returns for a range: Sales Return / Purchase Return reports. */
export function returnsReport(session: Session, range: DateRange) {
  const db = getDb()
  const totals = db
    .prepare(
      `SELECT kind, COUNT(*) AS count, COALESCE(SUM(refund_amount),0) AS total
       FROM returns WHERE shop_id = ? AND created_at >= ? AND created_at <= ?
       GROUP BY kind`
    )
    .all(session.shopId, range.from, range.to) as { kind: 'sale' | 'purchase'; count: number; total: number }[]
  const rows = db
    .prepare(
      `SELECT r.id, r.kind, r.invoice_number, r.party_name, r.refund_amount, r.refund_method,
              r.reason, r.is_cancellation, r.created_at, u.name AS created_by_name
       FROM returns r LEFT JOIN users u ON u.id = r.created_by
       WHERE r.shop_id = ? AND r.created_at >= ? AND r.created_at <= ?
       ORDER BY r.created_at DESC LIMIT 500`
    )
    .all(session.shopId, range.from, range.to) as {
    id: string; kind: 'sale' | 'purchase'; invoice_number: string; party_name: string | null
    refund_amount: number; refund_method: string; reason: string | null
    is_cancellation: number; created_at: string; created_by_name: string | null
  }[]
  const empty = { count: 0, total: 0 }
  return {
    sale: totals.find((t) => t.kind === 'sale') ?? { kind: 'sale', ...empty },
    purchase: totals.find((t) => t.kind === 'purchase') ?? { kind: 'purchase', ...empty },
    rows,
  }
}

/** Payment Method Report: how money moved, split by method and direction. */
export function paymentMethodReport(session: Session, range: DateRange) {
  const db = getDb()
  // Sales by tender (includes credit sales, which create dues instead of payments).
  const sales = db
    .prepare(
      `SELECT payment_method AS method, COUNT(*) AS count, COALESCE(SUM(total),0) AS total
       FROM sales WHERE shop_id = ? AND created_at >= ? AND created_at <= ?
       GROUP BY payment_method ORDER BY total DESC`
    )
    .all(session.shopId, range.from, range.to) as { method: string; count: number; total: number }[]
  // Actual money movements from the payments ledger.
  const flows = db
    .prepare(
      `SELECT reference_type, method, COUNT(*) AS count, COALESCE(SUM(amount),0) AS total
       FROM payments WHERE shop_id = ? AND created_at >= ? AND created_at <= ?
       GROUP BY reference_type, method
       ORDER BY reference_type, method`
    )
    .all(session.shopId, range.from, range.to) as {
    reference_type: string; method: 'cash' | 'card'; count: number; total: number
  }[]
  const IN = new Set(['sale', 'customer_payment', 'purchase_refund'])
  return {
    sales,
    flows: flows.map((f) => ({ ...f, direction: IN.has(f.reference_type) ? 'in' : 'out' })),
  }
}

/** Cash Flow Summary: money in vs money out for a range (payments ledger + expenses). */
export function cashFlow(session: Session, range: DateRange) {
  const db = getDb()
  const byType = db
    .prepare(
      `SELECT reference_type, method, COALESCE(SUM(amount),0) AS total
       FROM payments WHERE shop_id = ? AND created_at >= ? AND created_at <= ?
       GROUP BY reference_type, method`
    )
    .all(session.shopId, range.from, range.to) as {
    reference_type: string; method: 'cash' | 'card'; total: number
  }[]
  const sum = (type: string, method?: 'cash' | 'card') =>
    byType
      .filter((r) => r.reference_type === type && (!method || r.method === method))
      .reduce((a, r) => a + r.total, 0)

  const expenses = expenseTotal(session, range)
  const inflows = {
    sales: sum('sale'),
    customerPayments: sum('customer_payment'),
    purchaseRefunds: sum('purchase_refund'),
    total: 0,
  }
  inflows.total = inflows.sales + inflows.customerPayments + inflows.purchaseRefunds
  const outflows = {
    purchases: sum('purchase'),
    supplierPayments: sum('supplier_payment'),
    saleRefunds: sum('sale_refund'),
    expenses,
    total: 0,
  }
  outflows.total = outflows.purchases + outflows.supplierPayments + outflows.saleRefunds + expenses

  const IN = ['sale', 'customer_payment', 'purchase_refund']
  const OUT = ['purchase', 'supplier_payment', 'sale_refund']
  const methodNet = (method: 'cash' | 'card') => {
    const mIn = IN.reduce((a, t) => a + sum(t, method), 0)
    const mOut = OUT.reduce((a, t) => a + sum(t, method), 0)
    return { in: mIn, out: mOut, net: mIn - mOut }
  }

  return {
    inflows,
    outflows,
    net: inflows.total - outflows.total,
    byMethod: { cash: methodNet('cash'), card: methodNet('card') },
  }
}

/** Customer report: activity + dues per customer for a range. */
export function customerReport(session: Session, range: DateRange) {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.phone, c.due_balance,
              COUNT(s.id) AS sale_count, COALESCE(SUM(s.total),0) AS sale_total
       FROM customers c
       LEFT JOIN sales s ON s.customer_id = c.id AND s.created_at >= ? AND s.created_at <= ?
       WHERE c.shop_id = ?
       GROUP BY c.id ORDER BY sale_total DESC, c.name COLLATE NOCASE`
    )
    .all(range.from, range.to, session.shopId) as {
    id: string; name: string; phone: string | null; due_balance: number; sale_count: number; sale_total: number
  }[]
  const totals = {
    customers: rows.length,
    sale_total: rows.reduce((a, r) => a + r.sale_total, 0),
    due_total: rows.reduce((a, r) => a + Math.max(0, r.due_balance), 0),
  }
  return { rows, totals }
}

// ---- Day Book ----

export interface DayBookRow {
  at: string
  type: string
  ref: string
  party: string | null
  amount: number
  /** Actual cash/card that moved with this entry. Positive = in, negative = out, 0 = on credit. */
  cash_effect: number
  method: string | null
  user: string | null
}

/**
 * Day Book: every transaction in the range in one chronological register —
 * sales, purchases, returns, due payments and expenses — with its cash effect.
 */
export function dayBook(session: Session, range: DateRange) {
  const db = getDb()
  const rows: DayBookRow[] = []

  const sales = db
    .prepare(
      `SELECT s.created_at, s.invoice_number, s.total, s.payment_method, c.name AS party, u.name AS user
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN users u ON u.id = s.cashier_id
       WHERE s.shop_id = ? AND s.created_at >= ? AND s.created_at <= ?`
    )
    .all(session.shopId, range.from, range.to) as {
    created_at: string; invoice_number: string; total: number; payment_method: string
    party: string | null; user: string | null
  }[]
  for (const s of sales) {
    rows.push({
      at: s.created_at, type: s.payment_method === 'credit' ? 'Sale (on credit)' : 'Sale',
      ref: s.invoice_number, party: s.party, amount: s.total,
      cash_effect: s.payment_method === 'credit' ? 0 : s.total,
      method: s.payment_method === 'credit' ? null : s.payment_method, user: s.user,
    })
  }

  const purchases = db
    .prepare(
      `SELECT p.created_at, p.invoice_number, p.total, p.paid_amount, su.name AS party, u.name AS user
       FROM purchases p JOIN suppliers su ON su.id = p.supplier_id LEFT JOIN users u ON u.id = p.created_by
       WHERE p.shop_id = ? AND p.created_at >= ? AND p.created_at <= ?`
    )
    .all(session.shopId, range.from, range.to) as {
    created_at: string; invoice_number: string; total: number; paid_amount: number
    party: string; user: string | null
  }[]
  for (const p of purchases) {
    rows.push({
      at: p.created_at, type: p.paid_amount >= p.total ? 'Purchase' : p.paid_amount > 0 ? 'Purchase (part paid)' : 'Purchase (on credit)',
      ref: p.invoice_number, party: p.party, amount: p.total,
      cash_effect: -p.paid_amount, method: null, user: p.user,
    })
  }

  const returns = db
    .prepare(
      `SELECT r.created_at, r.kind, r.invoice_number, r.party_name, r.refund_amount, r.refund_method,
              r.is_cancellation, u.name AS user
       FROM returns r LEFT JOIN users u ON u.id = r.created_by
       WHERE r.shop_id = ? AND r.created_at >= ? AND r.created_at <= ?`
    )
    .all(session.shopId, range.from, range.to) as {
    created_at: string; kind: 'sale' | 'purchase'; invoice_number: string; party_name: string | null
    refund_amount: number; refund_method: 'cash' | 'due'; is_cancellation: number; user: string | null
  }[]
  for (const r of returns) {
    const label = r.is_cancellation
      ? r.kind === 'sale' ? 'Sale cancelled' : 'Purchase cancelled'
      : r.kind === 'sale' ? 'Sale return' : 'Purchase return'
    const sign = r.kind === 'sale' ? -1 : 1 // sale refund pays money out, purchase refund brings it back
    rows.push({
      at: r.created_at, type: r.refund_method === 'due' ? `${label} (due adjusted)` : label,
      ref: r.invoice_number, party: r.party_name, amount: r.refund_amount,
      cash_effect: r.refund_method === 'cash' ? sign * r.refund_amount : 0,
      method: r.refund_method === 'cash' ? 'cash' : null, user: r.user,
    })
  }

  const duePayments = db
    .prepare(
      `SELECT p.created_at, p.reference_type, p.amount, p.method, p.note, u.name AS user,
              COALESCE(c.name, su.name) AS party
       FROM payments p
       LEFT JOIN customers c ON p.party_type = 'customer' AND c.id = p.party_id
       LEFT JOIN suppliers su ON p.party_type = 'supplier' AND su.id = p.party_id
       LEFT JOIN users u ON u.id = p.created_by
       WHERE p.shop_id = ? AND p.reference_type IN ('customer_payment','supplier_payment')
         AND p.created_at >= ? AND p.created_at <= ?`
    )
    .all(session.shopId, range.from, range.to) as {
    created_at: string; reference_type: string; amount: number; method: string
    note: string | null; party: string | null; user: string | null
  }[]
  for (const p of duePayments) {
    const isIn = p.reference_type === 'customer_payment'
    rows.push({
      at: p.created_at, type: isIn ? 'Due collected from customer' : 'Due paid to supplier',
      ref: p.note ?? '', party: p.party, amount: p.amount,
      cash_effect: isIn ? p.amount : -p.amount, method: p.method, user: p.user,
    })
  }

  const expenseRows = db
    .prepare(
      `SELECT e.expense_date, e.created_at, e.amount, e.note, c.name AS category, u.name AS user
       FROM expenses e JOIN expense_categories c ON c.id = e.category_id LEFT JOIN users u ON u.id = e.created_by
       WHERE e.shop_id = ? AND e.expense_date >= ? AND e.expense_date <= ?`
    )
    .all(session.shopId, range.from.slice(0, 10), range.to.slice(0, 10)) as {
    expense_date: string; created_at: string; amount: number; note: string | null
    category: string; user: string | null
  }[]
  for (const e of expenseRows) {
    rows.push({
      at: e.created_at, type: 'Expense', ref: e.note ?? '', party: e.category,
      amount: e.amount, cash_effect: -e.amount, method: null, user: e.user,
    })
  }

  rows.sort((a, b) => a.at.localeCompare(b.at))

  const summary = {
    sales: { count: sales.length, total: sales.reduce((a, s) => a + s.total, 0) },
    purchases: { count: purchases.length, total: purchases.reduce((a, p) => a + p.total, 0) },
    returns: { count: returns.length, total: returns.reduce((a, r) => a + r.refund_amount, 0) },
    expenses: { count: expenseRows.length, total: expenseRows.reduce((a, e) => a + e.amount, 0) },
    cashIn: rows.reduce((a, r) => a + Math.max(0, r.cash_effect), 0),
    cashOut: rows.reduce((a, r) => a - Math.min(0, r.cash_effect), 0),
    netCash: rows.reduce((a, r) => a + r.cash_effect, 0),
  }
  return { rows, summary }
}

// ---- Cash Drawer (cashier reconciliation) ----

/**
 * Cash Drawer report: what each user should have in the till for the range —
 * cash sales + cash dues collected − cash refunds handed out.
 */
export function cashDrawer(session: Session, range: DateRange) {
  const db = getDb()
  interface DrawerRow {
    user: string
    cash_sales: number; cash_sale_count: number
    card_sales: number; credit_sales: number
    due_collected_cash: number; refunds_paid_cash: number
    expected_cash: number
  }
  const byUser = new Map<string, DrawerRow>()
  const row = (name: string): DrawerRow => {
    let r = byUser.get(name)
    if (!r) {
      r = {
        user: name, cash_sales: 0, cash_sale_count: 0, card_sales: 0, credit_sales: 0,
        due_collected_cash: 0, refunds_paid_cash: 0, expected_cash: 0,
      }
      byUser.set(name, r)
    }
    return r
  }

  const sales = db
    .prepare(
      `SELECT u.name AS user, s.payment_method AS method, COUNT(*) AS count, COALESCE(SUM(s.total),0) AS total
       FROM sales s JOIN users u ON u.id = s.cashier_id
       WHERE s.shop_id = ? AND s.created_at >= ? AND s.created_at <= ?
       GROUP BY s.cashier_id, s.payment_method`
    )
    .all(session.shopId, range.from, range.to) as { user: string; method: string; count: number; total: number }[]
  for (const s of sales) {
    const r = row(s.user)
    if (s.method === 'cash') { r.cash_sales += s.total; r.cash_sale_count += s.count }
    else if (s.method === 'card') r.card_sales += s.total
    else r.credit_sales += s.total
  }

  const dueCash = db
    .prepare(
      `SELECT u.name AS user, COALESCE(SUM(p.amount),0) AS total
       FROM payments p JOIN users u ON u.id = p.created_by
       WHERE p.shop_id = ? AND p.reference_type = 'customer_payment' AND p.method = 'cash'
         AND p.created_at >= ? AND p.created_at <= ?
       GROUP BY p.created_by`
    )
    .all(session.shopId, range.from, range.to) as { user: string; total: number }[]
  for (const d of dueCash) row(d.user).due_collected_cash += d.total

  const refundCash = db
    .prepare(
      `SELECT u.name AS user, COALESCE(SUM(p.amount),0) AS total
       FROM payments p JOIN users u ON u.id = p.created_by
       WHERE p.shop_id = ? AND p.reference_type = 'sale_refund' AND p.method = 'cash'
         AND p.created_at >= ? AND p.created_at <= ?
       GROUP BY p.created_by`
    )
    .all(session.shopId, range.from, range.to) as { user: string; total: number }[]
  for (const rr of refundCash) row(rr.user).refunds_paid_cash += rr.total

  const rows = [...byUser.values()].map((r) => ({
    ...r,
    expected_cash: r.cash_sales + r.due_collected_cash - r.refunds_paid_cash,
  }))
  rows.sort((a, b) => b.expected_cash - a.expected_cash)
  const totals = rows.reduce(
    (a, r) => ({
      cash_sales: a.cash_sales + r.cash_sales,
      card_sales: a.card_sales + r.card_sales,
      credit_sales: a.credit_sales + r.credit_sales,
      due_collected_cash: a.due_collected_cash + r.due_collected_cash,
      refunds_paid_cash: a.refunds_paid_cash + r.refunds_paid_cash,
      expected_cash: a.expected_cash + r.expected_cash,
    }),
    { cash_sales: 0, card_sales: 0, credit_sales: 0, due_collected_cash: 0, refunds_paid_cash: 0, expected_cash: 0 }
  )
  return { rows, totals }
}

// ---- Dues Aging ----

export interface AgingRow {
  id: string
  name: string
  phone: string | null
  due_balance: number
  b0: number // 0–30 days
  b1: number // 31–60
  b2: number // 61–90
  b3: number // over 90 / unmatched
}

function ageBuckets(
  outstanding: number,
  invoicesNewestFirst: { created_at: string; total: number }[],
  now: number
): Pick<AgingRow, 'b0' | 'b1' | 'b2' | 'b3'> {
  const b = { b0: 0, b1: 0, b2: 0, b3: 0 }
  let rem = outstanding
  // Payments settle the oldest invoices first, so what's still owed sits on the newest ones.
  for (const inv of invoicesNewestFirst) {
    if (rem <= 0) break
    const take = Math.min(rem, inv.total)
    const days = (now - new Date(inv.created_at).getTime()) / 86_400_000
    if (days <= 30) b.b0 += take
    else if (days <= 60) b.b1 += take
    else if (days <= 90) b.b2 += take
    else b.b3 += take
    rem -= take
  }
  if (rem > 0) b.b3 += rem // balance older than any invoice on record
  return b
}

/** Dues Aging: how old each outstanding balance is, in 30-day buckets. */
export function duesAging(session: Session) {
  const db = getDb()
  const now = Date.now()

  const customers = (
    db
      .prepare('SELECT id, name, phone, due_balance FROM customers WHERE shop_id = ? AND due_balance > 0')
      .all(session.shopId) as { id: string; name: string; phone: string | null; due_balance: number }[]
  ).map((c) => {
    const invoices = db
      .prepare(
        "SELECT created_at, total FROM sales WHERE customer_id = ? AND payment_method = 'credit' ORDER BY created_at DESC"
      )
      .all(c.id) as { created_at: string; total: number }[]
    return { ...c, ...ageBuckets(c.due_balance, invoices, now) }
  })

  const suppliers = (
    db
      .prepare('SELECT id, name, phone, due_balance FROM suppliers WHERE shop_id = ? AND due_balance > 0')
      .all(session.shopId) as { id: string; name: string; phone: string | null; due_balance: number }[]
  ).map((s) => {
    const invoices = db
      .prepare('SELECT created_at, total FROM purchases WHERE supplier_id = ? ORDER BY created_at DESC')
      .all(s.id) as { created_at: string; total: number }[]
    return { ...s, ...ageBuckets(s.due_balance, invoices, now) }
  })

  const sum = (rows: AgingRow[]) =>
    rows.reduce(
      (a, r) => ({ due: a.due + r.due_balance, b0: a.b0 + r.b0, b1: a.b1 + r.b1, b2: a.b2 + r.b2, b3: a.b3 + r.b3 }),
      { due: 0, b0: 0, b1: 0, b2: 0, b3: 0 }
    )
  customers.sort((a, b) => b.due_balance - a.due_balance)
  suppliers.sort((a, b) => b.due_balance - a.due_balance)
  return { customers, suppliers, customerTotals: sum(customers), supplierTotals: sum(suppliers) }
}

// ---- Stock Movements ----

/** Shop-wide stock movement log for a range, with per-type summary. */
export function stockMovements(session: Session, args: DateRange & { change_type?: string }) {
  const db = getDb()
  const typeFilter = args.change_type ? 'AND l.change_type = ?' : ''
  const params: unknown[] = [session.shopId, args.from, args.to]
  if (args.change_type) params.push(args.change_type)

  const rows = db
    .prepare(
      `SELECT l.id, l.created_at, l.change_type, l.quantity_change, l.reason,
              p.name AS product, u.name AS user
       FROM inventory_logs l
       LEFT JOIN products p ON p.id = l.product_id
       LEFT JOIN users u ON u.id = l.created_by
       WHERE l.shop_id = ? AND l.created_at >= ? AND l.created_at <= ? ${typeFilter}
       ORDER BY l.created_at DESC LIMIT 500`
    )
    .all(...params) as {
    id: string; created_at: string; change_type: string; quantity_change: number
    reason: string | null; product: string | null; user: string | null
  }[]

  const byType = db
    .prepare(
      `SELECT change_type, COUNT(*) AS count,
              COALESCE(SUM(CASE WHEN quantity_change > 0 THEN quantity_change ELSE 0 END),0) AS units_in,
              COALESCE(SUM(CASE WHEN quantity_change < 0 THEN -quantity_change ELSE 0 END),0) AS units_out
       FROM inventory_logs
       WHERE shop_id = ? AND created_at >= ? AND created_at <= ?
       GROUP BY change_type ORDER BY count DESC`
    )
    .all(session.shopId, args.from, args.to) as {
    change_type: string; count: number; units_in: number; units_out: number
  }[]

  return { rows, byType }
}

// ---- Cash Book ----

/**
 * Cash Book: every actual money movement (payments ledger + expenses) in order,
 * with a running net for the range.
 */
export function cashBook(session: Session, range: DateRange) {
  const db = getDb()
  const IN = new Set(['sale', 'customer_payment', 'purchase_refund'])

  interface BookRow {
    at: string; type: string; party: string | null; note: string | null
    method: string | null; in_amount: number; out_amount: number; user: string | null
  }
  const entries: BookRow[] = []

  const LABELS: Record<string, string> = {
    sale: 'Sale at the till',
    purchase: 'Paid on purchase',
    customer_payment: 'Customer due payment',
    supplier_payment: 'Supplier due payment',
    sale_refund: 'Refund to customer',
    purchase_refund: 'Refund from supplier',
  }

  const pays = db
    .prepare(
      `SELECT p.created_at, p.reference_type, p.amount, p.method, p.note, u.name AS user,
              COALESCE(c.name, su.name) AS party
       FROM payments p
       LEFT JOIN customers c ON p.party_type = 'customer' AND c.id = p.party_id
       LEFT JOIN suppliers su ON p.party_type = 'supplier' AND su.id = p.party_id
       LEFT JOIN users u ON u.id = p.created_by
       WHERE p.shop_id = ? AND p.created_at >= ? AND p.created_at <= ?`
    )
    .all(session.shopId, range.from, range.to) as {
    created_at: string; reference_type: string; amount: number; method: string
    note: string | null; party: string | null; user: string | null
  }[]
  for (const p of pays) {
    const isIn = IN.has(p.reference_type)
    entries.push({
      at: p.created_at, type: LABELS[p.reference_type] ?? p.reference_type,
      party: p.party, note: p.note, method: p.method,
      in_amount: isIn ? p.amount : 0, out_amount: isIn ? 0 : p.amount, user: p.user,
    })
  }

  const exp = db
    .prepare(
      `SELECT e.created_at, e.amount, e.note, c.name AS category, u.name AS user
       FROM expenses e JOIN expense_categories c ON c.id = e.category_id LEFT JOIN users u ON u.id = e.created_by
       WHERE e.shop_id = ? AND e.expense_date >= ? AND e.expense_date <= ?`
    )
    .all(session.shopId, range.from.slice(0, 10), range.to.slice(0, 10)) as {
    created_at: string; amount: number; note: string | null; category: string; user: string | null
  }[]
  for (const e of exp) {
    entries.push({
      at: e.created_at, type: 'Expense', party: e.category, note: e.note,
      method: null, in_amount: 0, out_amount: e.amount, user: e.user,
    })
  }

  entries.sort((a, b) => a.at.localeCompare(b.at))
  let running = 0
  const rows = entries.map((e) => {
    running += e.in_amount - e.out_amount
    return { ...e, balance: running }
  })
  const totals = {
    in: rows.reduce((a, r) => a + r.in_amount, 0),
    out: rows.reduce((a, r) => a + r.out_amount, 0),
    net: running,
  }
  return { rows, totals }
}

/** Supplier report: purchase activity + dues per supplier for a range. */
export function supplierReport(session: Session, range: DateRange) {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT su.id, su.name, su.phone, su.due_balance,
              COUNT(p.id) AS purchase_count, COALESCE(SUM(p.total),0) AS purchase_total
       FROM suppliers su
       LEFT JOIN purchases p ON p.supplier_id = su.id AND p.created_at >= ? AND p.created_at <= ?
       WHERE su.shop_id = ?
       GROUP BY su.id ORDER BY purchase_total DESC, su.name COLLATE NOCASE`
    )
    .all(range.from, range.to, session.shopId) as {
    id: string; name: string; phone: string | null; due_balance: number; purchase_count: number; purchase_total: number
  }[]
  const totals = {
    suppliers: rows.length,
    purchase_total: rows.reduce((a, r) => a + r.purchase_total, 0),
    due_total: rows.reduce((a, r) => a + Math.max(0, r.due_balance), 0),
  }
  return { rows, totals }
}
