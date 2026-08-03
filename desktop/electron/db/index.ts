import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import type DatabaseType from 'better-sqlite3'

// better-sqlite3 is a native module — load via require and keep it external to the bundle.
const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as typeof DatabaseType

let db: DatabaseType.Database | null = null

const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE shops (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'Rs',
  tax_percent REAL NOT NULL DEFAULT 0,
  receipt_footer TEXT NOT NULL DEFAULT 'Thank you for shopping with us!',
  license_key TEXT,
  hardware_id TEXT,
  license_expiry TEXT,
  sale_seq INTEGER NOT NULL DEFAULT 0,
  purchase_seq INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  name TEXT NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','cashier')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (shop_id, username)
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  name TEXT NOT NULL,
  UNIQUE (shop_id, name)
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  name TEXT NOT NULL,
  sku TEXT,
  barcode TEXT,
  category_id TEXT REFERENCES categories(id),
  unit TEXT NOT NULL DEFAULT 'pcs',
  cost_price INTEGER NOT NULL DEFAULT 0,
  sale_price INTEGER NOT NULL DEFAULT 0,
  tax_percent REAL NOT NULL DEFAULT 0,
  min_stock_alert INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending'
);
CREATE UNIQUE INDEX idx_products_barcode ON products(shop_id, barcode)
  WHERE barcode IS NOT NULL AND is_deleted = 0;
CREATE INDEX idx_products_name ON products(shop_id, name);

-- Append-only stock ledger. Stock is ALWAYS derived from SUM(quantity_change).
CREATE TABLE inventory_logs (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  change_type TEXT NOT NULL CHECK (change_type IN
    ('sale','purchase','sale_return','purchase_return','adjustment','opening')),
  quantity_change INTEGER NOT NULL,
  reason TEXT,
  reference_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX idx_invlogs_product ON inventory_logs(product_id, created_at);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  name TEXT NOT NULL,
  phone TEXT,
  credit_limit INTEGER NOT NULL DEFAULT 0,
  due_balance INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  name TEXT NOT NULL,
  phone TEXT,
  due_balance INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE sales (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  invoice_number TEXT NOT NULL,
  customer_id TEXT REFERENCES customers(id),
  cashier_id TEXT NOT NULL REFERENCES users(id),
  subtotal INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  tax INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','card','credit')),
  tendered INTEGER,
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed','partially_returned','returned')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  UNIQUE (shop_id, invoice_number)
);
CREATE INDEX idx_sales_created ON sales(shop_id, created_at);

CREATE TABLE sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  returned_quantity INTEGER NOT NULL DEFAULT 0,
  unit_price INTEGER NOT NULL,
  cost_price INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  tax INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL
);
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);

CREATE TABLE purchases (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  invoice_number TEXT NOT NULL,
  total INTEGER NOT NULL,
  paid_amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed','partially_returned','returned')),
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  UNIQUE (shop_id, invoice_number)
);

CREATE TABLE purchase_items (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchases(id),
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  returned_quantity INTEGER NOT NULL DEFAULT 0,
  cost_price INTEGER NOT NULL,
  total INTEGER NOT NULL
);
CREATE INDEX idx_purchase_items_purchase ON purchase_items(purchase_id);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  reference_type TEXT NOT NULL CHECK (reference_type IN
    ('sale','purchase','customer_payment','supplier_payment','sale_refund','purchase_refund')),
  reference_id TEXT,
  party_type TEXT CHECK (party_type IN ('customer','supplier')),
  party_id TEXT,
  amount INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash','card')),
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX idx_payments_party ON payments(party_type, party_id);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  user_id TEXT,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL
);
`,
  },
  {
    version: 2,
    sql: `
ALTER TABLE shops ADD COLUMN po_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shops ADD COLUMN recovery_code TEXT;
UPDATE shops SET recovery_code = upper(hex(randomblob(6)));

CREATE TABLE brands (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  name TEXT NOT NULL,
  UNIQUE (shop_id, name)
);

ALTER TABLE products ADD COLUMN brand_id TEXT REFERENCES brands(id);

