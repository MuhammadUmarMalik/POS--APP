// Granular permission model, shared by the renderer (UX-level hiding) and the
// electron main process (real enforcement in ipc.ts / services). Pure data only.
// Admin users implicitly have every permission and are never stored in
// user_permissions; manager and cashier users have exactly the rows returned by
// their defaults unless an admin customises them in Settings → Users.

export const ROLES = ['admin', 'cashier', 'manager'] as const
export type Role = (typeof ROLES)[number]

export const PERMISSIONS = [
  'pos.sell',            // operate the till: checkout, hold/resume, held list
  'pos.discount',        // apply line and bill discounts on sales
  'sales.view',          // view sales history (cashiers see only their own regardless)
  'returns.manage',      // process sale returns and cancellations
  'customers.manage',    // add / edit customers and receive due payments
  'products.manage',     // create / edit / delete products, categories, brands, import/export
  'inventory.manage',    // view stock, adjust stock, view movements and ledgers
  'inventory.transfer',  // transfer stock between products
  'purchases.manage',    // purchases, purchase orders, purchase returns, suppliers
  'expenses.manage',     // expenses and expense categories
  'reports.view',        // view reports
  'reports.profit',      // view profit/loss and money-movement reports
  'users.manage',        // manage users and their permissions
  'settings.manage',     // shop profile, logo, backup & restore, printer settings
  'subscription.manage', // membership activation and payment proof
  'sync.manage',         // cloud sync settings and manual sync
] as const
export type PermissionKey = (typeof PERMISSIONS)[number]

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  'pos.sell': 'Sell at the till',
  'pos.discount': 'Apply discounts',
  'sales.view': 'View sales history',
  'returns.manage': 'Process returns',
  'customers.manage': 'Manage customers',
  'products.manage': 'Manage products',
  'inventory.manage': 'Manage stock',
  'inventory.transfer': 'Transfer stock',
  'purchases.manage': 'Manage purchases',
  'expenses.manage': 'Manage expenses',
  'reports.view': 'View reports',
  'reports.profit': 'View profit / money reports',
  'users.manage': 'Manage users',
  'settings.manage': 'Manage settings',
  'subscription.manage': 'Manage membership',
  'sync.manage': 'Manage cloud sync',
}

export const PERMISSION_GROUPS: { label: string; keys: PermissionKey[] }[] = [
  { label: 'Till & sales', keys: ['pos.sell', 'pos.discount', 'sales.view', 'returns.manage'] },
  { label: 'Customers', keys: ['customers.manage'] },
  { label: 'Catalog & stock', keys: ['products.manage', 'inventory.manage', 'inventory.transfer'] },
  { label: 'Purchasing', keys: ['purchases.manage', 'expenses.manage'] },
  { label: 'Reports', keys: ['reports.view', 'reports.profit'] },
  { label: 'Administration', keys: ['users.manage', 'settings.manage', 'subscription.manage', 'sync.manage'] },
]

/** Permissions granted to a new user of the given role when no admin override exists. */
export const ROLE_DEFAULT_PERMISSIONS: Record<Exclude<Role, 'admin'>, readonly PermissionKey[]> = {
  cashier: [
    'pos.sell', 'pos.discount', 'sales.view', 'customers.manage',
  ],
  manager: [
    'pos.sell', 'pos.discount', 'sales.view', 'returns.manage', 'customers.manage',
    'products.manage', 'inventory.manage', 'inventory.transfer',
    'purchases.manage', 'expenses.manage', 'reports.view',
  ],
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  cashier: 'Cashier',
  manager: 'Manager',
}

export const isAdminRole = (role: Role): boolean => role === 'admin'
