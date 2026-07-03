# Database Schema

Local (SQLite) and cloud (PostgreSQL) share the same schema. All primary keys use **UUID** (not auto-increment) to avoid sync conflicts across offline devices.

## Core Tables

### `shops`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| name | text | |
| license_key | text | unique |
| hardware_id | text | bound device fingerprint |
| license_expiry | date | |
| created_at | timestamp | |

### `users`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| shop_id | UUID | FK → shops.id |
| name | text | |
| username | text | unique per shop |
| password_hash | text | |
| role | enum | admin, manager, cashier |
| active | boolean | |
| created_at | timestamp | |

### `products`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| shop_id | UUID | FK |
| name | text | |
| sku | text | |
| barcode | text | unique per shop |
| category_id | UUID | FK → categories.id |
| unit | text | pcs, kg, box, etc |
| cost_price | decimal | |
| sale_price | decimal | |
| tax_percent | decimal | |
| min_stock_alert | int | |
| is_deleted | boolean | soft delete only |
| updated_at | timestamp | for sync conflict resolution |
| sync_status | enum | pending, synced, failed |

### `categories`
| Column | Type |
|---|---|
| id | UUID PK |
| shop_id | UUID FK |
| name | text |

### `inventory_logs`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| shop_id | UUID | FK |
| product_id | UUID | FK |
| change_type | enum | sale, purchase, return, adjustment |
| quantity_change | int | +/- |
| reference_id | UUID | linked sale/purchase id |
| created_at | timestamp | |

### `customers`
| Column | Type |
|---|---|
| id | UUID PK |
| shop_id | UUID FK |
| name | text |
| phone | text |
| credit_limit | decimal |
| due_balance | decimal |

### `suppliers`
| Column | Type |
|---|---|
| id | UUID PK |
| shop_id | UUID FK |
| name | text |
| phone | text |
| due_balance | decimal |

### `sales`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| shop_id | UUID | FK |
| invoice_number | text | branch-prefixed, unique |
| customer_id | UUID | FK, nullable |
| cashier_id | UUID | FK → users.id |
| subtotal | decimal | |
| discount | decimal | |
| tax | decimal | |
| total | decimal | |
| payment_method | enum | cash, card, credit, split |
| status | enum | completed, returned, voided |
| created_at | timestamp | |
| sync_status | enum | |

### `sale_items`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| sale_id | UUID | FK → sales.id |
| product_id | UUID | FK |
| quantity | int | |
| unit_price | decimal | price snapshot at time of sale |
| discount | decimal | |
| tax | decimal | |

### `purchases`
| Column | Type |
|---|---|
| id | UUID PK |
| shop_id | UUID FK |
| supplier_id | UUID FK |
| invoice_number | text |
| total | decimal |
| paid_amount | decimal |
| status | enum (completed, returned) |
| created_at | timestamp |
| sync_status | enum |

### `purchase_items`
| Column | Type |
|---|---|
| id | UUID PK |
| purchase_id | UUID FK |
| product_id | UUID FK |
| quantity | int |
| cost_price | decimal | price snapshot |

### `payments`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| shop_id | UUID | FK |
| reference_type | enum | sale, purchase |
| reference_id | UUID | linked sale/purchase |
| party_type | enum | customer, supplier |
| party_id | UUID | |
| amount | decimal | |
| method | enum | cash, card |
| created_at | timestamp | |

### `shift_reports`
| Column | Type |
|---|---|
| id | UUID PK |
| shop_id | UUID FK |
| cashier_id | UUID FK |
| total_sales | decimal |
| cash_expected | decimal |
| cash_actual | decimal |
| variance | decimal |
| opened_at | timestamp |
| closed_at | timestamp |

## Relationships (Summary)
- `shops` → 1:many → `users`, `products`, `sales`, `purchases`
- `products` → 1:many → `sale_items`, `purchase_items`, `inventory_logs`
- `sales` → 1:many → `sale_items`, `payments`
- `purchases` → 1:many → `purchase_items`, `payments`
- `customers`/`suppliers` → 1:many → `sales`/`purchases`, `payments`

## Sync-Related Fields (on every syncable table)
- `id` (UUID) — globally unique, generated client-side
- `updated_at` — used for last-write-wins conflict resolution
- `sync_status` — pending / synced / failed
- `shop_id` — scopes data per shop for multi-tenant cloud DB
