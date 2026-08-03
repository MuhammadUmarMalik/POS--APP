# Open decisions — for the client

Three things in this app are business decisions, not engineering ones. Nothing
below has been changed. Each one is described as it behaves **today**, with the
options and what each would cost to change. Please mark a choice against each.

---

## 1. New sales stop when the trial or membership expires

**Status: BLOCKED — awaiting client confirmation. No change made.**

### What happens today

The app runs entirely on the shop's own machine. A subscription row per shop
holds a status (`trial_active`, `trial_expired`, `membership_active`,
`membership_expired`, `lifetime_active`, `suspended`, `pending_verification`)
and its end date. The status is re-derived from the date on every read, so
expiry takes effect on its own with no background job and no internet.

Once the status is not one of `trial_active`, `membership_active` or
`lifetime_active`, these channels refuse to run:

| Channel | Effect when locked |
| --- | --- |
| `sales:checkout` | Cannot complete a sale |
| `sales:hold` | Cannot park a bill |
| `purchases:create` | Cannot record a purchase |
| `purchaseOrders:create` | Cannot raise a purchase order |
| `purchaseOrders:receive` | Cannot receive stock against a PO |

The message shown is: *"Your trial has expired. Your data is safe, but new
sales are locked until activation."*

Everything else keeps working: login, the whole catalogue, all past sales and
purchases, every report, export, and backup and restore. The lock is on
**creating new transactions only**.

The free trial is **7 days**.

### What this means in practice

- The shop **does not need internet** to unlock. A licence key validates
  offline against a checksum; typing a valid key in re-activates immediately.
- It does mean that a shop whose membership lapses at 6pm on a Saturday
  **cannot take another sale** until someone gets them a key. A retail counter
  that cannot ring up a customer is a hard stop, not an inconvenience.
- There is no grace period and no read-only "keep selling, we'll settle later"
  mode.

### The decision

| Option | What it means |
| --- | --- |
| **A — leave it as is** | Strongest commercial position. A lapsed shop is fully stopped until it pays. |
| **B — add a grace period** | e.g. sales keep working for 3–7 days past expiry with a visible warning banner and a countdown. Softens the cliff-edge without giving the software away. |
| **C — never block sales** | Expiry nags but never stops the till. Weakest commercially; effectively an honour system. |

**Engineering note:** all three are small changes in one place
(`assertCanTransact` in `electron/services/subscription.ts`, plus the shared
rules in `src/shared/subscription.ts`). This is a pricing and support decision,
so nothing has been touched.

**Client decision: ☐ A   ☐ B (grace period of ____ days)   ☐ C**

---

## 2. Features that were built but are not in the agreed scope

**Status: PARTLY RESOLVED — cloud sync removed on the client's instruction.
Items 2–5 still awaiting sign-off.**

The following are working, tested features in the shipped app that sit outside
the original scope. They are listed so the client can decide, per feature,
whether to **keep** (and pay for / support), **hide** (leave the code, remove
the menu entry), or **remove** (delete the code and its data).

Apart from cloud sync, nothing here has been removed. Removing a feature that a
shop has already used would destroy the records it created, so none of this
should be done without an explicit instruction.

| # | Feature | Where it lives | What it does | Data it creates |
| --- | --- | --- | --- | --- |
| 1 | ~~**Cloud sync**~~ — **REMOVED** | *(was `electron/services/sync.ts`, Settings → Sync)* | Pushed local changes to a cloud API and pulled updates back; every table carried a `sync_status` column | *(gone — migration 13 drops `sync_settings`, `sync_logs`, `sync_conflicts` and every `sync_status` column)* |
| 2 | **Cloud backup (Google Drive)** | `electron/services/googleDriveBackup.ts`, Settings → Backup | OAuth to a Google account, uploads the encrypted backup archive on a schedule | Google OAuth tokens; backup log rows |
| 3 | **Customer credit / receivables** | `electron/services/parties.ts`, Customers page, POS "on account" payment | Sells on credit, tracks what each customer owes, credit limits, receive-payment screen, full customer ledger | `customers.due_balance`, `credit_limit`, `payments`, ledger entries |
| 4 | **Supplier payables** | `electron/services/parties.ts`, Suppliers page | Tracks what the shop owes each supplier, pay-supplier screen, full supplier ledger | `suppliers.due_balance`, `payments`, ledger entries |
| 5 | **Purchase orders** | `electron/services/purchases.ts`, Purchases → Orders | Raise an order before the goods arrive, receive it partly or fully, cancel it; stock only moves on receipt | `purchase_orders`, `purchase_order_items` |

