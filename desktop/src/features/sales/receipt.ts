// Builds a standalone 80mm receipt HTML document for silent printing.
import { formatMoney } from '../../lib/money'
import type { Sale, SaleItem, Shop } from '../../shared/types'

export function receiptHtml(args: { shop: Shop; sale: Sale; items: SaleItem[] }): string {
  const { shop, sale, items } = args
  const c = shop.currency
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const lines = items
    .map(
      (i) => `
      <tr>
        <td colspan="3" class="name">${esc(i.product_name)}</td>
      </tr>
      <tr class="sub">
        <td>${i.quantity} x ${formatMoney(i.unit_price, c)}</td>
        <td class="r">${i.discount > 0 ? '-' + formatMoney(i.discount, c) : ''}</td>
        <td class="r">${formatMoney(i.total, c)}</td>
      </tr>`
    )
    .join('')

  const change =
    sale.payment_method === 'cash' && sale.tendered != null ? sale.tendered - sale.total : null

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    @page { margin: 0; size: 80mm auto; }
    body { width: 72mm; margin: 0 auto; font-family: 'Courier New', monospace; font-size: 11px; color: #000; padding: 4mm 0; }
    .center { text-align: center; }
    .shop { font-size: 15px; font-weight: bold; }
    .meta { margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 1px 0; vertical-align: top; }
    .r { text-align: right; }
    .name { font-weight: bold; }
    .sub td { padding-bottom: 4px; }
    .rule { border-top: 1px dashed #000; margin: 5px 0; }
    .totals td { padding: 1.5px 0; }
    .grand { font-size: 14px; font-weight: bold; }
    .footer { margin-top: 8px; }
    .logo { display: block; margin: 0 auto 4px; max-height: 18mm; max-width: 30mm; }
  </style></head><body>
    ${shop.local_logo_path ? `<img class="logo" src="pos-img://${encodeURIComponent(shop.local_logo_path)}" alt="">` : ''}
    <div class="center shop">${esc(shop.name)}</div>
    ${shop.address || shop.city ? `<div class="center">${esc([shop.address, shop.city].filter(Boolean).join(', '))}</div>` : ''}
    ${shop.phone ? `<div class="center">Ph: ${esc(shop.phone)}</div>` : ''}
    ${shop.ntn ? `<div class="center">NTN: ${esc(shop.ntn)}</div>` : ''}
    <div class="meta">
      <div>Invoice: ${esc(sale.invoice_number)}</div>
      <div>Date: ${new Date(sale.created_at).toLocaleString()}</div>
      <div>Cashier: ${esc(sale.cashier_name ?? '')}</div>
      ${sale.customer_name ? `<div>Customer: ${esc(sale.customer_name)}</div>` : ''}
    </div>
    <div class="rule"></div>
    <table>${lines}</table>
    <div class="rule"></div>
    <table class="totals">
      <tr><td>Subtotal</td><td class="r">${formatMoney(sale.subtotal, c)}</td></tr>
      ${sale.discount > 0 ? `<tr><td>Discount</td><td class="r">-${formatMoney(sale.discount, c)}</td></tr>` : ''}
      ${sale.tax > 0 ? `<tr><td>Tax</td><td class="r">${formatMoney(sale.tax, c)}</td></tr>` : ''}
      <tr class="grand"><td>TOTAL</td><td class="r">${formatMoney(sale.total, c)}</td></tr>
      <tr><td>Paid (${esc(sale.payment_method)})</td><td class="r">${
        sale.payment_method === 'credit' ? 'ON CREDIT' : formatMoney(sale.tendered ?? sale.total, c)
      }</td></tr>
      ${change != null ? `<tr><td>Change</td><td class="r">${formatMoney(change, c)}</td></tr>` : ''}
    </table>
    <div class="rule"></div>
    <div class="center footer">${esc(shop.receipt_footer || 'Thank you!')}</div>
  </body></html>`
}
