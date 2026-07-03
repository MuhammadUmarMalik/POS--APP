import { AppError } from './helpers'

const MAX_FAILURES = 5
const WINDOW_MS = 15 * 60 * 1000
const LOCKOUT_MS = 5 * 60 * 1000

type Entry = { failures: number[]; lockedUntil: number }

const entries = new Map<string, Entry>()

function getEntry(key: string): Entry {
  let entry = entries.get(key)
  if (!entry) {
    entry = { failures: [], lockedUntil: 0 }
    entries.set(key, entry)
  }
  return entry
}

/** Throws if the key is locked out. Call before verifying credentials. */
export function assertNotRateLimited(key: string): void {
  const entry = entries.get(key)
  if (!entry) return
  const remaining = entry.lockedUntil - Date.now()
  if (remaining > 0) {
    const minutes = Math.ceil(remaining / 60_000)
    throw new AppError(
      `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
    )
  }
}

/** Record a failed attempt; locks the key once MAX_FAILURES occur within the window. */
export function recordAuthFailure(key: string): void {
  const entry = getEntry(key)
  const cutoff = Date.now() - WINDOW_MS
  entry.failures = entry.failures.filter((ts) => ts > cutoff)
  entry.failures.push(Date.now())
  if (entry.failures.length >= MAX_FAILURES) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS
    entry.failures = []
  }
}

/** Reset on successful auth. */
export function clearAuthFailures(key: string): void {
  entries.delete(key)
}
