import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/ipc'
import type { SubscriptionView } from '../../shared/types'

export function useSubscription() {
  const { data, isLoading } = useQuery({
    queryKey: ['subscription'],
    queryFn: () => api<SubscriptionView>('subscription:status'),
    refetchInterval: 60_000, // trial expiry takes effect without a restart
    staleTime: 30_000,
  })
  return { subscription: data ?? null, isLoading }
}

export function useInvalidateSubscription() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['subscription'] })
}
