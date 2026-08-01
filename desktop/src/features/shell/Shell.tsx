import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, ShoppingCart, ReceiptText, Package, Boxes,
  Truck, Users, BarChart3, Settings, LogOut, Store, Wallet, Undo2,
} from 'lucide-react'
import { useAuth, useSession } from '../../stores/auth'
import { cn } from '../../lib/utils'
import { Toaster } from '../../components/ui/toast'
import { ProfileModal } from '../auth/ProfileModal'
import { usePreferences } from '../../stores/preferences'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/pos', label: 'New Sale', icon: ShoppingCart, end: false, hotkey: 'F2' },
  { to: '/sales', label: 'Sales', icon: ReceiptText, end: false },
  { to: '/returns', label: 'Returns', icon: Undo2, end: false, admin: true },
  { to: '/products', label: 'Products', icon: Package, end: false, admin: true },
  { to: '/inventory', label: 'Inventory', icon: Boxes, end: false, admin: true },
  { to: '/purchases', label: 'Purchases', icon: Truck, end: false, admin: true },
  { to: '/customers', label: 'Customers', icon: Users, end: false },
  { to: '/suppliers', label: 'Suppliers', icon: Truck, end: false, admin: true },
  { to: '/expenses', label: 'Expenses', icon: Wallet, end: false, admin: true },
  { to: '/reports', label: 'Reports', icon: BarChart3, end: false, admin: true },
  { to: '/settings', label: 'Settings', icon: Settings, end: false, admin: true },
]

export function Shell() {
  const session = useSession()
  const shop = useAuth((s) => s.state?.shop)
  const logout = useAuth((s) => s.logout)
  const navigate = useNavigate()
  const navigationDensity = usePreferences((s) => s.navigationDensity)
  const [profileOpen, setProfileOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault()
        navigate('/pos')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  if (!session) return null
  const isAdmin = session.role === 'admin'

  return (
    <div className="flex h-full">
      <aside className="no-print flex w-52 shrink-0 flex-col border-r border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line px-4 py-4">
          <div className="rounded-md bg-primary p-1.5 text-white">
            <Store size={16} />
          </div>
          <span className="truncate font-semibold" title={shop?.name}>
            {shop?.name}
          </span>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          {NAV.filter((n) => isAdmin || !n.admin).map((n) => (
            <NavLink
              key={n.to + n.label}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cn(
                  'mb-0.5 flex items-center gap-3 rounded-md px-3 font-medium',
                  navigationDensity === 'compact' ? 'py-1.5' : 'py-2.5',
                  isActive ? 'bg-primary text-white' : 'text-muted hover:bg-slate-100 hover:text-ink'
                )
              }
            >
              <n.icon size={17} />
              <span className="flex-1">{n.label}</span>
              {n.hotkey && <kbd className="text-[10px] opacity-60">{n.hotkey}</kbd>}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line p-3">
          <button
            onClick={() => setProfileOpen(true)}
            className="mb-2 w-full rounded-md px-1 py-1 text-left hover:bg-slate-100"
            title="My profile"
          >
            <div className="font-medium">{session.name}</div>
            <div className="text-xs capitalize text-muted">{session.role}</div>
          </button>
          <button
            onClick={() => logout()}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-muted hover:bg-slate-100 hover:text-danger"
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
      <Toaster />
    </div>
  )
}
