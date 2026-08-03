import { useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { api } from '../../lib/ipc'
import { formatMoney, toPaisa, toRupees } from '../../lib/money'
import { useCurrency } from '../../stores/auth'
import type { ProductWithStock, Purchase, PurchaseItem, PurchaseOrder, Supplier } from '../../shared/types'
import { Button, Card, Field, Input, PageTitle, Select } from '../../components/ui'
import { toast } from '../../components/ui/toast'
import { useDocContext, usePrinter } from '../../lib/export'
import { purchaseInvoiceHtml } from './invoice'
import { useBatchTracking } from '../batches/useBatchSettings'

interface Line {
  product: ProductWithStock
  quantity: number
  cost: string // rupees, editable
  /** Only collected when the shop tracks batches; blank means unbatched stock. */
  batch_number: string
  expiry_date: string
}

export function NewPurchasePage() {
  const currency = useCurrency()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const ctx = useDocContext()
  const { print } = usePrinter()
  const batchTracking = useBatchTracking()
  const [supplierId, setSupplierId] = useState('')
  const [newSupplier, setNewSupplier] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [paid, setPaid] = useState('')
  const [method, setMethod] = useState<'cash' | 'card'>('cash')
  const [submitting, setSubmitting] = useState(false)
  // Only meaningful on a purchase order: it is the date asked of the supplier,
  // and it prints on the copy they receive.
  const [expectedDate, setExpectedDate] = useState('')

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers', ''],
    queryFn: () => api<Supplier[]>('suppliers:list'),
  })
  const { data: products } = useQuery({
    queryKey: ['products', productSearch, '', false],
    queryFn: () => api<ProductWithStock[]>('products:list', { search: productSearch || undefined }),
  })

  const addLine = (p: ProductWithStock) => {
    setLines((prev) => {
      if (prev.some((l) => l.product.id === p.id)) return prev
      return [
        ...prev,
        {
          product: p,
          quantity: 1,
          cost: String(toRupees(p.cost_price ?? 0)),
          batch_number: '',
          expiry_date: '',
        },
      ]
    })
    setProductSearch('')
  }

  const total = useMemo(
    () => lines.reduce((a, l) => a + (toPaisa(l.cost) || 0) * l.quantity, 0),
    [lines]
  )
  const paidPaisa = paid === '' ? 0 : toPaisa(paid) || 0

  const addSupplier = async () => {
    const name = newSupplier.trim()
    if (!name) return
    try {
      const s = await api<Supplier>('suppliers:create', { name, phone: null })
      void qc.invalidateQueries({ queryKey: ['suppliers'] })
      setSupplierId(s.id)
      setNewSupplier('')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const saveAsOrder = async () => {
    if (!supplierId) return toast.warning('Select a supplier')
    if (lines.length === 0) return toast.warning('Add at least one product')
    setSubmitting(true)
    try {
      const po = await api<PurchaseOrder>('purchaseOrders:create', {
        supplier_id: supplierId,
        expected_date: expectedDate || null,
        items: lines.map((l) => ({
          product_id: l.product.id,
          quantity: l.quantity,
          cost_price: toPaisa(l.cost) || 0,
        })),
      })
      toast.success(`Purchase order ${po.po_number} created — stock updates when you receive it`)
      void qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      navigate(`/purchases/orders/${po.id}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  // Same rule as the counter: print only if the shop asked for it, and say so
  // out loud when the printer refuses. The saved purchase is unaffected either
  // way — it can always be reprinted from its detail page.
  const autoPrint = async (id: string) => {
    if (!ctx.settings.auto_print_on_save) return
    try {
      const detail = await api<{ purchase: Purchase; items: PurchaseItem[] }>('purchases:get', { id })
      await print(purchaseInvoiceHtml(detail.purchase, detail.items, ctx), ctx.settings, { silent: true })
    } catch (e) {
      toast.error(`Invoice not printed: ${(e as Error).message}. Reprint it from the purchase.`)
    }
  }

  const submit = async () => {
    if (!supplierId) return toast.warning('Select a supplier')
    if (lines.length === 0) return toast.warning('Add at least one product')
    if (paidPaisa > total) return toast.warning('Paid amount exceeds total')
    setSubmitting(true)
    try {
      const purchase = await api<Purchase>('purchases:create', {
        supplier_id: supplierId,
        items: lines.map((l) => ({
          product_id: l.product.id,
          quantity: l.quantity,
          cost_price: toPaisa(l.cost) || 0,
          ...(batchTracking
            ? { batch_number: l.batch_number || null, expiry_date: l.expiry_date || null }
            : {}),
        })),
        paid_amount: paidPaisa,
        method,
      })
      toast.success(`Purchase ${purchase.invoice_number} saved — stock updated`)
      void qc.invalidateQueries({ queryKey: ['products'] })
      void qc.invalidateQueries({ queryKey: ['purchases'] })
      void qc.invalidateQueries({ queryKey: ['suppliers'] })
      await autoPrint(purchase.id)
      navigate(`/purchases/${purchase.id}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/purchases" className="mb-3 inline-flex items-center gap-1 text-muted hover:text-ink">
        <ArrowLeft size={15} /> Back to purchases
      </Link>
      <PageTitle>New purchase</PageTitle>

      <Card className="mb-4 grid grid-cols-2 gap-4">
        <Field label="Supplier" required>
          <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">— Select supplier —</option>
            {suppliers?.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Quick add supplier">
          <div className="flex gap-2">
            <Input value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} placeholder="Supplier name…" />
            <Button type="button" variant="secondary" size="sm" onClick={addSupplier} disabled={!newSupplier.trim()}>
              Add
            </Button>
          </div>
        </Field>
      </Card>

      <Card className="mb-4">
        <Field label="Add products">
          <Input
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            placeholder="Search product to add…"
          />
        </Field>
        {productSearch && (
          <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-line">
            {products?.slice(0, 8).map((p) => (
              <button
                key={p.id}
                onClick={() => addLine(p)}
                className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-50"
              >
                <span>{p.name}</span>
                <span className="flex items-center gap-2 text-xs text-muted">
                  stock {p.stock} <Plus size={14} className="text-primary" />
                </span>
              </button>
            ))}
            {products?.length === 0 && <div className="px-3 py-2 text-muted">No matches.</div>}
          </div>
        )}

        {lines.length > 0 && (
          <table className="mt-4 w-full text-left">
            <thead className="text-xs uppercase text-muted">
              <tr>
                <th className="py-2">Product</th>
                <th className="py-2 text-right">Qty</th>
                <th className="py-2 text-right">Unit cost ({currency})</th>
                {batchTracking && <th className="py-2">Batch</th>}
                {batchTracking && <th className="py-2">Expiry</th>}
                <th className="py-2 text-right">Line total</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.product.id} className="border-t border-line">
                  <td className="py-2 font-medium">{l.product.name}</td>
                  <td className="py-2 text-right">
                    <input
                      type="number" min={1} value={l.quantity}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((x) =>
                            x.product.id === l.product.id
                              ? { ...x, quantity: Math.max(1, parseInt(e.target.value) || 1) }
                              : x
                          )
                        )
                      }
                      className="w-20 rounded-md border border-line px-2 py-1 text-right focus:border-primary focus:outline-none"
                    />
                  </td>
                  <td className="py-2 text-right">
                    <input
                      type="number" step="0.01" min="0" value={l.cost}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((x) => (x.product.id === l.product.id ? { ...x, cost: e.target.value } : x))
                        )
                      }
                      className="w-28 rounded-md border border-line px-2 py-1 text-right focus:border-primary focus:outline-none"
                    />
                  </td>
                  {batchTracking && (
                    <td className="py-2">
                      <input
                        value={l.batch_number}
                        placeholder="optional"
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((x) =>
                              x.product.id === l.product.id ? { ...x, batch_number: e.target.value } : x
                            )
                          )
                        }
                        className="w-28 rounded-md border border-line px-2 py-1 focus:border-primary focus:outline-none"
                      />
                    </td>
                  )}
                  {batchTracking && (
                    <td className="py-2">
                      <input
                        type="date"
                        value={l.expiry_date}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((x) =>
                              x.product.id === l.product.id ? { ...x, expiry_date: e.target.value } : x
                            )
                          )
                        }
                        className="w-36 rounded-md border border-line px-2 py-1 focus:border-primary focus:outline-none"
                      />
                    </td>
                  )}
                  <td className="py-2 text-right font-medium">
                    {formatMoney((toPaisa(l.cost) || 0) * l.quantity, currency)}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => setLines((prev) => prev.filter((x) => x.product.id !== l.product.id))}
                      className="rounded p-1 text-muted hover:text-danger"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="ml-auto max-w-md space-y-4">
        <div className="flex justify-between text-lg font-bold">
          <span>Total</span>
          <span>{formatMoney(total, currency)}</span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Paid now" required>
            <Input type="number" step="0.01" min="0" value={paid} onChange={(e) => setPaid(e.target.value)}
              placeholder="0.00" className="text-right" />
          </Field>
          <Field label="Method">
            <Select value={method} onChange={(e) => setMethod(e.target.value as 'cash' | 'card')}>
              <option value="cash">Cash</option>
              <option value="card">Card / bank</option>
            </Select>
          </Field>
        </div>
        {total - paidPaisa > 0 && (
          <div className="flex justify-between rounded-md bg-amber-50 px-3 py-2 text-sm">
            <span className="text-muted">Added to supplier due</span>
            <span className="font-semibold text-warning">{formatMoney(total - paidPaisa, currency)}</span>
          </div>
        )}
        <Button size="lg" className="w-full" onClick={submit} loading={submitting} disabled={lines.length === 0 || !supplierId}>
          Save purchase
        </Button>
        <Field label="Expected delivery" hint="Prints on the purchase order sent to the supplier">
          <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
        </Field>
        <Button
          size="lg"
          variant="secondary"
          className="w-full"
          onClick={saveAsOrder}
          loading={submitting}
          disabled={lines.length === 0 || !supplierId}
          title="Create a purchase order — no stock or payment until it is received"
        >
          Save as purchase order
        </Button>
      </Card>
    </div>
  )
}
