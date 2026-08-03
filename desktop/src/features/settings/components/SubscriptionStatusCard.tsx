import { useState } from 'react'
import { BadgeCheck, Infinity as InfinityIcon, MessageCircle, RefreshCw } from 'lucide-react'
import { api } from '../../../lib/ipc'
import { useAuth } from '../../../stores/auth'
import { formatDate } from '../../../lib/utils'
import {
  LIFETIME_NOTE, PLAN_LABELS, SUBSCRIPTION_STATUS_LABELS, expiryWarningMessage, shouldLockSales,
  whatsappSupportUrl, type ExpiryWarning, type SubscriptionStatus,
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

// How urgent the "your membership is running out" banner looks. Only the last
// three days go red — a warning that shouts a week out stops being read.
const WARNING_STYLE: Record<Exclude<ExpiryWarning, 'none'>, string> = {
  week: 'border-blue-200 bg-blue-50 text-blue-900',
  soon: 'border-amber-200 bg-amber-50 text-amber-900',
  last_day: 'border-red-200 bg-red-50 text-red-900',
  expired: 'border-red-200 bg-red-50 text-red-900',
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
  const days = s.remaining_membership_days
  // A lifetime plan has no end date, so no countdown and no warning is ever shown.
  const warning = s.is_lifetime || locked ? 'none' : s.expiry_warning
  const warningText = expiryWarningMessage(warning, days)

  return (
    <SettingsSection
      title="Subscription / Membership"
      description="Your plan, trial status and license"
      icon={<BadgeCheck size={18} />}
      actions={<Badge tone={STATUS_TONE[s.status]}>{SUBSCRIPTION_STATUS_LABELS[s.status]}</Badge>}
    >
      {locked && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-900">
          {isTrial
            ? 'Your trial has expired. Your data is safe, but new sales are locked until activation.'
            : 'Your membership has ended. Your data is safe, but new sales are locked until you renew.'}
        </div>
      )}
      {s.is_lifetime && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-900">
          <InfinityIcon size={16} className="shrink-0" />
          <span>
            <strong>{LIFETIME_NOTE}.</strong> Your membership never expires — there is nothing to
            renew and nothing to pay again.
          </span>
        </div>
      )}
      {warningText && warning !== 'none' && (
        <div className={`mb-4 rounded-md border px-3 py-2.5 text-sm ${WARNING_STYLE[warning]}`}>
          {warningText}
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
            s.is_lifetime
              ? 'Never expires'
              : s.membership_ends_at
                ? formatDate(s.membership_ends_at)
                : null
          }
        />
        {/* No countdown on lifetime: there is nothing to count down to. */}
        {!s.is_lifetime && s.membership_ends_at && (
          <Row
            label="Days remaining"
            value={days > 0 ? `${days} ${days === 1 ? 'day' : 'days'}` : 'Expired'}
          />
        )}
        {s.renewal_count > 0 && (
          <Row
            label="Renewals"
            value={`${s.renewal_count}${s.last_renewed_at ? ` — last on ${formatDate(s.last_renewed_at)}` : ''}`}
          />
        )}
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

      <div className="flex flex-wrap items-center gap-2">
        {/* Lifetime has no renewal at all — the button is not shown, because a
            disabled "Renew" still invites a shopkeeper to go looking for a key. */}
        {!s.is_lifetime && (
          <Button onClick={() => setActivateOpen(true)}>
            {s.renewal_available ? 'Renew Membership' : 'Activate Membership'}
          </Button>
        )}
        <Button variant="secondary" onClick={contactSupport}>
          <MessageCircle size={15} /> Contact Support
        </Button>
        {(s.status === 'pending_verification' || locked) && (
          <Button variant="secondary" onClick={checkActivation} loading={checking}>
            <RefreshCw size={15} /> Check Activation Status
          </Button>
        )}
      </div>

      <ActivateMembershipModal
        open={activateOpen}
        renewal={s.renewal_available}
        onClose={() => setActivateOpen(false)}
      />
    </SettingsSection>
  )
}
