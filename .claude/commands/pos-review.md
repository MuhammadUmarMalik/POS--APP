Review the current diff against the project rules in CLAUDE.md. Check specifically:

- [ ] Any direct write to a stock/quantity field instead of going through `stock_movements`?
- [ ] Any Prisma query missing a `shop_id` filter?
- [ ] Any mutation without a server-side role/permission check?
- [ ] Any money value stored/handled as a float instead of integer (smallest unit)?
- [ ] Any financial or stock action missing an `audit_logs` write?
- [ ] Any report doing live aggregation over raw transaction tables?

List violations with file/line. Fix them directly, don't just flag.
