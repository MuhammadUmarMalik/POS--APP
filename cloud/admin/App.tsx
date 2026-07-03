import { useCallback, useEffect, useState } from 'react'
import { api, setToken, clearToken, hasToken, fetchProofBlob, downloadBackup } from './api'

// ---- shared bits ---------------------------------------------------------------

type Plan = 'monthly' | 'yearly' | 'lifetime'

const STATUS_LABEL: Record<string, string> = {
  trial_active: 'Trial Active', trial_expired: 'Trial Expired',
  membership_active: 'Membership Active', membership_expired: 'Membership Expired',
  lifetime_active: 'Lifetime Active', suspended: 'Suspended',
  pending_verification: 'Pending Verification',
}
const STATUS_CLASS: Record<string, string> = {
  trial_active: 'bg-blue-100 text-blue-800', trial_expired: 'bg-red-100 text-red-800',
  membership_active: 'bg-green-100 text-green-800', membership_expired: 'bg-red-100 text-red-800',
  lifetime_active: 'bg-green-100 text-green-800', suspended: 'bg-red-100 text-red-800',
  pending_verification: 'bg-amber-100 text-amber-800',
}

function Badge({ status }: { status: string | null }) {
  if (!status) return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">No data</span>
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—')
const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString() : '—')

function useToast() {
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null)
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), 3500)
    return () => clearTimeout(t)
  }, [msg])
  const toast = (text: string, err = false) => setMsg({ text, err })
  const node = msg ? (
    <div className={`fixed bottom-5 right-5 z-50 rounded-lg px-4 py-2.5 text-sm text-white shadow-lg ${msg.err ? 'bg-red-600' : 'bg-slate-900'}`}>
      {msg.text}
    </div>
  ) : null
  return { toast, node }
}

// ---- login -----------------------------------------------------------------------

