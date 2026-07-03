import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Eye, HandCoins } from 'lucide-react'
import { api } from '../../lib/ipc'
import { formatMoney } from '../../lib/money'
import { useCurrency, useSession } from '../../stores/auth'
import type { Customer } from '../../shared/types'
import { Badge, Button, Card, EmptyState, Input, PageTitle, Spinner } from '../../components/ui'
import { CustomerForm } from './CustomerForm'
import { CustomerDetailModal } from './CustomerDetailModal'
import { ReceivePaymentModal } from './ReceivePaymentModal'

export function CustomersPage() {
  const currency = useCurrency()
  const session = useSession()
  useQueryClient()
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [viewing, setViewing] = useState<Customer | null>(null)
  const [receiving, setReceiving] = useState<Customer | null>(null)

  const { data: customers, isLoading } = useQuery({
    queryKey: ['customers', search],
    queryFn: () => api<Customer[]>('customers:list', { search: search || undefined }),
  })

  return (
    <div>
      <PageTitle
        actions={
          <Button onClick={() => { setEditing(null); setFormOpen(true) }}>
            <Plus size={16} /> Add customer
          </Button>
        }
      >
        Customers
      </PageTitle>

      <Card className="mb-4 p-3">
        <Input
          placeholder="Search name or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </Card>

      <Card className="overflow-x-auto p-0">
        {isLoading ? (
          <Spinner />
        ) : !customers || customers.length === 0 ? (
          <EmptyState message="No customers yet." />
        ) : (
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3 text-right">Credit limit</th>
                <th className="px-4 py-3 text-right">Due balance</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="border-t border-line hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium">{c.name}</td>
                  <td className="px-4 py-2.5 text-muted">{c.phone ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right">
                    {c.credit_limit > 0 ? formatMoney(c.credit_limit, currency) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {c.due_balance > 0 ? (
                      <Badge tone="red">{formatMoney(c.due_balance, currency)}</Badge>
                    ) : c.due_balance < 0 ? (
                      <Badge tone="green">{formatMoney(-c.due_balance, currency)} credit</Badge>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      <button title="View" className="rounded p-1.5 text-muted hover:bg-slate-200" onClick={() => setViewing(c)}>
                        <Eye size={15} />
                      </button>
                      {c.due_balance > 0 && (
                        <button title="Receive payment" className="rounded p-1.5 text-success hover:bg-green-100" onClick={() => setReceiving(c)}>
                          <HandCoins size={15} />
                        </button>
                      )}
                      {session?.role === 'admin' && (
                        <button title="Edit" className="rounded p-1.5 text-muted hover:bg-slate-200" onClick={() => { setEditing(c); setFormOpen(true) }}>
                          <Pencil size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <CustomerForm open={formOpen} onClose={() => setFormOpen(false)} customer={editing} />
      {viewing && <CustomerDetailModal customer={viewing} onClose={() => setViewing(null)} />}
      {receiving && <ReceivePaymentModal customer={receiving} onClose={() => setReceiving(null)} />}
    </div>
  )
}
