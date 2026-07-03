# System Architecture

## High-Level Overview
```
[ Desktop App (Electron) ]
   ├─ React UI
   ├─ Local SQLite DB
   ├─ Sync Engine (background)
   ├─ Printer Service (ESC/POS + PDF)
   └─ License/Activation Module
            │
            │  (when online)
            ▼
[ Cloud API (Node.js + Express) ]
   ├─ Auth & License Service
   ├─ Sync API (push/pull)
   ├─ Reporting API (multi-branch)
   └─ PostgreSQL (multi-tenant, shop_id scoped)
            │
            ▼
[ Owner Web Dashboard (optional, phase 2) ]
```

## Frontend (Desktop)
- **Framework**: Electron + React (or Next.js in static export mode)
- **State management**: React Query / Zustand
- **UI**: Tailwind + component library, optimized for touch/keyboard-heavy POS use
- **Local data access**: direct SQLite queries via `better-sqlite3` or Prisma (SQLite adapter)
- **Offline-first**: all reads/writes hit local DB first, never wait on network

## Backend (Cloud)
- **Framework**: Node.js + Express (or NestJS for structure)
- **Database**: PostgreSQL, multi-tenant via `shop_id` on every table
- **Auth**: JWT for dashboard/API access
- **License service**: separate module — issues/validates activation keys, tracks hardware bindings
- **Sync API**: dedicated endpoints for batch push/pull, idempotent (safe to retry)

## Local Database
- **SQLite**, embedded in the desktop app
- Mirrors cloud schema exactly (see `database.md`)
- All primary keys UUID (generated client-side, no collision on sync)
- Every syncable table has `sync_status` + `updated_at`

## Sync Engine (Core of the System)

**Trigger**: background timer (e.g. every 30s) + on network reconnect event

**Push flow**:
1. Query local DB for `sync_status = pending`
2. Batch records (by table, e.g. 50 at a time)
3. POST to `/api/sync/push` with shop_id + auth token
4. Server upserts records (by UUID), returns success/conflict list
5. Local DB updates `sync_status = synced` for confirmed records

**Pull flow**:
1. Client sends `last_synced_at` timestamp
2. Server returns all records updated after that timestamp (scoped to shop_id, all branches if multi-branch)
3. Client merges into local DB

**Conflict resolution**:
- Default: **last-write-wins** based on `updated_at`
- Sensitive fields (stock quantity) use **delta-based merge** instead of overwrite — inventory changes are additive (+/-), not absolute, so two offline branches selling the same product don't overwrite each other's stock count incorrectly
- Conflicts logged in a `sync_conflicts` table for admin review

**Failure handling**:
- Network drop mid-sync: batch not marked synced, retried next cycle
- Partial batch failure: only failed records stay `pending`, rest confirmed

## Printing
- **Thermal receipts**: `node-thermal-printer` (ESC/POS protocol) — works fully offline via USB/network printer
- **A4 invoices/reports**: generate PDF via `pdfmake` or `puppeteer`, send to system printer

## License/Activation
- Hardware fingerprint: hash of CPU ID + MAC address
- Activation: one-time online call to cloud license API → returns signed JWT token
- Token stored encrypted in local app data
- Offline validation: token signature checked locally using public key (no server call needed daily)
- Periodic re-check (7–15 days) when online to catch renewals/cancellations

## Deployment
- Desktop app: packaged via Electron Builder → Windows installer (.exe), auto-update via electron-updater
- Backend: containerized (Docker), deployed on VPS/cloud (e.g. Railway, DigitalOcean, AWS)
- Database: managed PostgreSQL (or self-hosted)

## Security
- Local DB: encrypted at rest (SQLCipher) if handling sensitive data
- API: HTTPS only, JWT auth, rate limiting on activation endpoint
- Passwords: bcrypt hashed, never stored plain
