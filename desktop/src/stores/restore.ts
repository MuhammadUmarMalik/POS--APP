import { create } from 'zustand'

/**
 * Whether a database restore is running, so the whole window can be blocked.
 *
 * A restore replaces the database under the running app and then restarts it.
 * Anything the user does in between is at best thrown away, so the UI stops
 * being interactive and says so — rather than looking frozen or, once the
 * restart begins, looking like a crash.
 */
export type RestorePhase = 'restoring' | 'restarting'

interface RestoreStore {
  phase: RestorePhase | null
  setPhase: (phase: RestorePhase | null) => void
}

export const useRestore = create<RestoreStore>((set) => ({
  phase: null,
  setPhase: (phase) => set({ phase }),
}))

export const RESTORE_TEXT: Record<RestorePhase, { title: string; detail: string }> = {
  restoring: {
    title: 'Restoring database, please wait…',
    detail: 'Checking the backup and replacing your data. Do not close POS Desktop.',
  },
  restarting: {
    title: 'Restore complete — restarting…',
    detail: 'POS Desktop is reopening with your restored data. This takes a few seconds.',
  },
}
