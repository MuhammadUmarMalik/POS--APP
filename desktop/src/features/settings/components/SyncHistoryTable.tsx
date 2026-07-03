import { useQuery } from '@tanstack/react-query'
import { api } from '../../../lib/ipc'
import { formatDateTime } from '../../../lib/utils'
import type { SyncLog, SyncRunStatus } from '../../../shared/types'
import { Badge, EmptyState, Spinner } from '../../../components/ui'

export const SYNC_STATUS_TONE: Record<SyncRunStatus, 'green' | 'amber' | 'red' | 'blue' | 'slate'> = {
  success: 'green',
  failed: 'red',
  pending: 'amber',
  in_progress: 'blue',
  conflict: 'amber',
  disabled: 'slate',
}

export const SYNC_STATUS_LABEL: Record<SyncRunStatus, string> = {
  success: 'Sync Successful',
  failed: 'Sync Failed',
  pending: 'Sync Pending',
  in_progress: 'In Progress',
  conflict: 'Conflicts',
  disabled: 'Disabled',
}

export function SyncStatusBadge({ status }: { status: SyncRunStatus }) {
  return <Badge tone={SYNC_STATUS_TONE[status]}>{SYNC_STATUS_LABEL[status]}</Badge>
}

export function SyncHistoryTable() {
  const { data: logs, isLoading } = useQuery({
    queryKey: ['sync-logs'],
    queryFn: () => api<SyncLog[]>('sync:logs'),
  })

  if (isLoading || !logs) return <Spinner />
  if (logs.length === 0) return <EmptyState message="This device has not synced with cloud yet." />

  return (
    <div className="max-h-96 overflow-y-auto rounded-md border border-line">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-muted">
          <tr>
            <th className="px-3 py-2.5">Started</th>
            <th className="px-3 py-2.5">Type</th>
            <th className="px-3 py-2.5">Status</th>
            <th className="px-3 py-2.5 text-right">Records</th>
            <th className="px-3 py-2.5">Detail</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id} className="border-t border-line">
              <td className="whitespace-nowrap px-3 py-2">{formatDateTime(l.started_at)}</td>
              <td className="px-3 py-2 capitalize">{l.sync_type}</td>
              <td className="px-3 py-2"><SyncStatusBadge status={l.status} /></td>
              <td className="px-3 py-2 text-right">{l.total_records_synced}</td>
              <td className="max-w-56 truncate px-3 py-2 text-xs text-muted" title={l.error_message ?? ''}>
                {l.error_message ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
