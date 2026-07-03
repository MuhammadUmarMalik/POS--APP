import { useState } from 'react'
import { BadgeCheck, MessageCircle, RefreshCw } from 'lucide-react'
import { api } from '../../../lib/ipc'
import { useAuth } from '../../../stores/auth'
import { formatDate } from '../../../lib/utils'
import {
  PLAN_LABELS, SUBSCRIPTION_STATUS_LABELS, shouldLockSales, whatsappSupportUrl,
  type SubscriptionStatus,
} from '../../../shared/subscription'
import type { SubscriptionView } from '../../../shared/types'
import { Badge, Button, Spinner } from '../../../components/ui'
import { toast } from '../../../components/ui/toast'
import { useInvalidateSubscription, useSubscription } from '../useSubscription'
import { SettingsSection } from './SettingsLayout'
import { ActivateMembershipModal } from './ActivateMembershipModal'

const STATUS_TONE: Record<SubscriptionStatus, 'green' | 'amber' | 'red' | 'blue' | 'slate'> = {
  trial_active: 'blue',
  trial_expired: 'red',
  membership_active: 'green',
  membership_expired: 'red',
  lifetime_active: 'green',
  suspended: 'red',
  pending_verification: 'amber',
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="flex justify-between border-b border-line py-2 text-sm last:border-b-0">
      <span className="text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

export function SubscriptionStatusCard() {
  const { subscription, isLoading } = useSubscription()
  const shop = useAuth((s) => s.state?.shop)
  const invalidate = useInvalidateSubscription()
  const [activateOpen, setActivateOpen] = useState(false)
  const [checking, setChecking] = useState(false)

  const contactSupport = async () => {
    try {
      await api('app:openExternal', { url: whatsappSupportUrl(shop?.name ?? 'my shop') })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // Ask the vendor cloud whether the admin has approved us yet.
  const checkActivation = async () => {
    setChecking(true)
    try {
      const before = subscription?.status
      const view = await api<SubscriptionView>('subscription:refresh')
      invalidate()
      if (view.status !== before && !shouldLockSales(view.status)) {
        toast.success('Membership activated — thank you!')
      } else if (view.status === 'pending_verification') {
        toast.warning('Still waiting for verification. We will activate your membership shortly.')
      } else {
        toast.warning('No update yet. Check your internet connection or contact support.')
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setChecking(false)
    }
  }

  if (isLoading || !subscription) {
    return (
      <SettingsSection title="Subscription / Membership" icon={<BadgeCheck size={18} />}>
        <Spinner />
      </SettingsSection>
    )
  }

  const s = subscription
  const locked = shouldLockSales(s.status)
  const isTrial = s.plan_type === 'trial'

  return (
    <SettingsSection
      title="Subscription / Membership"
      description="Your plan, trial status and license"
      icon={<BadgeCheck size={18} />}
      actions={<Badge tone={STATUS_TONE[s.status]}>{SUBSCRIPTION_STATUS_LABELS[s.status]}</Badge>}
    >
      {locked && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-900">
          Your trial has expired. Your data is safe, but new sales are locked until activation.
        </div>
      )}
      {s.status === 'pending_verification' && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          Payment proof uploaded. Your membership will be activated after verification.
        </div>
      )}

      <div className="mb-4">
        <Row label="Current plan" value={PLAN_LABELS[s.plan_type]} />
        {isTrial && <Row label="Trial started" value={s.trial_started_at ? formatDate(s.trial_started_at) : null} />}
        {isTrial && <Row label="Trial ends" value={s.trial_ends_at ? formatDate(s.trial_ends_at) : null} />}
        {s.status === 'trial_active' && (
          <Row
            label="Remaining trial days"
            value={`${s.remaining_trial_days} ${s.remaining_trial_days === 1 ? 'day' : 'days'}`}
          />
        )}
        <Row label="Membership started" value={s.membership_started_at ? formatDate(s.membership_started_at) : null} />
        <Row
          label="Membership ends"
          value={
            s.plan_type === 'lifetime' && s.membership_started_at
              ? 'Never (lifetime)'
              : s.membership_ends_at
                ? formatDate(s.membership_ends_at)
                : null
          }
        />
        <Row label="License key" value={s.license_key_masked} />
        <Row
          label="Activation method"
          value={
            s.activation_method
              ? { license_key_online: 'License key (verified online)', license_key_offline: 'License key (offline)', payment_proof: 'Payment proof' }[s.activation_method] ?? s.activation_method
              : null
          }
        />
        <Row label="Payment reference" value={s.payment_reference} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setActivateOpen(true)}>
          {s.status === 'membership_active' || s.status === 'membership_expired'
            ? 'Renew Membership'
            : 'Activate Membership'}
        </Button>
        <Button variant="secondary" onClick={contactSupport}>
          <MessageCircle size={15} /> Contact Support
        </Button>
        {(s.status === 'pending_verification' || locked) && (
          <Button variant="secondary" onClick={checkActivation} loading={checking}>
            <RefreshCw size={15} /> Check Activation Status
          </Button>
        )}
      </div>

      <ActivateMembershipModal open={activateOpen} onClose={() => setActivateOpen(false)} />
    </SettingsSection>
  )
}
