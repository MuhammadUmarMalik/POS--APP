import { useEffect, useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, Field, Select } from '../../../components/ui'
import { toast } from '../../../components/ui/toast'
import { api } from '../../../lib/ipc'
import type { BatchSettings } from '../../../shared/types'
import { useBatchSettings } from '../../batches/useBatchSettings'
import { SettingsSection } from './SettingsLayout'

/**
 * Batch/expiry is off for a general retail shop and on for a pharmacy or
 * grocery. The switch is shop-level and stored in the database, not a device
 * preference — it changes what the server accepts, not just what the UI shows.
 */
export function BatchExpirySettings() {
  const { data } = useBatchSettings()
  const queryClient = useQueryClient()
  const [enabled, setEnabled] = useState(false)
  const [days, setDays] = useState(30)

  useEffect(() => {
    if (!data) return
    setEnabled(data.batch_tracking_enabled)
    setDays(data.expiry_alert_days)
  }, [data])

  const save = useMutation({
    mutationFn: () =>
      api<BatchSettings>('batches:updateSettings', {
        batch_tracking_enabled: enabled,
        expiry_alert_days: days,
      }),
    onSuccess: () => {
      // Product forms, POS and reports all branch on this, so drop every cache.
      queryClient.invalidateQueries()
      toast.success(enabled ? 'Batch & expiry tracking enabled' : 'Batch & expiry tracking disabled')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <SettingsSection
      title="Batch & Expiry Tracking"
      description="For shops that sell dated stock — medicines, dairy, cosmetics"
      icon={<CalendarClock size={18} />}
      actions={
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      }
    >
      <div className="divide-y divide-line rounded-lg border border-line">
        <label className="flex cursor-pointer items-center justify-between gap-5 px-4 py-3.5">
          <span>
            <span className="block text-sm font-medium">Enable batch / expiry tracking</span>
            <span className="block text-xs text-muted">
              Adds batch number and expiry date to products and goods receiving, shows expiry
              alerts, and sells the earliest-expiring batch first.
            </span>
          </span>
          <span className="relative shrink-0">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="peer sr-only"
            />
            <span className="block h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2" />
            <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
          </span>
        </label>
      </div>

      {enabled && (
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <Field
            label="Warn when stock expires within"
            hint="Used by inventory alerts and the Expiry report"
          >
            <Select value={String(days)} onChange={(event) => setDays(Number(event.target.value))}>
              <option value="30">30 days</option>
              <option value="60">60 days</option>
              <option value="90">90 days</option>
            </Select>
          </Field>
        </div>
      )}

      <p className="mt-3 text-xs text-muted">
        Turning this off hides batch fields everywhere and stops new batches being created. Batch
        data already recorded is kept, so it comes back intact if you turn it on again.
      </p>
    </SettingsSection>
  )
}
