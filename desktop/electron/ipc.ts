// Single registration point for all IPC channels.
// Every channel declares: access level + optional zod schema. Role checks happen HERE,
// in the main process — renderer-side hiding is cosmetic only.
import { ipcMain, shell } from 'electron'
import { z, type ZodTypeAny } from 'zod'
import type { IpcResult, Session } from '../src/shared/types'
import {
  setupSchema, loginSchema, productSchema, categorySchema, customerSchema,
  supplierSchema, checkoutSchema, saleReturnSchema, adjustmentSchema,
  purchaseSchema, purchaseReturnSchema, partyPaymentSchema, userCreateSchema,
  shopSettingsSchema, changePasswordSchema, updateProfileSchema, recoverPasswordSchema,
  holdSaleSchema, purchaseOrderSchema, receivePurchaseOrderSchema, expenseSchema, uuid,
  activateLicenseSchema, paymentProofSchema, syncSettingsSchema,
} from '../src/shared/schemas'
import { AppError } from './services/helpers'
import { getSession } from './services/session'
import * as auth from './services/auth'
import * as catalog from './services/catalog'
import * as sales from './services/sales'
import * as parties from './services/parties'
import * as purchases from './services/purchases'
import * as inventory from './services/inventory'
import * as reports from './services/reports'
import * as settings from './services/settings'
import * as expenses from './services/expenses'
import * as importExport from './services/importExport'
import * as subscription from './services/subscription'
import * as sync from './services/sync'
import { pickProductImages } from './services/images'
import { seedDemoData } from './services/seed'
import { printHtml } from './services/print'

type Access = 'public' | 'user' | 'admin'

interface Route {
  access: Access
  schema?: ZodTypeAny
  /** Creates a sale/purchase — blocked server-side when the trial/membership has expired. */
  requiresActiveSubscription?: boolean
  handler: (payload: never, session: Session) => unknown
}

const idSchema = z.object({ id: uuid })
const rangeSchema = z.object({ from: z.string(), to: z.string() })
const withId = <T extends ZodTypeAny>(s: T) => z.object({ id: uuid }).and(s)

