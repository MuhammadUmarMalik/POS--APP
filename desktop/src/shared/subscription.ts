// Subscription / trial access rules, shared by the renderer (UX-level hiding)
// and the electron main process (real enforcement in ipc.ts). Pure functions
// only — must stay importable from both sides.

export type SubscriptionStatus =
  | 'trial_active'
  | 'trial_expired'
  | 'membership_active'
  | 'membership_expired'
  | 'lifetime_active'
  | 'suspended'
  | 'pending_verification'

export type PlanType = 'trial' | 'monthly' | 'yearly' | 'lifetime'

/** The plans a license key can be issued for. Trial is never sold. */
export type PaidPlanType = Exclude<PlanType, 'trial'>

export const PAID_PLANS: readonly PaidPlanType[] = ['monthly', 'yearly', 'lifetime']

export const TRIAL_DAYS = 7

/**
 * How long a paid plan runs from the date it starts. Plain day counts rather
 * than calendar months, so a key issued on the 31st behaves like every other
 * key and the arithmetic is identical on both sides of the IPC boundary.
 * Lifetime is absent on purpose: it has no duration and stores no expiry.
 */
export const PLAN_DURATION_DAYS: Record<'monthly' | 'yearly', number> = {
  monthly: 30,
  yearly: 365,
}

/** Lifetime is the one plan that never expires and never needs renewing. */
export const isLifetimePlan = (plan: PlanType): boolean => plan === 'lifetime'

/** Only monthly and yearly can be renewed — trial is bought out of, lifetime is done. */
export const isRenewablePlan = (plan: PlanType): boolean => plan === 'monthly' || plan === 'yearly'

const FULL_ACCESS: readonly SubscriptionStatus[] = [
  'trial_active',
  'membership_active',
  'lifetime_active',
]

export const canUsePOS = (status: SubscriptionStatus): boolean => FULL_ACCESS.includes(status)

export const canCreateSale = (status: SubscriptionStatus): boolean => FULL_ACCESS.includes(status)

export const canCreatePurchase = (status: SubscriptionStatus): boolean =>
  FULL_ACCESS.includes(status)

// Old data, reports, export and backup stay available no matter what.
export const canAccessReports = (_status: SubscriptionStatus): boolean => true

export const shouldLockSales = (status: SubscriptionStatus): boolean =>
  !FULL_ACCESS.includes(status)

export const LOCKED_MESSAGE =
  'Your trial has expired. Your data is safe, but new sales are locked until activation.'

/** Whole days left before an end date, never negative. 0 once it has passed. */
export function remainingDays(endsAt: string | null | undefined, nowMs = Date.now()): number {
  if (!endsAt) return 0
  const diff = new Date(endsAt).getTime() - nowMs
  return Math.max(0, Math.ceil(diff / 86_400_000))
}

/** Whole days left on the trial, never negative. */
export function remainingTrialDays(trialEndsAt: string | null | undefined, nowMs = Date.now()): number {
  return remainingDays(trialEndsAt, nowMs)
}

/**
 * When a monthly/yearly membership should end, for both a first activation and
 * a renewal. Lifetime (and trial) return null — a lifetime membership stores no
 * expiry at all, so no expiry check can ever fire for it.
 *
 * RENEWAL POLICY — renewing early never costs the shop the days it paid for:
 *
 *   • current expiry still in the future → the new term is added ON TOP of it
 *     (a monthly renewed with 9 days left ends 39 days from today).
 *   • current expiry today or already passed → the new term starts NOW
 *     (a monthly renewed 5 days late ends 30 days from today, not 25).
 *
 * The boundary case — renewing at the exact moment of expiry — falls into the
 * second branch and gives a full term from that moment, which is the same
 * answer the first branch would give. There is no gap and no double count.
 */
export function computeMembershipEnd(
  plan: PlanType,
  nowIso: string,
  currentEndsAt: string | null | undefined
): string | null {
  if (plan !== 'monthly' && plan !== 'yearly') return null
  const nowMs = new Date(nowIso).getTime()
  const currentMs = currentEndsAt ? new Date(currentEndsAt).getTime() : 0
  const from = currentMs > nowMs ? currentMs : nowMs
  return new Date(from + PLAN_DURATION_DAYS[plan] * 86_400_000).toISOString()
}

/** How loudly the UI should warn that a membership is running out. */
export type ExpiryWarning = 'none' | 'week' | 'soon' | 'last_day' | 'expired'

/**
 * Escalates as the end date approaches: one week out, three days out, then the
 * final day. Lifetime memberships (no end date) never warn about anything.
 */
export function expiryWarning(
  endsAt: string | null | undefined,
  nowMs = Date.now()
): ExpiryWarning {
  if (!endsAt) return 'none'
  const days = remainingDays(endsAt, nowMs)
  if (days <= 0) return 'expired'
  if (days === 1) return 'last_day'
  if (days <= 3) return 'soon'
  if (days <= 7) return 'week'
  return 'none'
}

/** Shopkeeper-facing sentence for each warning level. */
export function expiryWarningMessage(level: ExpiryWarning, days: number): string | null {
  switch (level) {
    case 'last_day':
      return 'Your membership ends today. Renew now to keep selling tomorrow.'
    case 'soon':
      return `Your membership ends in ${days} days. Renew now to avoid interruption.`
    case 'week':
      return `Your membership ends in ${days} days. Renewing early adds the new term on top of the days you have left.`
    case 'expired':
      return 'Your membership has ended. New sales are locked until you renew.'
    default:
      return null
  }
}

export const LIFETIME_NOTE = 'Lifetime — no renewal needed'

export const LIFETIME_NO_RENEWAL_MESSAGE =
  'You already have a Lifetime membership. It never expires, so there is nothing to renew.'

export const KEY_ALREADY_USED_MESSAGE =
  'This license key has already been used on this computer. Enter a new key to renew.'

export const LICENSE_KEY_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/

/** Uppercase + insert dashes as the user types: "ab12cd" → "AB12-CD". */
export function formatLicenseKeyInput(raw: string): string {
  const chars = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16)
  return chars.replace(/(.{4})(?=.)/g, '$1-')
}

/** Only the last 4 characters are ever shown in the UI. */
export function maskLicenseKey(key: string | null | undefined): string | null {
  if (!key) return null
  return `••••-••••-••••-${key.slice(-4)}`
}

// Support contact for membership activation (WhatsApp number, digits only).
export const SUPPORT_WHATSAPP = '923001234567'

export function whatsappSupportUrl(shopName: string): string {
  const text = `Hello, I want to activate my POS membership. My shop name is ${shopName}.`
  return `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(text)}`
}

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trial_active: 'Trial Active',
  trial_expired: 'Trial Expired',
  membership_active: 'Membership Active',
  membership_expired: 'Membership Expired',
  lifetime_active: 'Lifetime Active',
  suspended: 'Suspended',
  pending_verification: 'Pending Verification',
}

export const PLAN_LABELS: Record<PlanType, string> = {
  trial: 'Free Trial',
  monthly: 'Monthly Membership',
  yearly: 'Yearly Membership',
  lifetime: 'Lifetime',
}
