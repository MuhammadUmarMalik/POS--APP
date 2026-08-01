import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth, useSession } from './stores/auth'
import { Spinner } from './components/ui'
import { Toaster } from './components/ui/toast'
import { SetupWizard } from './features/auth/SetupWizard'
import { Login } from './features/auth/Login'
import { usePreferences } from './stores/preferences'

const Shell = lazy(() => import('./features/shell/Shell').then((m) => ({ default: m.Shell })))
const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })))
const PosPage = lazy(() => import('./features/pos/PosPage').then((m) => ({ default: m.PosPage })))
const SalesPage = lazy(() => import('./features/sales/SalesPage').then((m) => ({ default: m.SalesPage })))
const SaleDetailPage = lazy(() => import('./features/sales/SaleDetailPage').then((m) => ({ default: m.SaleDetailPage })))
const ProductsPage = lazy(() => import('./features/products/ProductsPage').then((m) => ({ default: m.ProductsPage })))
const InventoryPage = lazy(() => import('./features/inventory/InventoryPage').then((m) => ({ default: m.InventoryPage })))
const PurchasesPage = lazy(() => import('./features/purchases/PurchasesPage').then((m) => ({ default: m.PurchasesPage })))
const PurchaseDetailPage = lazy(() => import('./features/purchases/PurchaseDetailPage').then((m) => ({ default: m.PurchaseDetailPage })))
const PurchaseOrderDetailPage = lazy(() => import('./features/purchases/PurchaseOrderDetailPage').then((m) => ({ default: m.PurchaseOrderDetailPage })))
const NewPurchasePage = lazy(() => import('./features/purchases/NewPurchasePage').then((m) => ({ default: m.NewPurchasePage })))
const SuppliersPage = lazy(() => import('./features/suppliers/SuppliersPage').then((m) => ({ default: m.SuppliersPage })))
const CustomersPage = lazy(() => import('./features/customers/CustomersPage').then((m) => ({ default: m.CustomersPage })))
const ReturnsPage = lazy(() => import('./features/returns/ReturnsPage').then((m) => ({ default: m.ReturnsPage })))
const ExpensesPage = lazy(() => import('./features/expenses/ExpensesPage').then((m) => ({ default: m.ExpensesPage })))
const ReportsPage = lazy(() => import('./features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })))
const SettingsPage = lazy(() => import('./features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const SubscriptionGate = lazy(() => import('./features/settings/SubscriptionGate').then((m) => ({ default: m.SubscriptionGate })))

function AdminOnly({ children }: { children: ReactNode }) {
  const session = useSession()
  if (session?.role !== 'admin') return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  const loaded = useAuth((s) => s.loaded)
  const startupError = useAuth((s) => s.startupError)
  const state = useAuth((s) => s.state)
  const init = useAuth((s) => s.init)
  const reduceMotion = usePreferences((s) => s.reduceMotion)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reduceMotion)
  }, [reduceMotion])

  if (!loaded) return <Spinner />
  if (startupError) {
    return (
      <div className="flex min-h-full items-center justify-center bg-page p-6">
        <div className="max-w-md rounded-lg border border-danger/30 bg-surface p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">POS Desktop could not start</h1>
          <p className="mt-2 text-sm text-muted">{startupError}</p>
          <button
            type="button"
            onClick={() => void init()}
            className="mt-5 rounded-md bg-primary px-5 py-2.5 font-medium text-white hover:bg-primary-hover"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }
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
    <Suspense fallback={<Spinner />}>
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
    </Suspense>
  )
}
