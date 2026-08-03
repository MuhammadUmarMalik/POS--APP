import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CalendarClock } from 'lucide-react'
import { api } from '../../lib/ipc'
import type { ExpiryReport } from '../../shared/types'
import { useBatchTracking } from './useBatchSettings'

/**
 * Inventory-screen warning about stock that is expired or about to be. Renders
 * nothing at all when the shop does not track batches, or when nothing is due —
 * a clean shelf should look clean.
 */
export function ExpiryAlert() {
  const tracking = useBatchTracking()
  const { data } = useQuery({
    queryKey: ['batches', 'expiring'],
    queryFn: () => api<ExpiryReport>('inventory:expiring'),
    enabled: tracking,
  })

  if (!tracking || !data?.enabled || data.rows.length === 0) return null
  const { expired, expiring } = data.totals

  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <CalendarClock size={18} className="mt-0.5 shrink-0 text-warning" />
      <div className="text-sm">
        <p className="font-medium text-ink">
          {expired > 0 && `${expired} batch${expired === 1 ? '' : 'es'} expired`}
          {expired > 0 && expiring > 0 && ', '}
          {expiring > 0 &&
            `${expiring} expiring within ${data.threshold_days} days`}
        </p>
        <p className="mt-0.5 text-muted">
          {data.rows
            .slice(0, 3)
            .map((r) => `${r.product_name}${r.batch_number ? ` (${r.batch_number})` : ''} — ${r.expiry_date}`)
            .join(' · ')}
          {data.rows.length > 3 && ` · +${data.rows.length - 3} more`}
        </p>
        <Link to="/reports?tab=expiry" className="mt-1 inline-block font-medium text-primary hover:underline">
          Open the expiry report
        </Link>
      </div>
    </div>
  )
}
