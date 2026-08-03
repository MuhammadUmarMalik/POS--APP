// Every printable business document — sales invoices, purchase invoices, cash
// receipts, cash payments — is described here once and rendered through the
// template the shop chose. Modules describe the document; they never write
// print HTML or pick a layout themselves.
//
// Three templates:
//   full     — the A4/A5 invoice, with party block, signatures and totals table
//   compact  — the same sheet made denser: half-height, no signature block
//   thermal  — a genuinely different single-column roll document (thermal.ts)
import { cellText, customHeader, documentShell, esc, fieldsBlock, footerText, shopHeader } from './html'
import { thermalBillHtml } from './thermal'
import { isThermal } from '../../shared/types'
import type { DocContext, DocFields, ExportColumn } from './types'

export interface BillTotal {
  label: string
  /** Integer paisa unless `text` is set. */
  value?: number
  /** Pre-formatted text for non-money rows such as a payment method. */
  text?: string
  strong?: boolean
}

export interface BillDoc<T> {
  /** Printed heading, e.g. "SALES INVOICE". */
  title: string
  /** Document number shown under the heading. */
  number: string
  /**
   * Line-item table. A document that is genuinely a single amount — a cash
   * receipt against a due balance — declares no columns and prints no table:
   * an empty grid saying "no line items" would be a defect on such a document,
   * not information.
   */
  columns: ExportColumn<T>[]
  /** Date, cashier, status and similar context. */
  meta?: [string, string][]
  /** Customer or supplier block. */
  party?: { label: string; lines: string[] }
  rows: T[]
  totals?: BillTotal[]
  /** Amount in words or terms. Falls back to the shop's footer text when unset. */
  note?: string
  /** Optional fields whose visibility the shop controls in Settings. */
  fields?: DocFields
  /** Draws a large diagonal watermark, e.g. "CANCELLED". */
  watermark?: string
}

const BILL_CSS = `
  .bill-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px;
               border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 12px; }
  .bill-title { text-align: right; }
  .bill-title h1 { font-size: 19px; letter-spacing: .5px; }
  .bill-no { font-size: 12px; font-weight: 600; color: #333; margin-top: 2px; }
  .party { border: 1px solid #d4d4d8; border-radius: 5px; padding: 7px 10px; margin-bottom: 10px;
           display: inline-block; min-width: 45%; }
  .party .l { font-size: 9px; text-transform: uppercase; letter-spacing: .3px; color: #666; }
  .party .n { font-weight: 700; font-size: 12px; margin-top: 1px; }
  .party div.x { color: #444; font-size: 10px; }
  /* Long shop, party and item names wrap instead of running off the sheet. */
  .bill-head { overflow-wrap: anywhere; }
  .party .n, .party div.x { overflow-wrap: anywhere; }
  .totals { margin-left: auto; width: 46%; margin-top: 10px; }
  .totals td { border: none; padding: 3px 6px; }
  /* No item table: the totals are the document. */
  .totals-solo { width: 100%; margin-left: 0; }
  .totals-solo td { padding: 5px 8px; border-bottom: 1px solid #e4e4e7; }
  .totals-solo td:first-child { color: #444; }
  .totals tr.strong td { border-top: 1.5px solid #111; font-size: 13px; font-weight: 700; padding-top: 5px; }
  .sign { display: flex; justify-content: space-between; margin-top: 26px; gap: 40px; }
  .sign div { flex: 1; border-top: 1px solid #999; padding-top: 4px; font-size: 9px;
              color: #666; text-align: center; }
  .wm { position: fixed; top: 42%; left: 0; right: 0; text-align: center; font-size: 68px;
        font-weight: 800; color: rgba(220, 38, 38, .13); transform: rotate(-22deg);
        letter-spacing: 6px; z-index: -1; }
`

/** Compact trades whitespace for paper: roughly half the sheet of a full bill. */
const COMPACT_CSS = `
  body { font-size: 9px; }
  .bill-head { padding-bottom: 6px; margin-bottom: 7px; }
  .bill-title h1 { font-size: 15px; }
  .logo { max-height: 11mm; max-width: 26mm; }
  .party { padding: 4px 7px; margin-bottom: 6px; }
  th, td { padding: 2px 4px; }
  .totals { width: 40%; margin-top: 6px; }
  .totals td { padding: 1px 4px; }
  .fields { margin-top: 7px; }
  .fields div { margin-top: 3px; }
  .gen { margin-top: 5px; }
`

