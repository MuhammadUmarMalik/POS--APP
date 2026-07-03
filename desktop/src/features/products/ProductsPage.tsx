import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, History, Upload, Download, Package } from 'lucide-react'
import { api } from '../../lib/ipc'
import { formatMoney } from '../../lib/money'
import { useCurrency } from '../../stores/auth'
import type { Brand, Category, ProductWithStock } from '../../shared/types'
import {
  Badge, Button, Card, EmptyState, Input, PageTitle, Select, Spinner, ConfirmDialog,
} from '../../components/ui'
import { toast } from '../../components/ui/toast'
import { ProductForm } from './ProductForm'
import { MovementsModal } from '../inventory/MovementsModal'

interface ImportResult {
  imported: number
  skipped: { row: number; reason: string }[]
  canceled?: boolean
}

export function stockTone(p: { stock: number; min_stock_alert: number }): 'green' | 'amber' | 'red' {
  if (p.stock <= 0) return 'red'
  if (p.stock <= p.min_stock_alert) return 'amber'
  return 'green'
}

export function ProductsPage() {
  const currency = useCurrency()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [brandId, setBrandId] = useState('')
  const [editing, setEditing] = useState<ProductWithStock | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [deleting, setDeleting] = useState<ProductWithStock | null>(null)
  const [movementsFor, setMovementsFor] = useState<ProductWithStock | null>(null)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState<'import' | 'export' | null>(null)

  const { data: products, isLoading } = useQuery({
    queryKey: ['products', search, categoryId, brandId],
    queryFn: () =>
      api<ProductWithStock[]>('products:list', {
        search: search || undefined,
        category_id: categoryId || undefined,
        brand_id: brandId || undefined,
      }),
  })
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<Category[]>('categories:list'),
  })
  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: () => api<Brand[]>('brands:list'),
  })

  const doExport = async () => {
    setBusy('export')
    try {
      const res = await api<{ saved: boolean; count?: number }>('products:export')
      if (res.saved) toast.success(`Exported ${res.count} products`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const doImport = async () => {
    setBusy('import')
    try {
      const res = await api<ImportResult>('products:import')
      if (!res.canceled) {
        setImportResult(res)
        void qc.invalidateQueries({ queryKey: ['products'] })
        void qc.invalidateQueries({ queryKey: ['categories'] })
        void qc.invalidateQueries({ queryKey: ['brands'] })
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const del = useMutation({
    mutationFn: (id: string) => api('products:delete', { id }),
    onSuccess: () => {
      toast.success('Product deleted')
      setDeleting(null)
      void qc.invalidateQueries({ queryKey: ['products'] })
    },
    onError: (e) => toast.error(e.message),
  })

  const rows = useMemo(() => products ?? [], [products])

  return (
    <div>
      <PageTitle
        actions={
          <>
            <Button variant="secondary" onClick={doImport} loading={busy === 'import'}>
              <Upload size={15} /> Import Excel
            </Button>
            <Button variant="secondary" onClick={doExport} loading={busy === 'export'}>
              <Download size={15} /> Export
            </Button>
            <Button onClick={() => { setEditing(null); setFormOpen(true) }}>
              <Plus size={16} /> Add product
            </Button>
          </>
        }
      >
        Products
      </PageTitle>

      <Card className="mb-4 flex gap-3 p-3">
        <Input
          placeholder="Search name, SKU or barcode…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="max-w-48">
          <option value="">All categories</option>
          {categories?.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        <Select value={brandId} onChange={(e) => setBrandId(e.target.value)} className="max-w-48">
          <option value="">All brands</option>
          {brands?.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </Select>
      </Card>

      <Card className="overflow-x-auto p-0">
        {isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState message="No products yet. Add your first product to start selling." />
        ) : (
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Barcode</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Brand</th>
                <th className="px-4 py-3 text-right">Cost</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-4 py-3 text-right">Stock</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-line hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      {p.image ? (
                        <img
                          src={`pos-img://${p.image}`}
                          alt=""
                          className="h-8 w-8 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-400">
                          <Package size={14} />
                        </span>
                      )}
                      <span className="font-medium">{p.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted">{p.barcode ?? '—'}</td>
                  <td className="px-4 py-2.5 text-muted">{p.category_name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-muted">{p.brand_name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right">{formatMoney(p.cost_price, currency)}</td>
                  <td className="px-4 py-2.5 text-right font-medium">{formatMoney(p.sale_price, currency)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Badge tone={stockTone(p)}>{p.stock} {p.unit}</Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      <button
                        title="Stock history"
                        className="rounded p-1.5 text-muted hover:bg-slate-200"
                        onClick={() => setMovementsFor(p)}
                      >
                        <History size={15} />
                      </button>
                      <button
                        title="Edit"
                        className="rounded p-1.5 text-muted hover:bg-slate-200"
                        onClick={() => { setEditing(p); setFormOpen(true) }}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        title="Delete"
                        className="rounded p-1.5 text-muted hover:bg-red-100 hover:text-danger"
                        onClick={() => setDeleting(p)}
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

      <ProductForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        product={editing}
        categories={categories ?? []}
        brands={brands ?? []}
      />
      {importResult && (
        <ConfirmDialog
          open
          onClose={() => setImportResult(null)}
          onConfirm={() => setImportResult(null)}
          title="Import finished"
          message={
            `${importResult.imported} product(s) imported.` +
            (importResult.skipped.length
              ? ` Skipped ${importResult.skipped.length}: ` +
                importResult.skipped.slice(0, 5).map((s) => `row ${s.row} (${s.reason})`).join('; ') +
                (importResult.skipped.length > 5 ? '…' : '')
              : '')
          }
          confirmLabel="OK"
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting.id)}
        title="Delete product"
        message={`Delete "${deleting?.name}"? Past sales keep their records; the product disappears from lists and POS.`}
        confirmLabel="Delete"
        danger
        loading={del.isPending}
      />
      {movementsFor && (
        <MovementsModal product={movementsFor} onClose={() => setMovementsFor(null)} />
      )}
    </div>
  )
}
