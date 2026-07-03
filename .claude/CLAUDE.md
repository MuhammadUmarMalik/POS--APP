# POS SaaS — Project Context

Cloud multi-tenant POS for small/medium shops (grocery, pharmacy, cosmetics, clothing, hardware, general retail).

## Stack
- Next.js (App Router) + TypeScript
- Tailwind CSS + ShadCN UI
- PostgreSQL + Prisma
- Auth.js (Clerk optional)
- Zustand for local UI state
- TanStack Table for all data grids
- React Hook Form + Zod (shared schema for client + server validation)
- Deploy: Vercel + Neon/Supabase

## Non-negotiable rules

**Stock is never edited directly.** Every stock change goes through `stock_movements` (append-only ledger). No code path updates `product.stock` directly — always insert a movement row and derive balance from it. This is the #1 bug source in POS apps — do not shortcut it.

**Every table is tenant-scoped.** All tenant tables carry `shop_id`. Every Prisma query must filter by `shop_id` from the authenticated session — never trust a `shop_id` passed from the client. Add a Prisma middleware or repository-layer guard, don't rely on remembering to filter manually.

**Every mutating endpoint checks role/permission server-side.** Client-side role checks are UX only, never security.

**Money is stored as integers (smallest unit / paisa), not floats.** Format for display only.

**Reports never do live aggregation over raw transaction tables at scale.** Use rollup tables or materialized views for anything beyond "today."

## Folder structure
```
/app                  → routes (App Router)
/features/<domain>    → pos, inventory, purchases, returns, reports, cash-register, settings
  /components
  /server (actions/services)
  /schema.ts (zod)
/lib                  → shared utils, prisma client, auth helpers
/prisma/schema.prisma
```

## Conventions
- Server actions for mutations, not API routes, unless building a public API.
- Every form: RHF + Zod, same schema reused in the server action.
- Every list screen: TanStack Table, server-side pagination once data > 500 rows.
- Every destructive/financial action (adjustment, return, void) writes an `audit_logs` row.
- Component naming: `ProductTable`, `ProductForm`, `ProductDrawer` — not generic `Table`/`Form`.

## Reference docs (in repo root)
- `pos-saas-product-plan.md` — full product spec (modules, DB schema, reports, business rules)
- `design.md` — wireframes and screen layouts for every screen

## When implementing a feature
1. Check `pos-saas-product-plan.md` section for the module's business rules and edge cases before coding.
2. Check `design.md` for the screen layout before building UI.
3. Stock-affecting features (sales, purchases, returns, adjustments) must always write to `stock_movements`.
4. Money-affecting features must consider: cash register impact, dues impact, audit log.