/**
 * The template also decides the page. A roll layout on an A4 sheet — or an A4
 * layout on a roll — is never what the shop meant, so the two are resolved
 * together here rather than being left to disagree.
 */
function resolveContext(ctx: DocContext): { ctx: DocContext; thermal: boolean } {
  const paperIsRoll = isThermal(ctx.settings.paper_size)
  if (ctx.settings.receipt_template === 'thermal') {
    return paperIsRoll
      ? { ctx, thermal: true }
      : { ctx: { ...ctx, settings: { ...ctx.settings, paper_size: 'Thermal80' } }, thermal: true }
  }
  // Roll stock with a sheet template: the paper wins, because the printer
  // physically cannot produce anything else.
  return { ctx, thermal: paperIsRoll }
}

export function billHtml<T>(bill: BillDoc<T>, ctx: DocContext): string {
  const resolved = resolveContext(ctx)
  if (resolved.thermal) return thermalBillHtml(bill, resolved.ctx)
  return sheetBillHtml(bill, resolved.ctx)
}

/** The paged A4/A5 invoice, in either its full or compact density. */
function sheetBillHtml<T>(bill: BillDoc<T>, ctx: DocContext): string {
  const compact = ctx.settings.receipt_template === 'compact'

  const head = bill.columns
    .map((c) => `<th class="${c.align === 'right' || c.money ? 'r' : ''}">${esc(c.header)}</th>`)
    .join('')

  const body = bill.rows.length
    ? bill.rows
        .map((row, i) => {
          const cells = bill.columns
            .map((c) => {
              const align = c.align === 'right' || c.money ? ' class="r"' : ''
              return `<td${align}>${esc(cellText(c.value(row), c.money, ctx))}</td>`
            })
            .join('')
          return `<tr><td class="r">${i + 1}</td>${cells}</tr>`
        })
        .join('')
    : `<tr><td class="empty" colspan="${bill.columns.length + 1}">No line items on this document.</td></tr>`

  const table = bill.columns.length
    ? `<table>
        <thead><tr><th class="r" style="width:26px">#</th>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>`
    : ''

  // With no item table the totals are the document, so they take the full width
  // rather than hugging the right edge of a column grid that is not there.
  const totals = bill.totals?.length
    ? `<table class="totals${bill.columns.length ? '' : ' totals-solo'}">${bill.totals
        .map(
          (t) =>
            `<tr class="${t.strong ? 'strong' : ''}"><td>${esc(t.label)}</td><td class="r">${esc(
              t.text ?? cellText(t.value, true, ctx)
            )}</td></tr>`
        )
        .join('')}</table>`
    : ''

  const party = bill.party
    ? `<div class="party"><div class="l">${esc(bill.party.label)}</div>${bill.party.lines
        .filter(Boolean)
        .map((line, i) => `<div class="${i === 0 ? 'n' : 'x'}">${esc(line)}</div>`)
        .join('')}</div>`
    : ''

  const meta = bill.meta?.length
    ? `<div class="meta">${bill.meta.map(([k, v]) => `<div><b>${esc(k)}:</b> ${esc(v)}</div>`).join('')}</div>`
    : ''

  const note = bill.note ?? (ctx.settings.show_notes ? footerText(ctx) : null)

  const html = `
    <style>${BILL_CSS}${compact ? COMPACT_CSS : ''}</style>
    ${bill.watermark ? `<div class="wm">${esc(bill.watermark)}</div>` : ''}
    ${customHeader(ctx)}
    <div class="bill-head">
      <div>${shopHeader(ctx)}</div>
      <div class="bill-title">
        <h1>${esc(bill.title)}</h1>
        <div class="bill-no">${esc(bill.number)}</div>
      </div>
    </div>
    ${party}
    ${meta}
    ${table}
    ${totals}
    ${fieldsBlock(ctx, bill.fields)}
    ${note ? `<div class="note">${esc(note)}</div>` : ''}
    ${compact ? '' : `<div class="sign"><div>Received by</div><div>For ${esc(ctx.shop?.name ?? '')}</div></div>`}
    <div class="gen">Generated ${esc(new Date().toLocaleString())}</div>`

  return documentShell({ title: `${bill.title} ${bill.number}`, body: html, ctx })
}
