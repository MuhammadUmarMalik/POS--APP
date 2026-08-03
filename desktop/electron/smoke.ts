// Service-level end-to-end smoke test. Run with POS_SMOKE=1 — uses a throwaway
// userData dir, exercises every stock/money flow, and exits 0/1. Never touches real data.
import { app, dialog, safeStorage } from 'electron'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import type DatabaseType from 'better-sqlite3'
import { LATEST_SCHEMA_VERSION, getDb, openDb, schemaVersion } from './db'
import { getStock } from './services/helpers'
import { imagesDir } from './services/images'
import * as auth from './services/auth'
import * as catalog from './services/catalog'
import * as sales from './services/sales'
import * as parties from './services/parties'
import * as purchases from './services/purchases'
import * as inventory from './services/inventory'
import * as reports from './services/reports'
import * as settings from './services/settings'
import * as expenses from './services/expenses'
import * as subscription from './services/subscription'
import * as googleDriveBackup from './services/googleDriveBackup'
import * as backupArchive from './services/backupArchive'
import * as localBackup from './services/localBackup'
import * as localAutoBackup from './services/localAutoBackup'
import { clearRestartLatchForSmoke } from './services/restart'
import * as batches from './services/batches'
import {
  canAccessReports, canCreatePurchase, canCreateSale, canUsePOS, computeMembershipEnd,
  expiryWarning, shouldLockSales,
} from '../src/shared/subscription'
import { ADJUSTMENT_REASONS, adjustmentReasonLabel, adjustmentSchema } from '../src/shared/schemas'
import { getSession, setSession } from './services/session'

// Native module, kept out of the bundle exactly as the app itself loads it.
const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as typeof DatabaseType

let failures = 0
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok  ${name}`)
  } else {
    failures++
    console.error(`FAIL  ${name}`, detail ?? '')
  }
}
function expectThrow(name: string, fn: () => unknown, msgPart?: string) {
  try {
    fn()
    failures++
    console.error(`FAIL  ${name} — expected error, none thrown`)
  } catch (e) {
    const m = (e as Error).message
    check(name, msgPart ? m.includes(msgPart) : true, m)
  }
}
/**
 * Rewinds a snapshot of this build's database to schema 9, data and all.
 *
 * Migrations 10-13 add columns, one index, and (13) remove the cloud-sync
 * tables and marker column, so undoing them by hand produces a database
 * indistinguishable from one an older build wrote — a far better restore
 * subject than an empty hand-rolled schema, because it carries the shop's real
 * rows through the upgrade. Putting the sync leftovers back matters: it is the
 * only way to prove migration 13 lands cleanly on a populated database that
 * still has them, which is what every existing install looks like. Only these
 * four versions are forgotten, so a later migration added to the app stays
 * marked as applied and does not get replayed on top of itself.
 */
function downgradeToSchema9(file: string) {
  const old = new Database(file, { fileMustExist: true })
  try {
    old.exec(`
DROP INDEX IF EXISTS idx_sales_idem;
ALTER TABLE sales DROP COLUMN idempotency_key;
ALTER TABLE suppliers DROP COLUMN address;
ALTER TABLE suppliers DROP COLUMN notes;
ALTER TABLE categories DROP COLUMN is_active;

-- Put cloud sync back exactly as migration 5 left it, so migration 13 has
-- something real to drop when the restore replays it.
ALTER TABLE shops ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE products ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE inventory_logs ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE customers ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE suppliers ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE sales ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE purchases ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE purchase_orders ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE payments ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE returns ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE expenses ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE print_settings ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE product_batches ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending';

