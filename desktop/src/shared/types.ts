// Shared between electron main and renderer. All money fields are integer paisa.
import type { ExpiryWarning, PlanType, SubscriptionStatus } from './subscription'
import type { Role } from './permissions'

export type { Role }
export type PermissionKey = import('./permissions').PermissionKey

export interface Session {
  userId: string
  name: string
  username: string
  role: Role
  shopId: string
}

// ---- printer & receipt settings -------------------------------------------
// One shop-level record drives every print, PDF and receipt in the app. See
// electron/services/printSettings.ts for persistence and src/stores/printSettings.ts
// for the renderer-side single source of truth.

export type PaperSize = 'A4' | 'A5' | 'Letter' | 'Legal' | 'Tabloid' | 'Thermal80' | 'Thermal58'
export type ColorMode = 'color' | 'grayscale' | 'bw'
export type ReceiptTemplate = 'full' | 'thermal' | 'compact'
export type CurrencyPosition = 'before' | 'after'

/** Thermal rolls reflow to a narrow single-column layout instead of a page grid. */
export const THERMAL_SIZES: PaperSize[] = ['Thermal80', 'Thermal58']
export function isThermal(size: PaperSize): boolean {
  return THERMAL_SIZES.includes(size)
}

export interface PrintSettings {
  paper_size: PaperSize
  landscape: boolean
  margin_top_mm: number
  margin_right_mm: number
  margin_bottom_mm: number
  margin_left_mm: number
  color_mode: ColorMode
  page_numbers: boolean
  /** 1–10. Applied by the main process when printing, not by duplicating HTML. */
  copies: number
  /** Print the document automatically once a sale/purchase is saved. */
  auto_print_on_save: boolean

  receipt_template: ReceiptTemplate
  show_logo: boolean
  show_header: boolean
  /** Extra line above the document title. Blank = omit. */
  header_text: string | null
  /** Blank falls back to the shop's receipt_footer. */
  footer_text: string | null
  show_prepared_by: boolean
  show_notes: boolean
  /** Blank = use the shop currency. */
  currency_symbol: string | null
  currency_position: CurrencyPosition
}

export interface Printer {
  name: string
  displayName: string
  isDefault: boolean
  /** Virtual drivers (Print to PDF, XPS, fax) prompt for a file and cannot serve auto-print. */
  isVirtual: boolean
}

export interface Shop {
  id: string
  name: string
  currency: string
  tax_percent: number
  receipt_footer: string
  recovery_code?: string | null
  owner_name: string | null
  phone: string | null
  email: string | null
  address: string | null
  city: string | null
  business_type: string | null
  ntn: string | null
  strn: string | null
  logo_url: string | null
  local_logo_path: string | null // file name inside the images dir, served via pos-img://
  created_at: string
}

export interface User {
  id: string
  name: string
  username: string
  role: Role
  active: number
  created_at: string
  /** Granted permissions — present on users:list so the admin UI can render the matrix. */
  permissions?: PermissionKey[]
}

export interface Category {
  id: string
  name: string
  /** 0 = retired: hidden when filing a new product, still named on old ones. */
  is_active: number
}

// ---- batch / expiry tracking (optional per shop) ----

export interface BatchSettings {
  batch_tracking_enabled: boolean
  expiry_alert_days: number
}

/** Derived per-batch stock. batch_id null = the unbatched pool. */
export interface BatchStock {
  batch_id: string | null
  batch_number: string | null
  expiry_date: string | null
  stock: number
}

export interface ExpiryRow {
  batch_id: string
  product_id: string
  product_name: string
  sku: string | null
  category_name: string | null
  batch_number: string | null
  expiry_date: string
  /** Negative once the batch has already expired. */
  days_left: number
  stock: number
  /** Absent for roles that may not see cost — see canViewCost in the main process. */
  cost_price?: number
  /** stock × cost. Absent alongside cost_price. */
  value?: number
}

export interface ExpiryReport {
  enabled: boolean
  threshold_days: number
  rows: ExpiryRow[]
  totals: { expired: number; expiring: number; value?: number }
}

export interface Brand {
  id: string
  name: string
}

export interface ProductImage {
  id: string
  product_id: string
  file_name: string
  position: number
}

export interface Product {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  category_id: string | null
  brand_id: string | null
  unit: string
  /**
   * What the shop paid. Stripped from every response to a cashier — see
   * canViewCost in the main process — so treat it as possibly absent.
   */
  cost_price?: number
  sale_price: number
  tax_percent: number
  min_stock_alert: number
  is_deleted: number
  updated_at: string
  /** Batch identifiers captured at product creation. Null unless batch tracking is on. */
  batch_number: string | null
  expiry_date: string | null
}

