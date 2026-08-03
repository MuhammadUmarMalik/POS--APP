import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Eye, HandCoins } from 'lucide-react'
import { api } from '../../lib/ipc'
import { formatMoney, toPaisa } from '../../lib/money'
import { useCurrency } from '../../stores/auth'
import type { Payment, Purchase, Supplier } from '../../shared/types'
import {
  Badge, Button, Card, EmptyState, Field, Input, Modal, PageTitle, Select, Spinner, Textarea,
} from '../../components/ui'
import { toast } from '../../components/ui/toast'
import { formatDateTime } from '../../lib/utils'
import { Link } from 'react-router-dom'
import { LedgerTable } from '../../components/LedgerTable'

export function SuppliersPage() {
  const currency = useCurrency()
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [viewing, setViewing] = useState<Supplier | null>(null)
  const [paying, setPaying] = useState<Supplier | null>(null)

  const { data: suppliers, isLoading } = useQuery({
    queryKey: ['suppliers', search],
    queryFn: () => api<Supplier[]>('suppliers:list', { search: search || undefined }),
  })

  return (
    <div>
      <PageTitle
        actions={
          <Button onClick={() => { setEditing(null); setFormOpen(true) }}>
            <Plus size={16} /> Add supplier
          </Button>
        }
      >
        Suppliers
      </PageTitle>

      <Card className="mb-4 p-3">
        <Input placeholder="Search name, phone or address…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
      </Card>

      <Card className="overflow-x-auto p-0">
        {isLoading ? (
          <Spinner />
        ) : !suppliers || suppliers.length === 0 ? (
          <EmptyState message="No suppliers yet." />
        ) : (
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Address</th>
                <th className="px-4 py-3 text-right">We owe</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id} className="border-t border-line hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium">{s.name}</td>
                  <td className="px-4 py-2.5 text-muted">{s.phone ?? '—'}</td>
                  <td className="max-w-56 truncate px-4 py-2.5 text-muted" title={s.address ?? undefined}>
                    {s.address ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {s.due_balance > 0 ? (
                      <Badge tone="amber">{formatMoney(s.due_balance, currency)}</Badge>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      <button title="View" className="rounded p-1.5 text-muted hover:bg-slate-200" onClick={() => setViewing(s)}>
                        <Eye size={15} />
                      </button>
                      {s.due_balance > 0 && (
                        <button title="Pay supplier" className="rounded p-1.5 text-success hover:bg-green-100" onClick={() => setPaying(s)}>
                          <HandCoins size={15} />
                        </button>
                      )}
                      <button title="Edit" className="rounded p-1.5 text-muted hover:bg-slate-200" onClick={() => { setEditing(s); setFormOpen(true) }}>
                        <Pencil size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <SupplierForm open={formOpen} onClose={() => setFormOpen(false)} supplier={editing} />
      {viewing && <SupplierDetailModal supplier={viewing} onClose={() => setViewing(null)} />}
      {paying && <PaySupplierModal supplier={paying} onClose={() => setPaying(null)} />}
    </div>
  )
}

function SupplierForm({
  open,
  onClose,
  supplier,
}: {
  open: boolean
  onClose: () => void
  supplier: Supplier | null
}) {
  const qc = useQueryClient()
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<{ name: string; phone: string; address: string; notes: string }>()

  useEffect(() => {
    if (open) {
      reset(
        supplier
          ? {
              name: supplier.name,
              phone: supplier.phone ?? '',
              address: supplier.address ?? '',
              notes: supplier.notes ?? '',
            }
          : { name: '', phone: '', address: '', notes: '' }
      )
    }
  }, [open, supplier, reset])

  const onSubmit = handleSubmit(async (v) => {
    const payload = {
      name: v.name,
      phone: v.phone || null,
      address: v.address.trim() || null,
      notes: v.notes.trim() || null,
    }
    try {
      if (supplier) {
        await api('suppliers:update', { id: supplier.id, ...payload })
        toast.success('Supplier updated')
      } else {
        await api('suppliers:create', payload)
        toast.success('Supplier added')
      }
      void qc.invalidateQueries({ queryKey: ['suppliers'] })
      void qc.invalidateQueries({ queryKey: ['supplier-detail'] })
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    }
  })

  return (
    <Modal open={open} onClose={onClose} title={supplier ? 'Edit supplier' : 'Add supplier'}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Name" required error={errors.name?.message}>
          <Input {...register('name', { required: 'Name is required' })} autoFocus />
        </Field>
        <Field label="Phone">
          <Input {...register('phone')} />
        </Field>
        <Field label="Address" hint="Where to send a return or a driver">
          <Textarea {...register('address')} rows={2} placeholder="Shop / street / city" />
        </Field>
        <Field label="Notes" hint="Delivery days, payment terms, the rep's name…">
          <Textarea {...register('notes')} rows={3} placeholder="Anything worth remembering" />
        </Field>
        <div className="flex justify-between pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={isSubmitting}>{supplier ? 'Save' : 'Add supplier'}</Button>
        </div>
      </form>
    </Modal>
  )
}

function SupplierDetailModal({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const currency = useCurrency()
  const { data, isLoading } = useQuery({
    queryKey: ['supplier-detail', supplier.id],
    queryFn: () =>
      api<{ supplier: Supplier; purchases: Purchase[]; payments: Payment[] }>('suppliers:detail', { id: supplier.id }),
  })

  return (
    <Modal open onClose={onClose} title={supplier.name} wide>
      {isLoading || !data ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          <div>
            <div className="text-xs text-muted">Outstanding balance (we owe)</div>
            <div className={`text-xl font-bold ${data.supplier.due_balance > 0 ? 'text-warning' : 'text-success'}`}>
              {formatMoney(data.supplier.due_balance, currency)}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 rounded-md bg-slate-50 px-4 py-3 text-sm">
            <div>
              <div className="text-xs uppercase text-muted">Phone</div>
              <div>{data.supplier.phone || '—'}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted">Address</div>
              {/* Kept as typed, line breaks and all — an address is not one line. */}
              <div className="whitespace-pre-wrap">{data.supplier.address || '—'}</div>
            </div>
            <div className="col-span-2">
              <div className="text-xs uppercase text-muted">Notes</div>
              <div className="whitespace-pre-wrap">{data.supplier.notes || '—'}</div>
            </div>
          </div>

          <div>
            <h3 className="mb-2 font-semibold">Recent purchases</h3>
            {data.purchases.length === 0 ? (
              <p className="text-muted">No purchases yet.</p>
            ) : (
              <table className="w-full text-left">
                <tbody>
                  {data.purchases.slice(0, 10).map((p) => (
                    <tr key={p.id} className="border-t border-line">
                      <td className="py-2">
                        <Link to={`/purchases/${p.id}`} onClick={onClose} className="text-primary hover:underline">
                          {p.invoice_number}
                        </Link>
                      </td>
                      <td className="py-2 text-muted">{formatDateTime(p.created_at)}</td>
                      <td className="py-2 text-right font-medium">{formatMoney(p.total, currency)}</td>
                      <td className="py-2 text-right text-muted">paid {formatMoney(p.paid_amount, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div>
            <h3 className="mb-2 font-semibold">Payments</h3>
            {data.payments.length === 0 ? (
              <p className="text-muted">No payments recorded.</p>
            ) : (
              <table className="w-full text-left">
                <tbody>
                  {data.payments.slice(0, 10).map((p) => (
                    <tr key={p.id} className="border-t border-line">
                      <td className="py-2 text-muted">{formatDateTime(p.created_at)}</td>
                      <td className="py-2 capitalize">{p.reference_type.replace('_', ' ')}</td>
                      <td className="py-2 capitalize text-muted">{p.method}</td>
                      <td className="py-2 text-right font-medium">{formatMoney(p.amount, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div>
            <h3 className="mb-2 font-semibold">Ledger</h3>
            <LedgerTable channel="suppliers:ledger" partyId={supplier.id} />
          </div>
        </div>
      )}
    </Modal>
  )
}

function PaySupplierModal({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const currency = useCurrency()
  const qc = useQueryClient()
  const [amount, setAmount] = useState(String(supplier.due_balance / 100))
  const [method, setMethod] = useState<'cash' | 'card'>('cash')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const amountPaisa = toPaisa(amount) || 0

  const submit = async () => {
    if (amountPaisa <= 0) return toast.warning('Enter a valid amount')
    setSubmitting(true)
    try {
      await api('suppliers:pay', {
        party_id: supplier.id,
        amount: amountPaisa,
        method,
        note: note.trim() || undefined,
      })
      toast.success(`Paid ${formatMoney(amountPaisa, currency)} to ${supplier.name}`)
      void qc.invalidateQueries({ queryKey: ['suppliers'] })
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Pay supplier — ${supplier.name}`}>
      <div className="mb-4 flex justify-between rounded-md bg-amber-50 px-4 py-3">
        <span className="text-muted">We owe</span>
        <span className="font-bold text-warning">{formatMoney(supplier.due_balance, currency)}</span>
      </div>
      <div className="space-y-4">
        <Field label="Amount" required>
          <Input type="number" step="0.01" min="0" autoFocus value={amount}
            onChange={(e) => setAmount(e.target.value)} className="text-right text-lg font-semibold" />
        </Field>
        <Field label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value as 'cash' | 'card')}>
            <option value="cash">Cash</option>
            <option value="card">Card / bank</option>
          </Select>
        </Field>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>
        <div className="flex justify-between pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="success" onClick={submit} loading={submitting}>Pay</Button>
        </div>
      </div>
    </Modal>
  )
}
