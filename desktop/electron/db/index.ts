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
]

export function openDb(): DatabaseType.Database {
  if (db) return db
  const dir = app.getPath('userData')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'pos.db')
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
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
