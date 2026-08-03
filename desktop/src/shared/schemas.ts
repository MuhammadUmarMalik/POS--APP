// Zod schemas shared by renderer forms and main-process IPC validation.
import { z } from 'zod'
import { PERMISSIONS, ROLES } from './permissions'

export const money = z.number().int().min(0) // paisa
export const uuid = z.string().min(1)

export const setupSchema = z.object({
  shopName: z.string().trim().min(1, 'Shop name is required'),
  ownerName: z.string().trim().max(120).optional(),
  phone: z
    .string().trim().regex(/^[0-9+\-\s()]{7,20}$/, 'Enter a valid phone number')
    .optional().or(z.literal('')),
  email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().max(80).optional(),
  businessType: z.string().trim().max(80).optional(),
  currency: z.string().trim().min(1, 'Currency symbol is required').max(8),
  taxPercent: z.number().min(0).max(100),
  ntn: z.string().trim().max(30).optional(),
  strn: z.string().trim().max(30).optional(),
  receiptFooter: z.string().trim().max(300).optional(),
  adminName: z.string().trim().min(1, 'Name is required'),
  username: z.string().trim().min(3, 'Min 3 characters'),
  password: z.string().min(4, 'Min 4 characters'),
})
export type SetupInput = z.infer<typeof setupSchema>

/** YYYY-MM-DD. Blank strings are normalised to null by the callers. */
export const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date')

export const batchSettingsSchema = z.object({
  batch_tracking_enabled: z.boolean(),
  expiry_alert_days: z.union([z.literal(30), z.literal(60), z.literal(90)]).default(30),
})
export type BatchSettingsInput = z.infer<typeof batchSettingsSchema>

export const expiryReportSchema = z.object({
  days: z.number().int().min(1).max(365).optional(),
})

export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
})
export type LoginInput = z.infer<typeof loginSchema>

export const productSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  sku: z.string().trim().nullable().optional(),
  barcode: z.string().trim().nullable().optional(),
  category_id: uuid.nullable().optional(),
  brand_id: uuid.nullable().optional(),
  unit: z.string().trim().min(1).default('pcs'),
  cost_price: money,
  sale_price: money,
  tax_percent: z.number().min(0).max(100).default(0),
  min_stock_alert: z.number().int().min(0).default(0),
  images: z.array(z.string()).max(8).optional(), // file names inside the product-images dir
  // Batch / expiry — ignored entirely unless the shop enabled batch tracking.
  batch_number: z.string().trim().max(60).nullable().optional(),
  expiry_date: isoDate.nullable().optional(),
})
export type ProductInput = z.infer<typeof productSchema>

/**
 * Creating a product may declare the stock already sitting on the shelf. It is
 * not a column on the product — it becomes one `opening` movement in the
 * append-only ledger, exactly like any other stock change. Create-only: an edit
 * cannot restate opening stock, that is what an adjustment is for.
 */
export const productCreateSchema = productSchema.extend({
  opening_stock: z.number().int().min(0).max(1_000_000).optional(),
})
export type ProductCreateInput = z.infer<typeof productCreateSchema>

export const categorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
})

/**
 * Renaming a category rewrites what every product already filed under it is
 * called, which is the point — the id never moves, so history stays intact.
 */
export const categoryUpdateSchema = z.object({
  id: uuid,
  name: z.string().trim().min(1, 'Name is required'),
})

/**
 * Retiring a category, not deleting it. Off = hidden from the pickers used to
 * file new products; products already in it keep showing the name everywhere.
 */
export const categoryActiveSchema = z.object({
  id: uuid,
  is_active: z.boolean(),
})

/** Only the manage-categories screen asks for the retired ones. */
export const categoryListSchema = z.object({
  include_inactive: z.boolean().optional(),
})

export const customerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  phone: z.string().trim().nullable().optional(),
  credit_limit: money.default(0),
})
export type CustomerInput = z.infer<typeof customerSchema>

export const supplierSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  phone: z.string().trim().nullable().optional(),
  // Where to send someone with a return, and anything worth remembering about
  // dealing with them. Both optional — a name and a phone number is still a
  // complete supplier.
  address: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
})
export type SupplierInput = z.infer<typeof supplierSchema>

export const saleItemInput = z.object({
  product_id: uuid,
  quantity: z.number().int().min(1),
  unit_price: money, // snapshot from client, re-validated against product server-side
  discount: money.default(0), // per-line total discount
})