export interface ProductWithStock extends Product {
  stock: number
  category_name: string | null
  brand_name: string | null
  image: string | null // first image file name, served via pos-img://
}

export interface Customer {
  id: string
  name: string
  phone: string | null
  credit_limit: number
  due_balance: number
  created_at: string
}

export interface Supplier {
  id: string
  name: string
  phone: string | null
  address: string | null
  notes: string | null
  due_balance: number
  created_at: string
}

export type PaymentMethod = 'cash' | 'card' | 'credit'
export type SaleStatus = 'completed' | 'partially_returned' | 'returned'

export interface Sale {
  id: string
  invoice_number: string
  customer_id: string | null
  customer_name: string | null
  cashier_id: string
  cashier_name: string | null
  subtotal: number
  discount: number
  tax: number
  total: number
  payment_method: PaymentMethod
  tendered: number | null
  status: SaleStatus
  created_at: string
}

export interface SaleItem {
  id: string
  sale_id: string
  product_id: string
  product_name: string
  quantity: number
  returned_quantity: number
  unit_price: number
  /** The cost at the time of sale — the line's margin. Absent for cashiers. */
  cost_price?: number
  discount: number
  tax: number
  total: number
}

export interface Purchase {
  id: string
  invoice_number: string
  supplier_id: string
  supplier_name: string | null
  total: number
  paid_amount: number
  status: SaleStatus
  created_at: string
}

export interface PurchaseItem {
  id: string
  purchase_id: string
  product_id: string
  product_name: string
  quantity: number
  returned_quantity: number
  cost_price: number
  total: number
  batch_number: string | null
  expiry_date: string | null
}

export type InventoryChangeType =
  | 'sale'
  | 'purchase'
  | 'sale_return'
  | 'purchase_return'
  | 'adjustment'
  | 'opening'
  | 'transfer_out'
  | 'transfer_in'

export interface InventoryLog {
  id: string
  product_id: string
  product_name?: string
  change_type: InventoryChangeType
  quantity_change: number
  reason: string | null
  reference_id: string | null
  created_by: string | null
  created_by_name?: string | null
  created_at: string
  /** Null = movement against stock held outside any batch. */
  batch_id?: string | null
}

export interface Payment {
  id: string
  reference_type: string
  reference_id: string | null
  party_type: 'customer' | 'supplier' | null
  party_id: string | null
  amount: number
  method: 'cash' | 'card'
  note: string | null
  created_at: string
}

/**
 * A customer due payment as it stood when it was taken. The balances are the
 * stored ones, not today's — a receipt reprinted next month must still show the
 * figures the customer was handed at the counter.
 */
export interface PaymentReceipt {
  id: string
  receipt_number: string
  customer_id: string
  customer_name: string
  amount: number
  method: 'cash' | 'card'
  note: string | null
  balance_before: number
  balance_after: number
  created_by_name: string | null
  created_at: string
}

export interface HeldSale {
  id: string
  cashier_id: string
  cashier_name?: string | null
  label: string | null
  cart_json: string
  created_at: string
}

export interface HeldCartLine {
  product_id: string
  quantity: number
  discount: number
}

export type PurchaseOrderStatus = 'open' | 'received' | 'cancelled'

export interface PurchaseOrder {
  id: string
  supplier_id: string
  supplier_name: string | null
  po_number: string
  total: number
  status: PurchaseOrderStatus
  purchase_id: string | null
  note: string | null
  /** Delivery date requested of the supplier. ISO date (YYYY-MM-DD) or null. */
  expected_date: string | null
  /** Name of the user who raised the order — "Authorised by" on the printed PO. */
  created_by_name?: string | null
  created_at: string
}

export interface PurchaseOrderItem {
  id: string
  purchase_order_id: string
  product_id: string
  product_name: string
  quantity: number
  cost_price: number
  total: number
}

export interface ReturnRecord {
  id: string
  kind: 'sale' | 'purchase'
  reference_id: string
  invoice_number: string
  party_name: string | null
  refund_amount: number
  refund_method: 'cash' | 'due'
  reason: string | null
  is_cancellation: number
  created_by_name?: string | null
  created_at: string
}

/** One line of a return event, as returned at that moment. */
export interface ReturnItem {
  id: string
  return_id: string
  product_name: string
  quantity: number
  amount: number
}

