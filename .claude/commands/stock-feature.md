I'm building a feature that affects stock: $ARGUMENTS

Before writing code:
1. Confirm which direction stock moves (in/out) and reference the Action → Stock Effect table in `pos-saas-product-plan.md` section 5.
2. Confirm this will insert a row into `stock_movements` with: product_id, branch_id, delta, balance_after (computed, not hardcoded), source_type, source_id, user_id, timestamp.
3. Never update a `stock` column directly on the product/branch table — derive current stock from the sum of movements, or maintain a cached balance that's only ever updated inside the same transaction as the movement insert.
4. Wrap the movement insert + any related writes (sale_items, purchase_items, etc.) in a single DB transaction.
5. If this is a return or adjustment, check whether it needs manager approval per section 6 of the product plan.

Then implement.
