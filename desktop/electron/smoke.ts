// Service-level end-to-end smoke test. Run with POS_SMOKE=1 — uses a throwaway
// userData dir, exercises every stock/money flow, and exits 0/1. Never touches real data.
import { app } from 'electron'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { getDb, openDb } from './db'
import { getStock } from './services/helpers'
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
import * as sync from './services/sync'
import {
  canAccessReports, canCreatePurchase, canCreateSale, canUsePOS, shouldLockSales,
} from '../src/shared/subscription'
import { getSession, setSession } from './services/session'

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

export async function runSmokeTest(): Promise<number> {
  const dir = path.join(os.tmpdir(), `pos-smoke-${process.pid}`)
  fs.mkdirSync(dir, { recursive: true })
  app.setPath('userData', dir)
  openDb()
  console.log('--- POS smoke test ---')

  // Setup + auth
  auth.setup({
    shopName: 'Smoke Shop', currency: 'Rs', taxPercent: 0,
    adminName: 'Boss', username: 'boss', password: 'test1234',
  })
  const admin = getSession()!
  check('setup creates admin session', admin.role === 'admin')
  expectThrow('second setup blocked', () =>
    auth.setup({ shopName: 'X', currency: 'Rs', taxPercent: 0, adminName: 'x', username: 'x2', password: 'pppp' })
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
  sales.returnSale(admin, {
    sale_id: sale2.id, reason: 'damaged', refund_method: 'due',
    items: [{ sale_item_id: detail2.items[0].id, quantity: 1 }],
  })
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
  parties.receiveCustomerPayment(admin, { party_id: cust.id, amount: 5000, method: 'cash' })
  check('due after payment = 3000',
    parties.listCustomers(admin).find((c) => c.id === cust.id)!.due_balance === 3000)

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
    items: [{ product_id: cola.id, quantity: 5, cost_price: 4000 }],
  })
  check('PO numbered', po.po_number === 'PO-000001', po.po_number)
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

  // Dashboard exposes operations only; financial figures stay in admin reports.
  const dash2 = reports.dashboard(admin)
  check('dashboard overview has low-stock operations', Array.isArray(dash2.lowStock))
  check('dashboard response excludes financial totals',
    !('sales' in dash2) && !('todayProfit' in dash2) && !('monthProfit' in dash2))
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

  // ---- Settings module: shop profile, subscription, cloud sync ----
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

  // Valid offline lifetime key reopens everything
  const lifetimeKey = subscription.generateLicenseKey('lifetime')
  const activated = await subscription.activateLicense(admin, { license_key: lifetimeKey })
  check('lifetime key activates', activated.status === 'lifetime_active' && activated.plan_type === 'lifetime')
  check('license masked to last 4', activated.license_key_masked === `••••-••••-••••-${lifetimeKey.slice(-4)}`)
  check('offline re-validation via cache', subscription.validateKeyOffline(lifetimeKey).valid)
  subscription.assertCanTransact(admin.shopId) // must not throw
  check('transact gate reopens after activation', true)

  // Sync settings defaults + update
  const syncStatus = sync.getSyncStatus(admin)
  check('sync defaults daily 23:59 enabled',
    syncStatus.auto_sync_enabled === 1 && syncStatus.sync_frequency === 'daily' && syncStatus.sync_time === '23:59')
  check('pending changes counted', syncStatus.pending_changes > 0, syncStatus.pending_changes)
  const syncUpdated = sync.updateSyncSettings(admin, { auto_sync_enabled: true, sync_frequency: 'daily', sync_time: '22:00' })
  check('sync time updated', syncUpdated.sync_time === '22:00' && !!syncUpdated.next_sync_at)

  // Manual sync with no cloud/internet: pending result persisted, POS unaffected
  let offlineMsg = ''
  try {
    await sync.manualSync(admin)
  } catch (e) {
    offlineMsg = (e as Error).message
  }
  check('offline sync reports no internet', offlineMsg.includes('No internet'), offlineMsg)
  const syncLogs = sync.listSyncLogs(admin)
  check('sync log written as pending', syncLogs.length === 1 && syncLogs[0].status === 'pending', syncLogs[0])
  check('last sync status pending, never synced', sync.getSyncStatus(admin).last_sync_status === 'pending' &&
    sync.getSyncStatus(admin).last_sync_at == null)
  const saleAfterFailedSync = sales.checkout(admin, {
    items: [{ product_id: chips.id, quantity: 1, unit_price: 3000, discount: 0 }],
    bill_discount: 0, payment_method: 'cash', tendered: 3300, allow_negative_stock: false,
  })
  check('POS keeps working after failed sync', saleAfterFailedSync.total === 3300)

  console.log(failures === 0 ? '--- ALL CHECKS PASSED ---' : `--- ${failures} FAILURES ---`)
  return failures === 0 ? 0 : 1
}