const routes: Record<string, Route> = {
  // ---- auth ----
  'auth:state': { access: 'public', handler: () => auth.authState() },
  'auth:setup': { access: 'public', schema: setupSchema, handler: (p) => auth.setup(p) },
  'auth:login': { access: 'public', schema: loginSchema, handler: (p) => auth.login(p) },
  'auth:logout': { access: 'user', handler: () => auth.logout() },
  'auth:changePassword': { access: 'user', schema: changePasswordSchema, handler: (p, s) => auth.changePassword(s, p) },
  'auth:updateProfile': { access: 'user', schema: updateProfileSchema, handler: (p, s) => auth.updateProfile(s, p) },
  'auth:recoverPassword': { access: 'public', schema: recoverPasswordSchema, handler: (p) => auth.recoverPassword(p) },

  // ---- catalog ----
  'products:list': {
    access: 'user',
    schema: z
      .object({
        search: z.string().optional(),
        category_id: z.string().optional(),
        low_stock_only: z.boolean().optional(),
      })
      .optional(),
    handler: (p, s) => catalog.listProducts(s, p ?? {}),
  },
  'products:byBarcode': {
    access: 'user',
    schema: z.object({ barcode: z.string().min(1) }),
    handler: (p: { barcode: string }, s) => catalog.getProductByBarcode(s, p.barcode),
  },
  'products:create': { access: 'admin', schema: productSchema, handler: (p, s) => catalog.createProduct(s, p) },
  'products:update': { access: 'admin', schema: withId(productSchema), handler: (p, s) => catalog.updateProduct(s, p) },
  'products:delete': { access: 'admin', schema: idSchema, handler: (p: { id: string }, s) => catalog.deleteProduct(s, p.id) },
  'products:generateBarcode': { access: 'admin', handler: (_p, s) => catalog.generateBarcode(s) },
  'categories:list': { access: 'user', handler: (_p, s) => catalog.listCategories(s) },
  'categories:create': { access: 'admin', schema: categorySchema, handler: (p, s) => catalog.createCategory(s, p) },
  'brands:list': { access: 'user', handler: (_p, s) => catalog.listBrands(s) },
  'brands:create': { access: 'admin', schema: categorySchema, handler: (p, s) => catalog.createBrand(s, p) },
  'products:images': {
    access: 'user',
    schema: z.object({ product_id: uuid }),
    handler: (p: { product_id: string }, s) => catalog.listProductImages(s, p.product_id),
  },
  'products:pickImages': { access: 'admin', handler: () => pickProductImages() },
  'products:export': { access: 'admin', handler: (_p, s) => importExport.exportProducts(s) },
  'products:import': { access: 'admin', handler: (_p, s) => importExport.importProducts(s) },

  // ---- sales / POS ----
  'sales:checkout': { access: 'user', schema: checkoutSchema, requiresActiveSubscription: true, handler: (p, s) => sales.checkout(s, p) },
  'sales:list': {
    access: 'user',
    schema: z
      .object({
        from: z.string().optional(), to: z.string().optional(),
        cashier_id: z.string().optional(), status: z.string().optional(),
        search: z.string().optional(), page: z.number().optional(), pageSize: z.number().optional(),
      })
      .optional(),
    handler: (p, s) => sales.listSales(s, p ?? {}),
  },
  'sales:get': { access: 'user', schema: idSchema, handler: (p: { id: string }, s) => sales.getSale(s, p.id) },
  'sales:return': { access: 'admin', schema: saleReturnSchema, handler: (p, s) => sales.returnSale(s, p) },
  'sales:cancel': {
    access: 'admin',
    schema: z.object({ id: uuid, reason: z.string().trim().optional() }),
    handler: (p, s) => sales.cancelSale(s, p),
  },
  'sales:hold': { access: 'user', schema: holdSaleSchema, requiresActiveSubscription: true, handler: (p, s) => sales.holdSale(s, p) },
  'sales:heldList': { access: 'user', handler: (_p, s) => sales.listHeldSales(s) },
  'sales:resumeHeld': { access: 'user', schema: idSchema, handler: (p: { id: string }, s) => sales.resumeHeldSale(s, p.id) },
  'sales:deleteHeld': { access: 'user', schema: idSchema, handler: (p: { id: string }, s) => sales.deleteHeldSale(s, p.id) },
  'returns:list': {
    access: 'admin',
    schema: z
      .object({
        from: z.string().optional(), to: z.string().optional(), kind: z.string().optional(),
        page: z.number().optional(), pageSize: z.number().optional(),
      })
      .optional(),
    handler: (p, s) => sales.listReturns(s, p ?? {}),
  },

  // ---- customers (cashiers can register customers and take due payments at the till) ----
  'customers:list': {
    access: 'user',
    schema: z.object({ search: z.string().optional() }).optional(),
    handler: (p, s) => parties.listCustomers(s, p ?? {}),
  },
  'customers:create': { access: 'user', schema: customerSchema, handler: (p, s) => parties.createCustomer(s, p) },
  'customers:update': { access: 'admin', schema: withId(customerSchema), handler: (p, s) => parties.updateCustomer(s, p) },
  'customers:detail': { access: 'user', schema: idSchema, handler: (p: { id: string }, s) => parties.customerDetail(s, p.id) },
  'customers:receivePayment': { access: 'user', schema: partyPaymentSchema, handler: (p, s) => parties.receiveCustomerPayment(s, p) },

  // ---- suppliers & purchases (admin) ----
  'suppliers:list': {
    access: 'admin',
    schema: z.object({ search: z.string().optional() }).optional(),
    handler: (p, s) => parties.listSuppliers(s, p ?? {}),
  },
  'suppliers:create': { access: 'admin', schema: supplierSchema, handler: (p, s) => parties.createSupplier(s, p) },
  'suppliers:update': { access: 'admin', schema: withId(supplierSchema), handler: (p, s) => parties.updateSupplier(s, p) },
  'suppliers:detail': { access: 'admin', schema: idSchema, handler: (p: { id: string }, s) => parties.supplierDetail(s, p.id) },
  'suppliers:pay': { access: 'admin', schema: partyPaymentSchema, handler: (p, s) => parties.paySupplier(s, p) },
  'purchases:create': { access: 'admin', schema: purchaseSchema, requiresActiveSubscription: true, handler: (p, s) => purchases.createPurchase(s, p) },
  'purchases:list': {
    access: 'admin',
    schema: z
      .object({
        from: z.string().optional(), to: z.string().optional(), search: z.string().optional(),
        page: z.number().optional(), pageSize: z.number().optional(),
      })
      .optional(),
    handler: (p, s) => purchases.listPurchases(s, p ?? {}),
  },
  'purchases:get': { access: 'admin', schema: idSchema, handler: (p: { id: string }, s) => purchases.getPurchase(s, p.id) },
  'purchases:return': { access: 'admin', schema: purchaseReturnSchema, handler: (p, s) => purchases.returnPurchase(s, p) },
  'purchaseOrders:create': { access: 'admin', schema: purchaseOrderSchema, requiresActiveSubscription: true, handler: (p, s) => purchases.createPurchaseOrder(s, p) },
  'purchaseOrders:list': {
    access: 'admin',
    schema: z
      .object({
        status: z.string().optional(), search: z.string().optional(),
        page: z.number().optional(), pageSize: z.number().optional(),
      })
      .optional(),
    handler: (p, s) => purchases.listPurchaseOrders(s, p ?? {}),
  },
  'purchaseOrders:get': { access: 'admin', schema: idSchema, handler: (p: { id: string }, s) => purchases.getPurchaseOrder(s, p.id) },
  'purchaseOrders:receive': { access: 'admin', schema: receivePurchaseOrderSchema, requiresActiveSubscription: true, handler: (p, s) => purchases.receivePurchaseOrder(s, p) },
  'purchaseOrders:cancel': { access: 'admin', schema: idSchema, handler: (p: { id: string }, s) => purchases.cancelPurchaseOrder(s, p.id) },
  'customers:ledger': { access: 'user', schema: idSchema, handler: (p: { id: string }, s) => parties.customerLedger(s, p.id) },
  'suppliers:ledger': { access: 'admin', schema: idSchema, handler: (p: { id: string }, s) => parties.supplierLedger(s, p.id) },

  // ---- expenses (admin) ----
  'expenses:list': {
    access: 'admin',
    schema: z
      .object({ from: z.string().optional(), to: z.string().optional(), category_id: z.string().optional() })
      .optional(),
    handler: (p, s) => expenses.listExpenses(s, p ?? {}),
  },
  'expenses:create': { access: 'admin', schema: expenseSchema, handler: (p, s) => expenses.createExpense(s, p) },
  'expenses:update': { access: 'admin', schema: withId(expenseSchema), handler: (p, s) => expenses.updateExpense(s, p) },
  'expenses:delete': { access: 'admin', schema: idSchema, handler: (p: { id: string }, s) => expenses.deleteExpense(s, p.id) },
  'expenseCategories:list': { access: 'admin', handler: (_p, s) => expenses.listExpenseCategories(s) },
  'expenseCategories:create': { access: 'admin', schema: categorySchema, handler: (p, s) => expenses.createExpenseCategory(s, p) },

  // ---- inventory ----
  'inventory:adjust': { access: 'admin', schema: adjustmentSchema, handler: (p, s) => inventory.adjustStock(s, p) },
  'inventory:movements': {
    access: 'admin',
    schema: z.object({ product_id: uuid }),
    handler: (p: { product_id: string }, s) => inventory.productMovements(s, p.product_id),
  },

  // ---- reports ----
  'reports:dashboard': { access: 'admin', handler: (_p, s) => reports.dashboard(s) },
  'reports:sales': { access: 'admin', schema: rangeSchema, handler: (p, s) => reports.salesReport(s, p) },
  'reports:profitLoss': { access: 'admin', schema: rangeSchema, handler: (p, s) => reports.profitLoss(s, p) },
  'reports:dues': { access: 'admin', handler: (_p, s) => reports.duesReport(s) },
  'reports:expenses': { access: 'admin', schema: rangeSchema, handler: (p, s) => expenses.expenseReport(s, p) },
  'reports:customers': { access: 'admin', schema: rangeSchema, handler: (p, s) => reports.customerReport(s, p) },
  'reports:suppliers': { access: 'admin', schema: rangeSchema, handler: (p, s) => reports.supplierReport(s, p) },
  'reports:salesSeries': {
    access: 'admin',
    schema: rangeSchema.extend({ group: z.enum(['day', 'month']) }),
    handler: (p, s) => reports.salesSeries(s, p),
  },
  'reports:productSales': { access: 'admin', schema: rangeSchema, handler: (p, s) => reports.productSales(s, p) },
  'reports:categorySales': { access: 'admin', schema: rangeSchema, handler: (p, s) => reports.categorySales(s, p) },
  'reports:slowMovers': { access: 'admin', schema: rangeSchema, handler: (p, s) => reports.slowMovers(s, p) },
  'reports:purchases': { access: 'admin', schema: rangeSchema, handler: (p, s) => reports.purchaseReport(s, p) },
  'reports:returns': { access: 'admin', schema: rangeSchema, handler: (p, s) => reports.returnsReport(s, p) },
  'reports:paymentMethods': { access: 'admin', schema: rangeSchema, handler: (p, s) => reports.paymentMethodReport(s, p) },
  'reports:cashFlow': { access: 'admin', schema: rangeSchema, handler: (p, s) => reports.cashFlow(s, p) },
  'reports:dayBook': { access: 'admin', schema: rangeSchema, handler: (p, s) => reports.dayBook(s, p) },
  'reports:cashDrawer': { access: 'admin', schema: rangeSchema, handler: (p, s) => reports.cashDrawer(s, p) },
  'reports:duesAging': { access: 'admin', handler: (_p, s) => reports.duesAging(s) },
  'reports:stockMovements': {
    access: 'admin',
    schema: rangeSchema.extend({ change_type: z.string().optional() }),
    handler: (p, s) => reports.stockMovements(s, p),
  },
  'reports:cashBook': { access: 'admin', schema: rangeSchema, handler: (p, s) => reports.cashBook(s, p) },
  'inventory:ledger': {
    access: 'admin',
    schema: z.object({ product_id: uuid }),
    handler: (p: { product_id: string }, s) => inventory.productLedger(s, p.product_id),
  },

  // ---- settings ----
  'settings:updateShop': { access: 'admin', schema: shopSettingsSchema, handler: (p, s) => settings.updateShop(s, p) },
  'users:list': { access: 'admin', handler: (_p, s) => settings.listUsers(s) },
  'users:create': { access: 'admin', schema: userCreateSchema, handler: (p, s) => settings.createUser(s, p) },
  'users:setActive': {
    access: 'admin',
    schema: z.object({ id: uuid, active: z.boolean() }),
    handler: (p, s) => settings.setUserActive(s, p),
  },
  'users:resetPassword': {
    access: 'admin',
    schema: z.object({ id: uuid, password: z.string() }),
    handler: (p, s) => settings.resetPassword(s, p),
  },
  'settings:backup': { access: 'admin', handler: (_p, s) => settings.backupNow(s) },
  'settings:recoveryCode': { access: 'admin', handler: (_p, s) => settings.getRecoveryCode(s) },
  'settings:uploadLogo': { access: 'admin', handler: (_p, s) => settings.uploadLogo(s) },
  'settings:removeLogo': { access: 'admin', handler: (_p, s) => settings.removeLogo(s) },

  // ---- subscription / membership ----
  'subscription:status': { access: 'user', handler: (_p, s) => subscription.getStatusView(s) },
  'subscription:refresh': { access: 'user', handler: (_p, s) => subscription.refreshSubscription(s) },
  'subscription:activate': { access: 'admin', schema: activateLicenseSchema, handler: (p, s) => subscription.activateLicense(s, p) },
  'subscription:uploadPaymentProof': { access: 'admin', schema: paymentProofSchema, handler: (p, s) => subscription.uploadPaymentProof(s, p) },

  // ---- cloud sync ----
  'sync:status': { access: 'admin', handler: (_p, s) => sync.getSyncStatus(s) },
  'sync:manual': { access: 'admin', handler: (_p, s) => sync.manualSync(s) },
  'sync:logs': { access: 'admin', handler: (_p, s) => sync.listSyncLogs(s) },
  'sync:conflicts': { access: 'admin', handler: (_p, s) => sync.listSyncConflicts(s) },
  'sync:updateSettings': { access: 'admin', schema: syncSettingsSchema, handler: (p, s) => sync.updateSyncSettings(s, p) },

  // ---- misc ----
  'app:openExternal': {
    access: 'user',
    schema: z.object({ url: z.string().url().startsWith('https://') }),
    handler: (p: { url: string }) => shell.openExternal(p.url),
  },

  // ---- printing ----
  'print:html': {
    access: 'user',
    schema: z.object({ html: z.string().min(1), silent: z.boolean().optional() }),
    handler: (p) => printHtml(p),
  },
}

