// Tiny fetch wrapper with the admin token in localStorage.
let token = localStorage.getItem('pos_admin_token') ?? ''

export function setToken(t: string) {
  token = t
  localStorage.setItem('pos_admin_token', t)
}

export function clearToken() {
  token = ''
  localStorage.removeItem('pos_admin_token')
}

export function hasToken() {
  return !!token
}

export async function api<T>(route: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(route, {
    method: opts.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) {
    clearToken()
    window.location.reload()
    throw new Error('Session expired')
  }
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
  return data as T
}

export function proofUrl(requestId: string) {
  return `/api/admin/requests/${requestId}/proof`
}

export async function fetchProofBlob(requestId: string): Promise<string> {
  const res = await fetch(proofUrl(requestId), {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error('No screenshot')
  return URL.createObjectURL(await res.blob())
}

export async function downloadBackup(shopId: string, shopName: string) {
  const res = await fetch(`/api/admin/shops/${shopId}/backup`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error('Backup failed')
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = `${shopName || shopId}-backup.json`
  a.click()
  URL.revokeObjectURL(url)
}
