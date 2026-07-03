# Product Roadmap

## Version 1 — Offline Core (MVP)
Single shop, fully offline, no sync yet. Goal: prove the core POS is reliable.

- License activation (single device)
- Product / Purchase / Sales / Customer CRUD
- Barcode scan + label printing
- Receipt printing (thermal)
- Basic reports (sales, stock, profit/loss, dues)
- Admin + Cashier roles
- Manual local backup

**Exit criteria**: 5-10 pilot shops running daily operations with zero data loss, no internet dependency.

---

## Version 2 — Cloud Sync + Multi-User
Add the sync engine and expand roles/reporting.

- Auto-sync engine (background, conflict resolution)
- Cloud backend + multi-tenant PostgreSQL
- Manager role + granular permissions
- Shift close / cash reconciliation report
- Batch/expiry tracking for products
- Sync status indicator in UI
- Re-validation of license on interval (subscription enforcement)
- Automated cloud backup

**Exit criteria**: sync runs reliably across intermittent connections with no duplicate/lost transactions across 20+ shops.

---

## Version 3 — Multi-Branch + Owner Dashboard
Scale to multi-location retailers and give owners remote visibility.

- Web-based owner dashboard (view all branches, consolidated reports)
- Multi-branch stock transfer
- Branch-level performance comparison reports
- Loyalty points system for customers
- Multi-currency support (for cross-border retailers)
- Role: Regional Manager (multi-branch access)
- Advanced analytics (best sellers across branches, demand forecasting basics)

**Exit criteria**: at least one multi-branch chain (3+ locations) running fully on the platform with owner using dashboard weekly.

---

## Later / Backlog (Post-V3)
- Mobile companion app (view-only reports, or lightweight mobile billing)
- E-commerce/online store integration
- Accounting module (full ledger, tax filing exports)
- Third-party integrations (WhatsApp receipt, SMS alerts, payment gateways)
- White-label option for reselling to other markets
