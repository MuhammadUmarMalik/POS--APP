import type { Session } from '../../src/shared/types'

let current: Session | null = null

export const getSession = () => current
export const setSession = (s: Session | null) => {
  current = s
}
