import type { AuthState, Shop } from '../shared/types'

const AUTH_CACHE_KEY = 'pos.auth-cache.v1'

interface AuthCache {
  version: 1
  setupComplete: boolean
  shop: Shop | null
  lastUsername: string
}

const emptyCache: AuthCache = {
  version: 1,
  setupComplete: false,
  shop: null,
  lastUsername: '',
}

export function readAuthCache(): AuthCache {
  try {
    const value = localStorage.getItem(AUTH_CACHE_KEY)
    if (!value) return emptyCache
    const parsed = JSON.parse(value) as Partial<AuthCache>
    if (parsed.version !== 1) return emptyCache
    return {
      version: 1,
      setupComplete: parsed.setupComplete === true,
      shop: parsed.shop ?? null,
      lastUsername: typeof parsed.lastUsername === 'string' ? parsed.lastUsername : '',
    }
  } catch {
    return emptyCache
  }
}

export function writeAuthCache(state: AuthState, username?: string): void {
  try {
    const previous = readAuthCache()
    const value: AuthCache = {
      version: 1,
      setupComplete: !state.needsSetup,
      shop: state.shop,
      lastUsername: username?.toLowerCase() ?? previous.lastUsername,
    }
    localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(value))
  } catch {
    // SQLite is authoritative; an unavailable renderer cache must not block auth.
  }
}