/** A return event with the lines it took back — the printed return slip. */
export interface ReturnReceipt {
  record: ReturnRecord
  items: ReturnItem[]
}

export interface ExpenseCategory {
  id: string
  name: string
}

export interface Expense {
  id: string
  category_id: string
  category_name?: string | null
  amount: number
  note: string | null
  expense_date: string
  created_by_name?: string | null
  created_at: string
}

// ---- printer / receipt ----
export type PrinterMode = 'css' | 'escpos'

export interface PrinterSettings {
  mode: PrinterMode
  host: string | null
  port: number
  width_mm: 58 | 80
  copies: number
}

export interface LedgerEntry {
  date: string
  type: string
  description: string
  debit: number // increases what the party owes / what we owe them
  credit: number // decreases it
  balance: number // running balance after this entry
}

// ---- subscription / membership ----
export interface SubscriptionView {
  plan_type: PlanType
  status: SubscriptionStatus
  trial_started_at: string | null
  trial_ends_at: string | null
  remaining_trial_days: number
  membership_started_at: string | null
  /** Null for a lifetime membership — it stores no expiry date at all. */
  membership_ends_at: string | null
  is_lifetime: boolean
  /** Whole days left on a monthly/yearly term. Always 0 for lifetime and trial. */
  remaining_membership_days: number
  expiry_warning: ExpiryWarning
  /** False for trial (activate, not renew) and for lifetime (nothing to renew). */
  renewal_available: boolean
  renewal_count: number
  last_renewed_at: string | null
  license_key_masked: string | null
  activation_method: string | null
  payment_reference: string | null
  payment_proof_uploaded: boolean
}

// ---- Google Drive full backups ----
export type DriveBackupFrequency = 'off' | 'daily' | 'weekly' | 'monthly'

export interface DriveBackupStatus {
  configured: boolean
  connected: boolean
  account_email: string | null
  auto_backup_frequency: DriveBackupFrequency
  backup_time: string
  include_images: boolean
  retention_count: number
  last_backup_at: string | null
  last_backup_status: 'success' | 'failed' | 'in_progress' | null
  last_backup_error: string | null
  next_backup_at: string | null
  backup_in_progress: boolean
}

export interface DriveRecoveryStatus {
  configured: boolean
  connected: boolean
  account_email: string | null
}

export interface DriveBackupFile {
  id: string
  name: string
  size: number
  created_at: string
  app_version: string | null
  shop_id: string | null
  shop_name: string | null
}

export interface DriveBackupLog {
  id: string
  backup_type: 'auto' | 'manual'
  status: 'success' | 'failed' | 'in_progress'
  started_at: string
  completed_at: string | null
  drive_file_id: string | null
  file_size: number | null
  error_message: string | null
}

// ---- Local backup files ----
/** `restored: false` means the user closed the file picker — not a failure. */
export type LocalRestoreResult =
  | { restored: false }
  | {
      restored: true
      restarting: true
      shop_name: string | null
      created_at: string | null
      /** 'archive' also restores product images; 'database' leaves them alone. */
      format: 'archive' | 'database'
    }

// ---- automatic local backups ----
export interface LocalAutoBackupStatus {
  /** Where the files are written — the app's own folder unless the shop moved it. */
  folder: string
  using_default_folder: boolean
  auto_backup_frequency: DriveBackupFrequency
  backup_time: string
  /** An extra backup as the app closes, for shops that shut before backup_time. */
  backup_on_close: boolean
  include_images: boolean
  retention_count: number
  last_backup_at: string | null
  last_backup_status: 'success' | 'failed' | 'in_progress' | null
  last_backup_error: string | null
  last_backup_file: string | null
  next_backup_at: string | null
  backup_in_progress: boolean
}

export interface LocalAutoBackupFile {
  name: string
  path: string
  size: number
  created_at: string
}

export interface LocalAutoBackupLog {
  id: string
  backup_type: 'auto' | 'manual' | 'on_close'
  status: 'success' | 'failed' | 'in_progress'
  started_at: string
  completed_at: string | null
  file_path: string | null
  file_size: number | null
  error_message: string | null
}

export interface AuthState {
  needsSetup: boolean
  session: Session | null
  shop: Shop | null
}

export interface Paged<T> {
  rows: T[]
  total: number
}

// ---- IPC envelope ----
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

export interface ExposedApi {
  invoke: (channel: string, payload?: unknown) => Promise<IpcResult<unknown>>
  onPrintDone: (cb: () => void) => () => void
}

declare global {
  interface Window {
    api: ExposedApi
  }
}
