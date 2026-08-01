import { create } from 'zustand'
import { api } from '../lib/ipc'
import type { AuthState } from '../shared/types'
import type { LoginInput, SetupInput } from '../shared/schemas'
import { readAuthCache, writeAuthCache } from '../lib/authCache'

interface AuthStore {
  loaded: boolean
  startupError: string | null
  state: AuthState | null
  init: () => Promise<void>
  login: (input: LoginInput) => Promise<void>
  setup: (input: SetupInput) => Promise<void>
  logout: () => Promise<void>
  setState: (s: AuthState) => void
}

let initPromise: Promise<AuthState> | null = null

function loadAuthState(): Promise<AuthState> {
  if (!initPromise) {
    initPromise = api<AuthState>('auth:state').finally(() => {
      initPromise = null
    })
  }
  return initPromise
}

export const useAuth = create<AuthStore>((set) => ({
  loaded: false,
  startupError: null,
  state: null,
  init: async () => {
    set({ loaded: false, startupError: null })
    try {
      const state = await loadAuthState()
      writeAuthCache(state)
      set({ state, loaded: true })
    } catch (error) {
      set({
        loaded: true,
        startupError: error instanceof Error ? error.message : 'Unable to start the application',
      })
    }
  },
  login: async (input) => {
    const state = await api<AuthState>('auth:login', input)
    writeAuthCache(state, input.username)
    set({ state })
  },
  setup: async (input) => {
    const state = await api<AuthState>('auth:setup', input)
    writeAuthCache(state, input.username)
    set({ state })
  },
  logout: async () => {
    const state = await api<AuthState>('auth:logout')
    writeAuthCache(state)
    set({ state })
  },
  setState: (state) => {
    writeAuthCache(state)
    set({ state })
  },
}))

export const getLastUsername = () => readAuthCache().lastUsername

/** Convenience: current shop currency symbol for money formatting. */
export const useCurrency = () => useAuth((s) => s.state?.shop?.currency ?? 'Rs')
export const useSession = () => useAuth((s) => s.state?.session ?? null)
