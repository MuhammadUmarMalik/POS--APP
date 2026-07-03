// Dev-only demo data. Registered only when running against the Vite dev server.
import bcrypt from 'bcryptjs'
import { getDb } from '../db'
import { uid, now, writeMovement } from './helpers'
import type { Session } from '../../src/shared/types'

export function seedDemoData(session: Session): { seeded: boolean } {
  const db = getDb()
  const productCount = db
    .prepare('SELECT COUNT(*) AS c FROM products WHERE shop_id = ?')
    .get(session.shopId) as { c: number }
  if (productCount.c > 0) return { seeded: false }

  const ts = now()
  const categories = ['Beverages', 'Snacks', 'Dairy', 'Household', 'Personal Care']
  const products: [string, string, number, number, number][] = [
    // name, category, cost (paisa), price (paisa), opening stock
    ['Coca Cola 1.5L', 'Beverages', 18000, 22000, 48],
    ['Pepsi 1.5L', 'Beverages', 17500, 21500, 36],
    ['Nestle Water 500ml', 'Beverages', 3500, 5000, 120],
    ['Red Bull 250ml', 'Beverages', 45000, 55000, 24],
    ['Tang Orange 750g', 'Beverages', 78000, 92000, 15],
    ['Lays Masala 70g', 'Snacks', 8000, 10000, 60],
    ['Kurkure 62g', 'Snacks', 4500, 6000, 80],
    ['Oreo Biscuits', 'Snacks', 9500, 12000, 45],
    ['Prince Biscuits', 'Snacks', 4000, 5500, 90],
    ['Slanty Jalapeno', 'Snacks', 2500, 3500, 100],
    ['Milk Pack 1L', 'Dairy', 21000, 24000, 30],
    ['Yogurt 400g', 'Dairy', 12000, 15000, 20],
    ['Butter 200g', 'Dairy', 48000, 56000, 12],
    ['Cheese Slices 10pk', 'Dairy', 52000, 62000, 10],
    ['Eggs Dozen', 'Dairy', 28000, 33000, 25],
    ['Surf Excel 1kg', 'Household', 58000, 68000, 18],
    ['Dishwash Liquid', 'Household', 25000, 32000, 22],
    ['Tissue Box', 'Household', 15000, 20000, 40],
    ['Trash Bags 30pk', 'Household', 18000, 25000, 15],
    ['Mosquito Spray', 'Household', 62000, 75000, 8],
    ['Lifebuoy Soap', 'Personal Care', 9000, 12000, 70],
    ['Head & Shoulders 185ml', 'Personal Care', 68000, 82000, 14],
    ['Colgate 150g', 'Personal Care', 28000, 35000, 30],
    ['Vaseline 100ml', 'Personal Care', 32000, 40000, 16],
    ['Dettol 250ml', 'Personal Care', 42000, 52000, 12],
  ]

  db.transaction(() => {
    const catIds = new Map<string, string>()
    for (const name of categories) {
      const id = uid()
      db.prepare('INSERT INTO categories (id, shop_id, name) VALUES (?, ?, ?)').run(
        id,
        session.shopId,
        name
      )
      catIds.set(name, id)
    }

    let barcodeSeq = 100000001
    for (const [name, cat, cost, price, stock] of products) {
      const id = uid()
      db.prepare(
        `INSERT INTO products (id, shop_id, name, sku, barcode, category_id, unit, cost_price, sale_price, tax_percent, min_stock_alert, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, 'pcs', ?, ?, 0, 10, ?)`
      ).run(id, session.shopId, name, `200${barcodeSeq++}0`, catIds.get(cat), cost, price, ts)
      writeMovement({
        shopId: session.shopId,
        productId: id,
        changeType: 'opening',
        quantityChange: stock,
        reason: 'Opening stock (seed)',
        userId: session.userId,
      })
    }

    const customers: [string, string, number][] = [
      ['Ahmed Khan', '0300-1234567', 5000000],
      ['Sara Malik', '0321-7654321', 2000000],
      ['Walk-in Regular', '', 0],
    ]
    for (const [name, phone, limit] of customers) {
      db.prepare(
        `INSERT INTO customers (id, shop_id, name, phone, credit_limit, due_balance, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
      ).run(uid(), session.shopId, name, phone || null, limit, ts, ts)
    }

    const suppliers: [string, string][] = [
      ['Metro Distributors', '042-35771234'],
      ['Karachi Traders', '021-34561122'],
    ]
    for (const [name, phone] of suppliers) {
      db.prepare(
        `INSERT INTO suppliers (id, shop_id, name, phone, due_balance, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`
      ).run(uid(), session.shopId, name, phone, ts, ts)
    }

    const cashierExists = db
      .prepare("SELECT 1 FROM users WHERE shop_id = ? AND username = 'cashier'")
      .get(session.shopId)
    if (!cashierExists) {
      db.prepare(
        `INSERT INTO users (id, shop_id, name, username, password_hash, role, active, created_at)
         VALUES (?, ?, 'Demo Cashier', 'cashier', ?, 'cashier', 1, ?)`
      ).run(uid(), session.shopId, bcrypt.hashSync('1234', 10), ts)
    }
  })()

  return { seeded: true }
}