export const checkoutSchema = z
  .object({
    items: z.array(saleItemInput).min(1, 'Cart is empty'),
    bill_discount: money.default(0),
    payment_method: z.enum(['cash', 'card', 'credit']),
    customer_id: uuid.nullable().optional(),
    tendered: money.nullable().optional(),
    allow_negative_stock: z.boolean().default(false),
    /**
     * One key per basket, stamped by the till before it submits. Sending the
     * same key twice returns the sale that was already created instead of
     * creating a second one — a double-clicked Pay button must not charge the
     * customer twice. Optional so an older client, or a caller that genuinely
     * wants a second identical sale, still works.
     */
    idempotency_key: z.string().trim().min(8).max(64).nullable().optional(),
  })
  .refine((v) => v.payment_method !== 'credit' || !!v.customer_id, {
    message: 'Credit sale requires a customer',
    path: ['customer_id'],
  })
export type CheckoutInput = z.infer<typeof checkoutSchema>

export const saleReturnSchema = z.object({
  sale_id: uuid,
  reason: z.string().trim().min(1, 'Reason is required'),
  refund_method: z.enum(['cash', 'due']), // due = reduce customer due balance
  items: z
    .array(z.object({ sale_item_id: uuid, quantity: z.number().int().min(1) }))
    .min(1, 'Select at least one item'),
})
export type SaleReturnInput = z.infer<typeof saleReturnSchema>

/**
 * Why stock moved outside a sale or purchase. Stored verbatim on the ledger row,
 * so these keys are permanent — add, never rename. `sign` is what the reason
 * normally means: 'out' only ever removes, 'in' only ever adds, 'both' either
 * way. The UI filters on it; the service accepts any reason in either direction
 * so an old payload can never be rejected retroactively.
 */
export const ADJUSTMENT_REASONS = [
  { value: 'correction', label: 'Stock count correction', sign: 'both' },
  { value: 'physical_count_correction', label: 'Physical count correction', sign: 'both' },
  { value: 'opening_stock', label: 'Opening stock', sign: 'in' },
  { value: 'damage', label: 'Damaged', sign: 'out' },
  { value: 'expired', label: 'Expired', sign: 'out' },
  { value: 'loss', label: 'Lost / stolen', sign: 'out' },
  { value: 'other', label: 'Other', sign: 'both' },
] as const

export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number]['value']

/**
 * Ledger rows store the raw key, optionally as `key: free-text note`. This turns
 * that back into something a shopkeeper reads, and leaves anything it does not
 * recognise (sale/purchase reasons, older free text) exactly as stored.
 */
export function adjustmentReasonLabel(stored: string | null | undefined): string {
  if (!stored) return ''
  const [key, ...rest] = stored.split(':')
  const match = ADJUSTMENT_REASONS.find((r) => r.value === key.trim())
  const label = key.trim() === 'opening_stock' && !match ? 'Opening stock' : match?.label
  if (!label) return stored
  const note = rest.join(':').trim()
  return note ? `${label}: ${note}` : label
}

const adjustmentReasonEnum = z.enum(
  ADJUSTMENT_REASONS.map((r) => r.value) as unknown as [AdjustmentReason, ...AdjustmentReason[]]
)

export const adjustmentSchema = z.object({
  product_id: uuid,
  quantity_change: z
    .number()
    .int()
    .refine((n) => n !== 0, 'Quantity cannot be zero'),
  reason: adjustmentReasonEnum,
  note: z.string().trim().optional(),
  // Optional batch targeting; only honoured while batch tracking is enabled.
  batch_id: uuid.nullable().optional(),
  batch_number: z.string().trim().max(60).nullable().optional(),
  expiry_date: isoDate.nullable().optional(),
})
export type AdjustmentInput = z.infer<typeof adjustmentSchema>

export const stockTransferSchema = z.object({
  from_product_id: uuid,
  to_product_id: uuid,
  quantity: z.number().int().min(1, 'Quantity must be at least 1'),
  note: z.string().trim().max(200).optional(),
})
export type StockTransferInput = z.infer<typeof stockTransferSchema>

export const purchaseItemInput = z.object({
  product_id: uuid,
  quantity: z.number().int().min(1),
  cost_price: money,
  // Batch received on this line. Ignored unless batch tracking is enabled.
  batch_number: z.string().trim().max(60).nullable().optional(),
  expiry_date: isoDate.nullable().optional(),
})

