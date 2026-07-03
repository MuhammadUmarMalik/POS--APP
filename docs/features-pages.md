# Features & Pages — 3-Day Build Scope

Source of truth: `mvp.md` (scope), `database.md` (schema), `design-system.md` (UI), `user-flow.md` (flows).
Target: **Electron + React + SQLite, single shop, fully offline.** No sync, no cloud (that's V2 per roadmap).

> **Stack note:** `.claude/CLAUDE.md` describes a Next.js SaaS stack, but the repo (`desktop/`) and all docs are Electron + SQLite. This plan follows the repo/docs. CLAUDE.md's business rules still apply and are baked in:
> - Stock is **never** stored on the product row — always derived from `inventory_logs` (append-only).
> - Money stored as **integer paisa**, formatted only for display.
> - Role checks enforced in the IPC/service layer, not just UI.

## Cut from the 3-day build (and why)

| Cut | Reason | Fallback |
|---|---|---|
| License activation (hardware-locked) | Requires a cloud license server — doesn't exist. | Stub: free-run flag in local config. Wire real activation when server exists. |
| Direct ESC/POS thermal printing | Driver/hardware testing eats a day. | 80mm receipt CSS printed via Electron `webContents.print()` — works on thermal printers installed as Windows printers. |
| Barcode **label** printing | Nice-to-have, not billing-critical. | Day 3 stretch goal only. |
| Cloud sync, multi-branch, shift close, batch/expiry, manager role | Explicitly excluded from MVP in `mvp.md`. | V2. |
| Hold/resume sale, split payment | PRD-only (not in MVP list). | Day 3 stretch goals. |

Everything else in `mvp.md` is in scope.

---

## Pages (14 screens)

### 1. Setup Wizard (first run only)
Shop name, currency symbol, default tax %, admin username/password. Writes `shops` row + admin `users` row. App boots here when `shops` table is empty.

### 2. Login
Username + password against local `users` (bcrypt). Loads role into session. Keyboard-first (Enter submits).

### 3. Dashboard
- Today's sales total, transaction count, cash vs card vs credit split
- Low-stock alert list (stock ≤ `min_stock_alert`)
- Customer dues total, supplier dues total
- Quick actions: New Sale (F2), New Purchase, Add Product
- Cashier sees only: today's own sales + New Sale button

### 4. POS / New Sale — *the core screen*
- Left: product search (name/SKU/barcode) + category-filtered product grid with stock badges
- Right: fixed cart panel — line items (qty stepper, price, remove), sticky footer (subtotal, tax, discount, total, big checkout button)
- Barcode scanner input (keyboard-wedge: global input capture, Enter terminates scan → add to cart)
- Item-level and bill-level discounts (amount or %)
- Payment modal (F4): cash (with tendered/change calc), card, credit (requires customer, blocks if over `credit_limit`)
- On confirm (single transaction): insert `sales` + `sale_items` + `inventory_logs` (−qty per item) + `payments` (if not credit) + customer `due_balance` update (if credit) → print receipt → clear cart
- Void/clear cart before checkout (Esc)
- Blocks selling below zero stock (with admin override)

### 5. Sales List
Table: invoice #, date/time, customer, cashier, total, payment method, status badge. Filter by date range / cashier / status. Row → sale detail.

### 6. Sale Detail + Return
Full invoice view, reprint receipt. Return flow: select items + quantities, reason, refund method (cash out or reduce customer due). Writes `sales.status = returned` (or partial), `inventory_logs` (+qty), `payments` (negative/refund).

### 7. Products
TanStack Table: name, SKU, barcode, category, cost, price, current stock (derived), status badge. Add/Edit in modal — name, category (inline-create), barcode (manual or auto-generated EAN-13-style), unit, cost price, sale price, tax %, min stock alert. Soft delete only. Search + category filter.

### 8. Inventory
- Stock report view: product, current stock (SUM of `inventory_logs`), valuation at cost, low-stock highlighting
- **Stock Adjustment**: product picker, ± quantity, reason (damage/loss/correction) → `inventory_logs` row with `change_type = adjustment`
- Movement history per product (drill-in)

### 9. Purchases
List + **New Purchase**: supplier picker (inline-create), line items (product, qty, unit cost), total, paid amount (full/partial). Confirm writes `purchases` + `purchase_items` + `inventory_logs` (+qty) + `payments` + supplier `due_balance` (if partial). **Purchase return** mirrors sale return.

### 10. Suppliers
CRUD table: name, phone, due balance. Detail: purchase history, payment history, "Pay supplier" action (writes `payments`, reduces due).

### 11. Customers
CRUD table: name, phone, credit limit, due balance. Detail: sale history, payment history, "Receive payment" action (writes `payments`, reduces due).

### 12. Reports
Four tabs (all read from transaction tables — fine at single-shop scale):
- **Sales**: date range, totals, by payment method, by cashier, transaction list
- **Stock**: current stock + valuation + low stock (same query as Inventory, printable)
- **Profit/Loss**: revenue − COGS (from `sale_items` qty × product cost snapshot) per date range
- **Dues**: customers with balances, suppliers with balances
Each printable via A4 print CSS.

### 13. Settings
- Shop info (name, currency, tax %) — admin only
- Users: add/edit cashiers, activate/deactivate, reset password — admin only
- **Backup Now**: copy SQLite file to user-chosen location (Electron save dialog)
- Receipt footer text

### 14. App Shell (not a page, but built once)
Sidebar nav (role-filtered), top bar (shop name, user, logout), global keyboard shortcuts (F2 new sale, F4 payment, Esc cancel), toast notifications, confirm dialogs.

---

## Feature → Day map

| Feature | Page(s) | Day |
|---|---|---|
| DB layer, migrations, IPC bridge | — | 1 |
| Setup wizard, login, roles | 1, 2 | 1 |
| App shell, design system components | 14 | 1 |
| Products + categories CRUD, barcode gen | 7 | 1 |
| POS billing, cart, discounts, payments | 4 | 2 |
| Receipt printing (80mm CSS) | 4 | 2 |
| Customers + credit/dues | 11 | 2 |
| Sales list, detail, sale return | 5, 6 | 2 |
| Stock adjustment + inventory views | 8 | 2–3 |
| Suppliers, purchases, purchase return | 9, 10 | 3 |
| Reports (sales, stock, P/L, dues) | 12 | 3 |
| Dashboard | 3 | 3 |
| Settings, users, backup | 13 | 3 |
| Windows installer build | — | 3 |

## Roles (MVP: 2 only)

| Capability | Admin | Cashier |
|---|---|---|
| POS sale, receipt print | ✅ | ✅ |
| Discounts | ✅ | ✅ (bill-level cap configurable) |
| Sale return | ✅ | ❌ |
| Products/Inventory/Purchases/Suppliers | ✅ | ❌ |
| Reports | ✅ | own daily sales only |
| Settings/Users/Backup | ✅ | ❌ |

Enforced in the IPC service layer (every mutating handler checks session role), UI hiding is cosmetic.
