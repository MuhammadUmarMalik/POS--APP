// License key issuing + verification. The checksum scheme MUST match
// desktop/electron/services/subscription.ts so keys also validate offline.
import { createHash, randomBytes } from 'node:crypto'

const KEY_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I
const KEY_SECRET = process.env.POS_KEY_SECRET ?? 'POS-DESKTOP-LK1'

export type KeyPlan = 'monthly' | 'yearly' | 'lifetime'

function expectedChecksum(firstThreeGroups: string): string {
  const digest = createHash('sha256').update(`${KEY_SECRET}|${firstThreeGroups}`).digest()
  let out = ''
  for (let i = 0; i < 4; i++) out += KEY_CHARSET[digest[i] % KEY_CHARSET.length]
  return out
}

export function generateKey(plan: KeyPlan): string {
  const first = plan === 'lifetime' ? 'L' : plan === 'yearly' ? 'Y' : 'M'
  const rand = randomBytes(11)
  let body = first
  for (let i = 0; i < 11; i++) body += KEY_CHARSET[rand[i] % KEY_CHARSET.length]
  const groups = [body.slice(0, 4), body.slice(4, 8), body.slice(8, 12)].join('-')
  return `${groups}-${expectedChecksum(groups)}`
}

export function checksumValid(key: string): boolean {
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key)) return false
  const groups = key.split('-')
  return expectedChecksum(groups.slice(0, 3).join('-')) === groups[3]
}

export function planFromKey(key: string): KeyPlan {
  if (key[0] === 'L') return 'lifetime'
  if (key[0] === 'Y') return 'yearly'
  return 'monthly'
}

export function keyHash(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}
