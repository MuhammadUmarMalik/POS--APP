# POS Desktop

An offline-first point-of-sale application for a single shop. It runs entirely
on the shop's own computer: the database is a local SQLite file, and no internet
connection is required to sell, purchase, report, back up or restore.

- **Platform:** Windows (primary), macOS and Linux builds also configured
- **Stack:** Electron 30 + React 18 + TypeScript + SQLite (`better-sqlite3`)
- **Money:** stored everywhere as **integer paisa**, never as a decimal
- **Stock:** never stored as a number — always derived from an append-only ledger

---

## Contents

1. [Setup and build](#1-setup-and-build)
2. [Admin guide](#2-admin-guide)
3. [Cashier guide](#3-cashier-guide)
4. [Printer and scanner setup](#4-printer-and-scanner-setup)
5. [How the data fits together (ERD)](#5-how-the-data-fits-together-erd)
6. [Costing method — please read](#6-costing-method--please-read)
7. [Testing](#7-testing)
8. [Packaging and code signing](#8-packaging-and-code-signing)
9. [Google Drive backups (optional)](#9-google-drive-backups-optional)
10. [Open decisions](#10-open-decisions)

---

## 1. Setup and build

### For a shop (installing the finished app)

1. Run `POS Desktop-Windows-<version>-Setup.exe`.
2. Windows SmartScreen will warn that the publisher is unknown — the installer
   is not code-signed yet (see [section 8](#8-packaging-and-code-signing)).
   Choose **More info → Run anyway**.
3. Choose an install folder. The app installs per-user, so no administrator
   password is needed.
4. On first launch the **setup wizard** asks for the shop name, currency,
   default tax percentage, receipt footer, and the first admin username and
   password. **Write that password down.** There is no "forgot password" —
   the data never leaves the machine, so nobody can reset it remotely.
5. The 7-day free trial starts automatically.

Where the data lives (Windows):

```
%APPDATA%\pos-desktop\
  pos.db          the whole shop: products, sales, purchases, everything
  images\         product photos and the shop logo
  backups\        automatic local backups (default location)
```

Uninstalling does **not** delete this folder.

### For a developer

Requirements: Node.js 18+, and the build tools `better-sqlite3` needs
(on Windows, the "Desktop development with C++" workload).

```bash
cd desktop
npm install

npm run dev          # renderer with hot reload + electron
npm run lint         # eslint (currently 7 known react-refresh warnings)
npx tsc --noEmit -p tsconfig.json    # typecheck everything
npm run build:main   # bundle the electron main process only
npm run build        # typecheck + bundle + package installers into release/
```

Layout:

```
electron/
  main.ts              app lifecycle, window, POS_SMOKE entry point
  ipc.ts               THE routing table — every channel, its role and its schema
  db/index.ts          schema + the MIGRATIONS array
  services/            all business logic (sales, purchases, reports, …)
  smoke.ts             the acceptance test suite
src/
  features/<domain>/   one folder per screen area
  shared/              zod schemas, types, permissions, subscription rules
                       — imported by BOTH the renderer and the main process
  components/ui/       the small in-house UI kit
scripts/               export + print verification helpers, license key generator
docs/OPEN-DECISIONS.md items awaiting a client decision
```

### Rules that must not be broken

These are not style preferences; breaking any of them corrupts shop data.

1. **Stock is never written directly.** There is no stock column. Every
   movement inserts a row into `inventory_logs`, and stock is always
   `SUM(quantity_change)`. If you find yourself wanting `UPDATE products SET
   stock = …`, stop.
2. **Never edit a migration that has already shipped.** Add a new entry to the
   `MIGRATIONS` array in `electron/db/index.ts`. Shops in the field have
   already run the old one.
3. **A schema change is three files, always together:** the migration, the Zod
   schema in `src/shared/schemas.ts`, and the IPC route in `electron/ipc.ts`.
   Never one or two of the three.
4. **Money is integer paisa.** `toPaisa` / `toRupees` in `src/lib/money`
   convert at the edges. Never store a float.
5. **Cost price is stripped in the main process**, not hidden in the UI.
   Anything returning cost, margin or supplier price must go through
   `costFiltered` / `canViewCost` in `electron/services/permissions.ts`, or
   live on an `access: 'admin'` route. A cashier with devtools open must not be
   able to read the buying price out of an IPC response.
6. **Every destructive or financial action writes an `audit_logs` row.**
7. **Batch/expiry tracking stays optional** and off by default.

---

## 2. Admin guide

The admin is the shop owner. Admins see everything, including cost prices,
profit and all reports.

### First hour with a new shop

1. **Settings → Shop profile** — name, logo, currency, default tax, receipt
   footer. These appear on every receipt.
2. **Products → Categories** — set up your categories first (Beverages,
   Snacks, Medicines…). Categories can be renamed or hidden later; they are
   never deleted, so old receipts keep the name they were sold under.
3. **Products → Add product** — name, barcode, cost price, sale price,
   minimum stock alert. The form has an **Opening stock** field: whatever you
   type there is written to the stock ledger as an `opening_stock` movement,
   so day-one stock is auditable like every other movement.
   - Bulk loading? **Products → Import** takes an Excel file; download the
     template from the same screen.
4. **Suppliers → Add supplier** — name, phone, address and notes (delivery
   days, the rep's name, payment terms).
5. **Settings → Users** — create a cashier account per person on the counter.
   Never share the admin login.
6. **Settings → Printer** — see [section 4](#4-printer-and-scanner-setup).
7. **Settings → Backup** — automatic local backup is **already on** (daily at
   21:00, plus one when the app closes, keeping the last 30 copies). Point the
   folder at a USB stick or a network drive so a dead hard disk does not take
   the backups with it.

### Roles

| Role | Sees cost & profit | Typical use |
| --- | --- | --- |
| **Admin** | Yes | The owner. Full access, always, including users and settings. |
| **Manager** | Yes | Runs the shop day to day: stock, purchases, returns, reports — but not users, settings or membership. |
| **Cashier** | **No** | The counter. Sells, holds bills, sees their own sales, manages customers. |

Beyond the role, each non-admin user has a tick-list of permissions
(Settings → Users → Permissions): sell, apply discounts, view sales history,
process returns, manage customers, manage products, manage stock, transfer
stock, manage purchases, manage expenses, view reports, view profit reports.
Admins implicitly have all of them.

Cost visibility is deliberately **role-based, not a permission tick-box** — a
tick-box could be missed on an old account and quietly leak the buying price.

### Daily routine

- **Dashboard** — today's takings, today's gross profit, stock value, product
  counts, recent sales, and what is running low. Admin only.
- **Purchases → New purchase** — record goods coming in. Stock goes up, the
  supplier's balance goes up by whatever you did not pay, and each product's
  cost price is updated to what you just paid (see
  [section 6](#6-costing-method--please-read)).
- **Inventory** — current stock, movement history per product, and stock
  adjustments. An adjustment always needs a reason: damaged, lost, expired,
  found, opening stock, physical count correction, or other. Every adjustment
  is audited with the user who made it.
- **Returns** — take goods back against a sale (refund in cash or against the
  customer's account) or return goods to a supplier. Stock comes back
  automatically; the original sale is marked partially returned or returned.
- **Customers** — credit customers, what they owe, credit limits, and
  receiving payments against their account.
- **Expenses** — rent, salaries, utilities. These come off net profit.
- **Reports** — sales, profit & loss, day book, product profitability, dues,
  cash flow, drawer, payments, ledgers, expiry. Every report exports to Excel.

### Backup and restore

- **Automatic local backup** runs on the schedule you set and prunes to the
  retention count. It only ever deletes files it wrote itself.
- **Manual backup** (Settings → Backup → Back up now) writes an archive
  containing the database and, optionally, the images.
- **Restore** replaces everything. Before it does, it takes a safety copy of
  the current data, verifies the archive belongs to this shop, and refuses an
  archive from a newer version of the app or one that is incomplete. If the
  restore fails at any point the shop is left exactly as it was.
- Restoring is **not** merging. Anything recorded after the backup was taken
  is gone. Take a manual backup first if in doubt.

### Membership and plans

Every shop starts on a **7-day free trial**. After that the till needs a
license key, entered in **Settings → Activate membership**. There are three
plans, and the shop never picks one: **the plan is carried inside the key**, so
whichever key you were sent is the plan you get.

| Plan | Term | Renewal |
| --- | --- | --- |
| Monthly | 30 days from activation | Yes, with a new key |
| Yearly | 365 days from activation | Yes, with a new key |
| Lifetime | Never expires — no date is stored at all | Not applicable; the button is hidden |

**Renewing early costs nothing.** If the membership has days left, the new term
is added on top of them (renew a monthly with 12 days left and you get 42). If
it has already lapsed — or is renewed at the exact moment it expires — the new
term runs from the day the key is entered. Days are never quietly lost, and a
lapse is never charged for twice.

Settings → Subscription shows the plan, the expiry date, and the days left,
with a warning that grows louder at 7 days, 3 days and on the last day.
A lifetime membership shows none of that: it says *Lifetime — no renewal
needed* and nothing counts down.

**A key can only be used once per shop.** Renewing needs a new key; entering an
old one is refused with an explanation rather than silently accepted. Every
accepted key is recorded in `license_activations` with its plan, the date, and
the expiry before and after — so "when did this shop last renew, and on what?"
is answerable from the shop's own database.

### Issuing keys (vendor side)

`npm run genkey` — run on **your** machine, never shipped to a shop:

```bash
npm run genkey                        # 1 monthly key
npm run genkey lifetime               # 1 lifetime key
npm run genkey yearly 5               # a batch of 5 yearly keys
npm run genkey monthly 3 --note "Ali Kiryana Store"
npm run genkey -- --list              # every key issued so far, newest first
npm run genkey -- --list yearly       # …only the yearly ones
```

Issued keys are appended to `scripts/issued-keys.jsonl` with their plan, date
and note. That file is git-ignored because it holds plaintext keys, and it is
the only record of which plan a given key carries — the app stores nothing but
a hash of the key it accepted.

---

## 3. Cashier guide

Everything the counter needs is on one screen.

### Making a sale

1. Press **F2** (or click **New Sale**) from anywhere in the app.
2. **Scan the barcode.** The item drops straight into the cart. No mouse
   needed — the scanner types the code and presses Enter for you.
   - No barcode? Type part of the name and click the product tile.
   - Pressing **Enter** adds the exact barcode match.
3. Adjust quantity with the **+ / −** buttons, or type it.
4. Discounts, if you are allowed to give them: per line, or one off the whole
   bill.
5. Press **F4** to pay.
6. Choose **Cash**, **Card**, or **On account** (credit customers only).
   - For cash, type what the customer handed over; the change is worked out
     for you.
   - For an account sale, pick the customer first. The app blocks the sale if
     it would push them past their credit limit.
7. The receipt prints. If auto-print is off, print it from the sale.

### Other things at the till

| Action | How |
| --- | --- |
| Park a bill and serve the next customer | **Held** → the current cart is saved under a label |
| Bring a parked bill back | **Held** → pick it from the list (prices refresh) |
| Empty the cart | **Esc** (asks first) |
| See a past sale | **Sales** — a cashier sees only their own sales |
| Reprint a receipt | Open the sale → **Print** |
| Add a customer | **Customers → Add customer** |
| Take a payment against an account | **Customers** → the customer → **Receive payment** |

### What a cashier will not see, and why

Cost price, profit, margins, stock value and the shop's financial reports are
not available to a cashier — not on the screen, and not in the data the screen
receives. This is deliberate and is not something a cashier can turn on.

### If something goes wrong

- **"Not enough stock"** — the shelf and the system disagree. Sell what the
  system has, and tell the owner so they can adjust stock properly. Do not
  guess.
- **"Your trial has expired"** — the shop's membership needs renewing. Nothing
  is lost; the owner must activate it.
- **A receipt did not print** — the app tells you why. Reprint from the sale
  once the printer is sorted. Nothing about the sale is lost.

---

## 4. Printer and scanner setup

### Barcode scanner

Any USB or Bluetooth **keyboard-wedge** scanner works. That is nearly all of
them — the scanner types the barcode as if it were a keyboard, then presses
Enter.

1. Plug the scanner in. Windows installs it as a keyboard; there is nothing to
   install and nothing to configure in the app.
2. Open Notepad and scan something. You should see the digits followed by a
   new line. If there is no new line, use the scanner's manual to set the
   suffix to **Enter / CR**. Every scanner has a barcode in its manual for this.
3. In the app, open **New Sale (F2)**. The search box is focused already —
   scan and the item is added.

Products carry a barcode field. Whatever your scanner produces (EAN-13,
UPC-A, Code 128, a supplier's own code) is what you should type into that
field. For loose goods with no barcode, print your own labels or leave the
field empty and search by name.

### Receipt printer

The app prints through the printers Windows already knows about, so if it
prints from Notepad it will print here.

1. Install the printer's Windows driver and make sure a Windows test page
   prints.
2. **Settings → Printer & Receipt Settings**:
   - **Printer** — pick the receipt printer by name. Leave it unset to use the
     Windows default. The app **refuses** to fall back to "Microsoft Print to
     PDF", OneNote or any other virtual printer — a receipt that silently turns
     into a file prompt is worse than a visible error.
   - **Paper size** — `Thermal80` for the common 80 mm roll, `Thermal58` for a
     58 mm roll, or A4/A5/Letter for full-page invoices.
   - **Template** — `thermal` (roll), `compact`, or `full` (A4 invoice).
   - **Copies**, **margins**, **colour mode**, **page numbers**.
   - **Logo, header, footer, "prepared by"** — what appears on the paper.
   - **Auto-print on save** — off by default. Turn it on and every completed
     sale prints without anyone clicking anything.
3. Click **Test print**.

There is also a raw **ESC/POS over TCP** mode for network thermal printers,
configured with a host and port (9100 by default) and a 58 mm or 80 mm width.
Use this only if the Windows driver route is unavailable — the CSS route
handles logos and formatting far better.

**Troubleshooting**

| Symptom | Cause |
| --- | --- |
| "No printer is installed on this computer" | Windows has no printer at all. Add one in Windows settings. |
| "The printer saved in Settings is not available" | It was renamed, unplugged or switched off. Reconnect it or pick it again. |
| "Only 'print to file' printers are installed" | Only virtual printers exist. Install the real one's driver. |
| Receipt prints half-width or cut off | Paper size does not match the roll. Switch between `Thermal58` and `Thermal80`. |
| Nothing prints and no error | Auto-print is off. Print from the sale. |

---

## 5. How the data fits together (ERD)

Every shop-owned table carries `shop_id`. Money columns are integer paisa.
Timestamps are ISO-8601 strings.

```
                            ┌──────────────┐
                            │    shops     │  currency, tax %, receipt footer,
                            │              │  invoice sequences, batch tracking
                            └──────┬───────┘
                                   │ 1
        ┌──────────────────────────┼────────────────────────────┐
        │ N                        │ N                          │ N
┌───────▼────────┐        ┌────────▼────────┐          ┌────────▼────────┐
│     users      │        │   categories    │          │    suppliers    │
│ role: admin /  │        │  is_active      │          │ name, phone,    │
│ manager /      │        └────────┬────────┘          │ address, notes, │
│ cashier        │                 │ 1                 │ due_balance     │
└───────┬────────┘                 │                   └────────┬────────┘
        │ 1                        │ N                          │ 1
┌───────▼────────┐        ┌────────▼────────┐                   │
│user_permissions│        │    products     │◄──────┐           │
└────────────────┘        │ cost_price      │       │           │
                          │ sale_price      │       │ N         │
                          │ min_stock_alert │       │           │
                          │ (NO stock col)  │       │           │
                          └────────┬────────┘       │           │
                                   │ 1              │           │
              ┌────────────────────┼────────────┐   │           │
              │ N                  │ N          │ N │           │
   ┌──────────▼─────────┐ ┌────────▼───────┐ ┌──▼───▼─────┐     │
   │  inventory_logs    │ │ product_batches│ │product_    │     │
   │ ══════════════════ │ │ batch_number,  │ │images      │     │
   │ APPEND ONLY.       │ │ expiry_date    │ └────────────┘     │
   │ change_type:       │ └────────────────┘                    │
   │  sale, purchase,   │        ▲                              │
   │  sale_return,      │        │ batch_id (nullable)          │
   │  purchase_return,  │────────┘                              │
   │  adjustment,       │                                       │
   │  opening,          │   STOCK = SUM(quantity_change)        │
   │  transfer_in/out   │   There is no stock column anywhere.  │
   └────────────────────┘                                       │
              ▲                    ▲                            │
              │ writes             │ writes                     │
   ┌──────────┴─────────┐  ┌───────┴──────────┐                 │
   │       sales        │  │    purchases     │◄────────────────┘
   │ invoice_number     │  │ invoice_number   │
   │ subtotal, discount │  │ total,           │
   │ tax, total         │  │ paid_amount      │
   │ payment_method:    │  │ status           │
   │  cash/card/credit  │  └───────┬──────────┘
   │ status             │          │ 1
   └───┬────────────┬───┘          │ N
       │ 1          │ N     ┌──────▼─────────┐
       │      ┌─────▼────┐  │ purchase_items │
       │      │sale_items│  │ quantity,      │
       │      │ quantity │  │ returned_qty,  │
       │      │ returned_│  │ cost_price,    │
       │      │ quantity │  │ batch_number,  │
       │      │ unit_    │  │ expiry_date    │
       │      │ price    │  └────────────────┘
       │      │ cost_    │
       │      │ price ◄──┼── COGS is frozen here at the moment of sale
       │      └──────────┘
       │ N
┌──────▼─────────┐        ┌─────────────────┐      ┌──────────────────┐
│   customers    │        │     returns     │      │ purchase_orders  │
│ credit_limit,  │        │ kind: sale /    │      │ status, expected │
│ due_balance    │        │       purchase  │      │ _date            │
└────────────────┘        │ refund_amount,  │      └────────┬─────────┘
       ▲                  │ refund_method   │               │ 1
       │                  └────────┬────────┘               │ N
       │ N                         │ 1             ┌────────▼─────────┐
┌──────┴─────────┐        ┌────────▼────────┐      │purchase_order_   │
│    payments    │        │  return_items   │      │items             │
│ reference_type:│        └─────────────────┘      └──────────────────┘
│  sale, purchase│
│  customer_pay, │        ┌─────────────────┐      ┌──────────────────┐
│  supplier_pay, │        │    expenses     │──N──►│expense_categories│
│  *_refund      │        │ amount, date    │      └──────────────────┘
│ receipt_number │        └─────────────────┘
│ balance_before │
│ balance_after  │        ┌─────────────────┐      ┌──────────────────┐
└────────────────┘        │   audit_logs    │      │   held_sales     │
                          │ every financial │      │ parked carts     │
                          │ + destructive   │      └──────────────────┘
                          │ action          │
                          └─────────────────┘

Settings and infrastructure tables (one row per shop unless noted):
  subscription_settings · license_activations (many) · license_key_cache
  printer_settings · print_settings
  local_backup_settings · local_backup_logs (many) · drive_backup_settings
  drive_backup_logs (many) · brands · schema_migrations
```

### The three things worth understanding

**1. Stock is a ledger, not a number.** `products` has no stock column. Every
sale, purchase, return, adjustment, opening balance and transfer appends one
row to `inventory_logs`. Current stock is `SUM(quantity_change)`. This is why
stock can always be explained: every unit that came in or went out has a row
with a timestamp, a user and a reason.

**2. Cost is frozen at the moment of sale.** `sale_items.cost_price` is a copy
of the product's cost price when the sale was rung up. A later purchase at a
different price does not rewrite history — last month's profit report still
says what it said last month. See [section 6](#6-costing-method--please-read).

**3. Returns are events, not edits.** A return never modifies the original
sale's lines. It writes a `returns` row plus `return_items`, increments
`sale_items.returned_quantity`, appends a `sale_return` movement to the stock
ledger, and marks the sale partially returned or returned.

---

## 6. Costing method — please read

**This app uses the latest purchase cost.** It is not FIFO and not weighted
average.

Concretely:

1. Recording a purchase **overwrites** each product's `cost_price` with the
   cost on that purchase line.
2. Ringing up a sale **copies** the product's cost price at that instant onto
   the sale line, where it stays forever.
3. Every profit figure — the dashboard tile, Profit & Loss, product
   profitability — is `selling price − that frozen cost`.
4. **Stock value** is always current stock × the **current** cost price, so it
   moves when a new purchase arrives at a new price.

What that means in practice: buy cola at Rs 50, buy more at Rs 60, then sell
one. This app books Rs 60 as the cost of that sale. FIFO would book Rs 50; a
weighted average would book something in between. With prices rising,
latest-cost reports the most conservative profit of the three.

Past reports never change retrospectively — only future sales use the new cost.

This was chosen because it is the easiest for a shopkeeper to reason about
("what it costs me to replace it") and is what comparable small-shop systems in
this market do. **It has not been formally signed off.** An accountant
preparing statutory accounts may expect FIFO. See
[docs/OPEN-DECISIONS.md](docs/OPEN-DECISIONS.md) before assuming.

---

## 7. Testing

One command runs the whole acceptance suite:

```bash
cd desktop
npm test
```

It typechecks, bundles the main process, and runs the suite in a real Electron
main process against a throwaway database in the system temp folder. Your own
data is never touched. It prints one line per assertion and exits non-zero on
the first failure.

Individually:

```bash
npm run typecheck      # tsc --noEmit
npm run build:main     # bundle the main process
npm run test:smoke     # the suite alone (needs build:main first)
npm run verify:export  # Excel export shape
npm run verify:print   # receipt/invoice HTML rendering
```

The suite lives in `electron/smoke.ts` and covers, among other things:

- setup, login, roles, and per-user permissions
- purchase → **stock goes up**; the supplier balance and payment follow
- sale → **stock goes down exactly once**, at the right cost
- sale return → **stock comes back**, the refund lands, the sale is re-statused
- purchase return, cancellations, and held sales
- every report reconciling against the seeded data (sales vs P&L vs day book
  vs series vs product profitability)
- optional batch/expiry: FEFO consumption, expiry windows, write-offs, and
  turning tracking off without losing batch data
- cost-price leaks: a cashier's IPC responses must not contain `cost_price`
- backup, archive validation, restore, and automatic local backup with pruning
- Google Drive backup and restore, end to end (see below)
- checkout idempotency: a duplicated submission must not create two sales
- license plans: a key of each type activating with the right expiry (30 days,
  365 days, none at all), the transact gate opening and closing with it,
  renewal early / on the exact expiry day / after a lapse, a used key being
  refused a second time, and lifetime never expiring and never offering renewal

Adding a feature? Add its assertions here. It is the only supported test path.

### Google Drive backup is tested without a Google account

The suite fakes Google and nothing else. A stub stands in for the network —
token refresh, resumable upload, file list, delete, and download — backed by an
in-memory `appDataFolder`. Everything on our side of that boundary is real: the
archive that gets uploaded is built by the real archive builder, and the test
takes the uploaded bytes back out of the fake Drive and restores them through
the real extractor.

That covers: upload and a success log row; the uploaded file actually being a
restorable archive of this shop, images included; another shop's backups and
other apps' files being invisible; retention pruning the oldest and nothing
else; the access token being fetched once and reused; a Drive outage producing
a `failed` log with the reason and a retry about fifteen minutes out; restore
refusing a file id belonging to another shop, another app, or nothing at all; a
download that claims to be over 512 MB being refused before it is written; a
full round trip putting the shop back to the moment of the backup, images and
all; and disconnect revoking the refresh token and deleting the stored
credential.

Two things the suite deliberately does not cover, because they cannot be
exercised without a real browser and a real Google account: the interactive
OAuth consent screen (`connect`), and Google's own quota and error responses.
Re-check those by hand after touching `electron/services/googleDriveBackup.ts`.

> **Note for anyone running Electron from a shell:** `ELECTRON_RUN_AS_NODE`
> must be unset, or the ESM main bundle will not load. The npm scripts handle
> this.

---

## 8. Packaging and code signing

```bash
npm run build      # → release/<version>/POS Desktop-Windows-<version>-Setup.exe
```

The Windows target is an NSIS installer: not one-click, per-user (no admin
rights), the install folder can be changed, and **uninstalling keeps the
shop's data**.

### Code signing — ACTION REQUIRED

**The installer is currently unsigned.** Every shop installing it sees a
SmartScreen warning that the publisher is unknown, and some corporate machines
and antivirus products will block it outright. This is the single biggest
friction point in getting the app onto a counter.

Signing needs a certificate, which is a **purchase, not a code change**:

| Type | Rough cost | What it does |
| --- | --- | --- |
| OV (organisation validated) | ~USD 200–400/year | Names the publisher. SmartScreen reputation builds up over the first few hundred installs. |
| EV (extended validation) | ~USD 300–600/year | Immediate SmartScreen reputation; requires a hardware token or a cloud HSM. |

Since June 2023 both must be stored on hardware (a token) or in a cloud signing
service — a `.pfx` file on disk is no longer accepted by the certificate
authorities.

Once a certificate exists, signing is configuration only. Add to
`electron-builder.json5` under `win`:

```json5
"win": {
  "signingHashAlgorithms": ["sha256"],
  "rfc3161TimeStampServer": "http://timestamp.digicert.com",
  // token/HSM: point at the CA's signing tool
  "sign": "./scripts/sign.js"
}
```

and supply the credentials as environment variables in the build environment
(`CSC_LINK` / `CSC_KEY_PASSWORD` for a file-based certificate, or the vendor's
equivalents for a token or cloud HSM). **Never commit a certificate or its
password.**

macOS additionally needs an Apple Developer ID plus notarisation before Gatekeeper
will open the `.dmg` without a right-click workaround.

**Status: BLOCKED pending a business decision on buying a certificate.** See
[docs/OPEN-DECISIONS.md](docs/OPEN-DECISIONS.md).

---

## 9. Google Drive backups (optional)

Settings supports private, versioned backups in Google Drive's hidden
`appDataFolder`. A backup is a consistent SQLite snapshot plus, when enabled,
the shop logo and product images. OAuth refresh tokens are stored with Electron
`safeStorage`, never in the database.

To enable it for a build:

1. In Google Cloud Console, enable the Google Drive API and configure the OAuth
   consent screen.
2. Create an OAuth 2.0 client of type **Desktop app**.
3. Copy `resources/google-drive-oauth.example.json` to
   `resources/google-drive-oauth.json` and fill in the downloaded values. The
   real file is git-ignored and is copied into the packaged app's resources.
4. In development you may instead set `POS_GOOGLE_DRIVE_CLIENT_ID` and
   `POS_GOOGLE_DRIVE_CLIENT_SECRET`.

Only `drive.appdata`, `openid` and `email` are requested. Files in
`appDataFolder` are hidden from the normal Drive UI and readable only by this
application. Sign-in uses a loopback callback with PKCE, and no local web
server is left listening afterwards.

Google Drive backup is **optional and off by default**. The automatic *local*
backup is the one that protects a shop with no Google account and no reliable
internet, and it is on out of the box.

---

## 10. Open decisions

Three items are business decisions rather than engineering ones and are
deliberately unresolved: what should happen to the till when a membership
expires, which out-of-scope features to keep, and which costing method is
official. They are written up with options and recommendations in
**[docs/OPEN-DECISIONS.md](docs/OPEN-DECISIONS.md)**.
