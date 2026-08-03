import { getDb } from '../db'
import { uid, now, AppError, audit, writeMovement } from './helpers'
import { batchTrackingEnabled, ensureBatch } from './batches'
import { costFiltered } from './permissions'
import { deleteImageFiles } from './images'
import type { Brand, Category, ProductImage, ProductWithStock, Session } from '../../src/shared/types'
import type { ProductCreateInput, ProductInput } from '../../src/shared/schemas'

const STOCK_JOIN = `
  LEFT JOIN (
    SELECT product_id, SUM(quantity_change) AS stock
    FROM inventory_logs GROUP BY product_id
  ) s ON s.product_id = p.id`

const IMAGE_JOIN = `
  LEFT JOIN (
    SELECT product_id, MIN(position) AS pos FROM product_images GROUP BY product_id
  ) fi ON fi.product_id = p.id
  LEFT JOIN product_images img ON img.product_id = p.id AND img.position = fi.pos`

export function listProducts(
  session: Session,
  args: { search?: string; category_id?: string; brand_id?: string; low_stock_only?: boolean } = {}
): ProductWithStock[] {
  const where: string[] = ['p.shop_id = ?', 'p.is_deleted = 0']
  const params: unknown[] = [session.shopId]
  if (args.search) {
    where.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)')
    const q = `%${args.search}%`
    params.push(q, q, q)
  }
  if (args.category_id) {
    where.push('p.category_id = ?')
    params.push(args.category_id)
  }
  if (args.brand_id) {
    where.push('p.brand_id = ?')
    params.push(args.brand_id)
  }
  let sql = `
    SELECT p.*, COALESCE(s.stock, 0) AS stock, c.name AS category_name,
           b.name AS brand_name, img.file_name AS image
    FROM products p
    ${STOCK_JOIN}
    ${IMAGE_JOIN}
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN brands b ON b.id = p.brand_id
    WHERE ${where.join(' AND ')}`
  if (args.low_stock_only) sql += ' AND COALESCE(s.stock, 0) <= p.min_stock_alert'
  sql += ' ORDER BY p.name COLLATE NOCASE'
  const rows = getDb().prepare(sql).all(...params) as ProductWithStock[]
  // The till needs the catalogue, not the buying price.
  return costFiltered(session, rows)
}

export function getProductByBarcode(session: Session, barcode: string): ProductWithStock | null {
  const row = getDb()
    .prepare(
      `SELECT p.*, COALESCE(s.stock, 0) AS stock, NULL AS category_name,
              NULL AS brand_name, img.file_name AS image
       FROM products p ${STOCK_JOIN} ${IMAGE_JOIN}
       WHERE p.shop_id = ? AND p.barcode = ? AND p.is_deleted = 0`
    )
    .get(session.shopId, barcode) as ProductWithStock | undefined
  if (!row) return null
  return costFiltered(session, [row])[0]
}

/** All images for one product, ordered. */
export function listProductImages(session: Session, productId: string): ProductImage[] {
  return getDb()
    .prepare(
      `SELECT pi.* FROM product_images pi
       JOIN products p ON p.id = pi.product_id
       WHERE pi.product_id = ? AND p.shop_id = ? ORDER BY pi.position`
    )
    .all(productId, session.shopId) as ProductImage[]
}

/** Replace a product's image set with the given ordered file names. */
function setProductImages(productId: string, fileNames: string[] | undefined) {
  if (fileNames === undefined) return
  const db = getDb()
  const existing = db
    .prepare('SELECT file_name FROM product_images WHERE product_id = ?')
    .all(productId) as { file_name: string }[]
  const keep = new Set(fileNames)
  const removed = existing.map((r) => r.file_name).filter((f) => !keep.has(f))
  db.prepare('DELETE FROM product_images WHERE product_id = ?').run(productId)
  const ins = db.prepare(
    'INSERT INTO product_images (id, product_id, file_name, position, created_at) VALUES (?, ?, ?, ?, ?)'
  )
  fileNames.forEach((f, i) => ins.run(uid(), productId, f, i, now()))
  deleteImageFiles(removed)
}

