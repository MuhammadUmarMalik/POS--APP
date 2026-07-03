import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Banknote, CreditCard, UserRound } from 'lucide-react'
import { api } from '../../lib/ipc'
import { formatMoney, toPaisa } from '../../lib/money'
import { useCurrency, useSession } from '../../stores/auth'
import type { Customer, PaymentMethod, Sale } from '../../shared/types'
import { Button, Field, Input, Modal, Select } from '../../components/ui'
import { toast } from '../../components/ui/toast'
import type { CartLine } from './PosPage'

export function PaymentModal({
  open,
  onClose,
  cart,
  billDiscount,
  total,
  onCompleted,
}: {
  open: boolean
  onClose: () => void
  cart: CartLine[]
  billDiscount: number
  total: number
  onCompleted: (sale: Sale) => void
}) {
  const currency = useCurrency()
  const session = useSession()
  const qc = useQueryClient()
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [tendered, setTendered] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [newCustomerName, setNewCustomerName] = useState('')
  const [allowNegative, setAllowNegative] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const { data: customers } = useQuery({
    queryKey: ['customers', ''],
    queryFn: () => api<Customer[]>('customers:list'),
    enabled: open,
  })

  useEffect(() => {
    if (open) {
      setMethod('cash')
      setTendered('')
      setCustomerId('')
      setNewCustomerName('')
      setAllowNegative(false)
    }
  }, [open])

  const tenderedPaisa = tendered === '' ? 0 : toPaisa(tendered) || 0
  const change = tenderedPaisa - total
  const canConfirm =
    cart.length > 0 &&
    (method === 'cash' ? tenderedPaisa >= total : true) &&
    (method === 'credit' ? !!customerId : true)

  const quickAmounts = useMemo(() => {
    const rupees = Math.ceil(total / 100)
    const round = (n: number) => Math.ceil(rupees / n) * n
    return Array.from(new Set([rupees, round(50), round(100), round(500), round(1000)])).slice(0, 4)
  }, [total])

  const addQuickCustomer = async () => {
    const name = newCustomerName.trim()
    if (!name) return
    try {
      const c = await api<Customer>('customers:create', { name, phone: null, credit_limit: 0 })
      void qc.invalidateQueries({ queryKey: ['customers'] })
      setCustomerId(c.id)
      setNewCustomerName('')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const confirm = async () => {
    setSubmitting(true)
    try {
      const sale = await api<Sale>('sales:checkout', {
        items: cart.map((l) => ({
          product_id: l.product.id,
          quantity: l.quantity,
          unit_price: l.product.sale_price,
          discount: l.discount,
        })),
        bill_discount: billDiscount,
        payment_method: method,
        customer_id: customerId || null,
        tendered: method === 'cash' ? tenderedPaisa : null,
        allow_negative_stock: allowNegative,
      })
      onCompleted(sale)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  // Enter confirms when valid
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && canConfirm && !submitting) {
        e.preventDefault()
        void confirm()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, canConfirm, submitting, method, tenderedPaisa, customerId, allowNegative])

  return (
    <Modal open={open} onClose={onClose} title="Payment">
      <div className="mb-4 rounded-lg bg-slate-50 p-4 text-center">
        <div className="text-xs uppercase tracking-wide text-muted">Amount due</div>
        <div className="text-3xl font-bold">{formatMoney(total, currency)}</div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2">
        {(
          [
            { m: 'cash' as const, label: 'Cash', icon: Banknote },
            { m: 'card' as const, label: 'Card', icon: CreditCard },
            { m: 'credit' as const, label: 'Credit', icon: UserRound },
          ]
        ).map(({ m, label, icon: Icon }) => (
          <button
            key={m}
            onClick={() => setMethod(m)}
            className={
              method === m
                ? 'flex flex-col items-center gap-1 rounded-lg border-2 border-primary bg-blue-50 p-3 font-medium text-primary'
                : 'flex flex-col items-center gap-1 rounded-lg border border-line p-3 text-muted hover:border-primary/50'
            }
          >
            <Icon size={20} />
            {label}
          </button>
        ))}
      </div>

      {method === 'cash' && (
        <div className="mb-4 space-y-3">
          <Field label="Cash received" required>
            <Input
              type="number" step="0.01" min="0" autoFocus
              value={tendered}
              onChange={(e) => setTendered(e.target.value)}
              className="text-right text-lg font-semibold"
            />
          </Field>
          <div className="flex gap-2">
            {quickAmounts.map((r) => (
              <button
                key={r}
                onClick={() => setTendered(String(r))}
                className="flex-1 rounded-md border border-line py-1.5 text-xs font-medium hover:border-primary hover:text-primary"
              >
                {currency} {r.toLocaleString('en-IN')}
              </button>
            ))}
          </div>
          {tenderedPaisa >= total && (
            <div className="flex justify-between rounded-md bg-green-50 px-3 py-2 font-semibold text-success">
              <span>Change</span>
              <span>{formatMoney(change, currency)}</span>
            </div>
          )}
        </div>
      )}

      {(method === 'credit' || method === 'card') && (
        <div className="mb-4 space-y-3">
          <Field label={method === 'credit' ? 'Customer (required)' : 'Customer (optional)'} required={method === 'credit'}>
            <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)} autoFocus={method === 'credit'}>
              <option value="">— Select customer —</option>
              {customers?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.due_balance > 0 ? ` (due ${formatMoney(c.due_balance, currency)})` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex gap-2">
            <Input
              placeholder="Quick add: customer name…"
              value={newCustomerName}
              onChange={(e) => setNewCustomerName(e.target.value)}
            />
            <Button type="button" variant="secondary" size="sm" onClick={addQuickCustomer} disabled={!newCustomerName.trim()}>
              Add
            </Button>
          </div>
        </div>
      )}

      {session?.role === 'admin' && (
        <label className="mb-4 flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={allowNegative}
            onChange={(e) => setAllowNegative(e.target.checked)}
          />
          Allow selling below zero stock (admin override)
        </label>
      )}

      <div className="flex justify-between">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="success" size="lg" disabled={!canConfirm} loading={submitting} onClick={confirm}>
          Complete sale
        </Button>
      </div>
    </Modal>
  )
}
