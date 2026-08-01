import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Minus, PauseCircle, Plus, ScanBarcode, Trash2, X } from 'lucide-react'
import { api } from '../../lib/ipc'
import { formatMoney, toPaisa } from '../../lib/money'
import { useAuth, useCurrency, useSession } from '../../stores/auth'
import type { HeldCartLine, HeldSale, ProductWithStock, Sale, SaleItem } from '../../shared/types'
import { Badge, Button, Card, Input, Spinner } from '../../components/ui'
import { toast } from '../../components/ui/toast'
import { stockTone } from '../products/ProductsPage'
import { PaymentModal } from './PaymentModal'
import { HeldSalesModal } from './HeldSalesModal'
import { receiptHtml } from '../sales/receipt'

export interface CartLine {
  product: ProductWithStock
  quantity: number
  discount: number // paisa, whole line
}

function lineAmounts(l: CartLine) {
  const base = l.product.sale_price * l.quantity
  const discount = Math.min(l.discount, base)
  const tax = Math.round(((base - discount) * l.product.tax_percent) / 100)
  return { base, discount, tax, total: base - discount + tax }
}

export function PosPage() {
  const currency = useCurrency()
  const session = useSession()
  const shop = useAuth((s) => s.state?.shop)
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [billDiscount, setBillDiscount] = useState('')
  const [payOpen, setPayOpen] = useState(false)
  const [heldOpen, setHeldOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const searchTerm = search.trim()

  // A short delay prevents fast barcode scans from rendering a product list;
  // scanners finish with Enter and add the exact match directly to the cart.
  useEffect(() => {
    if (!searchTerm) {
      setSearchQuery('')
      return
    }
    const timer = window.setTimeout(() => setSearchQuery(searchTerm), 180)
    return () => window.clearTimeout(timer)
  }, [searchTerm])

  const { data: products, isFetching: isSearching } = useQuery({
    queryKey: ['pos-products', searchQuery],
    queryFn: () =>
      api<ProductWithStock[]>('products:list', {
        search: searchQuery,
      }),
    enabled: searchQuery.length > 0,
  })
  const { data: heldSales } = useQuery({
    queryKey: ['held-sales'],
    queryFn: () => api<HeldSale[]>('sales:heldList'),
  })

  const addToCart = useCallback(
    (p: ProductWithStock) => {
      setCart((prev) => {
        const existing = prev.find((l) => l.product.id === p.id)
        const inCart = existing?.quantity ?? 0
        if (p.stock <= inCart && session?.role !== 'admin') {
          toast.warning(`"${p.name}" is out of stock`)
          return prev
        }
        if (existing) {
          return prev.map((l) =>
            l.product.id === p.id ? { ...l, quantity: l.quantity + 1 } : l
          )
        }
        return [...prev, { product: p, quantity: 1, discount: 0 }]
      })
    },
    [session?.role]
  )

  // Barcode scanners act as keyboards ending with Enter — the search box is the scan target.
  const onSearchEnter = async () => {
    const code = searchTerm
    if (!code) return
    try {
      const p = await api<ProductWithStock | null>('products:byBarcode', { barcode: code })
      if (p) {
        addToCart(p)
        setSearch('')
        return
      }
    } catch {
      /* fall through to plain search */
    }
    // Not a barcode — Enter still adds a unique name/SKU match.
    const matches = searchQuery === code && products
      ? products
      : await api<ProductWithStock[]>('products:list', { search: code })
    if (matches.length === 1) {
      addToCart(matches[0])
      setSearch('')
    }
  }

  const addSearchResult = (product: ProductWithStock) => {
    addToCart(product)
    setSearch('')
    searchRef.current?.focus()
  }

  const setQty = (productId: string, qty: number) => {
    setCart((prev) =>
      qty <= 0
        ? prev.filter((l) => l.product.id !== productId)
        : prev.map((l) => (l.product.id === productId ? { ...l, quantity: qty } : l))
    )
  }
  const setLineDiscount = (productId: string, rupees: string) => {
    const paisa = rupees === '' ? 0 : toPaisa(rupees)
    if (Number.isNaN(paisa) || paisa < 0) return
    setCart((prev) =>
      prev.map((l) => (l.product.id === productId ? { ...l, discount: paisa } : l))
    )
  }

  const totals = useMemo(() => {
    let subtotal = 0, discount = 0, tax = 0
    for (const l of cart) {
      const a = lineAmounts(l)
      subtotal += a.base
      discount += a.discount
      tax += a.tax
    }
    const bd = billDiscount === '' ? 0 : Math.max(0, toPaisa(billDiscount) || 0)
    const afterItems = subtotal - discount + tax
    const billD = Math.min(bd, afterItems)
    return { subtotal, itemDiscount: discount, tax, billDiscount: billD, total: afterItems - billD }
  }, [cart, billDiscount])

  const clearCart = useCallback(() => {
    setCart([])
    setBillDiscount('')
    searchRef.current?.focus()
  }, [])


  // F4 = pay, Esc = clear cart (with guard)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F4' && cart.length > 0) {
        e.preventDefault()
        setPayOpen(true)
      }
      if (e.key === 'Escape' && !payOpen && cart.length > 0) {
        if (window.confirm('Clear the current cart?')) clearCart()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cart.length, payOpen, clearCart])

  const holdCart = async () => {
    if (cart.length === 0) return
    const label = window.prompt('Label for this held sale (e.g. customer name):') ?? ''
    try {
      await api('sales:hold', {
        label: label.trim() || null,
        items: cart.map((l) => ({ product_id: l.product.id, quantity: l.quantity, discount: l.discount })),
      })
      clearCart()
      void qc.invalidateQueries({ queryKey: ['held-sales'] })
      toast.success('Sale held — resume it anytime from the Held button')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const resumeCart = async (lines: HeldCartLine[], label: string | null) => {
    if (cart.length > 0 && !window.confirm('Replace the current cart with the held sale?')) return
    try {
      const all = await api<ProductWithStock[]>('products:list')
      const byId = new Map(all.map((p) => [p.id, p]))
      const restored: CartLine[] = []
      const missing: string[] = []
      for (const l of lines) {
        const p = byId.get(l.product_id)
        if (p) restored.push({ product: p, quantity: l.quantity, discount: l.discount })
        else missing.push(l.product_id)
      }
      setCart(restored)
      setBillDiscount('')
      if (missing.length) toast.warning(`${missing.length} item(s) no longer exist and were skipped`)
      else toast.success(`Resumed${label ? ` "${label}"` : ''} — prices refreshed`)
      searchRef.current?.focus()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const onCompleted = async (sale: Sale) => {
    setPayOpen(false)
    clearCart()
    void qc.invalidateQueries({ queryKey: ['pos-products'] })
    void qc.invalidateQueries({ queryKey: ['products'] })
    toast.success(`Sale ${sale.invoice_number} completed — ${formatMoney(sale.total, currency)}`)
    // Print receipt in the background; failures shouldn't block the next sale.
    try {
      const detail = await api<{ sale: Sale; items: SaleItem[] }>('sales:get', { id: sale.id })
      if (shop) await api('print:html', { html: receiptHtml({ shop, sale: detail.sale, items: detail.items }) })
    } catch (e) {
      toast.warning(`Receipt not printed: ${(e as Error).message}`)
    }
  }

  return (
    <div className="flex h-full gap-4">
      {/* Left: search + product grid */}
        <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-3 flex gap-2">
          <div className="relative flex-1">
            <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
            <Input
              ref={searchRef}
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSearchEnter()}
              placeholder="Scan barcode or search products… (Enter adds exact match)"
              className="pl-10"
            />
          </div>
          <div className="shrink-0">
            <Button variant="secondary" onClick={() => setHeldOpen(true)}>
              <PauseCircle size={15} /> Held{heldSales?.length ? ` (${heldSales.length})` : ''}
            </Button>
          </div>
        </div>
        <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto pb-4 md:grid-cols-3 xl:grid-cols-4">
          {!searchTerm ? (
            <div className="col-span-full flex h-full min-h-80 flex-col items-center justify-center text-center text-muted">
              <ScanBarcode size={34} className="mb-3 text-primary" />
              <p className="font-medium text-ink">Search or scan to add a product</p>
              <p className="mt-1 max-w-sm text-sm">
                Type a product name above to see matching products, or scan a barcode to add it directly to the cart.
              </p>
            </div>
          ) : searchQuery !== searchTerm || isSearching ? (
            <div className="col-span-full"><Spinner /></div>
          ) : products?.map((p) => (
            <button
              key={p.id}
              onClick={() => addSearchResult(p)}
              className="flex flex-col items-start rounded-lg border border-line bg-surface p-3 text-left transition hover:border-primary hover:shadow-sm"
            >
              {p.image && (
                <img
                  src={`pos-img://${p.image}`}
                  alt=""
                  className="mb-2 h-20 w-full rounded-md object-cover"
                />
              )}
              <span className="mb-1 line-clamp-2 min-h-10 font-medium">{p.name}</span>
              <span className="mb-2 text-base font-semibold text-primary">
                {formatMoney(p.sale_price, currency)}
              </span>
              <Badge tone={stockTone(p)}>{p.stock} {p.unit}</Badge>
            </button>
          ))}
          {searchQuery === searchTerm && !isSearching && products?.length === 0 ? (
            <div className="col-span-full py-12 text-center text-muted">No products match.</div>
          ) : null}
        </div>
      </div>

      {/* Right: cart */}
      <Card className="flex w-96 shrink-0 flex-col p-0">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-lg font-semibold">Cart ({cart.length})</h2>
          {cart.length > 0 && (
            <button onClick={() => window.confirm('Clear the current cart?') && clearCart()}
              className="flex items-center gap-1 text-xs text-danger hover:underline">
              <Trash2 size={13} /> Clear
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <div className="flex h-full items-center justify-center p-8 text-center text-muted">
              Scan a barcode or search and select a product to start the sale.
            </div>
          ) : (
            cart.map((l) => {
              const a = lineAmounts(l)
              return (
                <div key={l.product.id} className="border-b border-line px-4 py-3">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <span className="font-medium">{l.product.name}</span>
                    <button onClick={() => setQty(l.product.id, 0)} className="text-muted hover:text-danger">
                      <X size={15} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center rounded-md border border-line">
                      <button className="px-2.5 py-1.5 hover:bg-slate-100" onClick={() => setQty(l.product.id, l.quantity - 1)}>
                        <Minus size={14} />
                      </button>
                      <input
                        type="number"
                        value={l.quantity}
                        min={1}
                        onChange={(e) => setQty(l.product.id, Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-12 border-x border-line py-1 text-center text-sm focus:outline-none"
                      />
                      <button className="px-2.5 py-1.5 hover:bg-slate-100" onClick={() => setQty(l.product.id, l.quantity + 1)}>
                        <Plus size={14} />
                      </button>
                    </div>
                    <input
                      type="number"
                      placeholder="Disc."
                      step="0.01"
                      min="0"
                      title="Line discount"
                      onChange={(e) => setLineDiscount(l.product.id, e.target.value)}
                      className="w-16 rounded-md border border-line px-2 py-1.5 text-right text-xs focus:border-primary focus:outline-none"
                    />
                    <span className="min-w-20 text-right text-base font-semibold">
                      {formatMoney(a.total, currency)}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="border-t border-line p-4">
          <div className="mb-1 flex justify-between text-muted">
            <span>Subtotal</span><span>{formatMoney(totals.subtotal, currency)}</span>
          </div>
          {totals.itemDiscount > 0 && (
            <div className="mb-1 flex justify-between text-muted">
              <span>Item discounts</span><span>-{formatMoney(totals.itemDiscount, currency)}</span>
            </div>
          )}
          {totals.tax > 0 && (
            <div className="mb-1 flex justify-between text-muted">
              <span>Tax</span><span>{formatMoney(totals.tax, currency)}</span>
            </div>
          )}
          <div className="mb-2 flex items-center justify-between">
            <span className="text-muted">Bill discount</span>
            <input
              type="number" step="0.01" min="0"
              value={billDiscount}
              onChange={(e) => setBillDiscount(e.target.value)}
              placeholder="0.00"
              className="w-24 rounded-md border border-line px-2 py-1 text-right text-sm focus:border-primary focus:outline-none"
            />
          </div>
          <div className="mb-3 flex items-center justify-between text-xl font-bold">
            <span>Total</span><span>{formatMoney(totals.total, currency)}</span>
          </div>
          <div className="flex gap-2">
            <Button
              size="lg"
              variant="secondary"
              className="shrink-0"
              disabled={cart.length === 0}
              onClick={holdCart}
              title="Park this cart and start a new sale"
            >
              <PauseCircle size={17} /> Hold
            </Button>
            <Button size="lg" className="w-full" disabled={cart.length === 0} onClick={() => setPayOpen(true)}>
              Pay {cart.length > 0 && formatMoney(totals.total, currency)} <kbd className="ml-1 text-xs opacity-70">F4</kbd>
            </Button>
          </div>
        </div>
      </Card>

      <HeldSalesModal open={heldOpen} onClose={() => setHeldOpen(false)} onResume={resumeCart} />
      <PaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        cart={cart}
        billDiscount={totals.billDiscount}
        total={totals.total}
        onCompleted={onCompleted}
      />
    </div>
  )
}
