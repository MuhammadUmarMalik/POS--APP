import { Link } from 'react-router-dom'
import { Clock, Lock } from 'lucide-react'
import { useSession } from '../../stores/auth'
import { shouldLockSales, shouldShowTrialBanner, LOCKED_MESSAGE } from '../../shared/subscription'
import { useSubscription } from './useSubscription'

/** Dashboard banner: trial countdown while active, lock notice once expired. */
export function TrialBanner() {
  const { subscription } = useSubscription()
  const session = useSession()
  if (!subscription) return null

  if (shouldShowTrialBanner(subscription.status)) {
    return (
      <div className="mb-4 flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <Clock size={17} className="shrink-0" />
        <span className="flex-1">
          <strong>Free Trial Active</strong> — {subscription.remaining_trial_days}{' '}
          {subscription.remaining_trial_days === 1 ? 'day' : 'days'} left. Activate membership to
          continue using POS after trial.
        </span>
        {session?.role === 'admin' && (
          <Link
            to="/settings"
            className="shrink-0 rounded-md bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-700"
          >
            Activate membership
          </Link>
        )}
      </div>
    )
  }

  if (shouldLockSales(subscription.status)) {
    return (
      <div className="mb-4 flex items-center gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
        <Lock size={17} className="shrink-0" />
        <span className="flex-1">{LOCKED_MESSAGE}</span>
        {session?.role === 'admin' ? (
          <Link
            to="/settings"
            className="shrink-0 rounded-md bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700"
          >
            Activate now
          </Link>
        ) : (
          <span className="shrink-0 font-medium">Contact your admin</span>
        )}
      </div>
    )
  }

  return null
}
