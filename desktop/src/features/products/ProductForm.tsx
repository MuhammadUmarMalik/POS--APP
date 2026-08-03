import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, RefreshCw, X } from 'lucide-react'
import { api } from '../../lib/ipc'
import { toPaisa, toRupees } from '../../lib/money'
import type { Brand, Category, ProductImage, ProductWithStock } from '../../shared/types'
import { Button, Field, Input, Modal, Select } from '../../components/ui'
import { toast } from '../../components/ui/toast'
import { useBatchTracking } from '../batches/useBatchSettings'

interface FormValues {
  name: string
  sku: string
  barcode: string
  category_id: string
  brand_id: string
  unit: string
  cost_price: number // rupees in the form, converted to paisa on submit
  sale_price: number
  tax_percent: number
  min_stock_alert: number
  opening_stock: number
  batch_number: string
  expiry_date: string
}

export function ProductForm({
  open,
  onClose,
  product,
  categories,
  brands,
}: {
  open: boolean
  onClose: () => void
  product: ProductWithStock | null
  categories: Category[]
  brands: Brand[]
}) {
  const qc = useQueryClient()
  const [newCategory, setNewCategory] = useState('')
  const [newBrand, setNewBrand] = useState('')
  const [images, setImages] = useState<string[]>([])
  const batchTracking = useBatchTracking()
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>()

  useEffect(() => {
    if (!open) return
    reset(
      product
        ? {
            name: product.name,
            sku: product.sku ?? '',
            barcode: product.barcode ?? '',
            category_id: product.category_id ?? '',
            brand_id: product.brand_id ?? '',
            unit: product.unit,
            cost_price: toRupees(product.cost_price ?? 0),
            sale_price: toRupees(product.sale_price),
            tax_percent: product.tax_percent,
            min_stock_alert: product.min_stock_alert,
            opening_stock: 0,
            batch_number: product.batch_number ?? '',
            expiry_date: product.expiry_date ?? '',
          }
        : {
            name: '', sku: '', barcode: '', category_id: '', brand_id: '', unit: 'pcs',
            cost_price: 0, sale_price: 0, tax_percent: 0, min_stock_alert: 0, opening_stock: 0,
            batch_number: '', expiry_date: '',
          }
    )
    setNewCategory('')
    setNewBrand('')
    setImages([])
    if (product) {
      api<ProductImage[]>('products:images', { product_id: product.id })
        .then((imgs) => setImages(imgs.map((i) => i.file_name)))
        .catch(() => setImages([]))
    }
  }, [open, product, reset])

  const addCategory = useMutation({
    mutationFn: (name: string) => api<Category>('categories:create', { name }),
    onSuccess: (cat) => {
      void qc.invalidateQueries({ queryKey: ['categories'] })
      setValue('category_id', cat.id)
      setNewCategory('')
      toast.success(`Category "${cat.name}" added`)
    },
    onError: (e) => toast.error(e.message),
  })

  const addBrand = useMutation({
    mutationFn: (name: string) => api<Brand>('brands:create', { name }),
    onSuccess: (brand) => {
      void qc.invalidateQueries({ queryKey: ['brands'] })
      setValue('brand_id', brand.id)
      setNewBrand('')
      toast.success(`Brand "${brand.name}" added`)
    },
    onError: (e) => toast.error(e.message),
  })

  const generateBarcode = async () => {
    try {
      const code = await api<string>('products:generateBarcode')
      setValue('barcode', code)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const pickImages = async () => {
    try {
      const picked = await api<string[]>('products:pickImages')
      if (picked.length) setImages((prev) => [...prev, ...picked].slice(0, 8))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const onSubmit = handleSubmit(async (v) => {
    const payload = {
      name: v.name,
      sku: v.sku || null,
      barcode: v.barcode || null,
      category_id: v.category_id || null,
      brand_id: v.brand_id || null,
      unit: v.unit || 'pcs',
      cost_price: toPaisa(v.cost_price) || 0,
      sale_price: toPaisa(v.sale_price) || 0,
      tax_percent: Number(v.tax_percent) || 0,
      min_stock_alert: Number(v.min_stock_alert) || 0,
      images,
      // Omitted entirely when the feature is off, so the payload is byte-for-byte
      // what it was before batch tracking existed.
      ...(batchTracking
        ? { batch_number: v.batch_number || null, expiry_date: v.expiry_date || null }
        : {}),
    }
    try {
      if (product) {
        await api('products:update', { id: product.id, ...payload })
        toast.success('Product updated')
      } else {
        // Opening stock is create-only and becomes a ledger movement, not a
        // stock column. Editing a product never restates it.
        const opening = Math.max(0, Math.trunc(Number(v.opening_stock) || 0))
        await api('products:create', { ...payload, ...(opening > 0 ? { opening_stock: opening } : {}) })
        toast.success(opening > 0 ? `Product added with ${opening} in stock` : 'Product added')
      }
      void qc.invalidateQueries({ queryKey: ['products'] })
      void qc.invalidateQueries({ queryKey: ['pos-products'] })
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    }
  })

  return (
    <Modal open={open} onClose={onClose} title={product ? 'Edit product' : 'Add product'} wide>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Name" required error={errors.name?.message}>
          <Input {...register('name', { required: 'Name is required' })} autoFocus />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Barcode">
            <div className="flex gap-2">
              <Input {...register('barcode')} placeholder="Scan or type…" className="font-mono" />
              <Button type="button" variant="secondary" size="sm" onClick={generateBarcode} title="Auto-generate">
                <RefreshCw size={14} />
              </Button>
            </div>
          </Field>
          <Field label="SKU">
            <Input {...register('sku')} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Category">
            <Select {...register('category_id')}>
              <option value="">— None —</option>
              {/* A product filed under a retired category keeps it. The option is
                  listed so that editing the price does not silently move the
                  product out of the category it has always been in. */}
              {product?.category_id && !categories.some((c) => c.id === product.category_id) && (
                <option value={product.category_id}>
                  {product.category_name ?? 'Current category'} (hidden)
                </option>
              )}
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
                placeholder="e.g. Beverages"
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
          <Field label="Brand">
            <Select {...register('brand_id')}>
              <option value="">— None —</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="New brand (optional)">
            <div className="flex gap-2">
              <Input
                value={newBrand}
                onChange={(e) => setNewBrand(e.target.value)}
                placeholder="e.g. Nestlé"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!newBrand.trim() || addBrand.isPending}
                onClick={() => addBrand.mutate(newBrand.trim())}
              >
                Add
              </Button>
            </div>
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Field label="Cost price" required error={errors.cost_price?.message}>
            <Input
              type="number" step="0.01" min="0"
              {...register('cost_price', { required: 'Required', min: 0, valueAsNumber: true })}
            />
          </Field>
          <Field label="Sale price" required error={errors.sale_price?.message}>
            <Input
              type="number" step="0.01" min="0"
              {...register('sale_price', { required: 'Required', min: 0, valueAsNumber: true })}
            />
          </Field>
          <Field label="Tax %">
            <Input type="number" step="0.01" min="0" {...register('tax_percent', { valueAsNumber: true })} />
          </Field>
        </div>

        <div className={product ? 'grid grid-cols-2 gap-4' : 'grid grid-cols-3 gap-4'}>
          <Field label="Unit">
            <Select {...register('unit')}>
              {['pcs', 'kg', 'g', 'litre', 'ml', 'box', 'pack', 'dozen'].map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </Select>
          </Field>
          <Field label="Low stock alert at">
            <Input type="number" min="0" {...register('min_stock_alert', { valueAsNumber: true })} />
          </Field>
          {/* Only on create. Changing stock later is an adjustment, so that the
              ledger keeps one honest reason per movement. */}
          {!product && (
            <Field label="Opening stock" hint="Optional — how many you already have on the shelf">
              <Input
                type="number" min="0" step="1"
                {...register('opening_stock', { valueAsNumber: true, min: 0 })}
              />
            </Field>
          )}
        </div>

        {batchTracking && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Batch number" hint="Optional — the lot this product first arrives as">
              <Input {...register('batch_number')} placeholder="e.g. B-2401" />
            </Field>
            <Field label="Expiry date" hint="Sold first when several batches are in stock">
              <Input type="date" {...register('expiry_date')} />
            </Field>
          </div>
        )}

        <Field label={`Images (${images.length}/8)`}>
          <div className="flex flex-wrap gap-2">
            {images.map((name, i) => (
              <div key={name} className="group relative h-16 w-16 overflow-hidden rounded-md border border-line">
                <img src={`pos-img://${name}`} alt="" className="h-full w-full object-cover" />
                {i === 0 && (
                  <span className="absolute bottom-0 left-0 right-0 bg-primary/80 text-center text-[9px] text-white">
                    main
                  </span>
                )}
                <button
                  type="button"
                  title="Remove"
                  onClick={() => setImages((prev) => prev.filter((f) => f !== name))}
                  className="absolute right-0.5 top-0.5 hidden rounded-full bg-slate-900/70 p-0.5 text-white group-hover:block"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
            {images.length < 8 && (
              <button
                type="button"
                onClick={pickImages}
                className="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-line text-muted hover:border-primary hover:text-primary"
              >
                <ImagePlus size={18} />
                <span className="text-[10px]">Add</span>
              </button>
            )}
          </div>
        </Field>

        <div className="flex justify-between pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={isSubmitting}>{product ? 'Save changes' : 'Add product'}</Button>
        </div>
      </form>
    </Modal>
  )
}
