# Product Requirements Document (PRD)

## Goal
Build a desktop POS system that runs fully offline, syncs automatically when online, and supports full retail operations — sales, purchases, inventory, and reporting — with a per-shop activation key.

## Target Users

| User | Role |
|---|---|
| Shop Owner | Views reports, manages products/pricing, controls users |
| Cashier | Bills customers, processes sales, limited access |
| Manager | Inventory, purchases, supplier management, reports |
| Multi-branch Owner | Views consolidated reports across shops via cloud dashboard |

## Goals
- Zero downtime billing — works with or without internet
- Automatic, conflict-safe data sync
- Full CRUD for products, inventory, purchases, sales, customers, suppliers
- Barcode scanning support (plug-and-play)
- Receipt + invoice printing
- Role-based access control
- Per-shop license activation, hardware-locked

## Non-Goals (Out of Scope for V1)
- Mobile app (POS on phone/tablet) — future phase
- E-commerce/online store integration
- Multi-currency support
- Accounting/ledger module (beyond basic due tracking)

## Feature List

### Sales
- Barcode scan to add item
- Manual product search/add
- Item & bill-level discounts
- Multiple payment methods (cash, card, credit)
- Split payment
- Hold/resume sale
- Sale return
- Void/cancel before checkout
- Receipt printing (thermal)

### Purchases
- Purchase order creation
- Purchase invoice entry
- Supplier CRUD
- Partial payments to supplier
- Purchase return

### Inventory
- Product CRUD (SKU, barcode, category, price, tax, unit)
- Stock in/out tracking
- Stock adjustment (damage, loss)
- Low stock alerts
- Batch/expiry tracking (optional, phase 2)
- Barcode label printing

### Customers & Suppliers
- Customer CRUD, credit limit, due balance
- Supplier CRUD, due balance
- Payment history per customer/supplier

### Reports
- Daily/weekly/monthly sales
- Purchase report
- Profit/loss report
- Stock valuation & low stock report
- Customer/supplier due report
- Cashier shift/cash reconciliation report
- Best-selling / slow-moving products

### System
- Role-based login (admin/manager/cashier)
- Offline-first operation
- Auto sync with cloud when online
- Manual "sync now" option
- License activation per shop (hardware-locked)
- Data backup (local + cloud)

## Success Criteria
- App fully usable with zero internet connection
- No data loss during power failure mid-transaction
- Sync completes without duplicate/lost records
- License system blocks unauthorized copies without deleting shop data
