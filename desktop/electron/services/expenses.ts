// Shop expenses: categorised spending outside purchases (rent, utilities, wages…).
import { getDb } from '../db'
import { uid, now, AppError, audit } from './helpers'
import type { Expense, ExpenseCategory, Session } from '../../src/shared/types'
import type { ExpenseInput } from '../../src/shared/schemas'

export function listExpenseCategories(session: Session): ExpenseCategory[] {
  return getDb()
    .prepare('SELECT id, name FROM expense_categories WHERE shop_id = ? ORDER BY name COLLATE NOCASE')
    .all(session.shopId) as ExpenseCategory[]
}

export function createExpenseCategory(session: Session, input: { name: string }): ExpenseCategory {
  const existing = getDb()
    .prepare('SELECT id, name FROM expense_categories WHERE shop_id = ? AND name = ? COLLATE NOCASE')
    .get(session.shopId, input.name) as ExpenseCategory | undefined
  if (existing) return existing
  const id = uid()
  getDb()
    .prepare('INSERT INTO expense_categories (id, shop_id, name) VALUES (?, ?, ?)')
    .run(id, session.shopId, input.name)
  return { id, name: input.name }
}

export function listExpenses(
  session: Session,
  args: { from?: string; to?: string; category_id?: string } = {}
): { rows: Expense[]; total: number } {
  const where: string[] = ['e.shop_id = ?']
  const params: unknown[] = [session.shopId]
  // expense_date is a plain YYYY-MM-DD — truncate ISO datetimes so string compare works.
  if (args.from) { where.push('e.expense_date >= ?'); params.push(args.from.slice(0, 10)) }
  if (args.to) { where.push('e.expense_date <= ?'); params.push(args.to.slice(0, 10)) }
  if (args.category_id) { where.push('e.category_id = ?'); params.push(args.category_id) }
  const db = getDb()
  const base = `FROM expenses e
    LEFT JOIN expense_categories c ON c.id = e.category_id
    LEFT JOIN users u ON u.id = e.created_by
    WHERE ${where.join(' AND ')}`
  const rows = db
    .prepare(
      `SELECT e.*, c.name AS category_name, u.name AS created_by_name ${base}
       ORDER BY e.expense_date DESC, e.created_at DESC`
    )
    .all(...params) as Expense[]
  const { total } = db
    .prepare(`SELECT COALESCE(SUM(e.amount),0) AS total ${base}`)
    .get(...params) as { total: number }
  return { rows, total }
}

export function createExpense(session: Session, input: ExpenseInput): Expense {
  const db = getDb()
  const cat = db
    .prepare('SELECT id FROM expense_categories WHERE id = ? AND shop_id = ?')
    .get(input.category_id, session.shopId)
  if (!cat) throw new AppError('Expense category not found')
  const id = uid()
  const ts = now()
  db.prepare(
    `INSERT INTO expenses (id, shop_id, category_id, amount, note, expense_date, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, session.shopId, input.category_id, input.amount, input.note?.trim() || null, input.expense_date, session.userId, ts, ts)
  audit(session, 'expense.create', { id, amount: input.amount })
  return listExpenses(session).rows.find((e) => e.id === id)!
}

export function updateExpense(session: Session, input: ExpenseInput & { id: string }): void {
  const db = getDb()
  const cat = db
    .prepare('SELECT id FROM expense_categories WHERE id = ? AND shop_id = ?')
    .get(input.category_id, session.shopId)
  if (!cat) throw new AppError('Expense category not found')
  const res = db
    .prepare(
      `UPDATE expenses SET category_id = ?, amount = ?, note = ?, expense_date = ?, updated_at = ?
       WHERE id = ? AND shop_id = ?`
    )
    .run(input.category_id, input.amount, input.note?.trim() || null, input.expense_date, now(), input.id, session.shopId)
  if (res.changes === 0) throw new AppError('Expense not found')
  audit(session, 'expense.update', { id: input.id, amount: input.amount })
}

export function deleteExpense(session: Session, id: string): void {
  const res = getDb()
    .prepare('DELETE FROM expenses WHERE id = ? AND shop_id = ?')
    .run(id, session.shopId)
  if (res.changes === 0) throw new AppError('Expense not found')
  audit(session, 'expense.delete', { id })
}

/** Category breakdown for a date range (used by the expense report). */
export function expenseReport(session: Session, range: { from: string; to: string }) {
  const db = getDb()
  const from = range.from.slice(0, 10)
  const to = range.to.slice(0, 10)
  const byCategory = db
    .prepare(
      `SELECT c.name AS category, COUNT(*) AS count, COALESCE(SUM(e.amount),0) AS total
       FROM expenses e JOIN expense_categories c ON c.id = e.category_id
       WHERE e.shop_id = ? AND e.expense_date >= ? AND e.expense_date <= ?
       GROUP BY e.category_id ORDER BY total DESC`
    )
    .all(session.shopId, from, to) as { category: string; count: number; total: number }[]
  const total = byCategory.reduce((a, r) => a + r.total, 0)
  const byMonth = db
    .prepare(
      `SELECT substr(e.expense_date, 1, 7) AS month, COALESCE(SUM(e.amount),0) AS total
       FROM expenses e
       WHERE e.shop_id = ? AND e.expense_date >= ? AND e.expense_date <= ?
       GROUP BY month ORDER BY month DESC`
    )
    .all(session.shopId, from, to) as { month: string; total: number }[]
  return { byCategory, byMonth, total }
}

/** Total expenses for an ISO datetime range (used by profit/loss and dashboard). */
export function expenseTotal(session: Session, range: { from: string; to: string }): number {
  const row = getDb()
    .prepare(
      'SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE shop_id = ? AND expense_date >= ? AND expense_date <= ?'
    )
    .get(session.shopId, range.from.slice(0, 10), range.to.slice(0, 10)) as { total: number }
  return row.total
}