CREATE TABLE sync_settings (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  auto_sync_enabled INTEGER NOT NULL DEFAULT 1,
  sync_frequency TEXT NOT NULL DEFAULT 'daily',
  sync_time TEXT NOT NULL DEFAULT '23:59',
  last_sync_at TEXT,
  next_sync_at TEXT,
  last_sync_status TEXT,
  last_sync_error TEXT,
  manual_sync_allowed INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (shop_id)
);
CREATE TABLE sync_logs (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  sync_type TEXT NOT NULL CHECK (sync_type IN ('auto','manual')),
  status TEXT NOT NULL CHECK (status IN
    ('success','failed','pending','in_progress','conflict','disabled')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT,
  total_records_synced INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sync_logs_shop ON sync_logs(shop_id, started_at DESC);
CREATE TABLE sync_conflicts (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  local_updated_at TEXT,
  cloud_updated_at TEXT,
  conflict_reason TEXT,
  resolution_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (resolution_status IN ('pending','resolved','ignored')),
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX idx_sync_conflicts_shop ON sync_conflicts(shop_id, resolution_status);

-- With rows in them, and a granted sync.manage permission, so the restore is
-- dropping populated tables and a live permission — not empty scaffolding.
INSERT INTO sync_settings (id, shop_id, created_at, updated_at)
  SELECT 'downgrade-sync-settings', id, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z'
    FROM shops LIMIT 1;
INSERT INTO sync_logs (id, shop_id, sync_type, status, started_at, created_at)
  SELECT 'downgrade-sync-log', id, 'auto', 'failed', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z'
    FROM shops LIMIT 1;
INSERT INTO user_permissions (id, shop_id, user_id, permission, created_at)
  SELECT 'downgrade-sync-perm', shop_id, id, 'sync.manage', '2020-01-01T00:00:00.000Z'
    FROM users LIMIT 1;

-- Undo migration 14 as well: no plan-type awareness existed on a schema-9
-- build, so a backup from one carries a lifetime shop with nothing but its
-- status to say so. Replaying 14 has to work that out for itself.
ALTER TABLE subscription_settings DROP COLUMN is_lifetime;
ALTER TABLE subscription_settings DROP COLUMN renewal_count;
ALTER TABLE subscription_settings DROP COLUMN last_renewed_at;
DROP TABLE license_activations;

DELETE FROM schema_migrations WHERE version IN (10, 11, 12, 13, 14);
`)
    old.pragma('wal_checkpoint(TRUNCATE)')
  } finally {
    old.close()
  }
}

/**
 * Un-records migrations without undoing them, so replaying them fails.
 *
 * This is the shape of a backup that cannot be brought forward: the app is
 * certain there is work to do and the work will not apply.
 */
function forgetMigrations(file: string, versions: number[]) {
  const broken = new Database(file, { fileMustExist: true })
  try {
    broken
      .prepare(`DELETE FROM schema_migrations WHERE version IN (${versions.map(() => '?').join(',')})`)
      .run(...versions)
    broken.pragma('wal_checkpoint(TRUNCATE)')
  } finally {
    broken.close()
  }
}

function readSchemaVersion(file: string): number {
  const candidate = new Database(file, { readonly: true, fileMustExist: true })
  try {
    return schemaVersion(candidate)
  } finally {
    candidate.close()
  }
}

async function expectReject(name: string, fn: () => Promise<unknown>, msgPart?: string) {
  try {
    await fn()
    failures++
    console.error(`FAIL  ${name} — expected error, none thrown`)
  } catch (e) {
    const m = (e as Error).message
    check(name, msgPart ? m.includes(msgPart) : true, m)
  }
}

export async function runSmokeTest(): Promise<number> {
  const dir = path.join(os.tmpdir(), `pos-smoke-${process.pid}`)
  fs.mkdirSync(dir, { recursive: true })
  app.setPath('userData', dir)
  openDb()
  console.log('--- POS smoke test ---')

  // A brand-new device may connect Drive before creating a local shop.
  const recoveryStatus = googleDriveBackup.getRecoveryStatus()
  check('fresh install exposes Drive recovery safely', !recoveryStatus.connected)

  // Setup + auth
  auth.setup({
    shopName: 'Smoke Shop', currency: 'Rs', taxPercent: 0,
    ownerName: 'Smoke Owner', phone: '0300-1234567', email: 'owner@example.com',
    address: '1 Test Street', city: 'Lahore', businessType: 'Mini Mart',
    ntn: '1234567-8', strn: 'STRN-123', receiptFooter: 'Come again!',
    adminName: 'Boss', username: 'boss', password: 'test1234',
  })
  check('setup does not auto-login', getSession() === null)
  const setupState = auth.authState()
  check('setup persists the full shop profile',
    !setupState.needsSetup && setupState.shop?.owner_name === 'Smoke Owner' &&
    setupState.shop.city === 'Lahore' && setupState.shop.receipt_footer === 'Come again!')
  const storedAdmin = getDb().prepare('SELECT password_hash FROM users WHERE username = ?').get('boss') as { password_hash: string }
  check('setup stores a password hash, not the password', storedAdmin.password_hash !== 'test1234')
  auth.login({ username: 'boss', password: 'test1234' })
  const admin = getSession()!
  check('login creates admin session', admin.role === 'admin')
  expectThrow('second setup blocked', () =>
    auth.setup({ shopName: 'X', currency: 'Rs', taxPercent: 0, adminName: 'x', username: 'x2', password: 'pppp' })
  )
  expectThrow(
    'pre-setup Drive recovery is blocked after shop creation',
    () => googleDriveBackup.getRecoveryStatus(),
    'only available before shop setup'
  )
  expectThrow('bad login rejected', () => auth.login({ username: 'boss', password: 'wrong' }), 'Invalid')

  // Catalog
  const cat = catalog.createCategory(admin, { name: 'Drinks' })
  const cola = catalog.createProduct(admin, {
    name: 'Cola', sku: null, barcode: '2001112223334', category_id: cat.id,
    unit: 'pcs', cost_price: 5000, sale_price: 8000, tax_percent: 0, min_stock_alert: 5,
  })
  const chips = catalog.createProduct(admin, {
    name: 'Chips', sku: null, barcode: null, category_id: cat.id,
    unit: 'pcs', cost_price: 2000, sale_price: 3000, tax_percent: 10, min_stock_alert: 2,
  })
  check('products created', !!cola.id && !!chips.id)
  expectThrow('duplicate barcode blocked', () =>
    catalog.createProduct(admin, {
      name: 'Fake', sku: null, barcode: '2001112223334', category_id: null,
      unit: 'pcs', cost_price: 1, sale_price: 1, tax_percent: 0, min_stock_alert: 0,
    }), 'already used')
  check('barcode lookup', catalog.getProductByBarcode(admin, '2001112223334')?.id === cola.id)

  // Opening stock via adjustment
  inventory.adjustStock(admin, { product_id: cola.id, quantity_change: 50, reason: 'correction', note: 'opening' })
  inventory.adjustStock(admin, { product_id: chips.id, quantity_change: 20, reason: 'correction' })
  check('opening stock cola=50', getStock(cola.id) === 50, getStock(cola.id))

  // Opening stock declared on the product form itself. It must land in the
  // ledger as an `opening` movement — never as a stock column.
  const openingProduct = catalog.createProduct(admin, {
    name: 'Opening Stock Widget', sku: 'OPEN-1', barcode: null, category_id: cat.id,
    unit: 'pcs', cost_price: 1000, sale_price: 1500, tax_percent: 0, min_stock_alert: 0,
    opening_stock: 12,
  })
  check('opening stock on create derives from the ledger', getStock(openingProduct.id) === 12, getStock(openingProduct.id))
  const openingRows = getDb()
    .prepare('SELECT change_type, quantity_change, reason FROM inventory_logs WHERE product_id = ?')
    .all(openingProduct.id) as { change_type: string; quantity_change: number; reason: string | null }[]
  check('opening stock writes exactly one opening movement',
    openingRows.length === 1 && openingRows[0].change_type === 'opening' &&
    openingRows[0].quantity_change === 12 && openingRows[0].reason === 'opening_stock', openingRows)
  check('opening stock is audited',
    !!getDb().prepare("SELECT 1 FROM audit_logs WHERE action = 'stock.opening'").get())
  const noOpening = catalog.createProduct(admin, {
    name: 'No Opening Widget', sku: 'OPEN-0', barcode: null, category_id: cat.id,
    unit: 'pcs', cost_price: 1000, sale_price: 1500, tax_percent: 0, min_stock_alert: 0,
  })
  check('omitting opening stock writes no movement at all',
    getStock(noOpening.id) === 0 &&
    (getDb().prepare('SELECT COUNT(*) AS n FROM inventory_logs WHERE product_id = ?')
      .get(noOpening.id) as { n: number }).n === 0)
  catalog.updateProduct(admin, {
    id: noOpening.id, name: 'No Opening Widget', sku: 'OPEN-0', barcode: null, category_id: cat.id,
    brand_id: null, unit: 'pcs', cost_price: 1000, sale_price: 1500, tax_percent: 0, min_stock_alert: 0,
  })
  check('editing a product never invents stock', getStock(noOpening.id) === 0)

  // Every adjustment reason the UI offers must be accepted by the service and
  // land on the ledger verbatim, so a stock movement always states its own why.
  for (const r of ADJUSTMENT_REASONS) {
    const sign = r.sign === 'out' ? -1 : 1
    inventory.adjustStock(admin, { product_id: noOpening.id, quantity_change: sign * 1, reason: r.value })
  }
  const reasonRows = getDb()
    .prepare('SELECT reason FROM inventory_logs WHERE product_id = ? AND change_type = ?')
    .all(noOpening.id, 'adjustment') as { reason: string | null }[]
  check('every adjustment reason is accepted and stored',
    ADJUSTMENT_REASONS.every((r) => reasonRows.some((row) => row.reason === r.value)), reasonRows)
  check('new reasons are present', (['expired', 'opening_stock', 'physical_count_correction'] as const)
    .every((v) => reasonRows.some((row) => row.reason === v)))
  check('adjustment notes stay attached to the reason', (() => {
    inventory.adjustStock(admin, {
      product_id: noOpening.id, quantity_change: -1, reason: 'expired', note: 'past use-by',
    })
    const row = getDb()
      .prepare('SELECT reason FROM inventory_logs WHERE product_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get(noOpening.id) as { reason: string }
    return row.reason === 'expired: past use-by' &&
      adjustmentReasonLabel(row.reason) === 'Expired: past use-by'
  })())
  check('unknown reason text is shown untouched',
    adjustmentReasonLabel('sold on invoice INV-1') === 'sold on invoice INV-1')
  expectThrow('an invented reason is refused by the schema', () =>
    adjustmentSchema.parse({ product_id: noOpening.id, quantity_change: 1, reason: 'shrinkage' }))

  // Oversell blocked
  expectThrow('oversell blocked', () =>
    sales.checkout(admin, {
      items: [{ product_id: cola.id, quantity: 999, unit_price: 8000, discount: 0 }],
      bill_discount: 0, payment_method: 'cash', tendered: 99999999, allow_negative_stock: false,
    }), 'Insufficient stock')

  // Cash sale: 2 cola (disc 1000 line) + 3 chips (10% tax)
  // cola: base 16000 - 1000 = 15000, tax 0 → 15000
  // chips: base 9000, tax 900 → 9900 ; subtotal 25000, bill disc 900 → total 24000
  const sale1 = sales.checkout(admin, {
    items: [
      { product_id: cola.id, quantity: 2, unit_price: 8000, discount: 1000 },
      { product_id: chips.id, quantity: 3, unit_price: 3000, discount: 0 },
    ],
    bill_discount: 900, payment_method: 'cash', tendered: 30000, allow_negative_stock: false,
  })
  check('sale1 total = 24000', sale1.total === 24000, sale1.total)
  check('sale1 invoice numbered', sale1.invoice_number === 'INV-000001', sale1.invoice_number)
  check('stock after sale1 cola=48', getStock(cola.id) === 48)
  check('stock after sale1 chips=17', getStock(chips.id) === 17)
  expectThrow('short tender blocked', () =>
    sales.checkout(admin, {
      items: [{ product_id: cola.id, quantity: 1, unit_price: 8000, discount: 0 }],
      bill_discount: 0, payment_method: 'cash', tendered: 100, allow_negative_stock: false,
    }), 'Tendered')

  // Credit sale + limit
  const cust = parties.createCustomer(admin, { name: 'Ali', phone: '0300', credit_limit: 20000 })
  expectThrow('credit limit enforced', () =>
    sales.checkout(admin, {
      items: [{ product_id: cola.id, quantity: 3, unit_price: 8000, discount: 0 }],
      bill_discount: 0, payment_method: 'credit', customer_id: cust.id, allow_negative_stock: false,
    }), 'Credit limit')
  const sale2 = sales.checkout(admin, {
    items: [{ product_id: cola.id, quantity: 2, unit_price: 8000, discount: 0 }],
    bill_discount: 0, payment_method: 'credit', customer_id: cust.id, allow_negative_stock: false,
  })
  const custAfter = parties.listCustomers(admin).find((c) => c.id === cust.id)!
  check('credit sale adds due 16000', custAfter.due_balance === 16000, custAfter.due_balance)

  // Sale return (1 cola from sale2, refund reduces due)
  const detail2 = sales.getSale(admin, sale2.id)
  const saleReturn = sales.returnSale(admin, {
    sale_id: sale2.id, reason: 'damaged', refund_method: 'due',
    items: [{ sale_item_id: detail2.items[0].id, quantity: 1 }],
  })
  // The slip has to be printable now and reprintable months later, so the lines
  // are stored rather than derived from cumulative returned_quantity.
  check('sale return records its lines', saleReturn.items.length === 1, saleReturn.items)
  check('return line names the product', saleReturn.items[0]?.product_name === 'Cola', saleReturn.items[0])
  check('return line amounts sum to the refund',
    saleReturn.items.reduce((a, i) => a + i.amount, 0) === saleReturn.record.refund_amount,
    saleReturn.record.refund_amount)
  check('return slip names who processed it', saleReturn.record.created_by_name === 'Boss', saleReturn.record.created_by_name)
  check('stored return reloads identically',
    sales.getReturn(admin, saleReturn.record.id).items.length === 1)
  check('stock restored after return', getStock(cola.id) === 47, getStock(cola.id))
  const custAfterReturn = parties.listCustomers(admin).find((c) => c.id === cust.id)!
  check('due reduced by refund 8000', custAfterReturn.due_balance === 8000, custAfterReturn.due_balance)
  check('sale2 partially returned', sales.getSale(admin, sale2.id).sale.status === 'partially_returned')
  expectThrow('over-return blocked', () =>
    sales.returnSale(admin, {
      sale_id: sale2.id, reason: 'x', refund_method: 'due',
      items: [{ sale_item_id: detail2.items[0].id, quantity: 5 }],
    }), 'can be returned')

  // Customer payment
  const rcp = parties.receiveCustomerPayment(admin, { party_id: cust.id, amount: 5000, method: 'cash' })
  check('due after payment = 3000',
    parties.listCustomers(admin).find((c) => c.id === cust.id)!.due_balance === 3000)
  // Everything the printed receipt needs is stored on the payment itself: the
  // customer's due moves with every later sale, so a reprint must not re-derive
  // these figures from today's balance.
  check('payment gets a receipt number', /^RCP-/.test(rcp.receipt_number), rcp.receipt_number)
  check('receipt stores the balances as they stood',
    rcp.balance_before === 8000 && rcp.balance_after === 3000, [rcp.balance_before, rcp.balance_after])
  check('receipt names payer and cashier',
    rcp.customer_name === 'Ali' && rcp.created_by_name === 'Boss', [rcp.customer_name, rcp.created_by_name])
  check('receipt is stored against the payment, not rebuilt at print time',
    !!(getDb().prepare('SELECT receipt_number FROM payments WHERE receipt_number = ?').get(rcp.receipt_number)),
    rcp.receipt_number)

  // Purchase with partial payment
  const sup = parties.createSupplier(admin, { name: 'Metro', phone: null })
  const purchase = purchases.createPurchase(admin, {
    supplier_id: sup.id,
    items: [{ product_id: cola.id, quantity: 10, cost_price: 4500 }],
    paid_amount: 20000, method: 'cash',
  })
  check('purchase total 45000', purchase.total === 45000, purchase.total)
  check('stock after purchase cola=57', getStock(cola.id) === 57)
  check('supplier due 25000',
    parties.listSuppliers(admin).find((s) => s.id === sup.id)!.due_balance === 25000)
  check('product cost updated to latest', catalog.listProducts(admin).find((p) => p.id === cola.id)!.cost_price === 4500)

  // Supplier address and notes: optional free text, stored and returned as
  // typed, and searchable so "the one on Ferozepur Road" actually finds them.
  check('a supplier with no address is still valid', sup.address === null && sup.notes === null)
  const withAddress = parties.createSupplier(admin, {
    name: 'Ferozepur Traders', phone: '0300-1234567',
    address: 'Shop 12, Ferozepur Road\nLahore',
    notes: 'Delivers Tuesdays. Ask for Bilal.',
  })
  check('address and notes are stored verbatim',
    withAddress.address === 'Shop 12, Ferozepur Road\nLahore' &&
    withAddress.notes === 'Delivers Tuesdays. Ask for Bilal.')
  check('the detail view carries address and notes', (() => {
    const d = parties.supplierDetail(admin, withAddress.id)
    return d.supplier.address === withAddress.address && d.supplier.notes === withAddress.notes
  })())
  check('suppliers are searchable by address',
    parties.listSuppliers(admin, { search: 'Ferozepur Road' }).length === 1)
  parties.updateSupplier(admin, {
    id: withAddress.id, name: 'Ferozepur Traders', phone: '0300-1234567',
    address: 'Shop 14, Ferozepur Road', notes: null,
  })
  const edited = parties.listSuppliers(admin).find((s) => s.id === withAddress.id)!
  check('address edits save and notes can be cleared',
    edited.address === 'Shop 14, Ferozepur Road' && edited.notes === null)
  parties.updateSupplier(admin, { id: sup.id, name: 'Metro', phone: null })
  check('an update that omits address leaves nothing behind',
    parties.listSuppliers(admin).find((s) => s.id === sup.id)!.address === null)
  expectThrow('another shop cannot edit this supplier', () =>
    parties.updateSupplier({ ...admin, shopId: 'not-this-shop' }, { id: sup.id, name: 'Hijacked' }),
    'not found')

  // Purchase return (2 units, reduce due)
  const pDetail = purchases.getPurchase(admin, purchase.id)
  purchases.returnPurchase(admin, {
    purchase_id: purchase.id, reason: 'expired', refund_method: 'due',
    items: [{ purchase_item_id: pDetail.items[0].id, quantity: 2 }],
  })
  check('stock after purchase return cola=55', getStock(cola.id) === 55)
  check('supplier due after return 16000',
    parties.listSuppliers(admin).find((s) => s.id === sup.id)!.due_balance === 16000)

  // Supplier payment
  parties.paySupplier(admin, { party_id: sup.id, amount: 16000, method: 'cash' })
  check('supplier settled',
    parties.listSuppliers(admin).find((s) => s.id === sup.id)!.due_balance === 0)

  // Reports sanity
  const range = { from: new Date(Date.now() - 3600_000).toISOString(), to: new Date(Date.now() + 3600_000).toISOString() }
  const sr = reports.salesReport(admin, range)
  check('sales report counts 2 sales', sr.totals.count === 2, sr.totals.count)
  check('sales report total 40000', sr.totals.total === 24000 + 16000, sr.totals.total)
  const pl = reports.profitLoss(admin, range)
  check('P/L revenue 40000', pl.revenue === 40000, pl.revenue)
  // COGS: sale1 (2 cola@5000 + 3 chips@2000 = 16000) + sale2 (2 cola@5000, 1 returned → 5000) = 21000
  check('P/L cogs 21000', pl.cogs === 21000, pl.cogs)
  const dash = reports.dashboard(admin)
  check('dashboard low stock present', Array.isArray(dash.lowStock))

  // Users + roles
  const cashier = settings.createUser(admin, { name: 'Cash', username: 'cash', password: '1234', role: 'cashier' })
  check('cashier created', !!cashier.id)
  auth.login({ username: 'cash', password: '1234' })
  const cashSession = getSession()!
  check('cashier session role', cashSession.role === 'cashier')
  const cashierSale = sales.checkout(cashSession, {
    items: [{ product_id: chips.id, quantity: 1, unit_price: 3000, discount: 0 }],
    bill_discount: 0, payment_method: 'cash', tendered: 3300, allow_negative_stock: false,
  })
  check('cashier can sell', cashierSale.total === 3300)
  check('cashier sees only own sales', sales.listSales(cashSession, {}).rows.every((s) => s.cashier_id === cashSession.userId))
  expectThrow('cashier cannot view others sale', () => sales.getSale(cashSession, sale1.id), 'Not allowed')

  // Cost price is management information. It has to be gone from the payload
  // itself, not merely hidden by the screen that draws it.
  const cashierProducts = catalog.listProducts(cashSession)
  check('cashier product list carries no cost_price',
    cashierProducts.length > 0 && cashierProducts.every((p) => !('cost_price' in p)))
  check('admin product list still carries cost_price',
    catalog.listProducts(admin).every((p) => 'cost_price' in p))
  check('cashier barcode lookup carries no cost_price',
    !('cost_price' in catalog.getProductByBarcode(cashSession, '2001112223334')!))
  check('admin barcode lookup still carries cost_price',
    'cost_price' in catalog.getProductByBarcode(admin, '2001112223334')!)
  const cashierSaleDetail = sales.getSale(cashSession, cashierSale.id)
  check('cashier sale items carry no cost_price',
    cashierSaleDetail.items.length > 0 && cashierSaleDetail.items.every((i) => !('cost_price' in i)))
  check('admin sale items still carry cost_price',
    sales.getSale(admin, sale1.id).items.every((i) => 'cost_price' in i))
  const cashierExpiry = batches.expiryReport(cashSession)
  check('cashier expiry report hides stock value', cashierExpiry.totals.value === undefined)
  check('cashier expiry rows hide cost', cashierExpiry.rows.every((r) => !('cost_price' in r)))
  expectThrow('cashier negative-stock override ignored', () =>
    sales.checkout(cashSession, {
      items: [{ product_id: chips.id, quantity: 999, unit_price: 3000, discount: 0 }],
      bill_discount: 0, payment_method: 'cash', tendered: 99999999, allow_negative_stock: true,
    }), 'Insufficient stock')

  // ---- Phase-1 additions ----
  setSession(admin)

  // Brands
  const brand = catalog.createBrand(admin, { name: 'Acme' })
  check('brand created', !!brand.id)
  check('brand dedupes case-insensitively', catalog.createBrand(admin, { name: 'acme' }).id === brand.id)
  catalog.updateProduct(admin, {
    id: cola.id, name: 'Cola', sku: null, barcode: '2001112223334', category_id: cat.id,
    brand_id: brand.id, unit: 'pcs', cost_price: 4500, sale_price: 8000, tax_percent: 0, min_stock_alert: 5,
  })
  check('product brand set', catalog.listProducts(admin).find((p) => p.id === cola.id)!.brand_name === 'Acme')

  // Categories: renamed and retired, never deleted. A retired category must
  // vanish from the pickers while every product already in it keeps the name.
  const retiring = catalog.createCategory(admin, { name: 'Seasonal' })
  check('category starts active', retiring.is_active === 1)
  const seasonal = catalog.createProduct(admin, {
    name: 'Christmas Cola', sku: 'XMAS-1', barcode: null, category_id: retiring.id,
    unit: 'pcs', cost_price: 1000, sale_price: 1500, tax_percent: 0, min_stock_alert: 0,
    opening_stock: 3,
  })
  const renamed = catalog.updateCategory(admin, { id: retiring.id, name: 'Seasonal lines' })
  check('category renamed', renamed.name === 'Seasonal lines')
  check('rename reaches the products already in it',
    catalog.listProducts(admin).find((p) => p.id === seasonal.id)!.category_name === 'Seasonal lines')
  check('renaming is audited',
    !!getDb().prepare("SELECT 1 FROM audit_logs WHERE action = 'category.update'").get())
  expectThrow('two categories cannot share a name', () =>
    catalog.updateCategory(admin, { id: retiring.id, name: 'Drinks' }), 'already called')
  check('a category from another shop cannot be renamed', (() => {
    try {
      catalog.updateCategory({ ...admin, shopId: 'not-this-shop' }, { id: retiring.id, name: 'Hijacked' })
      return false
    } catch {
      return true
    }
  })())

  check('products still in the category before retiring',
    catalog.countCategoryProducts(admin, retiring.id) === 1)
  const retired = catalog.setCategoryActive(admin, { id: retiring.id, is_active: false })
  check('category retired', retired.is_active === 0)
  check('retired category is hidden from the picker',
    !catalog.listCategories(admin).some((c) => c.id === retiring.id))
  check('the manage screen still sees it',
    catalog.listCategories(admin, { include_inactive: true }).some((c) => c.id === retiring.id))
  check('retiring is audited',
    !!getDb().prepare("SELECT 1 FROM audit_logs WHERE action = 'category.deactivate'").get())
  check('nothing is deleted: the product keeps its category',
    catalog.listProducts(admin).find((p) => p.id === seasonal.id)!.category_name === 'Seasonal lines')
  check('the product keeps its stock and stays sellable',
    getStock(seasonal.id) === 3 &&
    catalog.listProducts(admin, { category_id: retiring.id }).length === 1)
  check('re-adding a retired name revives the same row',
    catalog.createCategory(admin, { name: 'seasonal lines' }).id === retiring.id)
  check('reviving puts it back in the picker',
    catalog.listCategories(admin).some((c) => c.id === retiring.id))
  catalog.setCategoryActive(admin, { id: retiring.id, is_active: false })
  check('reactivating is audited',
    !!getDb().prepare("SELECT 1 FROM audit_logs WHERE action = 'category.activate'").get())

  // Hold / resume sale
  const held = sales.holdSale(admin, {
    label: 'Ali counter 2',
    items: [{ product_id: cola.id, quantity: 2, discount: 0 }],
  })
  check('sale held', sales.listHeldSales(admin).length === 1)
  const resumed = sales.resumeHeldSale(admin, held.id)
  check('held cart returned', JSON.parse(resumed.cart_json).length === 1)
  check('held sale consumed on resume', sales.listHeldSales(admin).length === 0)
  expectThrow('double resume blocked', () => sales.resumeHeldSale(admin, held.id), 'not found')

  // Cancel sale (full reversal)
  const stockBeforeCancel = getStock(chips.id)
  const sale3 = sales.checkout(admin, {
    items: [{ product_id: chips.id, quantity: 2, unit_price: 3000, discount: 0 }],
    bill_discount: 0, payment_method: 'cash', tendered: 10000, allow_negative_stock: false,
  })
  sales.cancelSale(admin, { id: sale3.id })
  check('cancel restores stock', getStock(chips.id) === stockBeforeCancel, getStock(chips.id))
  check('cancelled sale status returned', sales.getSale(admin, sale3.id).sale.status === 'returned')
  expectThrow('double cancel blocked', () => sales.cancelSale(admin, { id: sale3.id }), 'already')

  // Return history (sale2 return + purchase return + cancellation = 3)
  const retList = sales.listReturns(admin, {})
  check('returns history has 3 events', retList.total === 3, retList.total)
  check('cancellation flagged', retList.rows.some((r) => r.is_cancellation === 1))

  // Purchase order lifecycle
  const po = purchases.createPurchaseOrder(admin, {
    supplier_id: sup.id,
    expected_date: '2026-09-01',
    note: 'Payment 30 days from delivery',
    items: [{ product_id: cola.id, quantity: 5, cost_price: 4000 }],
  })
  check('PO numbered', po.po_number === 'PO-000001', po.po_number)
  // The supplier's copy needs a delivery date and an authorising name; both come
  // off the order itself, not from whoever happens to open it later.
  const poDoc = purchases.getPurchaseOrder(admin, po.id)
  check('PO stores the delivery date asked for', poDoc.order.expected_date === '2026-09-01', poDoc.order.expected_date)
  check('PO names who raised it', poDoc.order.created_by_name === 'Boss', poDoc.order.created_by_name)
  check('PO carries its terms', poDoc.order.note === 'Payment 30 days from delivery', poDoc.order.note)
  check('PO lists its items for the printed document', poDoc.items.length === 1, poDoc.items)
  check('PO does not move stock', getStock(cola.id) === 55)
  const stockBeforeReceive = getStock(cola.id)
  const poPurchase = purchases.receivePurchaseOrder(admin, { id: po.id, paid_amount: 0, method: 'cash' })
  check('PO receive creates invoice', poPurchase.total === 20000, poPurchase.total)
  check('PO receive moves stock +5', getStock(cola.id) === stockBeforeReceive + 5)
  check('PO marked received', purchases.getPurchaseOrder(admin, po.id).order.status === 'received')
  expectThrow('receive twice blocked', () =>
    purchases.receivePurchaseOrder(admin, { id: po.id, paid_amount: 0, method: 'cash' }), 'already')
  const po2 = purchases.createPurchaseOrder(admin, {
    supplier_id: sup.id, items: [{ product_id: cola.id, quantity: 1, cost_price: 4000 }],
  })
  purchases.cancelPurchaseOrder(admin, po2.id)
  check('PO cancelled', purchases.getPurchaseOrder(admin, po2.id).order.status === 'cancelled')

  // Expenses
  const expCat = expenses.createExpenseCategory(admin, { name: 'Rent' })
  const today = new Date().toISOString().slice(0, 10)
  expenses.createExpense(admin, { category_id: expCat.id, amount: 100000, note: 'July rent', expense_date: today })
  expenses.createExpense(admin, { category_id: expCat.id, amount: 5000, note: null, expense_date: today })
  check('expense list total 105000', expenses.listExpenses(admin, {}).total === 105000)
  const expRep = expenses.expenseReport(admin, range)
  check('expense report by category', expRep.byCategory[0]?.total === 105000, expRep.byCategory)
  const pl2 = reports.profitLoss(admin, range)
  check('P/L net profit includes expenses', pl2.netProfit === pl2.grossProfit - 105000, pl2.netProfit)

  // Ledgers
  const custLedger = parties.customerLedger(admin, cust.id)
  const lastBalance = custLedger[custLedger.length - 1]?.balance
  check('customer ledger balances to due', lastBalance === 3000, lastBalance)
  const supLedger = parties.supplierLedger(admin, sup.id)
  check('supplier ledger has entries', supLedger.length > 0)
  check('supplier ledger ends at due', supLedger[supLedger.length - 1].balance ===
    parties.listSuppliers(admin).find((s) => s.id === sup.id)!.due_balance, supLedger[supLedger.length - 1])

  // Dashboard. The operational half is for everyone; the money half is computed
  // in the main process only for a session allowed to see cost, and has to agree
  // with the reports for the same day or the owner is reading two sets of books.
  const dash2 = reports.dashboard(admin)
  check('dashboard overview has low-stock operations', Array.isArray(dash2.lowStock))
  check('dashboard stock-health totals cover products',
    dash2.stockHealth.total === dash2.stockHealth.healthy + dash2.stockHealth.low + dash2.stockHealth.out)
  check('dashboard category distribution is available', Array.isArray(dash2.categories))
  check('total products on the tile is the whole catalogue',
    dash2.stockHealth.total === catalog.listProducts(admin).length, dash2.stockHealth.total)

  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  const dayRange = { from: midnight.toISOString(), to: new Date(Date.now() + 3600_000).toISOString() }
  const dayPl = reports.profitLoss(admin, dayRange)
  const daySales = reports.salesReport(admin, dayRange)
  const dashToday = dash2.today!
  check("today's takings are net of today's refunds",
    dashToday.total === dayPl.netRevenue, [dashToday.total, dayPl.netRevenue])
  check("today's sale count matches the sales report",
    dashToday.count === daySales.totals.count, dashToday.count)
  check("today's refunds match the sales report",
    dashToday.refunds === daySales.refunds, dashToday.refunds)
  check('gross profit on the tile equals the P/L gross profit',
    dashToday.grossProfit === dayPl.grossProfit, [dashToday.grossProfit, dayPl.grossProfit])
  check('gross profit is takings less cost of goods sold',
    dashToday.grossProfit === dashToday.total - dayPl.cogs)

  // Stock value comes off the same ledger every other stock figure comes off.
  const valueFromLedger = (getDb()
    .prepare(
      `SELECT COALESCE(SUM(st.stock * p.cost_price),0) AS v FROM products p
       JOIN (SELECT product_id, SUM(quantity_change) AS stock FROM inventory_logs GROUP BY product_id) st
         ON st.product_id = p.id
       WHERE p.shop_id = ? AND p.is_deleted = 0 AND st.stock > 0`
    )
    .get(admin.shopId) as { v: number }).v
  check('stock value is stock on hand priced at cost',
    dash2.stockValue === valueFromLedger, [dash2.stockValue, valueFromLedger])
  check('stock value is a real figure by now', (dash2.stockValue ?? 0) > 0, dash2.stockValue)

  const recent = dash2.recentSales!
  check('recent sales are listed', recent.length > 0)
  check('recent sales are capped at eight', recent.length <= 8, recent.length)
  check('recent sales are newest first',
    recent.every((s, i) => i === 0 || recent[i - 1].created_at >= s.created_at))
  check('recent sales carry everything the row prints',
    recent.every((s) => !!s.invoice_number && !!s.created_at &&
      typeof s.total === 'number' && typeof s.item_count === 'number'))

  // A cashier calling the service directly gets the operational half and nothing
  // else. The route is admin-only; this is the second lock, in the main process.
  const cashierDash = reports.dashboard(cashSession)
  check('a cashier still gets the operational half of the dashboard',
    Array.isArray(cashierDash.lowStock) && !!cashierDash.stockHealth)
  check('a cashier gets no takings, profit, stock value or sales list',
    cashierDash.today === undefined && cashierDash.stockValue === undefined &&
    cashierDash.recentSales === undefined)
  const custRep = reports.customerReport(admin, range)
  check('customer report rows', custRep.rows.length >= 1)
  const supRep = reports.supplierReport(admin, range)
  check('supplier report totals', supRep.totals.purchase_total > 0)

  // New report suite
  const daily = reports.salesSeries(admin, { ...range, group: 'day' })
  const srNow = reports.salesReport(admin, range)
  check('daily series matches sales report count', daily.totals.count === srNow.totals.count, daily.totals)
  check('daily series matches sales report total', daily.totals.total === srNow.totals.total, daily.totals)
  const monthly = reports.salesSeries(admin, { ...range, group: 'month' })
  check('monthly series has one bucket', monthly.rows.length === 1, monthly.rows)
  check('series profit = total - cogs', daily.rows.every((r) => r.profit === r.total - r.cogs))

  const prodSales = reports.productSales(admin, range)
  const colaRow = prodSales.find((r) => r.id === cola.id)
  check('product sales: cola qty 4, returned 1', colaRow?.qty === 4 && colaRow?.returned === 1, colaRow)
  check('product sales profit consistent', prodSales.every((r) => r.profit === r.revenue - r.cogs))

  const catSales = reports.categorySales(admin, range)
  check('category sales has rows', catSales.length >= 1 && catSales[0].revenue > 0, catSales)

  const slow = reports.slowMovers(admin, range)
  check('slow movers lists products', slow.length >= 1)
  check('slow movers sorted by qty sold asc', slow.every((r, i) => i === 0 || r.qty_sold >= slow[i - 1].qty_sold))

  const purchRep = reports.purchaseReport(admin, range)
  check('purchase report: 2 purchases, 65000 total', purchRep.totals.count === 2 && purchRep.totals.total === 65000, purchRep.totals)
  check('purchase report: paid 20000, due 45000', purchRep.totals.paid === 20000 && purchRep.totals.due === 45000, purchRep.totals)
  check('purchase report: 1 return of 9000', purchRep.returns.count === 1 && purchRep.returns.total === 9000, purchRep.returns)

  const retRep = reports.returnsReport(admin, range)
  check('returns report: 3 rows', retRep.rows.length === 3, retRep.rows.length)
  check('returns report: 2 sale-side, 1 purchase', retRep.sale.count === 2 && retRep.purchase.count === 1, retRep)
  check('returns report: purchase refunds 9000', retRep.purchase.total === 9000, retRep.purchase)

  const payRep = reports.paymentMethodReport(admin, range)
  check('payment report: credit sales listed by tender', payRep.sales.some((m) => m.method === 'credit'))
  check('payment report: cash sales flow in', payRep.flows.some((f) => f.reference_type === 'sale' && f.direction === 'in' && f.total > 0))
  check('payment report: purchase flow out', payRep.flows.some((f) => f.reference_type === 'purchase' && f.direction === 'out'))

  const cf = reports.cashFlow(admin, range)
  check('cash flow net = in - out', cf.net === cf.inflows.total - cf.outflows.total, cf)
  check('cash flow inflow parts sum', cf.inflows.total === cf.inflows.sales + cf.inflows.customerPayments + cf.inflows.purchaseRefunds)
  check('cash flow expenses 105000', cf.outflows.expenses === 105000, cf.outflows)
  check('cash flow method net consistent', cf.byMethod.cash.net === cf.byMethod.cash.in - cf.byMethod.cash.out)

  // Day book, cash drawer, aging, stock movements, cash book, product ledger
  const dayb = reports.dayBook(admin, range)
  check('day book has rows', dayb.rows.length > 0)
  check('day book net = in - out', dayb.summary.netCash === dayb.summary.cashIn - dayb.summary.cashOut, dayb.summary)
  check('day book chronological', dayb.rows.every((r, i) => i === 0 || r.at >= dayb.rows[i - 1].at))
  check('day book cash agrees with cash flow', dayb.summary.netCash === cf.net, { daybook: dayb.summary.netCash, cashflow: cf.net })

  const drawer = reports.cashDrawer(admin, range)
  check('drawer rows internally consistent', drawer.rows.every(
    (r) => r.expected_cash === r.cash_sales + r.due_collected_cash - r.refunds_paid_cash
  ), drawer.rows)
  check('drawer totals sum rows', drawer.totals.expected_cash === drawer.rows.reduce((a, r) => a + r.expected_cash, 0))

  const aging = reports.duesAging(admin)
  check('customer aging buckets sum to due', aging.customers.every((c) => c.b0 + c.b1 + c.b2 + c.b3 === c.due_balance), aging.customers)
  check('supplier aging buckets sum to due', aging.suppliers.every((s) => s.b0 + s.b1 + s.b2 + s.b3 === s.due_balance), aging.suppliers)

  const moves = reports.stockMovements(admin, range)
  check('stock movements has rows', moves.rows.length > 0)
  check('stock movement summary covers rows', moves.byType.reduce((a, t) => a + t.count, 0) >= moves.rows.length)
  const salesOnly = reports.stockMovements(admin, { ...range, change_type: 'sale' })
  check('stock movement type filter works', salesOnly.rows.every((r) => r.change_type === 'sale'))

  const book = reports.cashBook(admin, range)
  check('cash book net = in - out', book.totals.net === book.totals.in - book.totals.out, book.totals)
  check('cash book running balance ends at net', book.rows.length > 0 && book.rows[book.rows.length - 1].balance === book.totals.net)
  check('cash book agrees with cash flow', book.totals.net === cf.net, { cashbook: book.totals.net, cashflow: cf.net })

  const colaLedger = inventory.productLedger(admin, cola.id)
  check('product ledger has entries', colaLedger.length > 0)
  check('product ledger top balance = current stock', colaLedger[0]?.balance === getStock(cola.id), colaLedger[0])

  // Auth: change password, profile, recovery
  auth.changePassword(admin, { current_password: 'test1234', new_password: 'newpass1' })
  expectThrow('old password no longer works', () => auth.login({ username: 'boss', password: 'test1234' }), 'Invalid')
  auth.login({ username: 'boss', password: 'newpass1' })
  check('new password works', getSession()?.username === 'boss')
  auth.updateProfile(getSession()!, { name: 'Big Boss' })
  check('profile name updated', getSession()?.name === 'Big Boss')
  const rc = settings.getRecoveryCode(getSession()!)
  check('recovery code exists', typeof rc.recovery_code === 'string' && rc.recovery_code.length >= 8)
  expectThrow('bad recovery code rejected', () =>
    auth.recoverPassword({ username: 'boss', recovery_code: 'WRONG', new_password: 'x1234' }), 'Invalid recovery code')
  auth.recoverPassword({ username: 'boss', recovery_code: rc.recovery_code, new_password: 'recovered1' })
  auth.login({ username: 'boss', password: 'recovered1' })
  check('recovered password works', getSession()?.username === 'boss')

  // Cashier restrictions on new features
  auth.login({ username: 'cash', password: '1234' })
  const cash2 = getSession()!
  sales.holdSale(cash2, { label: null, items: [{ product_id: chips.id, quantity: 1, discount: 0 }] })
  const adminSession = { ...admin, name: 'Big Boss' }
  check('admin sees cashier held sales', sales.listHeldSales(adminSession).length === 1)
  const cashierHeld = sales.listHeldSales(cash2)
  check('cashier sees own held sale', cashierHeld.length === 1)
  sales.deleteHeldSale(cash2, cashierHeld[0].id)

  // ---- Settings module: shop profile, subscription, backups ----
  setSession(admin)

  // Shop profile fields persist
  const updatedShop = settings.updateShop(admin, {
    name: 'Smoke Shop', currency: 'PKR', tax_percent: 0, receipt_footer: 'Thank you!',
    owner_name: 'Boss', phone: '0300-1234567', email: 'boss@shop.pk',
    address: 'Main Bazaar', city: 'Lahore', business_type: 'Kiryana Store',
    ntn: '1234567-8', strn: '32-77-8765-432-19',
  })
  check('shop profile fields persist', updatedShop.city === 'Lahore' &&
    updatedShop.business_type === 'Kiryana Store' && updatedShop.ntn === '1234567-8')

  // Trial auto-created on first read, 7 days, full access
  const sub = subscription.getStatusView(admin)
  check('trial auto-created active', sub.status === 'trial_active' && sub.plan_type === 'trial')
  check('trial is 7 days', sub.remaining_trial_days >= 6 && sub.remaining_trial_days <= 7, sub.remaining_trial_days)

  // Access-control helpers (pure)
  check('active statuses have full access', (['trial_active', 'membership_active', 'lifetime_active'] as const)
    .every((st) => canUsePOS(st) && canCreateSale(st) && canCreatePurchase(st) && !shouldLockSales(st)))
  check('expired statuses lock sales, keep reports', (['trial_expired', 'membership_expired', 'suspended'] as const)
    .every((st) => !canCreateSale(st) && !canCreatePurchase(st) && canAccessReports(st) && shouldLockSales(st)))

  // Invalid license key never activates
  let invalidKeyThrew = false
  try {
    await subscription.activateLicense(admin, { license_key: 'AAAA-AAAA-AAAA-AAAA' })
  } catch {
    invalidKeyThrew = true
  }
  check('invalid license key rejected', invalidKeyThrew)
  check('status unchanged after invalid key', subscription.getStatusView(admin).status === 'trial_active')

  // Force trial expiry: transact gate closes, old data stays readable
  getDb().prepare('UPDATE subscription_settings SET trial_ends_at = ? WHERE shop_id = ?')
    .run(new Date(Date.now() - 86_400_000).toISOString(), admin.shopId)
  check('expired trial derived on read', subscription.subscriptionStatus(admin.shopId) === 'trial_expired')
  expectThrow('expired trial blocks transact gate', () => subscription.assertCanTransact(admin.shopId), 'locked')
  check('reports readable while expired', reports.salesReport(admin, range).totals.count > 0)
  check('sales history readable while expired', sales.listSales(admin, {}).rows.length > 0)

  // ---- License plans: monthly, yearly, lifetime ----
  // Order matters: lifetime is terminal (no key may follow it), so the two
  // renewable plans are exercised first, on the same shop, in the order a real
  // shop would meet them — activate, renew early, renew on the day, renew late.

  // Whole days between now and an ISO instant; the same ceil the app reports.
  const daysUntil = (iso: string | null) =>
    iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000) : 0
  // Rewrite the stored expiry to set up a renewal case, without faking the clock.
  const setMembershipEnd = (iso: string) =>
    getDb().prepare('UPDATE subscription_settings SET membership_ends_at = ? WHERE shop_id = ?')
      .run(iso, admin.shopId)

  // The plan is carried by the key itself and read back before anything is stored.
  check('key encodes its plan', (['monthly', 'yearly', 'lifetime'] as const)
    .every((p) => subscription.planFromKey(subscription.generateLicenseKey(p)) === p))
  check('generated keys validate offline', (['monthly', 'yearly', 'lifetime'] as const)
    .every((p) => {
      const v = subscription.validateKeyOffline(subscription.generateLicenseKey(p))
      return v.valid && v.plan_type === p
    }))

  // Pure renewal arithmetic, independent of any stored row.
  const t0 = '2026-01-01T00:00:00.000Z'
  check('monthly term is 30 days from activation',
    computeMembershipEnd('monthly', t0, null) === '2026-01-31T00:00:00.000Z')
  check('yearly term is 365 days from activation',
    computeMembershipEnd('yearly', t0, null) === '2027-01-01T00:00:00.000Z')
  check('lifetime stores no expiry at all', computeMembershipEnd('lifetime', t0, null) === null)
  check('early renewal stacks on the days left',
    computeMembershipEnd('monthly', t0, '2026-01-10T00:00:00.000Z') === '2026-02-09T00:00:00.000Z')
  check('renewal on the exact expiry instant runs a full term from then',
    computeMembershipEnd('monthly', t0, t0) === '2026-01-31T00:00:00.000Z')
  check('renewal after a lapse runs a full term from today, losing nothing',
    computeMembershipEnd('monthly', t0, '2025-12-01T00:00:00.000Z') === '2026-01-31T00:00:00.000Z')

  // (1) Monthly key on an expired trial: 30-day expiry stored, gate reopens.
  const monthlyKey = subscription.generateLicenseKey('monthly')
  const monthlyPlan = await subscription.activateLicense(admin, { license_key: monthlyKey })
  check('monthly key activates', monthlyPlan.status === 'membership_active' && monthlyPlan.plan_type === 'monthly')
  check('monthly expiry is 30 days out', daysUntil(monthlyPlan.membership_ends_at) === 30, monthlyPlan.membership_ends_at)
  check('monthly is not lifetime', !monthlyPlan.is_lifetime && monthlyPlan.remaining_membership_days === 30)
  check('monthly offers renewal', monthlyPlan.renewal_available && monthlyPlan.renewal_count === 0)
  subscription.assertCanTransact(admin.shopId) // must not throw
  check('monthly membership opens the transact gate', true)

  // (2) The same key can never be replayed — otherwise one key renews forever.
  await subscription.activateLicense(admin, { license_key: monthlyKey }).then(
    () => check('used key cannot be entered again', false),
    (e: Error) => check('used key cannot be entered again', e.message.includes('already been used'))
  )
  check('replay leaves the expiry untouched',
    daysUntil(subscription.getStatusView(admin).membership_ends_at) === 30)

  // (3) Renewing early with 30 days left → 60, not 30. Nothing paid for is lost.
  const renewEarly = await subscription.activateLicense(admin, {
    license_key: subscription.generateLicenseKey('monthly'),
  })
  check('early renewal adds a term on top of the remainder', daysUntil(renewEarly.membership_ends_at) === 60)
  check('renewal is counted and dated', renewEarly.renewal_count === 1 && !!renewEarly.last_renewed_at)
  check('renewal keeps the original start date',
    renewEarly.membership_started_at === monthlyPlan.membership_started_at)

  // (4) Renewed at the exact moment of expiry: a full term from that moment.
  setMembershipEnd(new Date().toISOString())
  const renewOnDay = await subscription.activateLicense(admin, {
    license_key: subscription.generateLicenseKey('monthly'),
  })
  check('renewal on the expiry day gives a full 30 days', daysUntil(renewOnDay.membership_ends_at) === 30)

  // (5) Renewed 5 days after lapsing: 30 days from today, not 25.
  setMembershipEnd(new Date(Date.now() - 5 * 86_400_000).toISOString())
  check('lapsed membership is derived on read',
    subscription.subscriptionStatus(admin.shopId) === 'membership_expired')
  expectThrow('lapsed membership blocks the transact gate',
    () => subscription.assertCanTransact(admin.shopId), 'locked')
  const renewLate = await subscription.activateLicense(admin, {
    license_key: subscription.generateLicenseKey('monthly'),
  })
  check('renewal after a lapse gives a full 30 days', daysUntil(renewLate.membership_ends_at) === 30)
  check('renewal after a lapse reopens the gate', renewLate.status === 'membership_active')
  subscription.assertCanTransact(admin.shopId)

  // (6) Expiry warnings escalate 7 → 3 → 1 day, and never fire without an end date.
  check('no warning more than a week out', expiryWarning(new Date(Date.now() + 8 * 86_400_000).toISOString()) === 'none')
  check('warning a week out', expiryWarning(new Date(Date.now() + 7 * 86_400_000).toISOString()) === 'week')
  check('warning three days out', expiryWarning(new Date(Date.now() + 3 * 86_400_000).toISOString()) === 'soon')
  check('warning on the last day', expiryWarning(new Date(Date.now() + 12 * 3_600_000).toISOString()) === 'last_day')
  check('expired warning once past', expiryWarning(new Date(Date.now() - 3_600_000).toISOString()) === 'expired')
  check('no expiry date, no warning', expiryWarning(null) === 'none')

  // (7) A yearly key after a lapse: 365 days, plan switches, gate reopens.
  setMembershipEnd(new Date(Date.now() - 86_400_000).toISOString())
  const yearly = await subscription.activateLicense(admin, {
    license_key: subscription.generateLicenseKey('yearly'),
  })
  check('yearly key activates', yearly.status === 'membership_active' && yearly.plan_type === 'yearly')
  check('yearly expiry is 365 days out', daysUntil(yearly.membership_ends_at) === 365, yearly.membership_ends_at)
  check('yearly is not lifetime and still renewable', !yearly.is_lifetime && yearly.renewal_available)

  // (8) Lifetime key: no expiry stored, no countdown, no renewal offered.
  const lifetimeKey = subscription.generateLicenseKey('lifetime')
  const activated = await subscription.activateLicense(admin, { license_key: lifetimeKey })
  check('lifetime key activates', activated.status === 'lifetime_active' && activated.plan_type === 'lifetime')
  check('lifetime stores no expiry', activated.is_lifetime && activated.membership_ends_at === null)
  check('lifetime shows no countdown',
    activated.remaining_membership_days === 0 && activated.expiry_warning === 'none')
  check('lifetime offers no renewal', !activated.renewal_available)
  check('lifetime clears the stored expiry date',
    (getDb().prepare('SELECT membership_ends_at, is_lifetime FROM subscription_settings WHERE shop_id = ?')
      .get(admin.shopId) as { membership_ends_at: string | null; is_lifetime: number })
      .membership_ends_at === null)
  check('license masked to last 4', activated.license_key_masked === `••••-••••-••••-${lifetimeKey.slice(-4)}`)
  check('offline re-validation via cache', subscription.validateKeyOffline(lifetimeKey).valid)
  subscription.assertCanTransact(admin.shopId) // must not throw
  check('transact gate reopens after activation', true)

  // (9) No expiry logic can ever touch a lifetime membership. Even a past date
  // written straight into the row — a wrong clock, a restored backup — is ignored.
  setMembershipEnd(new Date(Date.now() - 400 * 86_400_000).toISOString())
  check('lifetime survives a past expiry date in the row',
    subscription.subscriptionStatus(admin.shopId) === 'lifetime_active')
  subscription.assertCanTransact(admin.shopId)
  check('lifetime never blocks the transact gate', true)
  check('lifetime still reports no expiry to the UI',
    subscription.getStatusView(admin).membership_ends_at === null &&
    subscription.getStatusView(admin).expiry_warning === 'none')

  // (10) Lifetime is terminal: no later key may extend it or downgrade it.
  await subscription.activateLicense(admin, { license_key: subscription.generateLicenseKey('monthly') }).then(
    () => check('lifetime refuses further keys', false),
    (e: Error) => check('lifetime refuses further keys', e.message.includes('never expires'))
  )
  check('lifetime plan unchanged after a refused key',
    subscription.getStatusView(admin).plan_type === 'lifetime')

  // (11) Every accepted key is on record, with its plan and what it did.
  const activations = getDb()
    .prepare('SELECT plan_type, kind, expires_at FROM license_activations WHERE shop_id = ? ORDER BY rowid')
    .all(admin.shopId) as { plan_type: string; kind: string; expires_at: string | null }[]
  check('activation history records every key', activations.length === 6, activations.length)
  check('first key is the activation, the rest are renewals',
    activations[0].kind === 'activation' && activations.slice(1).every((a) => a.kind === 'renewal'))
  check('history carries the plan of each key',
    activations.map((a) => a.plan_type).join(',') === 'monthly,monthly,monthly,monthly,yearly,lifetime',
    activations.map((a) => a.plan_type))
  check('only the lifetime row has no expiry',
    activations.filter((a) => a.expires_at === null).length === 1)

  // Google Drive backup migration and safe defaults (network/OAuth is not used in smoke tests).
  const driveBackupStatus = googleDriveBackup.getStatus(admin)
  check('Drive backup defaults are scheduled daily',
    driveBackupStatus.auto_backup_frequency === 'daily' && driveBackupStatus.backup_time === '02:00' &&
    driveBackupStatus.include_images && driveBackupStatus.retention_count === 7 && !!driveBackupStatus.next_backup_at)
  check('Drive backup starts disconnected without credentials', !driveBackupStatus.connected)

  // Cloud record sync is gone. Its three tables and the sync_status marker column
  // must be absent from a freshly migrated database, and selling must not depend
  // on any of it — this shop's data never leaves the machine.
  const syncTables = getDb()
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN ('sync_settings', 'sync_logs', 'sync_conflicts')`
    )
    .all() as { name: string }[]
  check('cloud sync tables are gone', syncTables.length === 0, syncTables)
  const syncStatusColumns = (
    getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
  ).filter((t) =>
    (getDb().prepare(`PRAGMA table_info(${t.name})`).all() as { name: string }[])
      .some((c) => c.name === 'sync_status')
  )
  check('no table carries a sync_status column', syncStatusColumns.length === 0, syncStatusColumns)
  const saleWithNoCloud = sales.checkout(admin, {
    items: [{ product_id: chips.id, quantity: 1, unit_price: 3000, discount: 0 }],
    bill_discount: 0, payment_method: 'cash', tendered: 3300, allow_negative_stock: false,
  })
  check('POS sells with no cloud configured at all', saleWithNoCloud.total === 3300)


  // ---- Batch & expiry tracking (optional, shop-level) ----
  // Off by default: nothing about it may show up for a general retail shop.
  check('batch tracking off by default', !batches.getBatchSettings(admin.shopId).batch_tracking_enabled)
  check('expiry report reports itself disabled', batches.expiryReport(admin).enabled === false)
  check('expiry report empty while disabled', batches.expiryReport(admin).rows.length === 0)
  check('product batches empty while disabled', batches.productBatches(admin, cola.id).length === 0)
  const colaStockBeforeBatches = getStock(cola.id)
  const untrackedSale = sales.checkout(admin, {
    items: [{ product_id: cola.id, quantity: 1, unit_price: 8000, discount: 0 }],
    bill_discount: 0, payment_method: 'cash', tendered: 8000, allow_negative_stock: false,
  })
  check('sales work untouched while tracking is off', getStock(cola.id) === colaStockBeforeBatches - 1)
  const untrackedMovements = getDb()
    .prepare('SELECT batch_id FROM inventory_logs WHERE reference_id = ?')
    .all(untrackedSale.id) as { batch_id: string | null }[]
  check('untracked sale writes no batch', untrackedMovements.every((m) => m.batch_id === null))

  batches.updateBatchSettings(admin, { batch_tracking_enabled: true, expiry_alert_days: 30 })
  check('batch tracking enabled', batches.getBatchSettings(admin.shopId).batch_tracking_enabled)
  check('alert window stored', batches.getBatchSettings(admin.shopId).expiry_alert_days === 30)

  const day = (offset: number) =>
    new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

  // Two batches of the same product: one nearly out of date, one good for months.
  const milk = catalog.createProduct(admin, {
    name: 'Milk', sku: 'MILK-1', barcode: null, category_id: cat.id,
    unit: 'pcs', cost_price: 10000, sale_price: 12000, tax_percent: 0, min_stock_alert: 2,
    batch_number: 'OLD-1', expiry_date: day(10),
  })
  purchases.createPurchase(admin, {
    supplier_id: sup.id,
    items: [{ product_id: milk.id, quantity: 6, cost_price: 10000, batch_number: 'OLD-1', expiry_date: day(10) }],
    paid_amount: 60000, method: 'cash',
  })
  purchases.createPurchase(admin, {
    supplier_id: sup.id,
    items: [{ product_id: milk.id, quantity: 4, cost_price: 11000, batch_number: 'NEW-1', expiry_date: day(200) }],
    paid_amount: 44000, method: 'cash',
  })
  check('purchases add stock to both batches', getStock(milk.id) === 10, getStock(milk.id))
  const milkBatches = batches.productBatches(admin, milk.id)
  check('two batches held', milkBatches.length === 2, milkBatches)
  check('earliest expiry sorts first', milkBatches[0].batch_number === 'OLD-1', milkBatches)
  check('per-batch stock derived from the ledger',
    milkBatches[0].stock === 6 && milkBatches[1].stock === 4, milkBatches)

  // FEFO: the old batch must empty before the new one is touched.
  const fefoSale = sales.checkout(admin, {
    items: [{ product_id: milk.id, quantity: 7, unit_price: 12000, discount: 0 }],
    bill_discount: 0, payment_method: 'cash', tendered: 84000, allow_negative_stock: false,
  })
  const afterFefo = batches.productBatches(admin, milk.id)
  check('FEFO empties the earliest-expiring batch first',
    afterFefo.find((b) => b.batch_number === 'OLD-1')?.stock === 0 &&
    afterFefo.find((b) => b.batch_number === 'NEW-1')?.stock === 3, afterFefo)
  check('total stock still ledger-derived', getStock(milk.id) === 3)

  // A return has to land back on the batches it came off, in the same shares.
  const fefoDetail = sales.getSale(admin, fefoSale.id)
  sales.returnSale(admin, {
    sale_id: fefoSale.id, reason: 'spoiled', refund_method: 'cash',
    items: [{ sale_item_id: fefoDetail.items[0].id, quantity: 6 }],
  })
  const afterReturn = batches.productBatches(admin, milk.id)
  // 6 of the 7 sold came off OLD-1, so all 6 returned go back there and NEW-1
  // keeps the 3 it still had.
  check('return credits the batches it was sold from',
    afterReturn.find((b) => b.batch_number === 'OLD-1')?.stock === 6 &&
    afterReturn.find((b) => b.batch_number === 'NEW-1')?.stock === 3, afterReturn)

  // Expiry report: OLD-1 is inside the 30-day window, NEW-1 is not.
  const expiry = batches.expiryReport(admin)
  check('expiry report enabled once tracking is on', expiry.enabled && expiry.threshold_days === 30)
  check('only the near-expiry batch is listed',
    expiry.rows.length === 1 && expiry.rows[0].batch_number === 'OLD-1', expiry.rows)
  // Value is stock x the product's current cost price, which this app takes from
  // the latest purchase (11000, not the 10000 OLD-1 was bought at). See the
  // costing-method note in the README.
  check('expiry row carries stock and value at cost',
    expiry.rows[0].stock === 6 && expiry.rows[0].value === 66000, expiry.rows[0])
  check('expiry totals count it as expiring, not expired',
    expiry.totals.expiring === 1 && expiry.totals.expired === 0 && expiry.totals.value === 66000, expiry.totals)
  check('a wider window pulls in the later batch',
    batches.expiryReport(admin, { days: 365 }).rows.length === 2)

  // Writing off an expired lot names the batch and only touches that batch.
  inventory.adjustStock(admin, {
    product_id: milk.id, quantity_change: -2, reason: 'damage',
    note: 'expired lot', batch_number: 'OLD-1', expiry_date: day(10),
  })
  check('write-off hits the named batch only',
    batches.productBatches(admin, milk.id).find((b) => b.batch_number === 'OLD-1')?.stock === 4)

  // Turning it off hides everything again without touching the data or breaking sales.
  batches.updateBatchSettings(admin, { batch_tracking_enabled: false, expiry_alert_days: 30 })
  check('expiry report disabled again', batches.expiryReport(admin).enabled === false)
  check('product batches hidden again', batches.productBatches(admin, milk.id).length === 0)
  const milkStockAfterDisable = getStock(milk.id)
  sales.checkout(admin, {
    items: [{ product_id: milk.id, quantity: 1, unit_price: 12000, discount: 0 }],
    bill_discount: 0, payment_method: 'cash', tendered: 12000, allow_negative_stock: false,
  })
  check('batched product still sells with tracking off', getStock(milk.id) === milkStockAfterDisable - 1)
  const storedBatches = getDb()
    .prepare('SELECT COUNT(*) AS n FROM product_batches WHERE product_id = ?')
    .get(milk.id) as { n: number }
  check('batch data is kept, not deleted, when tracking is turned off', storedBatches.n === 2, storedBatches)
  batches.updateBatchSettings(admin, { batch_tracking_enabled: false, expiry_alert_days: 30 })

  // ---- backup files & restore ----
  // Runs last: the final check really does swap this smoke database out, which
  // is only safe because userData here is a throwaway directory.
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), `pos-smoke-backup-${process.pid}-`))
  const stage = () => fs.mkdtempSync(path.join(backupDir, 'stage-'))
  const smokeImage = path.join(imagesDir(), 'smoke-image.bin')
  fs.writeFileSync(smokeImage, 'pretend this is a photo')

  const archive = await backupArchive.createArchive(admin.shopId, true, backupDir)
  check('backup archive is written for the current shop',
    fs.existsSync(archive.file) && archive.shopName === 'Smoke Shop', archive)

  const payload = await backupArchive.readBackupFile(archive.file, admin.shopId, stage())
  check('archive validates and stages its database and images',
    payload.format === 'archive' && payload.shopName === 'Smoke Shop' &&
    !!payload.images && fs.existsSync(path.join(payload.images!, 'smoke-image.bin')), payload)

  await expectReject('another shop\'s archive is refused',
    () => backupArchive.readBackupFile(archive.file, 'some-other-shop', stage()), 'different shop')
  await expectReject('the live database cannot be restored over itself',
    () => backupArchive.readBackupFile(backupArchive.databaseFile(), admin.shopId, stage()), 'running on')

  const junk = path.join(backupDir, 'holiday-photo.jpg')
  fs.writeFileSync(junk, 'this is not a backup at all')
  await expectReject('an unrelated file is rejected before anything is touched',
    () => backupArchive.readBackupFile(junk, admin.shopId, stage()), 'not a POS backup file')

  const truncated = path.join(backupDir, 'truncated.posbackup.gz')
  const archiveBytes = fs.readFileSync(archive.file)
  fs.writeFileSync(truncated, archiveBytes.subarray(0, Math.floor(archiveBytes.length / 2)))
  await expectReject('a half-copied archive is rejected',
    () => backupArchive.readBackupFile(truncated, admin.shopId, stage()))

  // The bare .db that earlier versions of "Download Backup" produced.
  const bare = path.join(backupDir, 'legacy-backup.db')
  await getDb().backup(bare)
  const barePayload = await backupArchive.readBackupFile(bare, admin.shopId, stage())
  check('a plain .db backup restores without touching product images',
    barePayload.format === 'database' && barePayload.images === null, barePayload)

  // A backup from a future build would leave its own migrations un-run.
  const future = path.join(backupDir, 'from-the-future.db')
  getDb().prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(9999, '2099-01-01')
  await getDb().backup(future)
  getDb().prepare('DELETE FROM schema_migrations WHERE version = ?').run(9999)
  await expectReject('a backup from a newer app version is refused',
    () => backupArchive.readBackupFile(future, admin.shopId, stage()), 'newer version')

  // End to end: work done after the backup is gone once it is restored.
  const afterBackup = catalog.createProduct(admin, {
    name: 'Recorded after the backup', sku: 'AFTER-BACKUP', barcode: null, category_id: null,
    unit: 'pcs', cost_price: 100, sale_price: 200, tax_percent: 0, min_stock_alert: 0,
  })
  fs.rmSync(smokeImage)
  await backupArchive.replaceLocalData(await backupArchive.readBackupFile(archive.file, admin.shopId, stage()))
  check('the restore hands back a database that is already open and migrated',
    schemaVersion(getDb()) === LATEST_SCHEMA_VERSION)
  const survivor = getDb()
    .prepare('SELECT COUNT(*) AS n FROM products WHERE id = ?')
    .get(afterBackup.id) as { n: number }
  check('restore rolls the shop back to the moment of the backup', survivor.n === 0, survivor)
  check('restore brings the product images back too',
    fs.existsSync(smokeImage))
  check('restored database is usable immediately', catalog.listProducts(admin).length > 0)
  fs.rmSync(backupDir, { recursive: true, force: true })

  // ---- automatic local backups ----
  // Nothing here touches the network: this is the backup a shop with no Google
  // account and no internet still gets.
  const autoDefaults = localAutoBackup.getStatus(admin)
  check('automatic local backup is on out of the box',
    autoDefaults.auto_backup_frequency === 'daily' && autoDefaults.backup_on_close &&
    autoDefaults.retention_count === 30 && !!autoDefaults.next_backup_at, autoDefaults)
  check('backups default to a folder inside the app data directory',
    autoDefaults.using_default_folder &&
    autoDefaults.folder === localAutoBackup.defaultBackupFolder(), autoDefaults)

  const autoTuned = localAutoBackup.updateSettings(admin, {
    auto_backup_frequency: 'daily', backup_time: '21:30',
    backup_on_close: true, include_images: false, retention_count: 2,
  })
  check('automatic backup settings are saved',
    autoTuned.backup_time === '21:30' && autoTuned.retention_count === 2 &&
    !autoTuned.include_images, autoTuned)

  const firstAuto = await localAutoBackup.backupNow(admin)
  check('a local backup file is written', fs.existsSync(firstAuto.path) && firstAuto.size > 0, firstAuto)
  check('the backup lands in the configured folder',
    path.dirname(firstAuto.path) === autoDefaults.folder, firstAuto)
  check('the backup is listed', (await localAutoBackup.listBackups(admin)).some((f) => f.path === firstAuto.path))
  const afterFirst = localAutoBackup.getStatus(admin)
  check('the successful backup is recorded',
    afterFirst.last_backup_status === 'success' && afterFirst.last_backup_file === firstAuto.path &&
    !!afterFirst.next_backup_at, afterFirst)
  check('the backup is logged', localAutoBackup.listLogs(admin)
    .some((l) => l.backup_type === 'manual' && l.status === 'success' && l.file_path === firstAuto.path))

  // Backups made inside the same second must not overwrite each other.
  const secondAuto = await localAutoBackup.backupNow(admin)
  check('a second backup does not replace the first', secondAuto.path !== firstAuto.path, secondAuto)
  await localAutoBackup.backupNow(admin)
  const kept = await localAutoBackup.listBackups(admin)
  check('old backups are pruned to the retention limit', kept.length === 2, kept.map((f) => f.name))
  check('pruning keeps the newest copies', !kept.some((f) => f.path === firstAuto.path), kept.map((f) => f.name))
  check('a second prune has nothing left to do', (await localAutoBackup.pruneNow(admin)).removed === 0)

  // Files the shop keeps in the same folder are not ours to delete.
  const notOurs = path.join(autoDefaults.folder, 'supplier-invoice.pdf')
  fs.writeFileSync(notOurs, 'not a backup')
  await localAutoBackup.pruneNow(admin)
  check('retention never deletes files the app did not write', fs.existsSync(notOurs))

  // The backup a shop that closes before backup_time depends on.
  await localAutoBackup.backupOnClose()
  check('closing the app takes a backup',
    localAutoBackup.listLogs(admin).some((l) => l.backup_type === 'on_close' && l.status === 'success'))

  localAutoBackup.updateSettings(admin, {
    auto_backup_frequency: 'daily', backup_time: '21:30',
    backup_on_close: false, include_images: false, retention_count: 2,
  })
  const closeLogsBefore = localAutoBackup.listLogs(admin).filter((l) => l.backup_type === 'on_close').length
  await localAutoBackup.backupOnClose()
  check('turning the closing backup off stops it running',
    localAutoBackup.listLogs(admin).filter((l) => l.backup_type === 'on_close').length === closeLogsBefore)

  const autoOff = localAutoBackup.updateSettings(admin, {
    auto_backup_frequency: 'off', backup_time: '21:30',
    backup_on_close: false, include_images: true, retention_count: 30,
  })
  check('turning automatic backup off clears the next run',
    autoOff.auto_backup_frequency === 'off' && autoOff.next_backup_at === null, autoOff)
  // Access itself is enforced by the router: every localAutoBackup:* route is
  // access: 'admin', so a cashier never reaches this service at all.

  // ---- Acceptance criteria, end to end on one clean product ----
  //
  // Everything above tests a module. This block tests the promises the app was
  // bought on, in the order a shop actually does them, on a product with no
  // history so the arithmetic is checkable by hand rather than by trusting the
  // fixture. Each one is asserted twice: once against the derived stock figure
  // the screens show, and once against the raw ledger rows underneath it —
  // because the failure that matters is stock and ledger drifting apart.
  setSession(admin)
  const acceptSupplier = parties.createSupplier(admin, { name: 'Acceptance Supplies', phone: null })
  const widget = catalog.createProduct(admin, {
    name: 'Acceptance Widget', sku: 'ACC-1', barcode: null, category_id: cat.id,
    unit: 'pcs', cost_price: 3000, sale_price: 5000, tax_percent: 0, min_stock_alert: 2,
  })
  const ledger = (type?: string) => getDb()
    .prepare(
      `SELECT change_type, quantity_change FROM inventory_logs
       WHERE product_id = ?${type ? ' AND change_type = ?' : ''}`
    )
    .all(...(type ? [widget.id, type] : [widget.id])) as
      { change_type: string; quantity_change: number }[]

  check('AC1 a new product starts at zero stock with an empty ledger',
    getStock(widget.id) === 0 && ledger().length === 0)

  // AC: purchase → stock up.
  purchases.createPurchase(admin, {
    supplier_id: acceptSupplier.id,
    items: [{ product_id: widget.id, quantity: 10, cost_price: 3000 }],
    paid_amount: 30000, method: 'cash',
  })
  check('AC2 a purchase puts the stock up', getStock(widget.id) === 10, getStock(widget.id))
  check('AC2 the purchase wrote exactly one +10 movement', (() => {
    const rows = ledger('purchase')
    return rows.length === 1 && rows[0].quantity_change === 10
  })(), ledger())

  // AC: sale → stock down, exactly once. Double-decrementing a sale is the
  // classic POS bug, so the row count is asserted, not just the balance.
  const acceptSale = sales.checkout(admin, {
    items: [{ product_id: widget.id, quantity: 4, unit_price: 5000, discount: 0 }],
    bill_discount: 0, payment_method: 'cash', tendered: 20000, allow_negative_stock: false,
  })
  check('AC3 a sale takes the stock down', getStock(widget.id) === 6, getStock(widget.id))
  check('AC3 the sale wrote exactly one -4 movement, not two', (() => {
    const rows = ledger('sale')
    return rows.length === 1 && rows[0].quantity_change === -4
  })(), ledger('sale'))
  check('AC3 the sale line froze the cost it was sold at',
    sales.getSale(admin, acceptSale.id).items[0].cost_price === 3000,
    sales.getSale(admin, acceptSale.id).items[0].cost_price)

  // AC: return → stock restored.
  const acceptDetail = sales.getSale(admin, acceptSale.id)
  sales.returnSale(admin, {
    sale_id: acceptSale.id, reason: 'customer changed mind', refund_method: 'cash',
    items: [{ sale_item_id: acceptDetail.items[0].id, quantity: 2 }],
  })
  check('AC4 a return puts the stock back', getStock(widget.id) === 8, getStock(widget.id))
  check('AC4 the return wrote exactly one +2 movement', (() => {
    const rows = ledger('sale_return')
    return rows.length === 1 && rows[0].quantity_change === 2
  })(), ledger('sale_return'))
  check('AC4 the sale is marked partially returned',
    sales.getSale(admin, acceptSale.id).sale.status === 'partially_returned')

  // AC: stock is the ledger, never a column. Four movements, summing to what
  // every screen shows.
  const widgetRows = ledger()
  check('AC5 stock on hand is exactly the sum of its movements',
    widgetRows.reduce((a, r) => a + r.quantity_change, 0) === getStock(widget.id), widgetRows)
  check('AC5 the whole history is three movements: in, out, back',
    widgetRows.length === 3, widgetRows.map((r) => `${r.change_type} ${r.quantity_change}`))

  // AC: the reports reconcile against what was just done, rather than against
  // themselves. Product profitability reports what went over the counter —
  // 4 sold at 5000 costing 3000 — and carries the 2 returned as its own column
  // rather than netting it out. Pinned here deliberately: the Profit & Loss
  // report DOES net refunds, so the two answer different questions and the
  // difference must not drift silently.
  const accRange = { from: '2000-01-01T00:00:00.000Z', to: new Date(Date.now() + 3600_000).toISOString() }
  const accProd = reports.productSales(admin, accRange).find((r) => r.id === widget.id)!
  check('AC6 product profitability reports 4 sold and 2 returned',
    accProd.qty === 4 && accProd.returned === 2, accProd)
  check('AC6 its revenue is what was rung up', accProd.revenue === 4 * 5000, accProd.revenue)
  check('AC6 its cost of goods is priced at the frozen cost', accProd.cogs === 4 * 3000, accProd.cogs)
  check('AC6 its profit is revenue less cost', accProd.profit === 4 * 2000, accProd.profit)
  const accLedgerRows = inventory.productLedger(admin, widget.id)
  check('AC6 the product ledger opens at the current stock',
    accLedgerRows[0]?.balance === getStock(widget.id), accLedgerRows[0])
  check('AC6 the product ledger runs the full history',
    accLedgerRows.length === 3, accLedgerRows.length)
  check('AC6 the stock-movement report shows all three movements',
    reports.stockMovements(admin, accRange).rows
      .filter((r) => r.product === 'Acceptance Widget').length === 3)

  // AC: a duplicate submission cannot ring the same basket up twice. This is
  // the one that costs a shop a customer: two charges, two invoice numbers and
  // stock down twice for one basket, none of it visible until the shelf is
  // counted. Simulated here the way it actually happens — the identical payload
  // submitted again, back to back, with nothing in between.
  const idemKey = 'smoke-double-click-0001'
  const idemPayload = {
    items: [{ product_id: widget.id, quantity: 1, unit_price: 5000, discount: 0 }],
    bill_discount: 0, payment_method: 'cash' as const, tendered: 5000,
    allow_negative_stock: false, idempotency_key: idemKey,
  }
  const stockBeforeIdem = getStock(widget.id)
  const firstSubmit = sales.checkout(admin, idemPayload)
  const secondSubmit = sales.checkout(admin, idemPayload)
  const thirdSubmit = sales.checkout(admin, idemPayload)
  check('AC8 a repeated submission returns the sale that already exists',
    secondSubmit.id === firstSubmit.id && thirdSubmit.id === firstSubmit.id,
    [firstSubmit.id, secondSubmit.id, thirdSubmit.id])
  check('AC8 it does not burn a second invoice number',
    secondSubmit.invoice_number === firstSubmit.invoice_number, secondSubmit.invoice_number)
  check('AC8 only one sale row exists for the key',
    (getDb().prepare('SELECT COUNT(*) AS n FROM sales WHERE shop_id = ? AND idempotency_key = ?')
      .get(admin.shopId, idemKey) as { n: number }).n === 1)
  check('AC8 the stock came down once, not three times',
    getStock(widget.id) === stockBeforeIdem - 1, getStock(widget.id))
  check('AC8 exactly one ledger row was written for it',
    (getDb().prepare('SELECT COUNT(*) AS n FROM inventory_logs WHERE reference_id = ?')
      .get(firstSubmit.id) as { n: number }).n === 1)
  check('AC8 the customer was charged once',
    (getDb().prepare("SELECT COUNT(*) AS n FROM payments WHERE reference_type = 'sale' AND reference_id = ?")
      .get(firstSubmit.id) as { n: number }).n === 1)

  // A different basket under a different key is a different sale — the guard
  // must stop duplicates, not stop trade.
  const nextCustomer = sales.checkout(admin, { ...idemPayload, idempotency_key: 'smoke-double-click-0002' })
  check('AC8 the next customer still gets their own sale',
    nextCustomer.id !== firstSubmit.id && nextCustomer.invoice_number !== firstSubmit.invoice_number)
  check('AC8 the next sale moves the stock again',
    getStock(widget.id) === stockBeforeIdem - 2, getStock(widget.id))

  // Sending no key at all is still allowed: an older client, or a shop that
  // genuinely rings the same basket twice for two customers.
  const unkeyedA = sales.checkout(admin, { ...idemPayload, idempotency_key: undefined })
  const unkeyedB = sales.checkout(admin, { ...idemPayload, idempotency_key: undefined })
  check('AC8 two identical unkeyed sales are still two sales', unkeyedA.id !== unkeyedB.id)
  check('AC8 the key is per shop, so a null key never collides',
    (getDb().prepare('SELECT COUNT(*) AS n FROM sales WHERE shop_id = ? AND idempotency_key IS NULL')
      .get(admin.shopId) as { n: number }).n >= 2)

  // AC: batch and expiry stays optional. It was switched off again above, and
  // the product just proved through the whole cycle without ever touching it.
  check('AC7 batch tracking is still off and nothing above needed it',
    !batches.getBatchSettings(admin.shopId).batch_tracking_enabled)
  check('AC7 an untracked product carries no batch on any movement',
    (getDb()
      .prepare('SELECT COUNT(*) AS n FROM inventory_logs WHERE product_id = ? AND batch_id IS NOT NULL')
      .get(widget.id) as { n: number }).n === 0)

  // ---- Google Drive backup and restore ----
  // Google is faked; nothing else is. The bytes that go up are the real archive
  // builder's output, the bytes that come back down are fed through the real
  // extractor, and the restore at the end really does swap this database out.
  // Only the network is stubbed — token refresh, resumable upload, list, delete
  // and download — so every assertion here is about our code, not Google's.
  // Runs last because that restore rolls the shop back.
  const driveDir = fs.mkdtempSync(path.join(os.tmpdir(), `pos-smoke-drive-${process.pid}-`))
  const driveStage = () => fs.mkdtempSync(path.join(driveDir, 'stage-'))
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  interface FakeDriveFile {
    id: string
    name: string
    body: Buffer
    createdTime: string
    appProperties: Record<string, string>
  }
  const driveFiles = new Map<string, FakeDriveFile>()
  const pendingUploads = new Map<string, { name: string; appProperties: Record<string, string> }>()
  let fakeSeq = 0
  let tokenRequests = 0
  let revokeRequests = 0
  let deleteRequests = 0
  // Levers the tests pull to make Google misbehave on demand.
  let uploadInitStatus = 200
  let downloadContentLength: number | null = null

  /** Monotonic and distinct, so `orderBy createdTime desc` is never ambiguous. */
  const fakeCreatedTime = () => new Date(Date.UTC(2030, 0, 1) + ++fakeSeq * 60_000).toISOString()
  const driveMeta = (file: FakeDriveFile) => ({
    id: file.id,
    name: file.name,
    size: String(file.body.length),
    createdTime: file.createdTime,
    modifiedTime: file.createdTime,
    appProperties: file.appProperties,
  })

  const realFetch = globalThis.fetch
  const fakeGoogle = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()

    if (url === 'https://oauth2.googleapis.com/token') {
      tokenRequests++
      return new Response(JSON.stringify({ access_token: `fake-access-${tokenRequests}`, expires_in: 3600 }),
        { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url === 'https://oauth2.googleapis.com/revoke') {
      revokeRequests++
      return new Response('', { status: 200 })
    }
    if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
      if (uploadInitStatus !== 200) return new Response('nope', { status: uploadInitStatus })
      const meta = JSON.parse(String(init?.body)) as { name: string; appProperties: Record<string, string> }
      const session = `upload-${++fakeSeq}`
      pendingUploads.set(session, { name: meta.name, appProperties: meta.appProperties })
      return new Response(null, { status: 200, headers: { location: `https://upload.fake/${session}` } })
    }
    if (url.startsWith('https://upload.fake/') && method === 'PUT') {
      const session = url.slice('https://upload.fake/'.length)
      const pending = pendingUploads.get(session)
      if (!pending) return new Response('no such upload session', { status: 404 })
      pendingUploads.delete(session)
      const file: FakeDriveFile = {
        id: `drive-file-${++fakeSeq}`,
        name: pending.name,
        body: Buffer.from(init?.body as Uint8Array),
        createdTime: fakeCreatedTime(),
        appProperties: pending.appProperties,
      }
      driveFiles.set(file.id, file)
      return new Response(JSON.stringify(driveMeta(file)),
        { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?')) {
      const files = [...driveFiles.values()]
        .sort((a, b) => b.createdTime.localeCompare(a.createdTime))
        .map(driveMeta)
      return new Response(JSON.stringify({ files }),
        { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url.startsWith('https://www.googleapis.com/drive/v3/files/')) {
      const rest = url.slice('https://www.googleapis.com/drive/v3/files/'.length)
      const id = decodeURIComponent(rest.split('?')[0])
      if (method === 'DELETE') {
        deleteRequests++
        return new Response('', { status: driveFiles.delete(id) ? 204 : 404 })
      }
      const file = driveFiles.get(id)
      if (!file) return new Response('not found', { status: 404 })
      return new Response(new Uint8Array(file.body), {
        status: 200,
        headers: { 'content-length': String(downloadContentLength ?? file.body.length) },
      })
    }
    throw new Error(`smoke: unexpected network call to ${url}`)
  }
  globalThis.fetch = fakeGoogle as typeof globalThis.fetch
  process.env.POS_GOOGLE_DRIVE_CLIENT_ID = 'smoke-client-id.apps.googleusercontent.com'
  process.env.POS_GOOGLE_DRIVE_CLIENT_SECRET = 'smoke-client-secret'

  const credentialFile = path.join(app.getPath('userData'), 'google-drive-credentials.json')
  const writeDriveCredential = () => {
    const plain = JSON.stringify({ refreshToken: 'smoke-refresh-token', email: 'shop@example.com' })
    fs.writeFileSync(
      credentialFile,
      JSON.stringify({ version: 1, encrypted: safeStorage.encryptString(plain).toString('base64') }),
      { mode: 0o600 }
    )
  }

  // Everything below needs a credential this computer can actually encrypt. If
  // the OS keyring is unavailable the product refuses to store one either, so
  // there is nothing to test rather than something to skip quietly.
  check('Drive credentials can be encrypted on this computer', safeStorage.isEncryptionAvailable())

  await expectReject('Drive backup is refused before an account is connected',
    () => googleDriveBackup.backupNow(admin), 'Connect a Google Drive account first')
  check('Drive shows as configured but not connected',
    googleDriveBackup.getStatus(admin).configured && !googleDriveBackup.getStatus(admin).connected)

  writeDriveCredential()
  check('Drive reads back as connected once a credential is stored',
    googleDriveBackup.getStatus(admin).connected)

  // Two foreign files sitting in the same appDataFolder: another shop's backup
  // (same Google account, second till) and something this app did not write.
  driveFiles.set('other-shop-file', {
    id: 'other-shop-file',
    name: 'pos-desktop-backup-other-shop-2030-01-01.posbackup.gz',
    body: Buffer.from('not ours'),
    createdTime: fakeCreatedTime(),
    appProperties: { app: 'pos-desktop', shopId: 'some-other-shop', shopName: 'Other Shop' },
  })
  driveFiles.set('foreign-app-file', {
    id: 'foreign-app-file',
    name: 'pos-desktop-backup-looks-right.posbackup.gz',
    body: Buffer.from('not even this app'),
    createdTime: fakeCreatedTime(),
    appProperties: { app: 'some-other-app', shopId: admin.shopId },
  })

  const driveImage = path.join(imagesDir(), 'drive-smoke-image.bin')
  fs.writeFileSync(driveImage, 'a product photo that must survive the round trip')

  const firstDriveBackup = await googleDriveBackup.backupNow(admin)
  check('a manual Drive backup uploads and reports the stored file',
    firstDriveBackup.size > 0 && firstDriveBackup.shop_id === admin.shopId &&
    firstDriveBackup.name.startsWith('pos-desktop-backup-') && driveFiles.has(firstDriveBackup.id),
    firstDriveBackup)

  // The single most important assertion in this section: what landed in Drive
  // is a restorable archive, not just bytes of the right length.
  const uploadedCopy = path.join(driveDir, 'uploaded.posbackup.gz')
  fs.writeFileSync(uploadedCopy, driveFiles.get(firstDriveBackup.id)!.body)
  const uploadedPayload = await backupArchive.readBackupFile(uploadedCopy, admin.shopId, driveStage())
  check('what was uploaded is a real, restorable archive of this shop',
    uploadedPayload.format === 'archive' && uploadedPayload.shopName === 'Smoke Shop' &&
    !!uploadedPayload.images &&
    fs.existsSync(path.join(uploadedPayload.images!, 'drive-smoke-image.bin')), uploadedPayload)

  const afterFirstDrive = googleDriveBackup.getStatus(admin)
  check('the backup is recorded as successful with the next one scheduled',
    afterFirstDrive.last_backup_status === 'success' && !!afterFirstDrive.last_backup_at &&
    !afterFirstDrive.last_backup_error && !!afterFirstDrive.next_backup_at, afterFirstDrive)
  const firstLog = googleDriveBackup.listLogs(admin)[0]
  check('the backup log points at the file it created',
    firstLog.status === 'success' && firstLog.backup_type === 'manual' &&
    firstLog.drive_file_id === firstDriveBackup.id && (firstLog.file_size ?? 0) > 0, firstLog)

  const listedAfterFirst = await googleDriveBackup.listBackups(admin)
  check('only this shop\'s backups are listed',
    listedAfterFirst.length === 1 && listedAfterFirst[0].id === firstDriveBackup.id,
    listedAfterFirst.map((f) => f.id))
  check('another shop\'s backup and a foreign app\'s file are both ignored',
    !listedAfterFirst.some((f) => f.id === 'other-shop-file' || f.id === 'foreign-app-file'))

  const tokensAfterFirst = tokenRequests
  check('the access token is refreshed once and then reused',
    tokensAfterFirst === 1, tokenRequests)

  // Retention: keep two, take two more, and the oldest must be deleted from
  // Drive — without touching anything that is not this shop's.
  googleDriveBackup.updateSettings(admin, {
    auto_backup_frequency: 'daily', backup_time: '02:00', include_images: true, retention_count: 2,
  })
  const secondDriveBackup = await googleDriveBackup.backupNow(admin)
  const thirdDriveBackup = await googleDriveBackup.backupNow(admin)
  const listedAfterThird = await googleDriveBackup.listBackups(admin)
  check('retention keeps only the newest two backups',
    listedAfterThird.length === 2 &&
    listedAfterThird[0].id === thirdDriveBackup.id && listedAfterThird[1].id === secondDriveBackup.id,
    listedAfterThird.map((f) => f.id))
  check('the pruned backup was really deleted from Drive',
    deleteRequests === 1 && !driveFiles.has(firstDriveBackup.id))
  check('retention never touches another shop\'s backups',
    driveFiles.has('other-shop-file') && driveFiles.has('foreign-app-file'))
  check('the token was still not refetched for any of that', tokenRequests === tokensAfterFirst)

  // A failed upload must leave a diagnosable trail and schedule a retry, not
  // silently look like nothing happened.
  uploadInitStatus = 503
  await expectReject('a Drive outage fails the backup loudly',
    () => googleDriveBackup.backupNow(admin), 'could not start the upload')
  uploadInitStatus = 200
  const afterFailure = googleDriveBackup.getStatus(admin)
  const retryInMinutes = (new Date(afterFailure.next_backup_at!).getTime() - Date.now()) / 60_000
  check('the failure is recorded with the reason',
    afterFailure.last_backup_status === 'failed' &&
    (afterFailure.last_backup_error ?? '').includes('503'), afterFailure)
  check('a failed backup retries in about fifteen minutes',
    retryInMinutes > 14 && retryInMinutes < 16, retryInMinutes)
  check('the failure is in the log with its error message',
    googleDriveBackup.listLogs(admin)[0].status === 'failed' &&
    !!googleDriveBackup.listLogs(admin)[0].error_message)
  check('the failed attempt uploaded nothing', (await googleDriveBackup.listBackups(admin)).length === 2)
  check('a backup is not left marked as running', !googleDriveBackup.getStatus(admin).backup_in_progress)

  // Restore guards, all before anything is actually replaced.
  await expectReject('restoring another shop\'s backup is refused',
    () => googleDriveBackup.restore(admin, { file_id: 'other-shop-file', confirmation: 'RESTORE' }),
    'Backup was not found for this shop')
  await expectReject('restoring a file this app did not write is refused',
    () => googleDriveBackup.restore(admin, { file_id: 'foreign-app-file', confirmation: 'RESTORE' }),
    'Backup was not found for this shop')
  await expectReject('restoring a backup that no longer exists is refused',
    () => googleDriveBackup.restore(admin, { file_id: firstDriveBackup.id, confirmation: 'RESTORE' }),
    'Backup was not found for this shop')
  await expectReject('pre-setup recovery is refused while this shop exists',
    () => googleDriveBackup.restoreForRecovery({ file_id: thirdDriveBackup.id, confirmation: 'RESTORE' }),
    'only available before shop setup')

  // An oversized download is rejected on the declared length, before the bytes
  // are ever written to disk.
  downloadContentLength = backupArchive.MAX_BACKUP_BYTES + 1
  await expectReject('a download claiming to be over 512 MB is refused',
    () => googleDriveBackup.restore(admin, { file_id: thirdDriveBackup.id, confirmation: 'RESTORE' }),
    '512 MB')
  downloadContentLength = null

  // The round trip. Work done after the backup, and a deleted product image,
  // both have to come back to where they were.
  const goneAfterRestore = catalog.createProduct(admin, {
    name: 'Recorded after the Drive backup', sku: 'AFTER-DRIVE', barcode: null, category_id: null,
    unit: 'pcs', cost_price: 100, sale_price: 200, tax_percent: 0, min_stock_alert: 0,
  })
  fs.rmSync(driveImage)

  // restore() ends by scheduling app.relaunch()/app.exit(0) 750 ms later, which
  // would kill this process and take the exit code with it. Both are stubbed
  // for the duration, the pending timer is allowed to fire against the stubs so
  // the restart is asserted rather than merely avoided, and then the real
  // methods go back — the suite must still be able to exit normally.
  const realRelaunch = app.relaunch
  const realExit = app.exit
  let restartRequested = 0
  Object.defineProperty(app, 'relaunch', {
    value: () => { restartRequested++ }, configurable: true, writable: true,
  })
  Object.defineProperty(app, 'exit', { value: () => undefined, configurable: true, writable: true })
  try {
    const restored = await googleDriveBackup.restore(admin, {
      file_id: thirdDriveBackup.id, confirmation: 'RESTORE',
    })
    check('restore reports that the app is restarting', restored.restarting === true)
    check('the restored database is open and migrated before the restart is even scheduled',
      schemaVersion(getDb()) === LATEST_SCHEMA_VERSION)
    await sleep(1200)
    check('restore asks the app to restart itself once', restartRequested === 1, restartRequested)
    // The restart closes the connection on its way out so the next process does
    // not have to recover a WAL before it can paint anything. The real app is
    // exiting at this point; this suite has to open the file again itself.
    expectThrow('the restart closes the database instead of leaving a WAL behind',
      () => getDb(), 'not initialised')
    openDb()
    clearRestartLatchForSmoke()
  } finally {
    Object.defineProperty(app, 'relaunch', { value: realRelaunch, configurable: true, writable: true })
    Object.defineProperty(app, 'exit', { value: realExit, configurable: true, writable: true })
  }

  check('the Drive restore rolled the shop back to the moment of the backup',
    (getDb().prepare('SELECT COUNT(*) AS n FROM products WHERE id = ?')
      .get(goneAfterRestore.id) as { n: number }).n === 0)
  check('the Drive restore brought the product images back', fs.existsSync(driveImage))
  check('the shop that was backed up is the shop that came back',
    (getDb().prepare('SELECT name FROM shops WHERE id = ?').get(admin.shopId) as { name: string })
      .name === 'Smoke Shop')
  check('the restored database is usable immediately', catalog.listProducts(admin).length > 0)
  check('the interrupted backup log from inside the archive is healed, not left running',
    googleDriveBackup.getStatus(admin).last_backup_status === 'failed' &&
    (googleDriveBackup.getStatus(admin).last_backup_error ?? '').includes('interrupted'))
  check('the backups themselves are untouched by a restore',
    (await googleDriveBackup.listBackups(admin)).length === 2)

  // Disconnecting must revoke at Google and leave nothing behind on disk.
  const disconnected = await googleDriveBackup.disconnect(admin)
  check('disconnecting revokes the refresh token with Google', revokeRequests === 1)
  check('disconnecting removes the stored credential', !fs.existsSync(credentialFile))
  check('disconnecting clears the account and the schedule',
    !disconnected.connected && !disconnected.account_email && !disconnected.next_backup_at, disconnected)
  await expectReject('backups stop working once disconnected',
    () => googleDriveBackup.backupNow(admin), 'Connect a Google Drive account first')

  globalThis.fetch = realFetch
  delete process.env.POS_GOOGLE_DRIVE_CLIENT_ID
  delete process.env.POS_GOOGLE_DRIVE_CLIENT_SECRET
  fs.rmSync(driveDir, { recursive: true, force: true })

  // ---- restore from a file, the whole way through ----
  // A restore that leaves the app unable to open its database is a blank window
  // on the next launch and nothing else — the shopkeeper has no way to tell it
  // apart from a crash. So each of these ends by proving the same thing: the
  // database is open, at this build's schema, and every screen can read it.
  const restoreDir = fs.mkdtempSync(path.join(os.tmpdir(), `pos-smoke-restore-${process.pid}-`))
  const restoreStage = (prefix: string) => fs.mkdtempSync(path.join(restoreDir, `${prefix}-`))
  const usableNow = () =>
    auth.authState().shop?.id === admin.shopId &&
    catalog.listProducts(admin).length > 0 &&
    reports.dashboard(admin) !== undefined

  // The file picker is the one part of this route that cannot run headless.
  let chosenFile: string | null = null
  const savedShowOpenDialog = dialog.showOpenDialog
  Object.defineProperty(dialog, 'showOpenDialog', {
    value: async () => (chosenFile === null
      ? { canceled: true, filePaths: [] as string[] }
      : { canceled: false, filePaths: [chosenFile] }),
    configurable: true, writable: true,
  })
  let restarts = 0
  const savedRelaunch = app.relaunch
  const savedExit = app.exit
  Object.defineProperty(app, 'relaunch', {
    value: () => { restarts++ }, configurable: true, writable: true,
  })
  Object.defineProperty(app, 'exit', { value: () => undefined, configurable: true, writable: true })

  try {
    // 1 — a backup taken on the schema this build is running.
    const sameSchemaBackup = await backupArchive.createArchive(admin.shopId, true, restoreStage('current'))
    const goneOnRestore = catalog.createProduct(admin, {
      name: 'Rung up after the backup', sku: 'AFTER-RESTORE-1', barcode: null, category_id: null,
      unit: 'pcs', cost_price: 100, sale_price: 200, tax_percent: 0, min_stock_alert: 0,
    })
    chosenFile = sameSchemaBackup.file
    const sameSchema = await localBackup.restoreFromFile(admin, { confirmation: 'RESTORE' })
    check('a current-schema backup restores and reports the restart',
      sameSchema.restored === true && sameSchema.restarting === true, sameSchema)
    check('it comes back on the schema this build was written for',
      schemaVersion(getDb()) === LATEST_SCHEMA_VERSION, schemaVersion(getDb()))
    check('the shop is exactly as it was when that backup was taken',
      (getDb().prepare('SELECT COUNT(*) AS n FROM products WHERE id = ?')
        .get(goneOnRestore.id) as { n: number }).n === 0)
    check('the app is usable straight away, with no restart needed to read it', usableNow())
    check('the restore wrote its own audit trail into the restored database',
      (getDb().prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'backup.restore_local'")
        .get() as { n: number }).n === 1)
    await sleep(1200)
    check('a file restore asks the app to restart itself once', restarts === 1, restarts)
    expectThrow('and closes the database on its way out', () => getDb(), 'not initialised')
    openDb()
    clearRestartLatchForSmoke()

    // 2 — a backup from an older build. Downgrading a real snapshot keeps the
    // shop's data intact, so this tests the migration a shopkeeper would
    // actually hit rather than a hand-built empty database.
    const older = path.join(restoreDir, 'older-build.db')
    await getDb().backup(older)
    downgradeToSchema9(older)
    check('the older backup really is behind this build', readSchemaVersion(older) === 9)
    chosenFile = older
    const oldSchema = await localBackup.restoreFromFile(admin, { confirmation: 'RESTORE' })
    check('an older backup restores instead of being refused', oldSchema.restored === true, oldSchema)
    check('its pending migrations were run before the restore returned',
      schemaVersion(getDb()) === LATEST_SCHEMA_VERSION, schemaVersion(getDb()))
    check('the columns those migrations add are really there',
      !!getDb().prepare("SELECT COUNT(*) AS n FROM pragma_table_info('sales') WHERE name = 'idempotency_key'")
        .get() &&
      (getDb().prepare("SELECT COUNT(*) AS n FROM pragma_table_info('categories') WHERE name = 'is_active'")
        .get() as { n: number }).n === 1)
    // Migration 14 on a database that predates plan types: the lifetime shop
    // inside the backup has nothing but its status to say so, and comes back
    // flagged as lifetime with its expiry date cleared.
    check('migration 14 backfilled the lifetime flag on the old backup',
      subscription.getStatusView(admin).is_lifetime &&
      subscription.getStatusView(admin).membership_ends_at === null)
    check('migration 14 added the activation history table',
      (getDb().prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'license_activations'"
      ).get() as { n: number }).n === 1)
    // Migration 13 on a real, populated database: the sync tables that every
    // existing install still carries, with rows in them, must be gone — and the
    // shop's own records must be untouched by their going.
    check('migration 13 dropped the populated sync tables from the old backup',
      (getDb().prepare(
        `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'
          AND name IN ('sync_settings', 'sync_logs', 'sync_conflicts')`
      ).get() as { n: number }).n === 0)
    check('migration 13 dropped the sync_status column off the shop tables',
      (getDb().prepare("SELECT COUNT(*) AS n FROM pragma_table_info('sales') WHERE name = 'sync_status'")
        .get() as { n: number }).n === 0 &&
      (getDb().prepare("SELECT COUNT(*) AS n FROM pragma_table_info('products') WHERE name = 'sync_status'")
        .get() as { n: number }).n === 0)
    check('migration 13 revoked the sync.manage permission it left behind',
      (getDb().prepare("SELECT COUNT(*) AS n FROM user_permissions WHERE permission = 'sync.manage'")
        .get() as { n: number }).n === 0)
    check('dropping those columns did not lose a single sale',
      (getDb().prepare('SELECT COUNT(*) AS n FROM sales').get() as { n: number }).n > 0 &&
      (getDb().prepare('SELECT COUNT(*) AS n FROM inventory_logs').get() as { n: number }).n > 0)
    check('the upgraded shop is usable straight away', usableNow())
    // The column migration 12 adds is the one checkout writes to, so ringing a
    // sale up is the honest test that the upgrade actually took.
    check('a sale can still be rung up on the migrated schema',
      sales.checkout(admin, {
        items: [{ product_id: catalog.listProducts(admin)[0].id, quantity: 1, unit_price: 5000, discount: 0 }],
        bill_discount: 0, payment_method: 'cash', tendered: 5000, allow_negative_stock: true,
      }).total === 5000)
    await sleep(1200)
    check('the upgraded shop is restarted into as well', restarts === 2, restarts)
    openDb()
    clearRestartLatchForSmoke()

    // 3 — a backup this build cannot bring forward. The shop must be told, and
    // must be left on the data it had, rather than restarted into a dead app.
    const unmigratable = path.join(restoreDir, 'cannot-upgrade.db')
    await getDb().backup(unmigratable)
    forgetMigrations(unmigratable, [10, 11, 12])
    const before = catalog.listProducts(admin).length
    chosenFile = unmigratable
    const restartsBefore = restarts
    await expectReject('a backup that cannot be upgraded is refused, in words a shopkeeper can act on',
      () => localBackup.restoreFromFile(admin, { confirmation: 'RESTORE' }), 'put back and nothing was changed')
    check('the previous data was put back, open and at the right schema',
      schemaVersion(getDb()) === LATEST_SCHEMA_VERSION && catalog.listProducts(admin).length === before)
    check('the shop can carry on working after the failed restore', usableNow())
    await sleep(1200)
    check('and the app was never asked to restart into it', restarts === restartsBefore, restarts)

    // Cancelling the picker must change nothing at all.
    chosenFile = null
    const cancelled = await localBackup.restoreFromFile(admin, { confirmation: 'RESTORE' })
    check('closing the file picker leaves the shop untouched',
      cancelled.restored === false && usableNow(), cancelled)
  } finally {
    Object.defineProperty(dialog, 'showOpenDialog', {
      value: savedShowOpenDialog, configurable: true, writable: true,
    })
    Object.defineProperty(app, 'relaunch', { value: savedRelaunch, configurable: true, writable: true })
    Object.defineProperty(app, 'exit', { value: savedExit, configurable: true, writable: true })
    clearRestartLatchForSmoke()
    fs.rmSync(restoreDir, { recursive: true, force: true })
  }

  console.log(failures === 0 ? '--- ALL CHECKS PASSED ---' : `--- ${failures} FAILURES ---`)
  return failures === 0 ? 0 : 1
}
