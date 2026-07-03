// Live 80mm receipt mock-up. Re-renders on every profile-form keystroke so the
// owner sees exactly how the printed header/footer will look.

export interface ReceiptPreviewData {
  name: string
  phone?: string | null
  address?: string | null
  city?: string | null
  currency: string
  receipt_footer?: string | null
  ntn?: string | null
  logoFile?: string | null // file name served via pos-img://
}

const SAMPLE_ITEMS = [
  { name: 'Milk Pack 1L', qty: 2, price: 33000 },
  { name: 'Bread Large', qty: 1, price: 18000 },
  { name: 'Eggs (dozen)', qty: 1, price: 34500 },
]

/** Preview always shows 2 decimals, e.g. "PKR 1,250.00". */
function fmt(paisa: number, currency: string): string {
  const rupees = (paisa / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${currency} ${rupees}`
}

export function ReceiptPreview({ data }: { data: ReceiptPreviewData }) {
  const total = SAMPLE_ITEMS.reduce((sum, i) => sum + i.qty * i.price, 0)
  const currency = data.currency || 'PKR'

  return (
    <div className="mx-auto w-[220px] rounded-md border border-line bg-white px-3 py-4 font-mono text-[11px] leading-4 text-black shadow-sm">
      {data.logoFile && (
        <img
          src={`pos-img://${data.logoFile}`}
          alt="Shop logo"
          className="mx-auto mb-2 h-14 w-14 object-contain"
        />
      )}
      <div className="text-center text-[13px] font-bold">{data.name || 'Your Shop Name'}</div>
      {(data.address || data.city) && (
        <div className="text-center">{[data.address, data.city].filter(Boolean).join(', ')}</div>
      )}
      {data.phone && <div className="text-center">Ph: {data.phone}</div>}
      {data.ntn && <div className="text-center">NTN: {data.ntn}</div>}

      <div className="my-2 border-t border-dashed border-black" />
      <div>Invoice: INV-000123</div>
      <div>Date: {new Date().toLocaleString()}</div>
      <div className="my-2 border-t border-dashed border-black" />

      {SAMPLE_ITEMS.map((i) => (
        <div key={i.name} className="mb-1">
          <div className="font-bold">{i.name}</div>
          <div className="flex justify-between">
            <span>
              {i.qty} x {fmt(i.price, currency)}
            </span>
            <span>{fmt(i.qty * i.price, currency)}</span>
          </div>
        </div>
      ))}

      <div className="my-2 border-t border-dashed border-black" />
      <div className="flex justify-between text-[13px] font-bold">
        <span>TOTAL</span>
        <span>{fmt(total, currency)}</span>
      </div>
      <div className="my-2 border-t border-dashed border-black" />
      <div className="text-center">{data.receipt_footer || 'Thank you for shopping with us!'}</div>
    </div>
  )
}