function Login({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await api<{ token: string }>('/api/admin/login', { method: 'POST', body: { username, password } })
      setToken(res.token)
      onDone()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <form onSubmit={submit} className="w-80 rounded-xl bg-white p-6 shadow">
        <h1 className="mb-1 text-xl font-bold">POS Admin</h1>
        <p className="mb-5 text-sm text-slate-500">Manage shops, memberships and keys</p>
        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium">Username</span>
          <input className="w-full rounded-md border border-slate-300 px-3 py-2" value={username}
            onChange={(e) => setUsername(e.target.value)} autoFocus />
        </label>
        <label className="mb-4 block text-sm">
          <span className="mb-1 block font-medium">Password</span>
          <input type="password" className="w-full rounded-md border border-slate-300 px-3 py-2" value={password}
            onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        <button disabled={busy} className="w-full rounded-md bg-slate-900 py-2 font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

// ---- activation requests -----------------------------------------------------------

interface ActivationRequest {
  id: string; shop_id: string; shop_name: string; phone: string | null
  requested_plan: string | null; reference: string | null; proof_path: string | null
  status: string; note: string | null; created_at: string; decided_at: string | null
}

function RequestsView({ toast, onChanged }: { toast: (m: string, e?: boolean) => void; onChanged: () => void }) {
  const [rows, setRows] = useState<ActivationRequest[] | null>(null)
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')
  const [proof, setProof] = useState<string | null>(null)
  const [planFor, setPlanFor] = useState<Record<string, Plan>>({})

  const load = useCallback(() => {
    api<ActivationRequest[]>(`/api/admin/requests?status=${filter}`).then(setRows).catch((e) => toast(e.message, true))
  }, [filter, toast])
  useEffect(load, [load])

  const approve = async (r: ActivationRequest) => {
    const plan = planFor[r.id] ?? (r.requested_plan as Plan) ?? 'monthly'
    try {
      await api(`/api/admin/requests/${r.id}/approve`, { method: 'POST', body: { plan_type: plan } })
      toast(`${r.shop_name || r.shop_id} activated — ${plan}`)
      load(); onChanged()
    } catch (e) { toast((e as Error).message, true) }
  }

  const reject = async (r: ActivationRequest) => {
    const note = window.prompt('Reason (sent nowhere, kept for your records):') ?? undefined
    try {
      await api(`/api/admin/requests/${r.id}/reject`, { method: 'POST', body: { note } })
      toast('Request rejected')
      load(); onChanged()
    } catch (e) { toast((e as Error).message, true) }
  }

  const showProof = async (r: ActivationRequest) => {
    try { setProof(await fetchProofBlob(r.id)) } catch (e) { toast((e as Error).message, true) }
  }

  if (!rows) return <p className="p-6 text-slate-500">Loading…</p>

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        {(['pending', 'all'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize ${filter === f ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-200'}`}>
            {f}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="rounded-xl bg-white p-10 text-center text-slate-500 shadow-sm">
          No {filter === 'pending' ? 'pending ' : ''}activation requests.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="rounded-xl bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">{r.shop_name || r.shop_id}</div>
                  <div className="text-xs text-slate-500">
                    {r.phone ?? 'no phone'} · {fmt(r.created_at)}
                    {r.reference && <> · Ref: <span className="font-mono">{r.reference}</span></>}
                    {r.requested_plan && <> · wants <b>{r.requested_plan}</b></>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {r.proof_path && (
                    <button onClick={() => showProof(r)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
                      View payment proof
                    </button>
                  )}
                  {r.status === 'pending' ? (
                    <>
                      <select className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                        value={planFor[r.id] ?? r.requested_plan ?? 'monthly'}
                        onChange={(e) => setPlanFor({ ...planFor, [r.id]: e.target.value as Plan })}>
                        <option value="monthly">Monthly (30 days)</option>
                        <option value="yearly">Yearly (365 days)</option>
                        <option value="lifetime">Lifetime</option>
                      </select>
                      <button onClick={() => approve(r)} className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700">
                        Approve & activate
                      </button>
                      <button onClick={() => reject(r)} className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">
                        Reject
                      </button>
                    </>
                  ) : (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.status === 'approved' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {r.status} {r.decided_at && `· ${fmtDate(r.decided_at)}`}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {proof && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-8" onClick={() => setProof(null)}>
          <img src={proof} alt="Payment proof" className="max-h-full max-w-full rounded-lg bg-white p-1" />
        </div>
      )}
    </div>
  )
}

// ---- shops -----------------------------------------------------------------------

interface ShopRow {
  id: string; name: string; owner_name: string | null; phone: string | null; city: string | null
  business_type: string | null; created_at: string; last_seen_at: string | null; last_sync_at: string | null
  plan_type: string | null; status: string | null; membership_ends_at: string | null; pending_requests: number
}

interface ShopDetail {
  shop: ShopRow & { email: string | null; address: string | null; currency: string | null }
  subscription: {
    plan_type: string; status: string; membership_started_at: string | null
    membership_ends_at: string | null; license_key_last4: string | null
    activation_method: string | null; payment_reference: string | null; updated_at: string
  } | null
  requests: ActivationRequest[]
  sync_runs: { id: string; pushed_records: number; created_at: string }[]
  records: { table_name: string; count: number }[]
}

function ShopDrawer({ shopId, toast, onClose, onChanged }: {
  shopId: string; toast: (m: string, e?: boolean) => void; onClose: () => void; onChanged: () => void
}) {
  const [detail, setDetail] = useState<ShopDetail | null>(null)
  const [grantPlan, setGrantPlan] = useState<Plan>('monthly')

  const load = useCallback(() => {
    api<ShopDetail>(`/api/admin/shops/${shopId}`).then(setDetail).catch((e) => toast(e.message, true))
  }, [shopId, toast])
  useEffect(load, [load])

  const setSub = async (patch: { plan_type: string; status: string; membership_started_at?: string | null; membership_ends_at?: string | null }) => {
    try {
      await api(`/api/admin/shops/${shopId}/subscription`, { method: 'PUT', body: patch })
      toast('Subscription updated')
      load(); onChanged()
    } catch (e) { toast((e as Error).message, true) }
  }

  const grant = () => {
    const started = new Date().toISOString()
    const ends = grantPlan === 'lifetime' ? null
      : new Date(Date.now() + (grantPlan === 'yearly' ? 365 : 30) * 86_400_000).toISOString()
    void setSub({
      plan_type: grantPlan,
      status: grantPlan === 'lifetime' ? 'lifetime_active' : 'membership_active',
      membership_started_at: started, membership_ends_at: ends,
    })
  }

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/40" onClick={onClose}>
      <div className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {!detail ? <p className="text-slate-500">Loading…</p> : (
          <>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold">{detail.shop.name || detail.shop.id}</h2>
                <p className="text-sm text-slate-500">
                  {[detail.shop.owner_name, detail.shop.phone, detail.shop.city, detail.shop.business_type].filter(Boolean).join(' · ') || 'No profile synced yet'}
                </p>
              </div>
              <button onClick={onClose} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100">✕</button>
            </div>

            <section className="mb-5 rounded-lg border border-slate-200 p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-semibold">Membership</h3>
                <Badge status={detail.subscription?.status ?? null} />
              </div>
              {detail.subscription ? (
                <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <dt className="text-slate-500">Plan</dt><dd className="capitalize">{detail.subscription.plan_type}</dd>
                  <dt className="text-slate-500">Started</dt><dd>{fmtDate(detail.subscription.membership_started_at)}</dd>
                  <dt className="text-slate-500">Ends</dt>
                  <dd>{detail.subscription.plan_type === 'lifetime' && detail.subscription.membership_started_at ? 'Never' : fmtDate(detail.subscription.membership_ends_at)}</dd>
                  <dt className="text-slate-500">Key</dt><dd>{detail.subscription.license_key_last4 ? `••••-${detail.subscription.license_key_last4}` : '—'}</dd>
                  <dt className="text-slate-500">Method</dt><dd>{detail.subscription.activation_method ?? '—'}</dd>
                  <dt className="text-slate-500">Payment ref</dt><dd>{detail.subscription.payment_reference ?? '—'}</dd>
                </dl>
              ) : (
                <p className="mb-3 text-sm text-slate-500">This shop has not reported a subscription yet.</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <select className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={grantPlan}
                  onChange={(e) => setGrantPlan(e.target.value as Plan)}>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                  <option value="lifetime">Lifetime</option>
                </select>
                <button onClick={grant} className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700">
                  Grant membership
                </button>
                {detail.subscription?.status !== 'suspended' ? (
                  <button onClick={() => void setSub({ plan_type: detail.subscription?.plan_type ?? 'trial', status: 'suspended' })}
                    className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">
                    Suspend
                  </button>
                ) : (
                  <button onClick={() => void setSub({ plan_type: 'trial', status: 'trial_expired' })}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
                    Unsuspend (as expired)
                  </button>
                )}
                <button onClick={() => downloadBackup(detail.shop.id, detail.shop.name).catch((e) => toast(e.message, true))}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
                  Download backup
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Changes reach the shop when it next syncs or checks its activation status.
              </p>
            </section>

            <section className="mb-5 rounded-lg border border-slate-200 p-4">
              <h3 className="mb-2 font-semibold">Cloud backup</h3>
              {detail.records.length === 0 ? (
                <p className="text-sm text-slate-500">This shop has never synced.</p>
              ) : (
                <p className="text-sm text-slate-600">
                  {detail.records.reduce((a, r) => a + r.count, 0)} records —{' '}
                  {detail.records.map((r) => `${r.table_name}: ${r.count}`).join(', ')}
                </p>
              )}
            </section>

            <section className="rounded-lg border border-slate-200 p-4">
              <h3 className="mb-2 font-semibold">Recent syncs</h3>
              {detail.sync_runs.length === 0 ? (
                <p className="text-sm text-slate-500">No syncs yet.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {detail.sync_runs.map((s) => (
                    <li key={s.id} className="flex justify-between border-b border-slate-100 py-1 last:border-b-0">
                      <span>{fmt(s.created_at)}</span>
                      <span className="text-slate-500">{s.pushed_records} records</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function ShopsView({ toast, refreshKey, onChanged }: { toast: (m: string, e?: boolean) => void; refreshKey: number; onChanged: () => void }) {
  const [rows, setRows] = useState<ShopRow[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    api<ShopRow[]>('/api/admin/shops').then(setRows).catch((e) => toast(e.message, true))
  }, [toast, refreshKey])

  if (!rows) return <p className="p-6 text-slate-500">Loading…</p>
  const filtered = rows.filter((r) =>
    `${r.name} ${r.phone ?? ''} ${r.city ?? ''}`.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <input placeholder="Search by name, phone, city…" value={search} onChange={(e) => setSearch(e.target.value)}
        className="mb-4 w-72 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" />
      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Shop</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Expires</th>
              <th className="px-4 py-3">Last sync</th>
              <th className="px-4 py-3 text-right">Requests</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => setOpen(r.id)}>
                <td className="px-4 py-2.5">
                  <div className="font-medium">{r.name || r.id}</div>
                  <div className="text-xs text-slate-500">{[r.phone, r.city].filter(Boolean).join(' · ')}</div>
                </td>
                <td className="px-4 py-2.5 capitalize">{r.plan_type ?? '—'}</td>
                <td className="px-4 py-2.5"><Badge status={r.status} /></td>
                <td className="px-4 py-2.5">{r.plan_type === 'lifetime' ? 'Never' : fmtDate(r.membership_ends_at)}</td>
                <td className="px-4 py-2.5">{fmt(r.last_sync_at)}</td>
                <td className="px-4 py-2.5 text-right">
                  {r.pending_requests > 0 && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      {r.pending_requests} pending
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                No shops yet. Shops appear here after their first sync or activation request.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      {open && <ShopDrawer shopId={open} toast={toast} onClose={() => setOpen(null)} onChanged={onChanged} />}
    </div>
  )
}

// ---- license keys -------------------------------------------------------------------

interface KeyRow {
  id: string; key_last4: string; plan_type: string; status: string; note: string | null
  created_at: string; used_at: string | null; used_by_shop_id: string | null; used_by_shop_name: string | null
}

function KeysView({ toast }: { toast: (m: string, e?: boolean) => void }) {
  const [rows, setRows] = useState<KeyRow[] | null>(null)
  const [plan, setPlan] = useState<Plan>('monthly')
  const [count, setCount] = useState(1)
  const [note, setNote] = useState('')
  const [fresh, setFresh] = useState<string[]>([])

  const load = useCallback(() => {
    api<KeyRow[]>('/api/admin/keys').then(setRows).catch((e) => toast(e.message, true))
  }, [toast])
  useEffect(load, [load])

  const generate = async () => {
    try {
      const res = await api<{ keys: string[] }>('/api/admin/keys', {
        method: 'POST', body: { plan_type: plan, count, note: note || null },
      })
      setFresh(res.keys)
      load()
    } catch (e) { toast((e as Error).message, true) }
  }

  const revoke = async (k: KeyRow) => {
    if (!window.confirm(`Revoke key ••••-${k.key_last4}? It will stop validating online.`)) return
    try {
      await api(`/api/admin/keys/${k.id}/revoke`, { method: 'POST' })
      toast('Key revoked')
      load()
    } catch (e) { toast((e as Error).message, true) }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 shadow-sm">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Plan</span>
          <select className="rounded-md border border-slate-300 px-2 py-1.5" value={plan} onChange={(e) => setPlan(e.target.value as Plan)}>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
            <option value="lifetime">Lifetime</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">How many</span>
          <input type="number" min={1} max={50} className="w-20 rounded-md border border-slate-300 px-2 py-1.5"
            value={count} onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
        </label>
        <label className="flex-1 text-sm">
          <span className="mb-1 block font-medium">Note (optional)</span>
          <input className="w-full rounded-md border border-slate-300 px-2 py-1.5" placeholder="e.g. sold to Ali — JazzCash 8839021"
            value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button onClick={generate} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
          Generate
        </button>
      </div>

      {fresh.length > 0 && (
        <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-green-900">
              New keys — copy them now, they are shown only once:
            </p>
            <button onClick={() => { navigator.clipboard.writeText(fresh.join('\n')); }}
              className="rounded-md border border-green-300 px-2 py-1 text-xs text-green-800 hover:bg-green-100">
              Copy all
            </button>
          </div>
          <div className="space-y-1 font-mono text-sm">
            {fresh.map((k) => <div key={k}>{k}</div>)}
          </div>
        </div>
      )}

      {!rows ? <p className="p-6 text-slate-500">Loading…</p> : (
        <div className="overflow-hidden rounded-xl bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Key</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Used by</th>
                <th className="px-4 py-3">Note</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((k) => (
                <tr key={k.id} className="border-t border-slate-100">
                  <td className="px-4 py-2.5 font-mono">••••-••••-••••-{k.key_last4}</td>
                  <td className="px-4 py-2.5 capitalize">{k.plan_type}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      k.status === 'unused' ? 'bg-blue-100 text-blue-800'
                        : k.status === 'used' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {k.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">{k.used_by_shop_name ?? (k.used_by_shop_id ? k.used_by_shop_id.slice(0, 8) : '—')}</td>
                  <td className="max-w-48 truncate px-4 py-2.5 text-slate-500" title={k.note ?? ''}>{k.note ?? '—'}</td>
                  <td className="px-4 py-2.5">{fmtDate(k.created_at)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {k.status !== 'revoked' && (
                      <button onClick={() => revoke(k)} className="text-xs text-red-600 hover:underline">Revoke</button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">No keys issued yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---- shell ------------------------------------------------------------------------

interface Overview { shops: number; pending_requests: number; active: number; trials: number; expired: number }

export function App() {
  const [authed, setAuthed] = useState(hasToken())
  const [tab, setTab] = useState<'requests' | 'shops' | 'keys'>('requests')
  const [overview, setOverview] = useState<Overview | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const { toast, node: toastNode } = useToast()

  const refreshOverview = useCallback(() => {
    if (!hasToken()) return
    api<Overview>('/api/admin/overview').then(setOverview).catch(() => setAuthed(hasToken()))
  }, [])
  useEffect(() => {
    refreshOverview()
    const t = setInterval(refreshOverview, 30_000)
    return () => clearInterval(t)
  }, [refreshOverview, authed, refreshKey])

  if (!authed) return <Login onDone={() => setAuthed(true)} />

  const onChanged = () => { setRefreshKey((k) => k + 1); refreshOverview() }

  const stat = (label: string, value: number | undefined, accent = '') => (
    <div className="rounded-xl bg-white px-4 py-3 shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-xl font-bold ${accent}`}>{value ?? '—'}</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <span className="text-lg font-bold">POS Admin</span>
            <nav className="flex gap-1">
              {([
                ['requests', `Activation Requests${overview?.pending_requests ? ` (${overview.pending_requests})` : ''}`],
                ['shops', 'Shops'],
                ['keys', 'License Keys'],
              ] as const).map(([id, label]) => (
                <button key={id} onClick={() => setTab(id)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                  {label}
                </button>
              ))}
            </nav>
          </div>
          <button onClick={() => { clearToken(); setAuthed(false) }} className="text-sm text-slate-500 hover:text-slate-900">
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {stat('Shops', overview?.shops)}
          {stat('Pending requests', overview?.pending_requests, overview?.pending_requests ? 'text-amber-600' : '')}
          {stat('Active members', overview?.active, 'text-green-700')}
          {stat('On trial', overview?.trials)}
          {stat('Expired / suspended', overview?.expired, overview?.expired ? 'text-red-600' : '')}
        </div>
        {tab === 'requests' && <RequestsView toast={toast} onChanged={onChanged} />}
        {tab === 'shops' && <ShopsView toast={toast} refreshKey={refreshKey} onChanged={onChanged} />}
        {tab === 'keys' && <KeysView toast={toast} />}
      </main>
      {toastNode}
    </div>
  )
}