export const purchaseSchema = z.object({
  supplier_id: uuid,
  items: z.array(purchaseItemInput).min(1, 'Add at least one item'),
  paid_amount: money,
  method: z.enum(['cash', 'card']).default('cash'),
})
export type PurchaseInput = z.infer<typeof purchaseSchema>

export const purchaseReturnSchema = z.object({
  purchase_id: uuid,
  reason: z.string().trim().min(1, 'Reason is required'),
  refund_method: z.enum(['cash', 'due']), // due = reduce supplier due
  items: z
    .array(z.object({ purchase_item_id: uuid, quantity: z.number().int().min(1) }))
    .min(1, 'Select at least one item'),
})
export type PurchaseReturnInput = z.infer<typeof purchaseReturnSchema>

export const partyPaymentSchema = z.object({
  party_id: uuid,
  amount: money.refine((n) => n > 0, 'Amount must be positive'),
  method: z.enum(['cash', 'card']),
  note: z.string().trim().optional(),
})
export type PartyPaymentInput = z.infer<typeof partyPaymentSchema>

export const userCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  username: z.string().trim().min(3, 'Min 3 characters'),
  password: z.string().min(4, 'Min 4 characters'),
  role: z.enum(ROLES),
})
export type UserCreateInput = z.infer<typeof userCreateSchema>

export const userPermissionsUpdateSchema = z.object({
  user_id: uuid,
  permissions: z.array(z.enum(PERMISSIONS)).default([]),
})
export type UserPermissionsUpdateInput = z.infer<typeof userPermissionsUpdateSchema>

export const printerSettingsSchema = z.object({
  mode: z.enum(['css', 'escpos']),
  host: z
    .string().trim()
    .regex(/^([a-zA-Z0-9.-]+|\d{1,3}(\.\d{1,3}){3})$/, 'Enter a valid host or IP')
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
  port: z.number().int().min(1).max(65535).default(9100),
  width_mm: z.union([z.literal(58), z.literal(80)]).default(80),
  copies: z.number().int().min(1).max(3).default(1),
})
export type PrinterSettingsInput = z.infer<typeof printerSettingsSchema>

export const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: z.string().min(4, 'Min 4 characters'),
})
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
})
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>

export const recoverPasswordSchema = z.object({
  username: z.string().trim().min(1, 'Username is required'),
  recovery_code: z.string().trim().min(1, 'Recovery code is required'),
  new_password: z.string().min(4, 'Min 4 characters'),
})
export type RecoverPasswordInput = z.infer<typeof recoverPasswordSchema>

export const holdSaleSchema = z.object({
  label: z.string().trim().max(60).nullable().optional(),
  items: z
    .array(z.object({ product_id: uuid, quantity: z.number().int().min(1), discount: money.default(0) }))
    .min(1, 'Cart is empty'),
})
export type HoldSaleInput = z.infer<typeof holdSaleSchema>

export const purchaseOrderSchema = z.object({
  supplier_id: uuid,
  note: z.string().trim().max(500).nullable().optional(),
  /** Delivery date requested of the supplier, as YYYY-MM-DD. */
  expected_date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date')
    .nullable()
    .optional(),
  items: z.array(purchaseItemInput).min(1, 'Add at least one item'),
})
export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>

export const receivePurchaseOrderSchema = z.object({
  id: uuid,
  paid_amount: money,
  method: z.enum(['cash', 'card']).default('cash'),
  /**
   * Batch details captured at the door, one entry per order line. A purchase
   * order is raised before the goods exist, so the batch can only be known here.
   * Ignored entirely when the shop does not track batches.
   */
  batches: z
    .array(
      z.object({
        item_id: uuid,
        batch_number: z.string().trim().max(60).nullable().optional(),
        expiry_date: isoDate.nullable().optional(),
      })
    )
    .optional(),
})
export type ReceivePurchaseOrderInput = z.infer<typeof receivePurchaseOrderSchema>

export const expenseSchema = z.object({
  category_id: uuid,
  amount: money.refine((n) => n > 0, 'Amount must be positive'),
  note: z.string().trim().max(500).nullable().optional(),
  expense_date: z.string().min(1, 'Date is required'), // YYYY-MM-DD
})
export type ExpenseInput = z.infer<typeof expenseSchema>

export const BUSINESS_TYPES = [
  'Kiryana Store', 'Mini Mart', 'Grocery Store', 'Pharmacy', 'Bakery',
  'Cosmetics Store', 'Stationery Store', 'Mobile Accessories Store',
  'Wholesale Store', 'Other',
] as const

