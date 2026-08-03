// Builds the print/PDF HTML. Bills and reports share one page shell (shop
// letterhead, paper rules, page-break behaviour) so every document in the app
// looks like it came from the same system.
//
// Two geometries exist, and neither is a scaled version of the other: a paged
// sheet (A4/A5/Letter/…) and a continuous thermal roll. The roll has 50–72 mm of
// printable width, so wide tables there are re-laid out as stacked label/value
// blocks rather than squeezed into unreadable columns.
import { formatMoney } from '../money'
import { isThermal } from '../../shared/types'
import type { AnySection, CellValue, DocContext, DocFields, ExportDoc, PaperSize } from './types'

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Printable width of a roll: stock width less the mechanism's dead margin. */
export function thermalWidthMm(size: PaperSize): number {
  return size === 'Thermal58' ? 50 : 72
}

/**
 * Page geometry is driven by CSS @page so the browser print preview matches
 * printToPDF. Margins come from the shared print settings; a roll gets none,
 * because the template supplies its own padding and there is no width to spare.
 */
function pageCss(ctx: DocContext): string {
  const s = ctx.settings
  if (isThermal(s.paper_size)) {
    const w = thermalWidthMm(s.paper_size)
    // `auto` height is what makes the roll continuous — the receipt is as long
    // as its content instead of being padded out to a fixed sheet.
    return `@page { size: ${w}mm auto; margin: 0; }
            body { width: ${w}mm; margin: 0 auto; padding: 3mm 2mm; }`
  }
  return `@page {
    size: ${s.paper_size} ${s.landscape ? 'landscape' : 'portrait'};
    margin: ${s.margin_top_mm}mm ${s.margin_right_mm}mm ${s.margin_bottom_mm}mm ${s.margin_left_mm}mm;
  }`
}

