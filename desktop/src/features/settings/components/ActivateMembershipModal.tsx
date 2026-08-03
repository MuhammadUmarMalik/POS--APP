import { useState } from 'react'
import { KeyRound, ImageUp, MessageCircle, CheckCircle2 } from 'lucide-react'
import { api } from '../../../lib/ipc'
import { useAuth } from '../../../stores/auth'
import {
  LICENSE_KEY_RE, PLAN_LABELS, formatLicenseKeyInput, whatsappSupportUrl,
} from '../../../shared/subscription'
import type { SubscriptionView } from '../../../shared/types'
import { Button, Field, Input, Modal } from '../../../components/ui'
import { toast } from '../../../components/ui/toast'
import { useInvalidateSubscription } from '../useSubscription'
import { cn, formatDate } from '../../../lib/utils'

type Tab = 'key' | 'proof' | 'support'

export function ActivateMembershipModal({
  open,
  onClose,
  renewal = false,
}: {
  open: boolean
  onClose: () => void
  /** The shop already has a paid plan, so this entry extends it rather than starts it. */
  renewal?: boolean
}) {
  const [tab, setTab] = useState<Tab>('key')

  return (
    <Modal open={open} onClose={onClose} title={renewal ? 'Renew membership' : 'Activate membership'} wide>
      <div className="mb-5 grid grid-cols-3 gap-2">
        {(
          [
            { id: 'key', label: 'License key', icon: <KeyRound size={16} /> },
            { id: 'proof', label: 'Payment screenshot', icon: <ImageUp size={16} /> },
            { id: 'support', label: 'Contact support', icon: <MessageCircle size={16} /> },
          ] as { id: Tab; label: string; icon: React.ReactNode }[]
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium',
              tab === t.id
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-line text-muted hover:bg-slate-50'
            )}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'key' && <LicenseKeyTab onDone={onClose} renewal={renewal} />}
      {tab === 'proof' && <PaymentProofTab onDone={onClose} />}
      {tab === 'support' && <SupportTab />}
    </Modal>
  )
}

function LicenseKeyTab({ onDone, renewal }: { onDone: () => void; renewal: boolean }) {
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const invalidate = useInvalidateSubscription()

  const submit = async () => {
    setError(null)
    if (!LICENSE_KEY_RE.test(key)) {
      setError('Enter the full key in XXXX-XXXX-XXXX-XXXX format')
      return
    }
    setSubmitting(true)
    try {
      const view = await api<SubscriptionView>('subscription:activate', { license_key: key })
      invalidate()
      toast.success(
        view.is_lifetime
          ? 'Lifetime membership activated — it never expires. Thank you!'
          : `${PLAN_LABELS[view.plan_type]} ${renewal ? 'renewed' : 'activated'} — valid until ${
              view.membership_ends_at ? formatDate(view.membership_ends_at) : 'further notice'
            }. Thank you!`
      )
      onDone()
    } catch (e) {
      setError((e as Error).message) // invalid key never changes state
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Enter the license key you received after purchase. The key itself carries the plan —
        monthly, yearly or lifetime — so there is nothing else to choose. Keys are verified online
        when internet is available, otherwise validated offline.
      </p>
      {renewal && (
        <p className="rounded-md border border-line bg-slate-50 px-3 py-2 text-sm text-muted">
          Renewing early costs you nothing: the new term is added on top of the days you have left.
          A renewal needs a new key — a key already used on this computer cannot be entered again.
        </p>
      )}
      <Field label="License key" required error={error ?? undefined}>
        <Input
          value={key}
          onChange={(e) => setKey(formatLicenseKeyInput(e.target.value))}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          className="font-mono tracking-widest"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
      </Field>
      <div className="flex justify-end">
        <Button onClick={submit} loading={submitting} disabled={key.length < 19}>
          <CheckCircle2 size={16} /> Activate
        </Button>
      </div>
    </div>
  )
}

function PaymentProofTab({ onDone }: { onDone: () => void }) {
  const [reference, setReference] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const invalidate = useInvalidateSubscription()

  const submit = async () => {
    setSubmitting(true)
    try {
      const res = await api<{ saved: boolean }>('subscription:uploadPaymentProof', {
        reference: reference || null,
      })
      if (res.saved) {
        invalidate()
        toast.success('Payment proof uploaded. Your membership will be activated after verification.')
        onDone()
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Paid via bank transfer, JazzCash or Easypaisa? Upload a screenshot of the payment. It is
        saved on this computer immediately and sent to us when internet is available.
      </p>
      <Field label="Payment reference / transaction ID (optional)">
        <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. TID 8839021" />
      </Field>
      <div className="flex justify-end">
        <Button onClick={submit} loading={submitting}>
          <ImageUp size={16} /> Choose screenshot &amp; upload
        </Button>
      </div>
    </div>
  )
}

function SupportTab() {
  const shop = useAuth((s) => s.state?.shop)

  const openWhatsApp = async () => {
    try {
      await api('app:openExternal', { url: whatsappSupportUrl(shop?.name ?? 'my shop') })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="space-y-4 text-center">
      <p className="text-sm text-muted">
        Message us on WhatsApp and we&apos;ll help you activate your membership. Your shop name is
        included automatically.
      </p>
      <Button onClick={openWhatsApp}>
        <MessageCircle size={16} /> Open WhatsApp
      </Button>
    </div>
  )
}