function assertBarcodeFree(shopId: string, barcode: string | null | undefined, exceptId?: string) {
  if (!barcode) return
  const row = getDb()
    .prepare(
      'SELECT id FROM products WHERE shop_id = ? AND barcode = ? AND is_deleted = 0' +
        (exceptId ? ' AND id != ?' : '')
    )
    .get(...(exceptId ? [shopId, barcode, exceptId] : [shopId, barcode])) as { id: string } | undefined
  if (row) throw new AppError(`Barcode ${barcode} is already used by another product`)
}

export function createProduct(session: Session, input: ProductCreateInput): ProductWithStock {
  assertBarcodeFree(session.shopId, input.barcode)
  const id = uid()
  const db = getDb()
  const openingStock = input.opening_stock ?? 0
  // Batch fields are only honoured while the shop has tracking on, so a payload
  // left over from a previous session cannot create batches behind the scenes.
  const tracking = batchTrackingEnabled(session.shopId)
  const batchNumber = tracking ? input.batch_number?.trim() || null : null
  const expiryDate = tracking ? input.expiry_date?.trim() || null : null
  db.transaction(() => {
    db.prepare(
      `INSERT INTO products
       (id, shop_id, name, sku, barcode, category_id, brand_id, unit, cost_price, sale_price, tax_percent, min_stock_alert, updated_at, batch_number, expiry_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      session.shopId,
      input.name,
      input.sku || null,
      input.barcode || null,
      input.category_id || null,
      input.brand_id || null,
      input.unit,
      input.cost_price,
      input.sale_price,
      input.tax_percent,
      input.min_stock_alert,
      now(),
      batchNumber,
      expiryDate
    )
    setProductImages(id, input.images)
    const batchId = ensureBatch(session.shopId, id, batchNumber, expiryDate)
    // Stock already on the shelf enters the same append-only ledger every other
    // movement uses — there is no direct stock write anywhere in the app.
    if (openingStock > 0) {
      writeMovement({
        shopId: session.shopId,
        productId: id,
        changeType: 'opening',
        quantityChange: openingStock,
        reason: 'opening_stock',
        userId: session.userId,
        batchId,
      })
      audit(session, 'stock.opening', {
        product_id: id,
        name: input.name,
        quantity: openingStock,
        batch_id: batchId,
      })
    }
  })()
  return listProducts(session, { search: undefined }).find((p) => p.id === id)!
}

export function updateProduct(session: Session, input: ProductInput & { id: string }): void {
  assertBarcodeFree(session.shopId, input.barcode, input.id)
  const db = getDb()
  const tracking = batchTrackingEnabled(session.shopId)
  db.transaction(() => {
    // With tracking off the two batch columns are left exactly as they were —
    // turning the feature off must not erase batch data a shop already entered.
    const batchSql = tracking ? ', batch_number = ?, expiry_date = ?' : ''
    const batchParams = tracking
      ? [input.batch_number?.trim() || null, input.expiry_date?.trim() || null]
      : []
    const res = db
      .prepare(
        `UPDATE products SET name = ?, sku = ?, barcode = ?, category_id = ?, brand_id = ?, unit = ?,
         cost_price = ?, sale_price = ?, tax_percent = ?, min_stock_alert = ?, updated_at = ?${batchSql}
         WHERE id = ? AND shop_id = ? AND is_deleted = 0`
      )
      .run(
        input.name,
        input.sku || null,
        input.barcode || null,
        input.category_id || null,
        input.brand_id || null,
        input.unit,
        input.cost_price,
        input.sale_price,
        input.tax_percent,
        input.min_stock_alert,
        now(),
        ...batchParams,
        input.id,
        session.shopId
      )
    if (res.changes === 0) throw new AppError('Product not found')
    setProductImages(input.id, input.images)
    if (tracking) ensureBatch(session.shopId, input.id, input.batch_number, input.expiry_date)
  })()
}

export function deleteProduct(session: Session, id: string): void {
  const res = getDb()
    .prepare(
      "UPDATE products SET is_deleted = 1, updated_at = ? WHERE id = ? AND shop_id = ?"
    )
    .run(now(), id, session.shopId)
  if (res.changes === 0) throw new AppError('Product not found')
  audit(session, 'product.delete', { id })
}

export function generateBarcode(session: Session): string {
  const db = getDb()
  // In-store barcode: prefix 200 + 9 random digits + naive check digit slot = 13 digits
  for (let i = 0; i < 20; i++) {
    const body = String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0')
    const candidate = `200${body}0`
    const exists = db
      .prepare('SELECT 1 FROM products WHERE shop_id = ? AND barcode = ? AND is_deleted = 0')
      .get(session.shopId, candidate)
    if (!exists) return candidate
  }
  throw new AppError('Could not generate a unique barcode, try again')
}

/**
 * Active ones only unless asked otherwise, so every "pick a category" list in
 * the app is short and current. The manage screen is the one place that wants
 * the retired ones back.
 */
export function listCategories(
  session: Session,
  args: { include_inactive?: boolean } = {}
): Category[] {
  const where = args.include_inactive ? '' : ' AND is_active = 1'
  return getDb()
    .prepare(
      `SELECT id, name, is_active FROM categories
       WHERE shop_id = ?${where}
       ORDER BY is_active DESC, name COLLATE NOCASE`
    )
    .all(session.shopId) as Category[]
}

export function createCategory(session: Session, input: { name: string }): Category {
  const existing = getDb()
    .prepare('SELECT id, name, is_active FROM categories WHERE shop_id = ? AND name = ? COLLATE NOCASE')
    .get(session.shopId, input.name) as Category | undefined
  // Re-adding a name that was retired brings the original row back rather than
  // colliding with it, so the products already filed under it stay where they are.
  if (existing) {
    if (!existing.is_active) return setCategoryActive(session, { id: existing.id, is_active: true })
    return existing
  }
  const id = uid()
  getDb()
    .prepare('INSERT INTO categories (id, shop_id, name, is_active) VALUES (?, ?, ?, 1)')
    .run(id, session.shopId, input.name)
  return { id, name: input.name, is_active: 1 }
}

function requireCategory(session: Session, id: string): Category {
  const row = getDb()
    .prepare('SELECT id, name, is_active FROM categories WHERE id = ? AND shop_id = ?')
    .get(id, session.shopId) as Category | undefined
  if (!row) throw new AppError('Category not found')
  return row
}

export function updateCategory(session: Session, input: { id: string; name: string }): Category {
  const current = requireCategory(session, input.id)
  const clash = getDb()
    .prepare('SELECT id FROM categories WHERE shop_id = ? AND name = ? COLLATE NOCASE AND id <> ?')
    .get(session.shopId, input.name, input.id) as { id: string } | undefined
  if (clash) throw new AppError(`Another category is already called "${input.name}"`)
  getDb()
    .prepare('UPDATE categories SET name = ? WHERE id = ? AND shop_id = ?')
    .run(input.name, input.id, session.shopId)
  audit(session, 'category.update', { id: input.id, from: current.name, to: input.name })
  return { id: input.id, name: input.name, is_active: current.is_active }
}

/**
 * Switching a category off hides it from the pickers only. Nothing is deleted,
 * no product is reassigned, and every historical record keeps its name.
 */
export function setCategoryActive(
  session: Session,
  input: { id: string; is_active: boolean }
): Category {
  const current = requireCategory(session, input.id)
  const next = input.is_active ? 1 : 0
  getDb()
    .prepare('UPDATE categories SET is_active = ? WHERE id = ? AND shop_id = ?')
    .run(next, input.id, session.shopId)
  audit(session, input.is_active ? 'category.activate' : 'category.deactivate', {
    id: input.id,
    name: current.name,
  })
  return { id: current.id, name: current.name, is_active: next }
}

/** How many products still point at a category, so the UI can warn before retiring it. */
export function countCategoryProducts(session: Session, id: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM products WHERE shop_id = ? AND category_id = ? AND is_deleted = 0')
    .get(session.shopId, id) as { n: number }
  return row.n
}

export function listBrands(session: Session): Brand[] {
  return getDb()
    .prepare('SELECT id, name FROM brands WHERE shop_id = ? ORDER BY name COLLATE NOCASE')
    .all(session.shopId) as Brand[]
}

export function createBrand(session: Session, input: { name: string }): Brand {
  const existing = getDb()
    .prepare('SELECT id, name FROM brands WHERE shop_id = ? AND name = ? COLLATE NOCASE')
    .get(session.shopId, input.name) as Brand | undefined
  if (existing) return existing
  const id = uid()
  getDb()
    .prepare('INSERT INTO brands (id, shop_id, name) VALUES (?, ?, ?)')
    .run(id, session.shopId, input.name)
  return { id, name: input.name }
}