Rough scale: cloud sync was ≈ 440 lines, Google Drive backup ≈ 690 lines, parties
(credit + payables) ≈ 290 lines plus their screens, purchase orders ≈ a third
of the purchases service plus two screens.

**Recommendation:** keep 3, 4 and 5. Credit to regular customers and buying on
account from suppliers are how the target shops actually trade, and purchase
orders fall out of that naturally. Items 1 and 2 (cloud sync and cloud backup)
were the ones genuinely worth a decision — they carry ongoing hosting, support
and privacy obligations that a purely local app does not.

**Client decision, per feature:**

| Feature | Keep | Hide | Remove |
| --- | --- | --- | --- |
| Cloud sync | ☐ | ☐ | ☑ **done** |
| Cloud backup (Google Drive) | ☐ | ☐ | ☐ |
| Customer credit / receivables | ☐ | ☐ | ☐ |
| Supplier payables | ☐ | ☐ | ☐ |
| Purchase orders | ☐ | ☐ | ☐ |

**Note on the cloud-sync removal.** Sync shared one piece of code with the
membership/licensing feature: the HTTP helper that talks to the vendor cloud.
That helper was moved out to `electron/services/cloudApi.ts` rather than deleted,
and the activation round trip it serves — which was being driven by the sync
scheduler — now runs on its own timer in `subscription.ts`. Membership activation
therefore still works exactly as before. No shop record of any kind now leaves
the machine; the only traffic the app ever sends is the licence activation
request and its reply, and with no cloud configured even that is a no-op.

---

## 3. Costing method was never agreed

**Status: BLOCKED — awaiting client confirmation. No change made.**

### What the app does today: **latest purchase cost**

1. When a purchase is recorded, each product's `cost_price` is **overwritten**
   with the cost on that purchase line
   (`electron/services/purchases.ts`, "Keep product cost price current with the
   latest purchase cost").
2. When a sale is rung up, the product's `cost_price` **at that moment** is
   copied onto the sale line and frozen there
   (`sale_items.cost_price`).
3. Every profit figure — the dashboard tile, the Profit & Loss report, product
   profitability, stock value — is derived from those two facts.

Because the cost is snapshotted onto the sale line, **past profit never
changes** when a new purchase comes in at a different price. Only future sales
use the new cost. Stock value, however, is *always* priced at the **current**
`cost_price`, so it moves when a new purchase arrives.

### Why it matters

Say the shop buys cola at Rs 50, then buys more at Rs 60, then sells one:

| Method | Cost booked against that sale |
| --- | --- |
| **Latest purchase cost** (what the app does) | Rs 60 |
| **FIFO** (first in, first out) | Rs 50 — the older stock is deemed sold first |
| **Weighted average** | Somewhere between, weighted by quantity on hand |

With prices rising, latest-cost reports the **lowest** profit of the three. It
is the simplest to explain to a shopkeeper ("what it costs me to replace it"),
and it is what most small-shop POS systems in this market do — but it is not
what an accountant preparing statutory accounts will usually expect, and it is
not FIFO.

### The decision

| Option | What it means |
| --- | --- |
| **A — confirm latest purchase cost** | No code change. Documented in the README so the client's accountant is not surprised. **Recommended.** |
| **B — FIFO** | Cost is drawn from the oldest unsold stock. Substantially more work: the app must track cost per batch and consume batches in order. The batch/expiry ledger already exists and would carry it, but every profit report and the stock valuation would need rewriting, and old data could not be restated. |
| **C — weighted average** | Cost is recalculated as a running average on each purchase. Middling effort; changes every future profit figure but not past ones. |

**No costing logic has been changed.** Changing it silently would make every
historical profit report disagree with itself, so this needs an explicit
instruction.

**Client decision: ☐ A   ☐ B   ☐ C**

---

## Also outstanding

**Code signing for the Windows installer** — see the README. Without a code
signing certificate, Windows SmartScreen warns every shop that the installer is
from an unknown publisher. Buying a certificate is a business purchase
(roughly USD 200–500 a year for OV, more for EV); the build is already wired to
use one the moment credentials are supplied.

**Client decision: ☐ buy a certificate   ☐ ship unsigned for now**
