import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { api } from '../../lib/ipc'
import { formatMoney, toPaisa, toRupees } from '../../lib/money'
import { useCurrency } from '../../stores/auth'
import type { Expense, ExpenseCategory } from '../../shared/types'
import {
  Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, PageTitle, Select, Spinner,
} from '../../components/ui'
import { toast } from '../../components/ui/toast'

function monthRange(month: string): { from: string; to: string } {
  // month = 'YYYY-MM'; expense dates are plain YYYY-MM-DD strings
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

export function ExpensesPage() {
  const currency = useCurrency()
  const qc = useQueryClient()
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [categoryId, setCategoryId] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [deleting, setDeleting] = useState<Expense | null>(null)

  const range = useMemo(() => monthRange(month), [month])

  const { data, isLoading } = useQuery({
    queryKey: ['expenses', month, categoryId],
    queryFn: () =>
      api<{ rows: Expense[]; total: number }>('expenses:list', {
        from: range.from,
        to: range.to,
        category_id: categoryId || undefined,
      }),
  })
  const { data: categories } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => api<ExpenseCategory[]>('expenseCategories:list'),
  })

  const del = useMutation({
    mutationFn: (id: string) => api('expenses:delete', { id }),
    onSuccess: () => {
      toast.success('Expense deleted')
      setDeleting(null)
      void qc.invalidateQueries({ queryKey: ['expenses'] })
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <div>
      <PageTitle
        actions={
          <Button onClick={() => { setEditing(null); setFormOpen(true) }}>
            <Plus size={16} /> Add expense
          </Button>
        }
      >
        Expenses
      </PageTitle>

      <Card className="mb-4 flex flex-wrap items-end gap-3 p-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Month</span>
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Category</span>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-48">
            <option value="">All categories</option>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </label>
        <div className="ml-auto text-right">
          <div className="text-xs text-muted">Total this view</div>
          <div className="text-xl font-bold">{formatMoney(data?.total ?? 0, currency)}</div>
        </div>
      </Card>

      <Card className="overflow-x-auto p-0">
        {isLoading ? (
          <Spinner />
        ) : !data || data.rows.length === 0 ? (
          <EmptyState message="No expenses recorded for this month." />
        ) : (
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Note</th>
                <th className="px-4 py-3">By</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((e) => (
                <tr key={e.id} className="border-t border-line hover:bg-slate-50">
                  <td className="px-4 py-2.5">{e.expense_date}</td>
                  <td className="px-4 py-2.5">{e.category_name}</td>
                  <td className="max-w-64 truncate px-4 py-2.5 text-muted" title={e.note ?? ''}>
                    {e.note ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{e.created_by_name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right font-medium">{formatMoney(e.amount, currency)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      <button
                        title="Edit"
                        className="rounded p-1.5 text-muted hover:bg-slate-200"
                        onClick={() => { setEditing(e); setFormOpen(true) }}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        title="Delete"
                        className="rounded p-1.5 text-muted hover:bg-red-100 hover:text-danger"
                        onClick={() => setDeleting(e)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <ExpenseForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        expense={editing}
        categories={categories ?? []}
      />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting.id)}
        title="Delete expense"
        message={`Delete this ${formatMoney(deleting?.amount ?? 0, currency)} expense? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        loading={del.isPending}
      />
    </div>
  )
}

interface FormValues {
  category_id: string
  amount: number // rupees in the form
  note: string
  expense_date: string
}

function ExpenseForm({
  open,
  onClose,
  expense,
  categories,
}: {
  open: boolean
  onClose: () => void
  expense: Expense | null
  categories: ExpenseCategory[]
}) {
  const qc = useQueryClient()
  const [newCategory, setNewCategory] = useState('')
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    values: expense
      ? {
          category_id: expense.category_id,
          amount: toRupees(expense.amount),
          note: expense.note ?? '',
          expense_date: expense.expense_date,
        }
      : {
          category_id: '',
          amount: 0,
          note: '',
          expense_date: new Date().toISOString().slice(0, 10),
        },
  })

  const addCategory = useMutation({
    mutationFn: (name: string) => api<ExpenseCategory>('expenseCategories:create', { name }),
    onSuccess: (cat) => {
      void qc.invalidateQueries({ queryKey: ['expense-categories'] })
      setValue('category_id', cat.id)
      setNewCategory('')
      toast.success(`Category "${cat.name}" added`)
    },
    onError: (e) => toast.error(e.message),
  })

  const onSubmit = handleSubmit(async (v) => {
    const payload = {
      category_id: v.category_id,
      amount: toPaisa(v.amount) || 0,
      note: v.note || null,
      expense_date: v.expense_date,
    }
    try {
      if (expense) {
        await api('expenses:update', { id: expense.id, ...payload })
        toast.success('Expense updated')
      } else {
        await api('expenses:create', payload)
        toast.success('Expense added')
      }
      void qc.invalidateQueries({ queryKey: ['expenses'] })
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    }
  })

  return (
    <Modal open={open} onClose={onClose} title={expense ? 'Edit expense' : 'Add expense'}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Category" required error={errors.category_id?.message}>
            <Select {...register('category_id', { required: 'Pick a category' })}>
              <option value="">— Choose —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="New category (optional)">
            <div className="flex gap-2">
              <Input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="e.g. Rent, Utilities"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!newCategory.trim() || addCategory.isPending}
                onClick={() => addCategory.mutate(newCategory.trim())}
              >
                Add
              </Button>
            </div>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Amount" required error={errors.amount?.message}>
            <Input
              type="number" step="0.01" min="0" autoFocus
              {...register('amount', {
                required: 'Required',
                valueAsNumber: true,
                validate: (v) => (v > 0 ? true : 'Must be positive'),
              })}
            />
          </Field>
          <Field label="Date" required error={errors.expense_date?.message}>
            <Input type="date" {...register('expense_date', { required: 'Required' })} />
          </Field>
        </div>
        <Field label="Note">
          <Input {...register('note')} placeholder="Optional description…" />
        </Field>
        <div className="flex justify-between pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={isSubmitting}>{expense ? 'Save changes' : 'Add expense'}</Button>
        </div>
      </form>
    </Modal>
  )
}