CREATE TABLE product_images (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  file_name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_product_images_product ON product_images(product_id, position);

-- Parked/draft carts. Resumed carts are re-priced against current products.
CREATE TABLE held_sales (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  cashier_id TEXT NOT NULL REFERENCES users(id),
  label TEXT,
  cart_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Purchase orders: no stock or supplier-due impact until received (converted to a purchase).
CREATE TABLE purchase_orders (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  po_number TEXT NOT NULL,
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','received','cancelled')),
  purchase_id TEXT,
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  UNIQUE (shop_id, po_number)
);

CREATE TABLE purchase_order_items (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  cost_price INTEGER NOT NULL,
  total INTEGER NOT NULL
);
CREATE INDEX idx_po_items_po ON purchase_order_items(purchase_order_id);

-- One row per return event (sale or purchase), for return history.
CREATE TABLE returns (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  kind TEXT NOT NULL CHECK (kind IN ('sale','purchase')),
  reference_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  party_name TEXT,
  refund_amount INTEGER NOT NULL,
  refund_method TEXT NOT NULL CHECK (refund_method IN ('cash','due')),
  reason TEXT,
  is_cancellation INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX idx_returns_created ON returns(shop_id, created_at);

CREATE TABLE expense_categories (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  name TEXT NOT NULL,
  UNIQUE (shop_id, name)
);

CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  category_id TEXT NOT NULL REFERENCES expense_categories(id),
  amount INTEGER NOT NULL,
  note TEXT,
  expense_date TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX idx_expenses_date ON expenses(shop_id, expense_date);
`,
  },
  {
    version: 3,
    sql: `
-- Shop profile (settings module). The single shops row IS shop_settings.
ALTER TABLE shops ADD COLUMN owner_name TEXT;
ALTER TABLE shops ADD COLUMN phone TEXT;
ALTER TABLE shops ADD COLUMN email TEXT;
ALTER TABLE shops ADD COLUMN address TEXT;
ALTER TABLE shops ADD COLUMN city TEXT;
ALTER TABLE shops ADD COLUMN business_type TEXT;
ALTER TABLE shops ADD COLUMN ntn TEXT;
ALTER TABLE shops ADD COLUMN strn TEXT;
ALTER TABLE shops ADD COLUMN logo_url TEXT;
ALTER TABLE shops ADD COLUMN local_logo_path TEXT;
ALTER TABLE shops ADD COLUMN updated_at TEXT;
ALTER TABLE shops ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending';
UPDATE shops SET updated_at = created_at;

-- Trial / membership state. One row per shop, lazily created on first read
-- (existing installs get a fresh 7-day trial at migration time).
CREATE TABLE subscription_settings (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  plan_type TEXT NOT NULL DEFAULT 'trial'
    CHECK (plan_type IN ('trial','monthly','yearly','lifetime')),
  status TEXT NOT NULL DEFAULT 'trial_active'
    CHECK (status IN ('trial_active','trial_expired','membership_active',
      'membership_expired','lifetime_active','suspended','pending_verification')),
  trial_started_at TEXT,
  trial_ends_at TEXT,
  membership_started_at TEXT,
  membership_ends_at TEXT,
  license_key TEXT,
  activation_method TEXT,
  payment_reference TEXT,
  payment_proof_url TEXT,
  payment_proof_local_path TEXT,
  activated_by_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (shop_id)
);

-- Valid license-key hashes cached from the cloud, for offline re-validation.
CREATE TABLE license_key_cache (
  key_hash TEXT PRIMARY KEY,
  plan_type TEXT NOT NULL,
  cached_at TEXT NOT NULL
);

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

-- Ambiguous merge results. Never auto-deleted — resolved manually / by support.
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
`,
  },
  {
    version: 4,
    sql: `
-- (a) Rebuild users to add the 'manager' role.
-- The tables referencing users are re-pointed by name automatically; the whole
-- migration runs with foreign_keys=OFF (see migrate()) so the rebuild is safe.
CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  name TEXT NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','cashier','manager')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (shop_id, username)
);
INSERT INTO users_new (id, shop_id, name, username, password_hash, role, active, created_at)
  SELECT id, shop_id, name, username, password_hash, role, active, created_at FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- (b) Rebuild inventory_logs to allow stock-transfer movement types.
CREATE TABLE inventory_logs_new (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  change_type TEXT NOT NULL CHECK (change_type IN
    ('sale','purchase','sale_return','purchase_return','adjustment','opening','transfer_out','transfer_in')),
  quantity_change INTEGER NOT NULL,
  reason TEXT,
  reference_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending'
);
INSERT INTO inventory_logs_new (id, shop_id, product_id, change_type, quantity_change, reason, reference_id, created_by, created_at, sync_status)
  SELECT id, shop_id, product_id, change_type, quantity_change, reason, reference_id, created_by, created_at, sync_status FROM inventory_logs;
DROP TABLE inventory_logs;
ALTER TABLE inventory_logs_new RENAME TO inventory_logs;
CREATE INDEX idx_invlogs_product ON inventory_logs(product_id, created_at);

-- (c) Granular permissions: one row per granted permission.
-- Admin users keep no rows — they implicitly have every permission.
CREATE TABLE user_permissions (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  permission TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, permission)
);
CREATE INDEX idx_user_permissions_user ON user_permissions(user_id);

-- (d) Receipt printer settings (CSS print or raw ESC/POS over TCP).
CREATE TABLE printer_settings (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  mode TEXT NOT NULL DEFAULT 'css' CHECK (mode IN ('css','escpos')),
  host TEXT,
  port INTEGER NOT NULL DEFAULT 9100,
  width_mm INTEGER NOT NULL DEFAULT 80 CHECK (width_mm IN (58,80)),
  copies INTEGER NOT NULL DEFAULT 1 CHECK (copies BETWEEN 1 AND 3),
  updated_at TEXT NOT NULL,
  UNIQUE (shop_id)
);
`,
  },
  {
    version: 5,
    sql: `
-- Google Drive snapshots are intentionally separate from record-level cloud sync.
-- OAuth tokens live outside SQLite in the OS credential store; this table only
-- contains scheduling and user-visible status.
CREATE TABLE drive_backup_settings (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  auto_backup_frequency TEXT NOT NULL DEFAULT 'daily'
    CHECK (auto_backup_frequency IN ('off','daily','weekly','monthly')),
  backup_time TEXT NOT NULL DEFAULT '02:00',
  include_images INTEGER NOT NULL DEFAULT 1,
  retention_count INTEGER NOT NULL DEFAULT 7 CHECK (retention_count BETWEEN 1 AND 30),
  account_email TEXT,
  last_backup_at TEXT,
  last_backup_status TEXT CHECK (last_backup_status IN ('success','failed','in_progress')),
  last_backup_error TEXT,
  next_backup_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (shop_id)
);

CREATE TABLE drive_backup_logs (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  backup_type TEXT NOT NULL CHECK (backup_type IN ('auto','manual')),
  status TEXT NOT NULL CHECK (status IN ('success','failed','in_progress')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  drive_file_id TEXT,
  file_size INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_drive_backup_logs_shop ON drive_backup_logs(shop_id, started_at DESC);
`,
  },
  {
    version: 6,
    sql: `
-- Printer & receipt defaults for every printable document in the app. One row
-- per shop: these are business-level choices (paper, template, which fields the
-- shop wants on its documents), not per-user preferences.
--
-- The chosen printer is deliberately NOT here. Printer names are per-machine —
-- a second till syncing this shop would inherit a device it does not have — so
-- the renderer keeps that one value in local storage.
CREATE TABLE print_settings (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),

  -- printer / page setup
  paper_size TEXT NOT NULL DEFAULT 'A4'
    CHECK (paper_size IN ('A4','A5','Letter','Legal','Tabloid','Thermal80','Thermal58')),
  landscape INTEGER NOT NULL DEFAULT 0,
  margin_top_mm REAL NOT NULL DEFAULT 12 CHECK (margin_top_mm BETWEEN 0 AND 50),
  margin_right_mm REAL NOT NULL DEFAULT 12 CHECK (margin_right_mm BETWEEN 0 AND 50),
  margin_bottom_mm REAL NOT NULL DEFAULT 12 CHECK (margin_bottom_mm BETWEEN 0 AND 50),
  margin_left_mm REAL NOT NULL DEFAULT 12 CHECK (margin_left_mm BETWEEN 0 AND 50),
  color_mode TEXT NOT NULL DEFAULT 'color' CHECK (color_mode IN ('color','grayscale','bw')),
  page_numbers INTEGER NOT NULL DEFAULT 1,
  copies INTEGER NOT NULL DEFAULT 1 CHECK (copies BETWEEN 1 AND 10),
  auto_print_on_save INTEGER NOT NULL DEFAULT 0,

  -- receipt / document content
  receipt_template TEXT NOT NULL DEFAULT 'thermal'
    CHECK (receipt_template IN ('full','thermal','compact')),
  show_logo INTEGER NOT NULL DEFAULT 1,
  show_header INTEGER NOT NULL DEFAULT 1,
  header_text TEXT,
  footer_text TEXT,
  show_prepared_by INTEGER NOT NULL DEFAULT 1,
  show_notes INTEGER NOT NULL DEFAULT 1,
  currency_symbol TEXT,
  currency_position TEXT NOT NULL DEFAULT 'before' CHECK (currency_position IN ('before','after')),

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  UNIQUE (shop_id)
);
`,
  },
  {
    version: 7,
    sql: `
-- Printable proof for the three money events that previously left none: a
-- customer due payment, a return refund, and a purchase order sent to a
-- supplier. Each needs a stable document number and enough stored detail to
-- reprint the document months later — reconstructing it from current balances
-- would print today's numbers on yesterday's receipt.

-- Customer payment receipts get their own sequence, like sales and purchases.
ALTER TABLE shops ADD COLUMN payment_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN receipt_number TEXT;
-- Balances as they stood at the moment of payment. Stored, not derived: the
-- customer's due moves with every later sale.
ALTER TABLE payments ADD COLUMN balance_before INTEGER;
ALTER TABLE payments ADD COLUMN balance_after INTEGER;

-- What a return event actually took back. The returns table records only the
-- refund total; item lines cannot be recovered from sale_items afterwards
-- because returned_quantity there is cumulative across every return event.
CREATE TABLE return_items (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL REFERENCES returns(id),
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  amount INTEGER NOT NULL
);
CREATE INDEX idx_return_items_return ON return_items(return_id);

-- A purchase order is a request to a supplier, so it carries a delivery date.
ALTER TABLE purchase_orders ADD COLUMN expected_date TEXT;
`,
  },
  {
    version: 8,
    sql: `
-- Optional batch / expiry tracking. Off by default: a general retail shop never
-- sees any of this, a pharmacy or grocery turns it on per shop.
ALTER TABLE shops ADD COLUMN batch_tracking_enabled INTEGER NOT NULL DEFAULT 0;
-- How many days ahead an expiry counts as "nearing". 30 / 60 / 90.
ALTER TABLE shops ADD COLUMN expiry_alert_days INTEGER NOT NULL DEFAULT 30;

-- The batch a product is first created with, and the batch each purchase line
-- was received as. Both nullable — untracked products simply leave them null.
ALTER TABLE products ADD COLUMN batch_number TEXT;
ALTER TABLE products ADD COLUMN expiry_date TEXT;
ALTER TABLE purchase_items ADD COLUMN batch_number TEXT;
ALTER TABLE purchase_items ADD COLUMN expiry_date TEXT;

-- One row per distinct (product, batch number, expiry) actually held. Stock per
-- batch is never stored here: it is derived from inventory_logs.batch_id, the
-- same append-only ledger every other stock figure comes from.
CREATE TABLE product_batches (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  batch_number TEXT,
  expiry_date TEXT,
  created_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending'
);
CREATE UNIQUE INDEX idx_product_batches_key
  ON product_batches(product_id, IFNULL(batch_number, ''), IFNULL(expiry_date, ''));
CREATE INDEX idx_product_batches_expiry ON product_batches(shop_id, expiry_date);

-- Null batch_id = stock held outside any batch. Every pre-existing movement is
-- exactly that, which is why the column is nullable and has no default.
ALTER TABLE inventory_logs ADD COLUMN batch_id TEXT REFERENCES product_batches(id);
CREATE INDEX idx_invlogs_batch ON inventory_logs(batch_id, created_at);
`,
  },
  {
    version: 9,
    sql: `
-- Unattended backups onto this computer (or a USB/network folder). Separate
-- from drive_backup_settings on purpose: most shops here have no Google
-- account and no reliable internet, and a shop that loses its PC on a Tuesday
-- should not discover its last backup was the day it stopped clicking the
-- button. On by default — a backup nobody enabled is the one that saves them.
CREATE TABLE local_backup_settings (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  auto_backup_frequency TEXT NOT NULL DEFAULT 'daily'
    CHECK (auto_backup_frequency IN ('off','daily','weekly','monthly')),
  backup_time TEXT NOT NULL DEFAULT '21:00',
  -- A shop that closes before backup_time would otherwise never be backed up.
  backup_on_close INTEGER NOT NULL DEFAULT 1,
  include_images INTEGER NOT NULL DEFAULT 1,
  -- How many backup files to keep in the folder; older ones are pruned.
  retention_count INTEGER NOT NULL DEFAULT 30 CHECK (retention_count BETWEEN 1 AND 365),
  -- NULL = the app's own "backups" folder under userData. Set to point the
  -- backups at a USB stick or a network share instead.
  folder TEXT,
  last_backup_at TEXT,
  last_backup_status TEXT CHECK (last_backup_status IN ('success','failed','in_progress')),
  last_backup_error TEXT,
  last_backup_file TEXT,
  next_backup_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (shop_id)
);

CREATE TABLE local_backup_logs (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  backup_type TEXT NOT NULL CHECK (backup_type IN ('auto','manual','on_close')),
  status TEXT NOT NULL CHECK (status IN ('success','failed','in_progress')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  file_path TEXT,
  file_size INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_local_backup_logs_shop ON local_backup_logs(shop_id, started_at DESC);
`,
  },
  {
    version: 10,
    sql: `
-- Categories are retired, never deleted. A category that is switched off stops
-- appearing when a shopkeeper picks one for a new product, but every product
-- and every past receipt that already refers to it keeps reading the same name.
-- Deleting the row would blank out history, which is exactly what a shopkeeper
-- does not want a "tidy up my list" action to do.
ALTER TABLE categories ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
`,
  },
  {
    version: 11,
    sql: `
-- Where the supplier actually is, and whatever the shopkeeper needs to remember
-- about dealing with them ("delivers Tuesdays", "cash only", the rep's name).
-- Both free text and both optional: a supplier is often just a name and a phone
-- number scribbled down, and that has to keep working.
ALTER TABLE suppliers ADD COLUMN address TEXT;
ALTER TABLE suppliers ADD COLUMN notes TEXT;
`,
  },
  {
    version: 12,
    sql: `
-- Idempotency key for checkout. A double-clicked Pay button, a jammed scanner
-- trigger, or a renderer that retries after a slow reply must never be able to
-- ring the same basket up twice: the customer is charged twice and the stock
-- ledger is wrong, and neither is obvious until the shop counts the shelf.
--
-- The client stamps one key per basket. The UNIQUE index is what actually
-- enforces it — a check-then-insert would still race, but SQLite cannot let two
-- rows through this index whatever the timing. Nullable, and the index is
-- partial, so the column costs nothing for sales that predate it or for callers
-- that do not send a key.
ALTER TABLE sales ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_idem
  ON sales(shop_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
`,
  },
  {
    version: 13,
    sql: `
-- Cloud record sync removed. The app is local-only: nothing about a shop's
-- trading data leaves the machine, and the only thing that ever reaches a
-- server is the membership activation round trip in subscription.ts.
--
-- This drops the feature's own three tables and the sync_status marker column
-- it put on every synced table. Safe on a database with data: sync_status was
-- only ever read by the sync service, it is in no index, no CHECK constraint
-- and no view, and nothing else in the app reads it. The three tables hold
-- sync bookkeeping alone — no shop record lives in them, so dropping them
-- cannot lose a sale, a purchase or a rupee.
--
-- Order matters: the child tables go before sync_settings so no FK-bearing row
-- outlives its parent even with foreign_keys OFF during the migration run.
DROP TABLE IF EXISTS sync_conflicts;
DROP TABLE IF EXISTS sync_logs;
DROP TABLE IF EXISTS sync_settings;

-- One per table that carried the marker. DROP COLUMN rewrites the table, so on
-- a large shop this is the slow part of the migration — it runs once, inside
-- the migration's own transaction, before the window opens.
ALTER TABLE shops DROP COLUMN sync_status;
ALTER TABLE products DROP COLUMN sync_status;
ALTER TABLE inventory_logs DROP COLUMN sync_status;
ALTER TABLE customers DROP COLUMN sync_status;
ALTER TABLE suppliers DROP COLUMN sync_status;
ALTER TABLE sales DROP COLUMN sync_status;
ALTER TABLE purchases DROP COLUMN sync_status;
ALTER TABLE purchase_orders DROP COLUMN sync_status;
ALTER TABLE payments DROP COLUMN sync_status;
ALTER TABLE returns DROP COLUMN sync_status;
ALTER TABLE expenses DROP COLUMN sync_status;
ALTER TABLE print_settings DROP COLUMN sync_status;
ALTER TABLE product_batches DROP COLUMN sync_status;

-- The 'sync.manage' permission no longer exists. Left behind it would be an
-- unlabelled row that Settings → Users cannot render and cannot switch off.
DELETE FROM user_permissions WHERE permission = 'sync.manage';
`,
  },
  {
    version: 14,
    sql: `
-- Plan-type awareness for license keys: monthly, yearly and lifetime.
--
-- The three plans and the key format they are encoded in already existed; what
-- was missing was (a) an explicit "this never expires" marker rather than one
-- inferred from plan_type in three different places, and (b) any record of what
-- was activated when — without which a renewal cannot know the term it is
-- extending, and the same key can be replayed forever to reset the expiry.

-- Lifetime as stored state, not as a string comparison. Every expiry check
-- short-circuits on this flag, so a lifetime shop can never be locked out by
-- date arithmetic — however wrong the machine's clock is.
ALTER TABLE subscription_settings ADD COLUMN is_lifetime INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subscription_settings ADD COLUMN renewal_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subscription_settings ADD COLUMN last_renewed_at TEXT;
UPDATE subscription_settings SET is_lifetime = 1
  WHERE plan_type = 'lifetime' OR status = 'lifetime_active';
-- A lifetime membership stores no expiry date at all. Any left over from an
-- earlier activation would be a date nothing reads — and a trap for the next
-- person who writes a query against membership_ends_at.
UPDATE subscription_settings SET membership_ends_at = NULL WHERE is_lifetime = 1;

-- One row per key ever accepted on this machine: the activation history behind
-- "Membership started / renewed", and the record a renewal reads to work out
-- whether it is extending a live term or starting a lapsed one again.
--
-- Only the SHA-256 of the key is kept, plus its last 4 characters for support
-- calls — the same shape as the hash already reported for a consumed key. The
-- plaintext key stays in subscription_settings alone.
CREATE TABLE license_activations (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  key_hash TEXT NOT NULL,
  key_last4 TEXT NOT NULL,
  plan_type TEXT NOT NULL CHECK (plan_type IN ('monthly','yearly','lifetime')),
  -- 'activation' = first paid plan on this shop, 'renewal' = extending one.
  kind TEXT NOT NULL CHECK (kind IN ('activation','renewal')),
  activation_method TEXT,
  activated_at TEXT NOT NULL,
  -- NULL means it never expires. Lifetime keys are the only rows with NULL.
  expires_at TEXT,
  -- What the expiry was before this key was applied; NULL on a first activation.
  previous_expires_at TEXT,
  created_at TEXT NOT NULL
);
-- One activation per key per shop. This index is the replay guard: without it a
-- shop could re-enter the same monthly key every month for free, because a
-- check-then-insert in the service would still race with itself.
CREATE UNIQUE INDEX idx_license_activations_key ON license_activations(shop_id, key_hash);
CREATE INDEX idx_license_activations_shop ON license_activations(shop_id, activated_at DESC);

-- Deliberately NOT backfilled from subscription_settings.license_key: hashing
-- needs JS, and more importantly a key already in use must keep working exactly
-- as it does today. It simply is not in the history, so it may be entered once
-- more — after which it is recorded like every other key.
`,
  },
]

/** Highest migration this build knows. Restore refuses newer backups. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version

export function openDb(): DatabaseType.Database {
  if (db) return db
  const dir = app.getPath('userData')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'pos.db')
  const opened = new Database(file)
  // Nothing is published to `db` until the schema is actually usable. A half
  // migrated handle left in place would make every later openDb() return early
  // and turn one loud failure into a hundred quiet "no such column" errors.
  try {
    opened.pragma('journal_mode = WAL')
    opened.pragma('foreign_keys = ON')
    migrate(opened)
  } catch (error) {
    try {
      opened.close()
    } catch {
      // Closing a database that failed to migrate adds nothing to the report.
    }
    throw error
  }
  db = opened
  return db
}

/** The schema version currently on disk; 0 for a database that has none yet. */
export function schemaVersion(d: DatabaseType.Database): number {
  const table = d
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get()
  if (!table) return 0
  const row = d.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
    version: number | null
  }
  return row.version ?? 0
}

function migrate(d: DatabaseType.Database) {
  d.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)'
  )
  const applied = new Set(
    (d.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(
      (r) => r.version
    )
  )
  const pending = MIGRATIONS.filter((m) => !applied.has(m.version))
  if (pending.length === 0) return
  // Table rebuilds (role CHECK, inventory_logs CHECK) require FK enforcement to
  // be off for the duration of the run. Safe here: migrations run before any
  // application queries, and each migration still commits in its own transaction.
  d.pragma('foreign_keys = OFF')
  try {
    for (const m of pending) {
      const run = d.transaction(() => {
        d.exec(m.sql)
        d.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
          m.version,
          new Date().toISOString()
        )
      })
      run()
    }
  } finally {
    d.pragma('foreign_keys = ON')
  }
}

export function getDb(): DatabaseType.Database {
  if (!db) throw new Error('Database not initialised')
  return db
}

export function closeDb() {
  if (db) {
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.close()
    db = null
  }
}
