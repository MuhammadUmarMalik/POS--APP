// Zod schemas shared by renderer forms and main-process IPC validation.
import { z } from 'zod'

export const money = z.number().int().min(0) // paisa
export const uuid = z.string().min(1)

export const setupSchema = z.object({
  shopName: z.string().trim().min(1, 'Shop name is required'),
  currency: z.string().trim().min(1, 'Currency symbol is required').max(8),
  taxPercent: z.number().min(0).max(100),
  adminName: z.string().trim().min(1, 'Name is required'),
  username: z.string().trim().min(3, 'Min 3 characters'),
  password: z.string().min(4, 'Min 4 characters'),
})
export type SetupInput = z.infer<typeof setupSchema>

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
})
export type ProductInput = z.infer<typeof productSchema>

export const categorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
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

export const adjustmentSchema = z.object({
  product_id: uuid,
  quantity_change: z
    .number()
    .int()
    .refine((n) => n !== 0, 'Quantity cannot be zero'),
  reason: z.enum(['damage', 'loss', 'correction', 'other']),
  note: z.string().trim().optional(),
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
  role: z.enum(['admin', 'cashier']),
})
export type UserCreateInput = z.infer<typeof userCreateSchema>

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
  items: z.array(purchaseItemInput).min(1, 'Add at least one item'),
})
export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>

export const receivePurchaseOrderSchema = z.object({
  id: uuid,
  paid_amount: money,
  method: z.enum(['cash', 'card']).default('cash'),
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

// ---- cloud sync ----
export const syncSettingsSchema = z.object({
  auto_sync_enabled: z.boolean(),
  sync_frequency: z.enum(['daily']).default('daily'),
  sync_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM'),
})
export type SyncSettingsInput = z.infer<typeof syncSettingsSchema>
