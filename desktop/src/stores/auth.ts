import { create } from 'zustand'
import { api } from '../lib/ipc'
import type { AuthState } from '../shared/types'
import type { LoginInput, SetupInput } from '../shared/schemas'

interface AuthStore {
  loaded: boolean
  state: AuthState | null
  init: () => Promise<void>
  login: (input: LoginInput) => Promise<void>
  setup: (input: SetupInput) => Promise<void>
  logout: () => Promise<void>
  setState: (s: AuthState) => void
}

export const useAuth = create<AuthStore>((set) => ({
  loaded: false,
  state: null,
  init: async () => {
    const state = await api<AuthState>('auth:state')
    set({ state, loaded: true })
  },
  login: async (input) => {
    const state = await api<AuthState>('auth:login', input)
    set({ state })
  },
  setup: async (input) => {
    const state = await api<AuthState>('auth:setup', input)
    set({ state })
  },
  logout: async () => {
    const state = await api<AuthState>('auth:logout')
    set({ state })
  },
  setState: (state) => set({ state }),
}))

/** Convenience: current shop currency symbol for money formatting. */
export const useCurrency = () => useAuth((s) => s.state?.shop?.currency ?? 'Rs')
export const useSession = () => useAuth((s) => s.state?.session ?? null)
