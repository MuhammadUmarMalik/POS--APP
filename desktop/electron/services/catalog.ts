import { getDb } from '../db'
import { uid, now, AppError, audit } from './helpers'
import { deleteImageFiles } from './images'
import type { Brand, Category, ProductImage, ProductWithStock, Session } from '../../src/shared/types'
import type { ProductInput } from '../../src/shared/schemas'

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
  return getDb().prepare(sql).all(...params) as ProductWithStock[]
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
  return row ?? null
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

export function createProduct(session: Session, input: ProductInput): ProductWithStock {
  assertBarcodeFree(session.shopId, input.barcode)
  const id = uid()
  const db = getDb()
  db.transaction(() => {
    db.prepare(
      `INSERT INTO products
       (id, shop_id, name, sku, barcode, category_id, brand_id, unit, cost_price, sale_price, tax_percent, min_stock_alert, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      now()
    )
    setProductImages(id, input.images)
  })()
  return listProducts(session, { search: undefined }).find((p) => p.id === id)!
}

export function updateProduct(session: Session, input: ProductInput & { id: string }): void {
  assertBarcodeFree(session.shopId, input.barcode, input.id)
  const db = getDb()
  db.transaction(() => {
    const res = db
      .prepare(
        `UPDATE products SET name = ?, sku = ?, barcode = ?, category_id = ?, brand_id = ?, unit = ?,
         cost_price = ?, sale_price = ?, tax_percent = ?, min_stock_alert = ?, updated_at = ?, sync_status = 'pending'
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
        input.id,
        session.shopId
      )
    if (res.changes === 0) throw new AppError('Product not found')
    setProductImages(input.id, input.images)
  })()
}

export function deleteProduct(session: Session, id: string): void {
  const res = getDb()
    .prepare(
      "UPDATE products SET is_deleted = 1, updated_at = ?, sync_status = 'pending' WHERE id = ? AND shop_id = ?"
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

export function listCategories(session: Session): Category[] {
  return getDb()
    .prepare('SELECT id, name FROM categories WHERE shop_id = ? ORDER BY name COLLATE NOCASE')
    .all(session.shopId) as Category[]
}

export function createCategory(session: Session, input: { name: string }): Category {
  const existing = getDb()
    .prepare('SELECT id, name FROM categories WHERE shop_id = ? AND name = ? COLLATE NOCASE')
    .get(session.shopId, input.name) as Category | undefined
  if (existing) return existing
  const id = uid()
  getDb()
    .prepare('INSERT INTO categories (id, shop_id, name) VALUES (?, ?, ?)')
    .run(id, session.shopId, input.name)
  return { id, name: input.name }
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
