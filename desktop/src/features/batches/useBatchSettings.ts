import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/ipc'
import type { BatchSettings } from '../../shared/types'

/**
 * Shop-level batch/expiry switch. Every batch-aware screen reads this before
 * rendering anything batch-related, so a shop with the feature off sees an app
 * identical to one built without it.
 */
export function useBatchSettings() {
  return useQuery({
    queryKey: ['batches', 'settings'],
    queryFn: () => api<BatchSettings>('batches:settings'),
    staleTime: 60_000,
  })
}

export function useBatchTracking(): boolean {
  return useBatchSettings().data?.batch_tracking_enabled ?? false
}