const optionalTrimmed = (max: number) =>
  z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null))

export const shopSettingsSchema = z.object({
  name: z.string().trim().min(1, 'Shop name is required'),
  currency: z.string().trim().min(1).max(8),
  tax_percent: z.number().min(0).max(100),
  receipt_footer: z.string().default(''),
  owner_name: optionalTrimmed(120),
  phone: z
    .string().trim().regex(/^[0-9+\-\s()]{7,20}$/, 'Enter a valid phone number')
    .nullable().optional().or(z.literal('').transform(() => null)),
  email: z
    .string().trim().email('Enter a valid email')
    .nullable().optional().or(z.literal('').transform(() => null)),
  address: optionalTrimmed(300),
  city: optionalTrimmed(80),
  business_type: z.enum(BUSINESS_TYPES).nullable().optional(),
  ntn: optionalTrimmed(30),
  strn: optionalTrimmed(30),
})
export type ShopSettingsInput = z.infer<typeof shopSettingsSchema>

// ---- subscription ----
export const activateLicenseSchema = z.object({
  license_key: z
    .string().trim().toUpperCase()
    .regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/, 'Key format: XXXX-XXXX-XXXX-XXXX'),
})
export type ActivateLicenseInput = z.infer<typeof activateLicenseSchema>

export const paymentProofSchema = z.object({
  reference: z.string().trim().max(120).nullable().optional(),
})
export type PaymentProofInput = z.infer<typeof paymentProofSchema>

// ---- Google Drive full backups ----
export const driveBackupSettingsSchema = z.object({
  auto_backup_frequency: z.enum(['off', 'daily', 'weekly', 'monthly']),
  backup_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM'),
  include_images: z.boolean(),
  retention_count: z.number().int().min(1).max(30),
})
export type DriveBackupSettingsInput = z.infer<typeof driveBackupSettingsSchema>

export const driveBackupRestoreSchema = z.object({
  file_id: z.string().min(1),
  confirmation: z.literal('RESTORE'),
})

// ---- local backup files ----
// The file itself is chosen through the OS picker in the main process, so the
// renderer only ever sends the typed confirmation.
export const localBackupRestoreSchema = z.object({
  confirmation: z.literal('RESTORE'),
})

// Unattended backups onto this computer. The folder is chosen through the OS
// picker in the main process, so it is not part of this payload either — the
// renderer must never be able to name an arbitrary path to write into.
export const localBackupSettingsSchema = z.object({
  auto_backup_frequency: z.enum(['off', 'daily', 'weekly', 'monthly']),
  backup_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM'),
  backup_on_close: z.boolean(),
  include_images: z.boolean(),
  retention_count: z.number().int().min(1).max(365),
})
export type LocalBackupSettingsInput = z.infer<typeof localBackupSettingsSchema>

// ---- printer & receipt settings ----
// Same schema validates the Settings form (RHF) and the IPC payload in the main
// process, so the two can never drift.
const marginMm = z.number().min(0, 'Min 0 mm').max(50, 'Max 50 mm')

export const printSettingsSchema = z.object({
  paper_size: z.enum(['A4', 'A5', 'Letter', 'Legal', 'Tabloid', 'Thermal80', 'Thermal58']),
  landscape: z.boolean(),
  margin_top_mm: marginMm,
  margin_right_mm: marginMm,
  margin_bottom_mm: marginMm,
  margin_left_mm: marginMm,
  color_mode: z.enum(['color', 'grayscale', 'bw']),
  page_numbers: z.boolean(),
  copies: z.number().int().min(1, 'At least 1 copy').max(10, 'At most 10 copies'),
  auto_print_on_save: z.boolean(),

  receipt_template: z.enum(['full', 'thermal', 'compact']),
  show_logo: z.boolean(),
  show_header: z.boolean(),
  header_text: optionalTrimmed(200),
  footer_text: optionalTrimmed(300),
  show_prepared_by: z.boolean(),
  show_notes: z.boolean(),
  currency_symbol: optionalTrimmed(8),
  currency_position: z.enum(['before', 'after']),
})
export type PrintSettingsInput = z.infer<typeof printSettingsSchema>
/** Pre-validation shape, which is what the RHF form holds while being edited. */
export type PrintSettingsForm = z.input<typeof printSettingsSchema>
