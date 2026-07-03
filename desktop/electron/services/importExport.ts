// Bulk product import/export via Excel (.xlsx). Prices are rupees in the
// spreadsheet (human-friendly) and converted to integer paisa at the boundary.
import { app, dialog, BrowserWindow } from 'electron'
import path from 'node:path'
import { createRequire } from 'node:module'
import type * as ExcelJSType from 'exceljs'
import { getDb } from '../db'
import { uid, now, AppError, audit, writeMovement } from './helpers'
import { listProducts, createCategory, createBrand } from './catalog'
import type { Session } from '../../src/shared/types'

const require = createRequire(import.meta.url)
const ExcelJS = require('exceljs') as typeof ExcelJSType

const HEADERS = [
  'Name', 'SKU', 'Barcode', 'Category', 'Brand', 'Unit',
  'Cost Price', 'Sale Price', 'Tax %', 'Min Stock Alert', 'Opening Stock',
] as const

export async function exportProducts(session: Session): Promise<{ saved: boolean; path?: string; count?: number }> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const stamp = new Date().toISOString().slice(0, 10)
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export products',
    defaultPath: path.join(app.getPath('documents'), `products-${stamp}.xlsx`),
    filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
  })
  if (canceled || !filePath) return { saved: false }

  const products = listProducts(session)
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Products')
  ws.columns = HEADERS.map((h) => ({ header: h, key: h, width: h === 'Name' ? 32 : 14 }))
  ws.getRow(1).font = { bold: true }
  for (const p of products) {
    ws.addRow({
      Name: p.name,
      SKU: p.sku ?? '',
      Barcode: p.barcode ?? '',
      Category: p.category_name ?? '',
      Brand: p.brand_name ?? '',
      Unit: p.unit,
      'Cost Price': p.cost_price / 100,
      'Sale Price': p.sale_price / 100,
      'Tax %': p.tax_percent,
      'Min Stock Alert': p.min_stock_alert,
      'Opening Stock': p.stock,
    })
  }
  await wb.xlsx.writeFile(filePath)
  audit(session, 'products.export', { path: filePath, count: products.length })
  return { saved: true, path: filePath, count: products.length }
}

export interface ImportResult {
  imported: number
  skipped: { row: number; reason: string }[]
  canceled?: boolean
}

export async function importProducts(session: Session): Promise<ImportResult> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Import products from Excel',
    properties: ['openFile'],
    filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
  })
  if (canceled || filePaths.length === 0) return { imported: 0, skipped: [], canceled: true }

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePaths[0])
  const ws = wb.worksheets[0]
  if (!ws) throw new AppError('The workbook has no sheets')

  // Map header text (case/space-insensitive) to column number.
  const headerRow = ws.getRow(1)
  const cols = new Map<string, number>()
  headerRow.eachCell((cell, colNumber) => {
    cols.set(String(cell.value ?? '').trim().toLowerCase().replace(/\s+/g, ' '), colNumber)
  })
  const col = (name: string) => cols.get(name.toLowerCase())
  if (!col('Name') || !col('Sale Price')) {
    throw new AppError('Missing required columns. Expected headers: ' + HEADERS.join(', '))
  }

  const db = getDb()
  const skipped: { row: number; reason: string }[] = []
  let imported = 0

  const text = (row: ExcelJSType.Row, name: string): string => {
    const c = col(name)
    if (!c) return ''
    const v = row.getCell(c).value
    if (v == null) return ''
    if (typeof v === 'object' && 'text' in (v as object)) return String((v as { text: unknown }).text).trim()
    if (typeof v === 'object' && 'result' in (v as object)) return String((v as { result: unknown }).result ?? '').trim()
    return String(v).trim()
  }
  const num = (row: ExcelJSType.Row, name: string): number => {
    const raw = text(row, name)
    if (raw === '') return 0
    const n = Number(raw)
    if (Number.isNaN(n)) throw new AppError(`"${name}" is not a number`)
    return n
  }

  db.transaction(() => {
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      try {
        const name = text(row, 'Name')
        if (!name) continue // blank row

        const barcode = text(row, 'Barcode') || null
        if (barcode) {
          const dup = db
            .prepare('SELECT id FROM products WHERE shop_id = ? AND barcode = ? AND is_deleted = 0')
            .get(session.shopId, barcode)
          if (dup) {
            skipped.push({ row: r, reason: `Barcode ${barcode} already exists` })
            continue
          }
        }
        const nameDup = db
          .prepare('SELECT id FROM products WHERE shop_id = ? AND name = ? AND is_deleted = 0 COLLATE NOCASE')
          .get(session.shopId, name)
        if (nameDup) {
          skipped.push({ row: r, reason: `Product "${name}" already exists` })
          continue
        }

        const categoryName = text(row, 'Category')
        const brandName = text(row, 'Brand')
        const categoryId = categoryName ? createCategory(session, { name: categoryName }).id : null
        const brandId = brandName ? createBrand(session, { name: brandName }).id : null

        const costPrice = Math.round(num(row, 'Cost Price') * 100)
        const salePrice = Math.round(num(row, 'Sale Price') * 100)
        if (salePrice < 0 || costPrice < 0) throw new AppError('Prices cannot be negative')
        const taxPercent = num(row, 'Tax %')
        const minStock = Math.max(0, Math.round(num(row, 'Min Stock Alert')))
        const openingStock = Math.round(num(row, 'Opening Stock'))

        const id = uid()
        db.prepare(
          `INSERT INTO products
           (id, shop_id, name, sku, barcode, category_id, brand_id, unit, cost_price, sale_price, tax_percent, min_stock_alert, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          id, session.shopId, name,
          text(row, 'SKU') || null, barcode, categoryId, brandId,
          text(row, 'Unit') || 'pcs', costPrice, salePrice, taxPercent, minStock, now()
        )
        if (openingStock > 0) {
          writeMovement({
            shopId: session.shopId,
            productId: id,
            changeType: 'opening',
            quantityChange: openingStock,
            reason: 'Excel import',
            userId: session.userId,
          })
        }
        imported++
      } catch (err) {
        skipped.push({ row: r, reason: err instanceof AppError ? err.message : 'Invalid row' })
      }
    }
  })()

  audit(session, 'products.import', { imported, skipped: skipped.length, file: filePaths[0] })
  return { imported, skipped }
}
