import { useMemo, useState } from 'react'
import { api } from '../../lib/ipc'
import { formatMoney } from '../../lib/money'
import { useCurrency } from '../../stores/auth'
import { useDocContext, usePrinter } from '../../lib/export'
import type { ReturnReceipt, Sale, SaleItem } from '../../shared/types'
import { Button, Field, Input, Modal, Select } from '../../components/ui'
import { ExportBar } from '../../components/ExportBar'
import { toast } from '../../components/ui/toast'
import { returnSlipHtml } from '../returns/slip'

export function ReturnModal({
  sale,
  items,
  onClose,
  onDone,
}: {
  sale: Sale
  items: SaleItem[]
  onClose: () => void
  onDone: () => void
}) {
  const currency = useCurrency()
  const ctx = useDocContext()
  const { print } = usePrinter()
  const [qtys, setQtys] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')
  const [refundMethod, setRefundMethod] = useState<'cash' | 'due'>('cash')
  const [submitting, setSubmitting] = useState(false)
  // Money has left the drawer: what remains is a slip to hand over, not a form.
  const [receipt, setReceipt] = useState<ReturnReceipt | null>(null)

  const returnable = items.filter((i) => i.quantity > i.returned_quantity)

  const estimate = useMemo(() => {
    const itemTotalsSum = items.reduce((a, i) => a + i.total, 0)
    let refund = 0
    for (const i of returnable) {
      const q = qtys[i.id] ?? 0
      if (q > 0) refund += Math.round((i.total * q) / i.quantity)
    }
    if (itemTotalsSum > 0 && sale.total < itemTotalsSum) {
      refund = Math.round((refund * sale.total) / itemTotalsSum)
    }
    return refund
  }, [qtys, returnable, items, sale.total])

  // The refund is already recorded; a printer fault must not read as a failed
  // return, so it is reported as exactly what it is and the slip stays on
  // screen to be printed by hand.
  const autoPrint = async (r: ReturnReceipt) => {
    if (!ctx.settings.auto_print_on_save) return
    try {
      await print(returnSlipHtml(r, ctx), ctx.settings, { silent: true })
    } catch (e) {
      toast.error(`Slip not printed: ${(e as Error).message}. Print it from this window.`)
    }
  }

  const submit = async () => {
    const selected = returnable
      .filter((i) => (qtys[i.id] ?? 0) > 0)
      .map((i) => ({ sale_item_id: i.id, quantity: qtys[i.id] }))
    if (selected.length === 0) {
      toast.warning('Select at least one item to return')
      return
    }
    setSubmitting(true)
    try {
      const saved = await api<ReturnReceipt>('sales:return', {
        sale_id: sale.id,
        reason: reason.trim() || 'Customer return',
        refund_method: refundMethod,
        items: selected,
      })
      toast.success(`Return processed — refund ${formatMoney(saved.record.refund_amount, currency)}`)
      setReceipt(saved)
      void autoPrint(saved)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (receipt) {
    return (
      <Modal open onClose={onDone} title={`Return slip — ${receipt.record.invoice_number}`}>
        <div className="mb-4 rounded-md bg-amber-50 px-4 py-3">
          <div className="text-xs text-muted">
            {receipt.record.refund_method === 'cash' ? 'Cash refunded' : 'Credited to balance'}
          </div>
          <div className="mt-1 text-2xl font-bold">
            {formatMoney(receipt.record.refund_amount, currency)}
          </div>
        </div>
        <table className="mb-5 w-full text-left text-sm">
          <thead className="text-xs uppercase text-muted">
            <tr>
              <th className="py-1.5">Item</th>
              <th className="py-1.5 text-right">Qty</th>
              <th className="py-1.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {receipt.items.map((i) => (
              <tr key={i.id} className="border-t border-line">
                <td className="py-1.5">{i.product_name}</td>
                <td className="py-1.5 text-right">{i.quantity}</td>
                <td className="py-1.5 text-right">{formatMoney(i.amount, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t border-line pt-4">
          <ExportBar
            module="ReturnSlip"
            scope={receipt.record.invoice_number}
            buildHtml={(docCtx) => returnSlipHtml(receipt, docCtx)}
          />
          <Button onClick={onDone}>Done</Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open onClose={onClose} title={`Return — ${sale.invoice_number}`} wide>
      <table className="mb-4 w-full text-left">
        <thead className="text-xs uppercase text-muted">
          <tr>
            <th className="py-2">Item</th>
            <th className="py-2 text-right">Sold</th>
            <th className="py-2 text-right">Already returned</th>
            <th className="py-2 text-right">Return qty</th>
          </tr>
        </thead>
        <tbody>
          {returnable.map((i) => {
            const max = i.quantity - i.returned_quantity
            return (
              <tr key={i.id} className="border-t border-line">
                <td className="py-2 font-medium">{i.product_name}</td>
                <td className="py-2 text-right">{i.quantity}</td>
                <td className="py-2 text-right text-muted">{i.returned_quantity}</td>
                <td className="py-2 text-right">
                  <input
                    type="number"
                    min={0}
                    max={max}
                    value={qtys[i.id] ?? 0}
                    onChange={(e) =>
                      setQtys((prev) => ({
                        ...prev,
                        [i.id]: Math.min(max, Math.max(0, parseInt(e.target.value) || 0)),
                      }))
                    }
                    className="w-20 rounded-md border border-line px-2 py-1 text-right focus:border-primary focus:outline-none"
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="mb-4 grid grid-cols-2 gap-4">
        <Field label="Reason" required>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. damaged, wrong item" />
        </Field>
        <Field label="Refund method" required>
          <Select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value as 'cash' | 'due')}>
            <option value="cash">Cash refund</option>
            {sale.customer_id && <option value="due">Reduce customer due</option>}
          </Select>
        </Field>
      </div>

      <div className="mb-4 flex justify-between rounded-md bg-slate-50 px-4 py-3 font-semibold">
        <span>Estimated refund</span>
        <span>{formatMoney(estimate, currency)}</span>
      </div>

      <div className="flex justify-between">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={submit} loading={submitting} disabled={estimate === 0}>
          Process return
        </Button>
      </div>
    </Modal>
  )
}
