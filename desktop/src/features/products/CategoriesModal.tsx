import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, EyeOff, Eye, Pencil, Plus, X } from 'lucide-react'
import { api } from '../../lib/ipc'
import type { Category } from '../../shared/types'
import { Badge, Button, EmptyState, Input, Modal, Spinner } from '../../components/ui'
import { toast } from '../../components/ui/toast'

/**
 * Renaming and retiring categories. There is no delete: a category name is
 * printed on old receipts and reports, so the only tidy-up on offer is to hide
 * it from the pickers used when filing a new product.
 */
export function CategoriesModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['categories', 'all'],
    queryFn: () => api<Category[]>('categories:list', { include_inactive: true }),
  })

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['categories'] })
    void qc.invalidateQueries({ queryKey: ['products'] })
  }

  const create = useMutation({
    mutationFn: (name: string) => api<Category>('categories:create', { name }),
    onSuccess: (c) => {
      setNewName('')
      refresh()
      toast.success(`Category "${c.name}" added`)
    },
    onError: (e) => toast.error(e.message),
  })

  const rename = useMutation({
    mutationFn: (v: { id: string; name: string }) => api<Category>('categories:update', v),
    onSuccess: () => {
      setEditingId(null)
      refresh()
      toast.success('Category renamed')
    },
    onError: (e) => toast.error(e.message),
  })

  const setActive = useMutation({
    mutationFn: (v: { id: string; is_active: boolean }) => api<Category>('categories:setActive', v),
    onSuccess: (c) => {
      refresh()
      toast.success(c.is_active ? `"${c.name}" is back in use` : `"${c.name}" hidden from new products`)
    },
    onError: (e) => toast.error(e.message),
  })

  // Retiring a category leaves its products exactly where they are, so the count
  // is a plain statement of what stays behind, not a warning about data loss.
  const retire = async (c: Category) => {
    const count = await api<number>('categories:productCount', { id: c.id }).catch(() => 0)
    if (count > 0 && !confirm(
      `${count} product(s) are in "${c.name}". They keep this category and stay on sale — ` +
      'it just stops being offered for new products. Continue?'
    )) return
    setActive.mutate({ id: c.id, is_active: false })
  }

  return (
    <Modal open onClose={onClose} title="Categories">
      <div className="mb-4 flex gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New category name"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newName.trim()) create.mutate(newName.trim())
          }}
        />
        <Button
          disabled={!newName.trim()}
          loading={create.isPending}
          onClick={() => create.mutate(newName.trim())}
        >
          <Plus size={15} /> Add
        </Button>
      </div>

      {isLoading ? (
        <Spinner />
      ) : !data || data.length === 0 ? (
        <EmptyState message="No categories yet." />
      ) : (
        <ul className="max-h-96 divide-y divide-line overflow-y-auto">
          {data.map((c) => (
            <li key={c.id} className="flex items-center gap-2 py-2">
              {editingId === c.id ? (
                <>
                  <Input
                    value={draftName}
                    autoFocus
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && draftName.trim()) rename.mutate({ id: c.id, name: draftName.trim() })
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                  />
                  <button
                    title="Save"
                    className="rounded p-1.5 text-success hover:bg-green-50"
                    disabled={!draftName.trim() || rename.isPending}
                    onClick={() => rename.mutate({ id: c.id, name: draftName.trim() })}
                  >
                    <Check size={16} />
                  </button>
                  <button
                    title="Cancel"
                    className="rounded p-1.5 text-muted hover:bg-slate-100"
                    onClick={() => setEditingId(null)}
                  >
                    <X size={16} />
                  </button>
                </>
              ) : (
                <>
                  <span className={`flex-1 ${c.is_active ? '' : 'text-muted line-through'}`}>{c.name}</span>
                  {!c.is_active && <Badge tone="slate">Hidden</Badge>}
                  <button
                    title="Rename"
                    className="rounded p-1.5 text-muted hover:bg-slate-200"
                    onClick={() => { setEditingId(c.id); setDraftName(c.name) }}
                  >
                    <Pencil size={15} />
                  </button>
                  {c.is_active ? (
                    <button
                      title="Hide from new products"
                      className="rounded p-1.5 text-muted hover:bg-amber-100 hover:text-amber-700"
                      onClick={() => void retire(c)}
                    >
                      <EyeOff size={15} />
                    </button>
                  ) : (
                    <button
                      title="Use again"
                      className="rounded p-1.5 text-muted hover:bg-green-100 hover:text-success"
                      onClick={() => setActive.mutate({ id: c.id, is_active: true })}
                    >
                      <Eye size={15} />
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-xs text-muted">
        Hidden categories are never deleted. Products already in them keep the category on every
        past sale, purchase and report.
      </p>

      <div className="flex justify-end pt-4">
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  )
}
