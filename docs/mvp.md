# MVP Scope (Version 1)

Goal: a single-shop, fully offline-capable POS that a shop can actually run their business on — sync and multi-branch come later.

## Included in MVP

### Setup
- License activation (hardware-locked, one shop)
- Basic setup wizard (shop name, currency, tax, admin account)

### Users
- Login system
- 2 roles only: Admin, Cashier (Manager role added in V2)

### Products
- Product CRUD (name, barcode, category, cost/sale price, tax, unit)
- Barcode auto-generate + manual entry
- Barcode label printing

### Inventory
- Stock in/out (tied to purchases/sales)
- Manual stock adjustment
- Low stock alert (dashboard indicator)

### Purchases
- Supplier CRUD
- Purchase entry (full/partial payment)
- Purchase return

### Sales
- POS billing screen with barcode scan
- Cart, discounts (item + bill level)
- Payment: cash, card, credit
- Sale return
- Void before checkout
- Receipt printing (thermal)

### Customers
- Customer CRUD
- Due/credit tracking

### Reports
- Daily sales report
- Stock report (current + low stock)
- Profit/loss (basic)
- Customer due report

### System
- Fully offline operation (local SQLite)
- Manual "Backup Now" (local file export)
- **No auto-sync yet** — sync is V2

## Explicitly Excluded from MVP
- Cloud sync / multi-branch
- Manager role & granular permissions
- Batch/expiry tracking
- Shift close / cash reconciliation report
- Owner web dashboard
- Multi-currency
- Loyalty points

## Why This Scope
- Proves the offline-core works reliably before adding sync complexity
- Gets a sellable product to first shops fast
- Sync is the hardest, riskiest part — build and test it after core POS is stable and battle-tested with real usage

## Definition of Done (MVP)
- Shop can activate, set up, and run a full day of sales/purchases with zero internet
- No data loss on app crash or power failure mid-transaction
- Receipt prints correctly on standard thermal printer
- Reports match actual transaction data (no discrepancies)
