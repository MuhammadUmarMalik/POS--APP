// Thermal roll template for bills.
//
// This is a separate document, not the A4 invoice scaled down. On 50–72 mm the
// column grid is abandoned: an item is a name line followed by a
// "qty x rate ..... amount" line, totals are right-aligned pairs, and the
// letterhead centres. Nothing here assumes horizontal room.
import { customHeader, documentShell, esc, fieldsBlock, footerText, shopHeader, cellText } from './html'
import type { DocContext } from './types'
import type { BillDoc } from './bill'

const THERMAL_BILL_CSS = `
  .t-title { text-align: center; font-weight: 700; font-size: 12px; margin: 4px 0 1px; }
  .t-no { text-align: center; font-size: 10px; margin-bottom: 4px; }
  .rule { border-top: 1px dashed #000; margin: 4px 0; }
  .line { display: flex; justify-content: space-between; gap: 6px; font-size: 9.5px; }
  /* 50 mm of paper: a long customer or supplier name wraps under its label
     rather than pushing the amount off the roll. */
  .line span { min-width: 0; overflow-wrap: anywhere; }
  .line span:last-child { text-align: right; }
  .line.money span:last-child { white-space: nowrap; }
  .item { margin-top: 3px; }
  .item .name { font-size: 10px; font-weight: 600; word-break: break-word; }
  .t-total { font-size: 11px; font-weight: 700; }
  .t-note { text-align: center; font-size: 9px; margin-top: 6px; white-space: pre-wrap; }
  .t-gen { text-align: center; font-size: 8px; color: #444; margin-top: 4px; }
  /* A roll has no page to sign off on, and the cut needs blank paper. */
  .cut { height: 10mm; }
`

/**
 * Renders a bill for a continuous roll. Item columns are collapsed to the two
 * that matter on a counter receipt — what it was, and what it cost — with any
 * remaining right-aligned columns folded into the qty/rate line.
 */
export function thermalBillHtml<T>(bill: BillDoc<T>, ctx: DocContext): string {
  // First column is the description; the money column nearest the end is the
  // line amount. Everything between them prints on the detail line.
  const nameCol = bill.columns[0]
  const amountIndex = findLast(bill.columns, (c) => c.money === true)
  const detailCols = bill.columns.filter((_, i) => i !== 0 && i !== amountIndex)

  // A single-amount document (a cash receipt) has no item block and no rules
  // around one — just the letterhead, the figures, and the signature line.
  const items = !bill.columns.length
    ? ''
    : bill.rows.length
    ? bill.rows
        .map((row) => {
          const detail = detailCols
            .map((c) => cellText(c.value(row), c.money, ctx))
            .filter((t) => t !== '')
            .join('  x  ')
          const amount =
            amountIndex >= 0 ? cellText(bill.columns[amountIndex].value(row), true, ctx) : ''
          return `<div class="item">
            <div class="name">${esc(cellText(nameCol.value(row), nameCol.money, ctx))}</div>
            ${detail || amount ? `<div class="line money"><span>${esc(detail)}</span><span>${esc(amount)}</span></div>` : ''}
          </div>`
        })
        .join('')
    : '<div class="line"><span>No line items on this document.</span><span></span></div>'

  const totals = bill.totals?.length
    ? bill.totals
        .map(
          (t) =>
            `<div class="line money ${t.strong ? 't-total' : ''}"><span>${esc(t.label)}</span><span>${esc(
              t.text ?? cellText(t.value, true, ctx)
            )}</span></div>`
        )
        .join('')
    : ''

  const meta = bill.meta?.length
    ? bill.meta.map(([k, v]) => `<div class="line"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')
    : ''

  const party = bill.party
    ? `<div class="line"><span>${esc(bill.party.label)}</span><span>${esc(
        bill.party.lines.filter(Boolean)[0] ?? ''
      )}</span></div>`
    : ''

  const note = bill.note ?? (ctx.settings.show_notes ? footerText(ctx) : null)

  const body = `
    <style>${THERMAL_BILL_CSS}</style>
    ${customHeader(ctx)}
    <div class="head">${shopHeader(ctx)}</div>
    <div class="t-title">${esc(bill.title)}</div>
    <div class="t-no">${esc(bill.number)}</div>
    ${bill.watermark ? `<div class="t-title">** ${esc(bill.watermark)} **</div>` : ''}
    ${meta}${party}
    <div class="rule"></div>
    ${items ? `${items}<div class="rule"></div>` : ''}
    ${totals}
    ${fieldsBlock(ctx, bill.fields)}
    ${note ? `<div class="t-note">${esc(note)}</div>` : ''}
    <div class="t-gen">${esc(new Date().toLocaleString())}</div>
    <div class="cut"></div>`

  return documentShell({ title: `${bill.title} ${bill.number}`, body, ctx })
}

function findLast<T>(items: T[], match: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (match(items[i])) return i
  return -1
}
