# User Flows

## 1. First-Time Setup (Shop Onboarding)
1. Install desktop app
2. App generates hardware fingerprint
3. Enter license/activation key
4. App calls activation server (needs internet, one-time)
5. Server validates key → binds to hardware → returns signed token
6. Token stored locally (encrypted) — app now works offline
7. Setup wizard: shop name, currency, tax %, admin user creation
8. Ready to use

## 2. Daily Login
1. Open app → login screen (works offline)
2. Enter username/password (validated against local DB)
3. Role loaded (admin/manager/cashier) → dashboard shown per role permissions

## 3. Sale Flow (Cashier)
1. Open POS billing screen
2. Scan barcode (or search product manually) → item added to cart
3. Adjust quantity if needed
4. Apply discount (item or bill level) — if permitted by role
5. Select payment method (cash/card/credit)
6. If credit: select customer, check credit limit
7. Confirm sale → stock deducted → invoice generated (UUID + branch prefix)
8. Print receipt (thermal printer)
9. Sale saved locally with `sync_status: pending`
10. If online: sync engine pushes to cloud in background

## 4. Sale Return
1. Open past invoice (search by invoice # or customer)
2. Select item(s) to return
3. Confirm return reason
4. Stock added back
5. Refund processed (cash or adjust customer due)
6. Return record synced same as sale

## 5. Purchase Flow (Manager)
1. Go to Purchases → New Purchase
2. Select/add supplier
3. Add products with quantity + cost price
4. Full or partial payment entry
5. Confirm → stock increased → supplier due updated (if partial)
6. Purchase invoice saved, synced when online

## 6. Product Management
1. Go to Products → Add/Edit
2. Enter name, category, cost/sale price, tax, unit
3. Auto-generate barcode (if not provided) or scan existing barcode
4. Save → available immediately in POS screen
5. Edit price: doesn't affect past invoices (price snapshot per sale)

## 7. Inventory Adjustment
1. Go to Inventory → Stock Adjustment
2. Select product, enter reason (damage/loss/correction)
3. Enter quantity change (+/-)
4. Confirm → stock updated, adjustment logged for audit

## 8. Sync Flow (Background, Automatic)
1. App checks internet connectivity every X seconds
2. If online: gather all records with `sync_status: pending`
3. Push to cloud API in batches
4. Server responds success/conflict per record
5. On success: mark `synced` locally
6. On conflict: apply resolution rule (timestamp-based), log conflict
7. Pull any updates from other branches/devices
8. Update local DB, notify user (subtle sync icon/status)

## 9. Shift Close (Cashier End of Day)
1. Cashier clicks "Close Shift"
2. System shows: total sales, cash expected, card total, returns
3. Cashier enters actual cash in drawer
4. System calculates variance (if any)
5. Shift report saved and printable

## 10. License Expiry / Offline Grace Period
1. App checks license validity when online (every 7–15 days)
2. If expired: app enters read-only mode (view data, no new sales) — data never deleted
3. Owner renews → next online check restores full access
