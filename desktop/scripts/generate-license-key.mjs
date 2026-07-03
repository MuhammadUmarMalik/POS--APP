// Vendor-side license key generator. Run on YOUR machine, never shipped to shops.
//
//   npm run genkey                → 1 monthly key
//   npm run genkey lifetime       → 1 lifetime key
//   npm run genkey yearly 5       → 5 yearly keys
//
// KEY_SECRET and KEY_CHARSET must stay identical to electron/services/subscription.ts,
// otherwise generated keys will not validate inside the app.
import { createHash, randomBytes } from 'node:crypto'

const KEY_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I
const KEY_SECRET = 'POS-DESKTOP-LK1'

function expectedChecksum(firstThreeGroups) {
  const digest = createHash('sha256').update(`${KEY_SECRET}|${firstThreeGroups}`).digest()
  let out = ''
  for (let i = 0; i < 4; i++) out += KEY_CHARSET[digest[i] % KEY_CHARSET.length]
  return out
}

function generateKey(plan) {
  const first = plan === 'lifetime' ? 'L' : plan === 'yearly' ? 'Y' : 'M'
  const rand = randomBytes(11)
  let body = first
  for (let i = 0; i < 11; i++) body += KEY_CHARSET[rand[i] % KEY_CHARSET.length]
  const groups = [body.slice(0, 4), body.slice(4, 8), body.slice(8, 12)].join('-')
  return `${groups}-${expectedChecksum(groups)}`
}

const plan = (process.argv[2] ?? 'monthly').toLowerCase()
const count = Math.max(1, Math.min(100, Number(process.argv[3]) || 1))

if (!['monthly', 'yearly', 'lifetime'].includes(plan)) {
  console.error(`Unknown plan "${plan}". Use: monthly | yearly | lifetime`)
  process.exit(1)
}

console.log(`Plan: ${plan}\n`)
for (let i = 0; i < count; i++) {
  const key = generateKey(plan)
  // Self-check: refuse to print a key the app would reject.
  const groups = key.split('-')
  if (expectedChecksum(groups.slice(0, 3).join('-')) !== groups[3]) {
    console.error('Internal error: generated key failed self-verification')
    process.exit(1)
  }
  console.log(key)
}
console.log('\nSend the key to the shopkeeper. They enter it in Settings → Activate Membership.')
console.log('Keep a record of which key you sent to which shop (name + phone + date + payment ref).')