export function registerIpc(isDev: boolean) {
  if (isDev) {
    routes['dev:seed'] = { access: 'admin', handler: (_p, s) => seedDemoData(s) }
  }

  for (const [channel, route] of Object.entries(routes)) {
    ipcMain.handle(channel, async (_event, payload: unknown): Promise<IpcResult<unknown>> => {
      try {
        let session = getSession()
        if (route.access !== 'public') {
          if (!session) throw new AppError('Not logged in')
          if (route.access === 'admin' && session.role !== 'admin') {
            throw new AppError('Admin permission required')
          }
        }
        session = session ?? ({} as Session)
        // Expired trial/membership: viewing, reports, export and backup keep
        // working; creating sales/purchases is refused here regardless of UI state.
        if (route.requiresActiveSubscription) subscription.assertCanTransact(session.shopId)
        const parsed = route.schema ? route.schema.parse(payload) : payload
        const data = await route.handler(parsed as never, session)
        return { ok: true, data: data ?? null }
      } catch (err) {
        if (err instanceof z.ZodError) {
          const first = err.issues[0]
          return { ok: false, error: first ? `${first.message}` : 'Invalid input' }
        }
        if (err instanceof AppError) return { ok: false, error: err.message }
        console.error(`[ipc:${channel}]`, err)
        return { ok: false, error: 'Something went wrong. Check the logs.' }
      }
    })
  }
}
