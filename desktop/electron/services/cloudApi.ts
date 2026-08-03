// Thin HTTP client for the vendor cloud API.
//
// This is used by the membership/licensing round trip in subscription.ts only:
// activation requests travel out, the admin's approval travels back. It is NOT
// a record-sync channel — shop data never leaves the machine.
//
// Empty POS_CLOUD_URL → this install has no cloud backend. Every call returns
// null and the caller carries on offline; licence keys still validate against
// their checksum with no internet at all.
const CLOUD_URL = (process.env.POS_CLOUD_URL ?? '').replace(/\/+$/, '')

/** POST/GET JSON against the cloud API. Returns null when offline/unconfigured. */
export async function cloudFetch(
  route: string,
  opts: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number } = {}
): Promise<unknown | null> {
  if (!CLOUD_URL) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000)
  try {
    const res = await fetch(`${CLOUD_URL}${route}`, {
      method: opts.method ?? 'GET',
      headers: { 'content-type': 'application/json' },
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`Cloud API ${route} → HTTP ${res.status}`)
    return (await res.json()) as unknown
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
