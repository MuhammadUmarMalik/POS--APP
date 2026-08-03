// Vendor-side license key generator. Run on YOUR machine, never shipped to shops.
//
//   npm run genkey                          → 1 monthly key
//   npm run genkey lifetime                 → 1 lifetime key
//   npm run genkey yearly 5                 → a batch of 5 yearly keys
//   npm run genkey monthly 3 --note "Ali Kiryana Store"
//   npm run genkey -- --list                → every key issued so far, newest first
//   npm run genkey -- --list yearly         → …only the yearly ones
//   npm run genkey monthly 1 --no-record    → print a key without logging it
//
// Every issued key is appended to scripts/issued-keys.jsonl (git-ignored: it holds
// plaintext keys). That log is the only answer to "which plan was the key I sent
// this shop?" — the app stores nothing but a hash, and a key is a checksum rather
// than a row in any database.
//
// KEY_SECRET and KEY_CHARSET must stay identical to electron/services/subscription.ts,
// otherwise generated keys will not validate inside the app.
import { createHash, randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const KEY_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I
const KEY_SECRET = 'POS-DESKTOP-LK1'

const PLANS = ['monthly', 'yearly', 'lifetime']
// Printed beside each key so the term is never in doubt. Mirrors PLAN_DURATION_DAYS
// and the lifetime rule in src/shared/subscription.ts.
const PLAN_TERM = {
  monthly: '30 days from activation',
  yearly: '365 days from activation',
  lifetime: 'never expires',
}

const LOG_FILE = join(dirname(fileURLToPath(import.meta.url)), 'issued-keys.jsonl')

function expectedChecksum(firstThreeGroups) {
  const digest = createHash('sha256').update(`${KEY_SECRET}|${firstThreeGroups}`).digest()
  let out = ''
  for (let i = 0; i < 4; i++) out += KEY_CHARSET[digest[i] % KEY_CHARSET.length]
  return out
}

// The plan travels in the first character of the key — L / Y / M. The app reads
// it back with planFromKey() and applies the matching term on activation.
function generateKey(plan) {
  const first = plan === 'lifetime' ? 'L' : plan === 'yearly' ? 'Y' : 'M'
  const rand = randomBytes(11)
  let body = first
  for (let i = 0; i < 11; i++) body += KEY_CHARSET[rand[i] % KEY_CHARSET.length]
  const groups = [body.slice(0, 4), body.slice(4, 8), body.slice(8, 12)].join('-')
  return `${groups}-${expectedChecksum(groups)}`
}

function readIssuedLog() {
  if (!existsSync(LOG_FILE)) return []
  return readFileSync(LOG_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null // a hand-edited log must not take the whole tool down
      }
    })
    .filter(Boolean)
}

// ---- arguments --------------------------------------------------------------
// Flags may appear anywhere; --note takes the next argument as its value.

const argv = process.argv.slice(2)
const positional = []
const flags = new Set()
let note = null
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]
  if (arg === '--note') {
    note = argv[++i] ?? null
  } else if (arg.startsWith('--')) {
    flags.add(arg.slice(2))
  } else {
    positional.push(arg)
  }
}

function assertKnownPlan(value) {
  if (!PLANS.includes(value)) {
    console.error(`Unknown plan "${value}". Use: monthly | yearly | lifetime`)
    process.exit(1)
  }
}

// ---- --list: what has been issued, and on which plan ------------------------

if (flags.has('list')) {
  const filter = positional[0]?.toLowerCase() ?? null
  if (filter) assertKnownPlan(filter)

  const all = readIssuedLog()
  const rows = filter ? all.filter((r) => r.plan === filter) : all
  if (rows.length === 0) {
    console.log(filter ? `No ${filter} keys issued yet.` : 'No keys issued yet.')
    process.exit(0)
  }

  console.log(`${rows.length} key(s) issued${filter ? ` on the ${filter} plan` : ''}, newest first:\n`)
  console.log('KEY                    PLAN      ISSUED (UTC)          NOTE')
  for (const r of [...rows].reverse()) {
    const when = String(r.issued_at ?? '').slice(0, 19).replace('T', ' ')
    console.log(`${r.key}  ${String(r.plan).padEnd(8)}  ${when.padEnd(20)}  ${r.note ?? ''}`)
  }
  console.log(`\nTotals — ${PLANS.map((p) => `${p}: ${all.filter((r) => r.plan === p).length}`).join('  ·  ')}`)
  process.exit(0)
}

// ---- generate a key, or a batch of one plan ---------------------------------

const plan = (positional[0] ?? 'monthly').toLowerCase()
assertKnownPlan(plan)
const count = Math.max(1, Math.min(100, Number(positional[1]) || 1))

console.log(`Plan: ${plan} (${PLAN_TERM[plan]})\n`)
const issued = []
for (let i = 0; i < count; i++) {
  const key = generateKey(plan)
  // Self-check: refuse to print a key the app would reject.
  const groups = key.split('-')
  if (expectedChecksum(groups.slice(0, 3).join('-')) !== groups[3]) {
    console.error('Internal error: generated key failed self-verification')
    process.exit(1)
  }
  issued.push(key)
  console.log(key)
}

if (!flags.has('no-record')) {
  const issuedAt = new Date().toISOString()
  appendFileSync(
    LOG_FILE,
    issued.map((key) => JSON.stringify({ key, plan, issued_at: issuedAt, note })).join('\n') + '\n',
    'utf8'
  )
  console.log(`\nRecorded ${issued.length} ${plan} key(s) in scripts/issued-keys.jsonl`)
}

console.log('\nSend the key to the shopkeeper. They enter it in Settings → Activate Membership.')
console.log('The plan rides inside the key — the shop never picks monthly/yearly/lifetime itself.')
if (plan !== 'lifetime') {
  console.log('A renewal needs a NEW key: a key already used on that computer is refused.')
}
console.log('Run `npm run genkey -- --list` to see every key issued, with its plan and note.')
