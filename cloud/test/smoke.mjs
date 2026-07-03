// End-to-end contract test for the vendor cloud. Payload shapes below mirror
// exactly what desktop/electron/services/{sync,subscription}.ts sends.
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

process.env.POS_CLOUD_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-cloud-smoke-'))
process.env.POS_ADMIN_USER = 'admin'
process.env.POS_ADMIN_PASSWORD = 'test-admin-pw'
process.env.POS_TOKEN_SECRET = 'test-secret'

const { createApp } = await import('../dist/server.js')

let failures = 0
function check(name, cond, detail) {
  if (cond) console.log(`  ok  ${name}`)
  else { failures++; console.error(`FAIL  ${name}`, detail ?? '') }
}

const server = createApp().listen(0)
const port = server.address().port
const base = `http://127.0.0.1:${port}`
let adminToken = ''

async function call(route, { method = 'GET', body, admin = false } = {}) {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(admin ? { authorization: `Bearer ${adminToken}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}

const SHOP_ID = 'shop-e2e-0001'
console.log('--- pos-cloud smoke test ---')

// Health (what desktop isOnline() hits)
check('health ok', (await call('/api/health')).data.ok === true)

// 1. Shop syncs for the first time — exact push shape from desktop runSync()
const push = await call('/api/sync/push', {
  method: 'POST',
  body: {
    shop_id: SHOP_ID,
    tables: {
      shops: [{ id: SHOP_ID, name: 'Ali Kiryana Store', phone: '0300-1112223', city: 'Lahore', currency: 'PKR', updated_at: new Date().toISOString() }],
      products: [
        { id: 'p1', shop_id: SHOP_ID, name: 'Milk', sale_price: 33000, updated_at: new Date().toISOString() },
        { id: 'p2', shop_id: SHOP_ID, name: 'Bread', sale_price: 18000, updated_at: new Date().toISOString() },
      ],
      sales: [{ id: 's1', shop_id: SHOP_ID, invoice_number: 'INV-000001', total: 51000, updated_at: new Date().toISOString() }],
    },
  },
})
check('push accepted (4 records)', push.data.ok === true && push.data.received === 4, push.data)
check('pull returns empty master tables', JSON.stringify((await call(`/api/sync/pull?shop_id=${SHOP_ID}&since=1970`)).data.tables) === '{}')

// 2. Shopkeeper presses Activate → request with payment proof (1x1 px png)
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const reqBody = {
  shop_id: SHOP_ID,
  client_request_id: 'proof-abc123.png',
  shop_name: 'Ali Kiryana Store',
  phone: '0300-1112223',
  reference: 'TID 8839021',
  proof_base64: PNG,
  proof_ext: '.png',
}
const req1 = await call('/api/subscription/request-activation', { method: 'POST', body: reqBody })
check('activation request accepted', req1.data.ok === true && !!req1.data.request_id, req1.data)
const req2 = await call('/api/subscription/request-activation', { method: 'POST', body: reqBody })
check('retried request deduped', req2.data.request_id === req1.data.request_id)

const statusPending = (await call(`/api/subscription/status?shop_id=${SHOP_ID}`)).data
check('shop status pending_verification', statusPending.status === 'pending_verification', statusPending)

// 3. Admin logs in
check('bad admin login rejected', (await call('/api/admin/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } })).status === 401)
check('admin api blocked without token', (await call('/api/admin/requests', { admin: true })).status === 401)
const loginRes = await call('/api/admin/login', { method: 'POST', body: { username: 'admin', password: 'test-admin-pw' } })
adminToken = loginRes.data.token
check('admin login works', !!adminToken)

const overview = (await call('/api/admin/overview', { admin: true })).data
check('overview: 1 shop, 1 pending request', overview.shops === 1 && overview.pending_requests === 1, overview)

// 4. Admin sees the request with the shop's details and proof
const pending = (await call('/api/admin/requests?status=pending', { admin: true })).data
check('request lists shop + reference', pending.length === 1 && pending[0].shop_name === 'Ali Kiryana Store' && pending[0].reference === 'TID 8839021', pending[0])
const proofRes = await fetch(`${base}/api/admin/requests/${pending[0].id}/proof`, { headers: { authorization: `Bearer ${adminToken}` } })
check('payment proof downloadable', proofRes.ok && (await proofRes.arrayBuffer()).byteLength > 0)

// 5. Admin approves as YEARLY → shop becomes active
const approve = await call(`/api/admin/requests/${pending[0].id}/approve`, { method: 'POST', body: { plan_type: 'yearly' }, admin: true })
check('approve grants yearly membership', approve.data.ok === true && approve.data.plan_type === 'yearly' && !!approve.data.expires_at, approve.data)
check('approve twice blocked', (await call(`/api/admin/requests/${pending[0].id}/approve`, { method: 'POST', body: { plan_type: 'yearly' }, admin: true })).status === 404)

// 6. Shop polls its status (what refreshSubscriptionFromCloud does) → activated
const statusActive = (await call(`/api/subscription/status?shop_id=${SHOP_ID}`)).data
check('shop sees membership_active', statusActive.status === 'membership_active' && statusActive.plan_type === 'yearly', statusActive)
check('yearly runs ~365 days', new Date(statusActive.membership_ends_at) - Date.now() > 360 * 86400000)

// 7. Keys: generate from panel, activate a second shop with one
const gen = await call('/api/admin/keys', { method: 'POST', body: { plan_type: 'lifetime', count: 2, note: 'smoke batch' }, admin: true })
check('2 lifetime keys generated', gen.data.keys?.length === 2 && gen.data.keys.every((k) => /^L[A-Z0-9]{3}(-[A-Z0-9]{4}){3}$/.test(k)), gen.data)
const [keyA, keyB] = gen.data.keys

const verifyA = (await call('/api/subscription/verify-license', { method: 'POST', body: { license_key: keyA, shop_id: 'shop-e2e-0002' } })).data
check('panel key activates lifetime', verifyA.valid === true && verifyA.plan_type === 'lifetime' && verifyA.expires_at === null, verifyA)
const reuseSame = (await call('/api/subscription/verify-license', { method: 'POST', body: { license_key: keyA, shop_id: 'shop-e2e-0002' } })).data
check('same shop can re-verify its key', reuseSame.valid === true)
const reuseOther = (await call('/api/subscription/verify-license', { method: 'POST', body: { license_key: keyA, shop_id: 'shop-e2e-0003' } })).data
check('other shop rejected for used key', reuseOther.valid === false)
check('garbage key rejected', (await call('/api/subscription/verify-license', { method: 'POST', body: { license_key: 'AAAA-AAAA-AAAA-AAAA', shop_id: SHOP_ID } })).data.valid === false)

const keyRows = (await call('/api/admin/keys', { admin: true })).data
const rowB = keyRows.find((k) => k.key_last4 === keyB.slice(-4) && k.status === 'unused')
check('unused key listed', !!rowB)
await call(`/api/admin/keys/${rowB.id}/revoke`, { method: 'POST', admin: true })
const verifyRevoked = (await call('/api/subscription/verify-license', { method: 'POST', body: { license_key: keyB, shop_id: 'shop-e2e-0004' } })).data
check('revoked key rejected', verifyRevoked.valid === false)

// 8. Shops list, detail, backup, manual subscription control
const shops = (await call('/api/admin/shops', { admin: true })).data
check('shops list has synced profile', shops.some((s) => s.id === SHOP_ID && s.city === 'Lahore' && s.status === 'membership_active'), shops)
const detail = (await call(`/api/admin/shops/${SHOP_ID}`, { admin: true })).data
check('shop detail: records + sync runs', detail.records.length === 3 && detail.sync_runs.length === 1, detail.records)
const backup = (await call(`/api/admin/shops/${SHOP_ID}/backup`, { admin: true })).data
check('backup exports pushed rows', backup.tables.products?.length === 2 && backup.tables.sales?.length === 1)

const suspend = await call(`/api/admin/shops/${SHOP_ID}/subscription`, { method: 'PUT', body: { plan_type: 'yearly', status: 'suspended' }, admin: true })
check('admin can suspend', suspend.data.status === 'suspended')
check('suspension visible to shop', (await call(`/api/subscription/status?shop_id=${SHOP_ID}`)).data.status === 'suspended')

// 9. Offline activation report: shop activated a panel key with NO internet, then
// reconnects and reports — key flips to used, panel shows the shop active.
const gen2 = await call('/api/admin/keys', { method: 'POST', body: { plan_type: 'yearly', count: 1, note: 'offline sale' }, admin: true })
const offlineKey = gen2.data.keys[0]
const { createHash } = await import('node:crypto')
const offlineHash = createHash('sha256').update(offlineKey).digest('hex')
const reportRes = await call('/api/subscription/report', {
  method: 'POST',
  body: {
    shop_id: 'shop-e2e-0006', shop_name: 'Offline Mart', phone: '0311-0001112',
    plan_type: 'yearly', status: 'membership_active',
    membership_started_at: new Date().toISOString(),
    membership_ends_at: new Date(Date.now() + 365 * 86400000).toISOString(),
    activation_method: 'license_key_offline',
    license_key_hash: offlineHash, license_key_last4: offlineKey.slice(-4),
    updated_at: new Date().toISOString(),
  },
})
check('offline activation report applied', reportRes.data.ok === true && reportRes.data.applied === true, reportRes.data)
const reportedKey = (await call('/api/admin/keys', { admin: true })).data.find((k) => k.key_last4 === offlineKey.slice(-4))
check('reported key marked used + bound', reportedKey?.status === 'used' && reportedKey?.used_by_shop_id === 'shop-e2e-0006', reportedKey)
const reportedShop = (await call('/api/admin/shops', { admin: true })).data.find((s) => s.id === 'shop-e2e-0006')
check('offline-activated shop visible as active', reportedShop?.status === 'membership_active', reportedShop)

// Stale report never overwrites a newer admin decision
const stale = await call('/api/subscription/report', {
  method: 'POST',
  body: {
    shop_id: SHOP_ID, plan_type: 'trial', status: 'trial_expired',
    updated_at: '2020-01-01T00:00:00.000Z',
  },
})
check('stale report ignored', stale.data.applied === false)
check('admin decision survives stale report', (await call(`/api/subscription/status?shop_id=${SHOP_ID}`)).data.status === 'suspended')

// 10. Reject flow on a fresh request
const req3 = await call('/api/subscription/request-activation', { method: 'POST', body: { shop_id: 'shop-e2e-0005', shop_name: 'New Mart', client_request_id: 'proof-x.png' } })
await call(`/api/admin/requests/${req3.data.request_id}/reject`, { method: 'POST', body: { note: 'no payment received' }, admin: true })
const rejected = (await call('/api/admin/requests?status=all', { admin: true })).data.find((r) => r.id === req3.data.request_id)
check('reject recorded with note', rejected?.status === 'rejected' && rejected?.note === 'no payment received', rejected)

server.close()
console.log(failures === 0 ? '--- ALL CHECKS PASSED ---' : `--- ${failures} FAILURES ---`)
process.exit(failures === 0 ? 0 : 1)
