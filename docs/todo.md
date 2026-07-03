# TODO — 3-Day Build Plan

Priorities: **P0** = app is not sellable without it. **P1** = MVP-complete. **P2** = stretch, only if ahead of schedule.
Rule: a day's P0s must be done before touching the next day's list. POS sale flow (Day 2) is the heart — protect that time.

---

## Day 1 — Foundation, Auth, Products

### P0 — Infrastructure
- [ ] Clean template junk from `desktop/` (App.css, logos, counter demo)
- [ ] Install: `react-router-dom`, `bcryptjs`, `react-hook-form`, `zod`, `@tanstack/react-table`, `lucide-react`, `clsx`
- [ ] Wire Tailwind v4 with design tokens from `design-system.md` (colors, type scale)
- [ ] **DB module in Electron main process** (`electron/db/`):
  - better-sqlite3 init at `app.getPath('userData')/pos.db`, WAL mode
  - Migration runner (numbered SQL files, `schema_migrations` table)
  - Migration 001: all tables from `database.md` — with two deviations: money columns as **INTEGER (paisa)**, and **no stock column on products** (derived from `inventory_logs`). Keep `sync_status`/`updated_at` columns so V2 sync needs no schema change
- [ ] **IPC bridge**: `contextIsolation: true`, `nodeIntegration: false`; preload exposes one typed `invoke(channel, payload)`; main registers handlers per domain (`products:*`, `sales:*`, …). All SQL lives in main-process services — renderer never touches the DB
- [ ] Session: login sets `{userId, role}` in main-process memory; **every mutating IPC handler checks role** before executing
- [ ] Seed script (dev only): demo shop, admin + cashier users, 30 products across 5 categories, 3 customers, 2 suppliers, opening stock via `inventory_logs`

### P0 — Auth & Setup
- [ ] First-run detection (`shops` empty) → Setup Wizard: shop name, currency symbol, tax %, admin credentials
- [ ] Login screen (bcrypt verify, error states, Enter to submit)
- [ ] Route guards by role; logout

### P0 — App Shell
- [ ] Sidebar layout (role-filtered nav), top bar (shop, user, logout)
- [ ] Shared components: Button (primary/secondary/danger), Input, Select, Modal, ConfirmDialog, Toast, StatusBadge, money formatter (`paisa → Rs 1,234.50`)
- [ ] Global shortcuts: F2 → POS, Esc → close modal

### P0 — Products
- [ ] Products table: search, category filter, columns per features-pages.md, derived stock badge (green/amber/red)
- [ ] Product form modal (RHF + Zod): all fields, inline category create, barcode manual entry + auto-generate (unique per shop), duplicate-barcode validation
- [ ] Soft delete with confirm
- [ ] `getStock(productId)` = `SUM(quantity_change)` from `inventory_logs` — single shared query used everywhere

**Day 1 done when:** fresh install → wizard → login as admin → create/edit products with categories and barcodes.

---

## Day 2 — POS Billing (the core), Customers, Returns

