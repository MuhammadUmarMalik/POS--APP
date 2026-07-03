import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { Button, Card } from '../../components/ui'
import { useSession } from '../../stores/auth'
import { shouldLockSales, LOCKED_MESSAGE } from '../../shared/subscription'
import { useSubscription } from './useSubscription'

/**
 * Route guard for sale/purchase-creating screens. UX only — the real block is
 * requiresActiveSubscription in electron/ipc.ts, which refuses the mutation
 * even if this component is bypassed.
 */
export function SubscriptionGate({ children }: { children: ReactNode }) {
  const { subscription } = useSubscription()
  const session = useSession()

  if (subscription && shouldLockSales(subscription.status)) {
    return (
      <div className="mx-auto mt-16 max-w-lg">
        <Card className="p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
            <Lock size={26} className="text-danger" />
          </div>
          <h2 className="mb-2 text-xl font-bold">New sales are locked</h2>
          <p className="mb-6 text-muted">{LOCKED_MESSAGE} You can still view old data, reports and backups.</p>
          <div className="flex justify-center gap-3">
            <Link to="/sales">
              <Button variant="secondary">View sales history</Button>
            </Link>
            {session?.role === 'admin' ? (
              <Link to="/settings">
                <Button>Activate membership</Button>
              </Link>
            ) : (
              <span className="self-center text-sm text-muted">Ask your admin to activate</span>
            )}
          </div>
        </Card>
      </div>
    )
  }

  return <>{children}</>
}