const BASE_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; font-size: 10.5px; color: #111; }
  h1 { font-size: 17px; margin: 0; }
  .sub { color: #555; font-size: 11px; margin-top: 2px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 1.5px solid #111; padding-bottom: 8px; margin-bottom: 10px; gap: 16px; }
  .shop-name { font-size: 15px; font-weight: 700; }
  .shop-line { color: #444; font-size: 10px; }
  .logo { max-height: 16mm; max-width: 34mm; margin-bottom: 4px; }
  .doc-title { text-align: right; }
  .custom-head { font-weight: 600; margin-bottom: 6px; white-space: pre-wrap; }
  .meta { display: flex; flex-wrap: wrap; gap: 4px 22px; margin-bottom: 10px; }
  .meta div { font-size: 10px; }
  .meta b { color: #444; font-weight: 600; }
  .stats { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
  .stat { border: 1px solid #d4d4d8; border-radius: 5px; padding: 6px 10px; min-width: 110px; }
  .stat .l { font-size: 9px; color: #666; text-transform: uppercase; letter-spacing: .3px; }
  .stat .v { font-size: 13px; font-weight: 700; margin-top: 1px; }
  section { margin-bottom: 14px; }
  h2 { font-size: 12px; margin: 0 0 5px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 4px 6px; border-bottom: 1px solid #e4e4e7; text-align: left; vertical-align: top; }
  th { background: #f4f4f5; font-size: 9px; text-transform: uppercase; letter-spacing: .3px;
       color: #52525b; border-bottom: 1px solid #bbb; }
  td.r, th.r { text-align: right; }
  tfoot td { font-weight: 700; border-top: 1.5px solid #111; border-bottom: none; background: #fafafa; }
  .empty { color: #666; font-style: italic; padding: 10px 6px; }
  .note { color: #555; font-size: 9.5px; margin-top: 10px; border-top: 1px solid #e4e4e7; padding-top: 6px; }
  .gen { color: #888; font-size: 9px; margin-top: 8px; text-align: right; }
  .fields { margin-top: 12px; }
  .fields div { margin-top: 6px; font-size: 10px; }
  .fill { display: inline-block; min-width: 45mm; border-bottom: 1px dotted #666; }
  /* Long tables must repeat their header and never split a row across pages. */
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  section { break-inside: auto; }
  h2 { break-after: avoid; }
`

/**
 * Roll overrides. This is a re-layout, not a zoom: the letterhead centres and
 * stacks, cards become one line each, and grid tables collapse to label/value
 * pairs so nothing depends on horizontal room the roll does not have.
 */
const THERMAL_CSS = `
  body { font-family: "Courier New", monospace; font-size: 10px; }
  h1 { font-size: 13px; }
  h2 { font-size: 11px; margin-bottom: 3px; }
  .head { display: block; text-align: center; border-bottom: 1px dashed #000;
          padding-bottom: 5px; margin-bottom: 6px; }
  .doc-title { text-align: center; margin-top: 4px; }
  .logo { max-height: 12mm; max-width: 30mm; display: block; margin: 0 auto 3px; }
  .shop-name { font-size: 12px; }
  .shop-line { font-size: 9px; }
  .sub { font-size: 9px; }
  .custom-head { text-align: center; font-size: 9.5px; }
  /* Meta and stats stack: side-by-side cards do not fit on 50 mm of paper. */
  .meta { display: block; margin-bottom: 6px; }
  .meta div { font-size: 9px; }
  .stats { display: block; margin-bottom: 6px; }
  .stat { border: none; border-bottom: 1px dotted #999; border-radius: 0; padding: 2px 0;
          min-width: 0; display: flex; justify-content: space-between; gap: 6px; }
  .stat .l { text-transform: none; letter-spacing: 0; font-size: 9px; }
  .stat .v { font-size: 10px; }
  section { margin-bottom: 8px; }
  /* Stacked rows replace the column grid entirely. */
  .trow { border-bottom: 1px dotted #999; padding: 3px 0; }
  .trow .c { display: flex; justify-content: space-between; gap: 6px; font-size: 9.5px; }
  .trow .c span:first-child { color: #444; }
  .trow .c span:last-child { text-align: right; }
  .trow.foot { border-top: 1px solid #000; border-bottom: none; font-weight: 700; }
  .note { font-size: 9px; text-align: center; border-top: 1px dashed #000; }
  .gen { text-align: center; font-size: 8px; }
  .fields div { font-size: 9px; }
  .fill { min-width: 22mm; }
`

/**
 * Shop letterhead. Honours the receipt toggles: the whole block can be hidden
 * for shops printing on pre-printed stationery, and the logo independently.
 */
export function shopHeader(ctx: DocContext): string {
  const shop = ctx.shop
  const s = ctx.settings
  if (!shop) return ''
  const logo = s.show_logo && shop.local_logo_path ? logoImg(shop.local_logo_path) : ''
  // The logo is a separate toggle, so it can still appear with the text hidden.
  if (!s.show_header) return logo
  const address = [shop.address, shop.city].filter(Boolean).join(', ')
  return `
    ${logo}
    <div class="shop-name">${esc(shop.name)}</div>
    ${address ? `<div class="shop-line">${esc(address)}</div>` : ''}
    ${shop.phone ? `<div class="shop-line">Ph: ${esc(shop.phone)}</div>` : ''}
    ${shop.ntn ? `<div class="shop-line">NTN: ${esc(shop.ntn)}</div>` : ''}`
}

function logoImg(file: string): string {
  return `<img class="logo" src="pos-img://${encodeURIComponent(file)}" alt="">`
}

/** Shop-defined line printed above the document, when set. */
export function customHeader(ctx: DocContext): string {
  const text = ctx.settings.header_text?.trim()
  return text ? `<div class="custom-head">${esc(text)}</div>` : ''
}

/**
 * Closing line. The print settings' footer wins; otherwise the shop's own
 * receipt footer is kept, so shops that set one before this screen existed do
 * not silently lose it.
 */
export function footerText(ctx: DocContext): string | null {
  return ctx.settings.footer_text?.trim() || ctx.shop?.receipt_footer?.trim() || null
}

export function cellText(value: CellValue, money: boolean | undefined, ctx: DocContext): string {
  if (value == null || value === '') return ''
  if (money) {
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n)
      ? formatMoney(n, ctx.currency, ctx.settings.currency_position)
      : ''
  }
  return String(value)
}

/**
 * The optional Prepared By / Notes block. Each field appears only when its
 * toggle is on; with the toggle on but no value it prints a ruled blank for the
 * counter to complete by hand.
 */
export function fieldsBlock(ctx: DocContext, fields: DocFields | undefined): string {
  const s = ctx.settings
  const rows: string[] = []
  const line = (label: string, value: string | null | undefined) =>
    `<div><b>${esc(label)}:</b> ${value ? esc(value) : '<span class="fill"></span>'}</div>`

  if (s.show_prepared_by) rows.push(line('Prepared by', fields?.preparedBy))
  // Notes has no fill-in line: an empty note is nothing to write on, it is
  // simply absent.
  if (s.show_notes && fields?.notes) rows.push(line('Notes', fields.notes))

  return rows.length ? `<div class="fields">${rows.join('')}</div>` : ''
}

function renderSection(s: AnySection, ctx: DocContext): string {
  const heading = s.title ? `<h2>${esc(s.title)}</h2>` : ''
  if (s.rows.length === 0) {
    return `<section>${heading}<div class="empty">${esc(s.emptyText ?? 'No records for the selected filters.')}</div></section>`
  }
  const body = isThermal(ctx.settings.paper_size) ? renderStacked(s, ctx) : renderTable(s, ctx)
  return `<section>${heading}${body}</section>`
}

function renderTable(s: AnySection, ctx: DocContext): string {
  const head = s.columns
    .map((c) => `<th class="${c.align === 'right' || c.money ? 'r' : ''}">${esc(c.header)}</th>`)
    .join('')

  const body = s.rows
    .map((row) => {
      const cells = s.columns
        .map((c) => {
          const align = c.align === 'right' || c.money ? ' class="r"' : ''
          return `<td${align}>${esc(cellText(c.value(row), c.money, ctx))}</td>`
        })
        .join('')
      return `<tr>${cells}</tr>`
    })
    .join('')

  const foot = s.footer
    ? `<tfoot><tr>${s.columns
        .map((c, i) => {
          const align = c.align === 'right' || c.money ? ' class="r"' : ''
          // Footer money cells arrive as paisa, matching their column.
          return `<td${align}>${esc(cellText(s.footer?.[i], c.money, ctx))}</td>`
        })
        .join('')}</tr></tfoot>`
    : ''

  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>`
}

/**
 * Roll layout for a report section: each record becomes a small block of
 * label/value lines, so a ten-column stock report stays legible on 50 mm
 * instead of collapsing into slivers. Empty cells are dropped entirely.
 */
function renderStacked(s: AnySection, ctx: DocContext): string {
  const lines = (get: (i: number) => CellValue) =>
    s.columns
      .map((c, i) => {
        const text = cellText(get(i), c.money, ctx)
        return text === ''
          ? ''
          : `<div class="c"><span>${esc(c.header)}</span><span>${esc(text)}</span></div>`
      })
      .filter(Boolean)
      .join('')

  const rows = s.rows
    .map((row) => {
      const inner = lines((i) => s.columns[i].value(row))
      return inner ? `<div class="trow">${inner}</div>` : ''
    })
    .join('')

  const footInner = s.footer ? lines((i) => s.footer?.[i]) : ''
  return rows + (footInner ? `<div class="trow foot">${footInner}</div>` : '')
}

/**
 * Wraps arbitrary body HTML in the shared page shell. Bills use this directly
 * because their layout is bespoke; reports go through `docToHtml`.
 */
export function documentShell(args: { title: string; body: string; ctx: DocContext }): string {
  const thermal = isThermal(args.ctx.settings.paper_size)
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(args.title)}</title>
    <style>${BASE_CSS}${thermal ? THERMAL_CSS : ''}${pageCss(args.ctx)}</style></head>
    <body>${args.body}</body></html>`
}

/** Renders a report ExportDoc to a complete printable HTML document. */
export function docToHtml(doc: ExportDoc, ctx: DocContext): string {
  const meta = doc.meta?.length
    ? `<div class="meta">${doc.meta.map(([k, v]) => `<div><b>${esc(k)}:</b> ${esc(v)}</div>`).join('')}</div>`
    : ''

  const stats = doc.stats?.length
    ? `<div class="stats">${doc.stats
        .map((s) => `<div class="stat"><div class="l">${esc(s.label)}</div><div class="v">${esc(s.value)}</div></div>`)
        .join('')}</div>`
    : ''

  // A report's own note is content, not a receipt setting, so it always prints;
  // the shop's standing footer is appended when receipts are showing notes.
  const footer = ctx.settings.show_notes ? footerText(ctx) : null
  const note = doc.note ?? footer

  const body = `
    ${customHeader(ctx)}
    <div class="head">
      <div>${shopHeader(ctx)}</div>
      <div class="doc-title">
        <h1>${esc(doc.title)}</h1>
        ${doc.subtitle ? `<div class="sub">${esc(doc.subtitle)}</div>` : ''}
      </div>
    </div>
    ${meta}
    ${stats}
    ${doc.sections.map((s) => renderSection(s, ctx)).join('')}
    ${note ? `<div class="note">${esc(note)}</div>` : ''}
    <div class="gen">Generated ${esc(new Date().toLocaleString())}</div>`

  return documentShell({ title: doc.title, body, ctx })
}
