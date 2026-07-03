// SQLite storage for the vendor cloud. Same zero-config stack as the desktop app;
// the schema is small enough that swapping to Postgres later only touches this file.
import Database from 'better-sqlite3'
import type { Database as DatabaseType } from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'

export const DATA_DIR = process.env.POS_CLOUD_DATA ?? path.join(process.cwd(), 'data')

let db: DatabaseType | null = null

export const now = () => new Date().toISOString()
export const uid = () => crypto.randomUUID()

const SCHEMA = `
CREATE TABLE IF NOT EXISTS shops (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  owner_name TEXT, phone TEXT, email TEXT, address TEXT, city TEXT,
  business_type TEXT, currency TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  last_sync_at TEXT
);

-- Vendor-side view of each shop's membership. Authoritative once the shop is online.
CREATE TABLE IF NOT EXISTS subscriptions (
  shop_id TEXT PRIMARY KEY REFERENCES shops(id),
  plan_type TEXT NOT NULL DEFAULT 'trial'
    CHECK (plan_type IN ('trial','monthly','yearly','lifetime')),
  status TEXT NOT NULL DEFAULT 'trial_active'
    CHECK (status IN ('trial_active','trial_expired','membership_active',
      'membership_expired','lifetime_active','suspended','pending_verification')),
  trial_started_at TEXT, trial_ends_at TEXT,
  membership_started_at TEXT, membership_ends_at TEXT,
  license_key_last4 TEXT,
  activation_method TEXT,
  payment_reference TEXT,
  updated_at TEXT NOT NULL
);

-- "Shopkeeper pressed Activate" inbox for the admin.
CREATE TABLE IF NOT EXISTS activation_requests (
  id TEXT PRIMARY KEY,
  client_request_id TEXT,
  shop_id TEXT NOT NULL,
  shop_name TEXT NOT NULL DEFAULT '',
  phone TEXT,
  requested_plan TEXT,
  reference TEXT,
  proof_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  note TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_requests_status ON activation_requests(status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_client ON activation_requests(shop_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

-- Keys issued from the admin panel. Only the hash is stored after generation.
CREATE TABLE IF NOT EXISTS license_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  key_last4 TEXT NOT NULL,
  plan_type TEXT NOT NULL CHECK (plan_type IN ('monthly','yearly','lifetime')),
  status TEXT NOT NULL DEFAULT 'unused' CHECK (status IN ('unused','used','revoked')),
  note TEXT,
  used_by_shop_id TEXT,
  created_at TEXT NOT NULL,
  used_at TEXT
);

-- Generic mirror of pushed desktop rows: the cloud backup. One row per record,
-- payload is the full JSON row. No per-table schemas to maintain.
CREATE TABLE IF NOT EXISTS synced_records (
  shop_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT,
  received_at TEXT NOT NULL,
  PRIMARY KEY (shop_id, table_name, record_id)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  pushed_records INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_runs_shop ON sync_runs(shop_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`

export function openDb(): DatabaseType {
  if (db) return db
  fs.mkdirSync(DATA_DIR, { recursive: true })
  db = new Database(path.join(DATA_DIR, 'pos-cloud.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  seedAdmin(db)
  return db
}

export function getDb(): DatabaseType {
  return db ?? openDb()
}

/** First-boot admin comes from env so there is no setup wizard to secure. */
function seedAdmin(d: DatabaseType) {
  const username = (process.env.POS_ADMIN_USER ?? 'admin').toLowerCase()
  const password = process.env.POS_ADMIN_PASSWORD
  const existing = d.prepare('SELECT id FROM admins WHERE username = ?').get(username)
  if (existing) return
  if (!password) {
    if ((d.prepare('SELECT COUNT(*) AS c FROM admins').get() as { c: number }).c > 0) return
    console.warn('[pos-cloud] POS_ADMIN_PASSWORD not set — admin login disabled until you set it and restart.')
    return
  }
  d.prepare('INSERT INTO admins (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    uid(), username, bcrypt.hashSync(password, 10), now()
  )
  console.log(`[pos-cloud] admin user "${username}" created`)
}

/** Upsert the shop stub so it exists before its first full sync. */
export function touchShop(fields: { id: string; name?: string; phone?: string }) {
  const d = getDb()
  const existing = d.prepare('SELECT id FROM shops WHERE id = ?').get(fields.id)
  if (existing) {
    d.prepare('UPDATE shops SET last_seen_at = ?, name = COALESCE(NULLIF(?, \'\'), name) WHERE id = ?')
      .run(now(), fields.name ?? '', fields.id)
  } else {
    d.prepare('INSERT INTO shops (id, name, phone, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
      .run(fields.id, fields.name ?? '', fields.phone ?? null, now(), now())
  }
}