### P0 — POS Screen
- [ ] Layout: product grid + search left, fixed cart panel right (per design-system.md)
- [ ] Barcode keyboard-wedge capture (global listener, buffer + Enter) → add/increment cart line
- [ ] Manual search (name/SKU/barcode, debounced) + category filter
- [ ] Cart: qty stepper, line remove, item discount (amt/%), bill discount, live subtotal/tax/total (all integer math, tax from product `tax_percent`)
- [ ] Stock check on add (block at zero, admin override)
- [ ] Payment modal (F4): cash (tendered → change), card, credit (customer required, `credit_limit` enforced)
- [ ] **Checkout = one SQLite transaction**: `sales` (invoice # `INV-000001` sequential per shop) + `sale_items` (price snapshot) + `inventory_logs` (−qty, `change_type=sale`, `reference_id`) + `payments` / customer due update. Crash mid-transaction = full rollback (this is the "no data loss" MVP criterion)
- [ ] Clear/void cart (Esc + confirm)

### P0 — Receipt
- [ ] 80mm receipt component: shop header, invoice #, date, cashier, lines, discounts, tax, total, tendered/change, footer text
- [ ] Print via hidden window + `webContents.print()`; silent to default printer, reprint from sale detail

### P0 — Customers
- [ ] CRUD table + form (name, phone, credit limit)
- [ ] Detail: due balance, sale history, "Receive payment" (writes `payments`, reduces due, one transaction)

### P1 — Sales History & Return
- [ ] Sales list: date-range/cashier/status filters, server-side (IPC-side) pagination
- [ ] Sale detail: full invoice, reprint
- [ ] Return flow (admin): select items/qtys, reason, refund cash or reduce due → status update + `inventory_logs` (+qty, `change_type=return`) + payment record, one transaction

### P1 — Inventory Adjustment
- [ ] Adjustment form: product, ±qty, reason → `inventory_logs` (`change_type=adjustment`)
- [ ] Per-product movement history view

**Day 2 done when:** scan → cart → pay → receipt prints → stock decremented → return works and restocks. A cashier could run a real day on it.

---

## Day 3 — Purchases, Reports, Dashboard, Ship

### P0 — Purchases & Suppliers
- [ ] Suppliers CRUD + detail (due, history, "Pay supplier")
- [ ] New Purchase: supplier picker, line items (product/qty/cost), paid amount full/partial → `purchases` + `purchase_items` + `inventory_logs` (+qty) + `payments` + supplier due, one transaction
- [ ] Purchases list + detail
- [ ] Purchase return (mirror of sale return, −stock, reduce supplier due)

### P0 — Reports
- [ ] Sales report: date range, totals by payment method + cashier, transaction list
- [ ] Stock report: current stock, cost valuation, low-stock section
- [ ] Profit/Loss: revenue − COGS − discounts for range (COGS from cost snapshot on purchase or product cost)
- [ ] Dues report: customer + supplier balances
- [ ] A4 print stylesheet for all four

### P0 — Dashboard
- [ ] Today's stats (sales total, tx count, payment split), low-stock list, dues totals, quick actions
- [ ] Cashier variant (own sales only)

### P0 — Settings & Backup
- [ ] Shop info + tax + receipt footer edit
- [ ] User management: add/deactivate cashier, reset password
- [ ] Backup Now: SQLite file copy via save dialog (checkpoint WAL first)

### P0 — Ship
- [ ] Full manual pass of the Day-2 checklist + purchase flow on a clean DB
- [ ] Kill dev-only seed behind a flag; fresh install boots to wizard
- [ ] `electron-builder` Windows NSIS installer; install + smoke test the packaged .exe (better-sqlite3 native rebuild — watch for this, it's the likeliest packaging failure)

### P2 — Only if ahead
- [ ] Hold/resume sale (park cart in memory/SQLite)
- [ ] Split payment (cash + card on one sale)
- [ ] Barcode label printing (product barcode → printable label grid)
- [ ] License activation stub UI (key entry form, accepts any key, stores locally — real validation when server exists)
- [ ] Dark mode

---

## Standing rules (every task, all days)

1. Stock changes **only** via `inventory_logs` inserts. Never an UPDATE on a stock number anywhere.
2. Money = integer paisa end-to-end; format only at render.
3. Multi-write operations (sale, purchase, return, payment) = one `better-sqlite3` transaction.
4. Every mutating IPC handler validates the Zod schema **and** checks session role.
5. Price/cost snapshots on `sale_items`/`purchase_items` — editing a product never changes past invoices.
6. UUIDs via `crypto.randomUUID()`, generated app-side (sync-ready for V2).

## Explicitly deferred (do not build)
Cloud sync engine, license server + hardware lock, multi-branch, manager role, shift close, batch/expiry, owner web dashboard, loyalty, multi-currency, ESC/POS direct driver.
