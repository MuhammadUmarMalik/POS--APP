Scaffold a full CRUD module for: $ARGUMENTS

Build:
1. Prisma model (if not already in schema.prisma) — must include `shop_id`, `created_at`, `updated_at`
2. Zod schema in `/features/<module>/schema.ts`
3. Server actions in `/features/<module>/server/actions.ts`: create, update, delete, list (paginated, filtered by session shop_id)
4. `<Module>Table` component using TanStack Table — match column layout from design.md if this screen exists there
5. `<Module>Form` component using RHF + Zod, rendered in a side drawer (not full page) unless design.md says otherwise
6. Empty state, loading skeleton, and error state per the states defined in design.md

Follow CLAUDE.md rules: tenant scoping on every query, server-side permission check on every mutation, audit log entry if this module is financial or stock-affecting.

Show me the plan first before writing files.
