import { useEffect, type ReactNode } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth, useSession } from './stores/auth'
import { Spinner } from './components/ui'
import { Toaster } from './components/ui/toast'
import { SetupWizard } from './features/auth/SetupWizard'
import { Login } from './features/auth/Login'
import { Shell } from './features/shell/Shell'
import { DashboardPage } from './features/dashboard/DashboardPage'
import { PosPage } from './features/pos/PosPage'
import { SalesPage } from './features/sales/SalesPage'
import { SaleDetailPage } from './features/sales/SaleDetailPage'
import { ProductsPage } from './features/products/ProductsPage'
import { InventoryPage } from './features/inventory/InventoryPage'
import { PurchasesPage } from './features/purchases/PurchasesPage'
import { PurchaseDetailPage } from './features/purchases/PurchaseDetailPage'
import { PurchaseOrderDetailPage } from './features/purchases/PurchaseOrderDetailPage'
import { NewPurchasePage } from './features/purchases/NewPurchasePage'
import { SuppliersPage } from './features/suppliers/SuppliersPage'
import { CustomersPage } from './features/customers/CustomersPage'
import { ReturnsPage } from './features/returns/ReturnsPage'
import { ExpensesPage } from './features/expenses/ExpensesPage'
import { ReportsPage } from './features/reports/ReportsPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { SubscriptionGate } from './features/settings/SubscriptionGate'

function AdminOnly({ children }: { children: ReactNode }) {
  const session = useSession()
  if (session?.role !== 'admin') return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  const loaded = useAuth((s) => s.loaded)
  const state = useAuth((s) => s.state)
  const init = useAuth((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  if (!loaded) return <Spinner />
  if (state?.needsSetup) {
    return (
      <>
        <SetupWizard />
        <Toaster />
      </>
    )
  }
  if (!state?.session) {
    return (
      <>
        <Login />
        <Toaster />
      </>
    )
  }

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<DashboardPage />} />
        <Route path="pos" element={<SubscriptionGate><PosPage /></SubscriptionGate>} />
        <Route path="sales" element={<SalesPage />} />
        <Route path="sales/:id" element={<SaleDetailPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="products" element={<AdminOnly><ProductsPage /></AdminOnly>} />
        <Route path="inventory" element={<AdminOnly><InventoryPage /></AdminOnly>} />
        <Route path="purchases" element={<AdminOnly><PurchasesPage /></AdminOnly>} />
        <Route path="purchases/new" element={<AdminOnly><SubscriptionGate><NewPurchasePage /></SubscriptionGate></AdminOnly>} />
        <Route path="purchases/orders/:id" element={<AdminOnly><PurchaseOrderDetailPage /></AdminOnly>} />
        <Route path="purchases/:id" element={<AdminOnly><PurchaseDetailPage /></AdminOnly>} />
        <Route path="returns" element={<AdminOnly><ReturnsPage /></AdminOnly>} />
        <Route path="expenses" element={<AdminOnly><ExpensesPage /></AdminOnly>} />
        <Route path="suppliers" element={<AdminOnly><SuppliersPage /></AdminOnly>} />
        <Route path="reports" element={<AdminOnly><ReportsPage /></AdminOnly>} />
        <Route path="settings" element={<AdminOnly><SettingsPage /></AdminOnly>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
