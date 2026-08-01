// Shared between electron main and renderer. All money fields are integer paisa.
import type { PlanType, SubscriptionStatus } from './subscription'

export type Role = 'admin' | 'cashier'

export interface Session {
  userId: string
  name: string
  username: string
  role: Role
  shopId: string
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
}

export interface Category {
  id: string
  name: string
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
  cost_price: number
  sale_price: number
  tax_percent: number
  min_stock_alert: number
  is_deleted: number
  updated_at: string
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
  cost_price: number
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
  membership_ends_at: string | null
  license_key_masked: string | null
  activation_method: string | null
  payment_reference: string | null
  payment_proof_uploaded: boolean
}

// ---- cloud sync ----
export type SyncRunStatus = 'success' | 'failed' | 'pending' | 'in_progress' | 'conflict' | 'disabled'

export interface SyncSettings {
  auto_sync_enabled: number
  sync_frequency: string
  sync_time: string // "HH:MM"
  last_sync_at: string | null
  next_sync_at: string | null
  last_sync_status: SyncRunStatus | null
  last_sync_error: string | null
  manual_sync_allowed: number
}

export interface SyncStatusView extends SyncSettings {
  pending_changes: number
  conflict_count: number
  cloud_configured: boolean
  sync_in_progress: boolean
}

export interface SyncLog {
  id: string
  sync_type: 'auto' | 'manual'
  status: SyncRunStatus
  started_at: string
  completed_at: string | null
  error_message: string | null
  total_records_synced: number
}

export interface SyncConflict {
  id: string
  table_name: string
  record_id: string
  local_updated_at: string | null
  cloud_updated_at: string | null
  conflict_reason: string | null
  resolution_status: 'pending' | 'resolved' | 'ignored'
  created_at: string
  resolved_at: string | null
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
