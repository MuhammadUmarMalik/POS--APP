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

export const TRIAL_DAYS = 7

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

export const shouldShowTrialBanner = (status: SubscriptionStatus): boolean =>
  status === 'trial_active'

export const shouldLockSales = (status: SubscriptionStatus): boolean =>
  !FULL_ACCESS.includes(status)

export const LOCKED_MESSAGE =
  'Your trial has expired. Your data is safe, but new sales are locked until activation.'

/** Whole days left on the trial, never negative. */
export function remainingTrialDays(trialEndsAt: string | null | undefined, nowMs = Date.now()): number {
  if (!trialEndsAt) return 0
  const diff = new Date(trialEndsAt).getTime() - nowMs
  return Math.max(0, Math.ceil(diff / 86_400_000))
}

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
