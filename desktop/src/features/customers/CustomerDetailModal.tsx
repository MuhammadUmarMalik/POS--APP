import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../../lib/ipc'
import { formatMoney } from '../../lib/money'
import { formatDateTime } from '../../lib/utils'
import { useCurrency } from '../../stores/auth'
import type { Customer, Payment, Sale } from '../../shared/types'
import { Modal, Spinner, Badge } from '../../components/ui'
import { LedgerTable } from '../../components/LedgerTable'

export function CustomerDetailModal({
  customer,
  onClose,
}: {
  customer: Customer
  onClose: () => void
}) {
  const currency = useCurrency()
  const { data, isLoading } = useQuery({
    queryKey: ['customer-detail', customer.id],
    queryFn: () =>
      api<{ customer: Customer; sales: Sale[]; payments: Payment[] }>('customers:detail', {
        id: customer.id,
      }),
  })

  return (
    <Modal open onClose={onClose} title={customer.name} wide>
      {isLoading || !data ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          <div className="flex gap-6">
            <div>
              <div className="text-xs text-muted">Due balance</div>
              <div className={`text-xl font-bold ${data.customer.due_balance > 0 ? 'text-danger' : 'text-success'}`}>
                {formatMoney(data.customer.due_balance, currency)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">Credit limit</div>
              <div className="text-xl font-bold">
                {data.customer.credit_limit > 0 ? formatMoney(data.customer.credit_limit, currency) : 'Unlimited'}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">Phone</div>
              <div className="text-xl font-bold">{data.customer.phone ?? '—'}</div>
            </div>
          </div>

          <div>
            <h3 className="mb-2 font-semibold">Recent sales</h3>
            {data.sales.length === 0 ? (
              <p className="text-muted">No sales yet.</p>
            ) : (
              <table className="w-full text-left">
                <tbody>
                  {data.sales.slice(0, 10).map((s) => (
                    <tr key={s.id} className="border-t border-line">
                      <td className="py-2">
                        <Link to={`/sales/${s.id}`} onClick={onClose} className="text-primary hover:underline">
                          {s.invoice_number}
                        </Link>
                      </td>
                      <td className="py-2 text-muted">{formatDateTime(s.created_at)}</td>
                      <td className="py-2 capitalize"><Badge tone={s.payment_method === 'credit' ? 'amber' : 'slate'}>{s.payment_method}</Badge></td>
                      <td className="py-2 text-right font-medium">{formatMoney(s.total, currency)}</td>
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
            <LedgerTable channel="customers:ledger" partyId={customer.id} />
          </div>
        </div>
      )}
    </Modal>
  )
}
