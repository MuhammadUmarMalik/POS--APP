// Public surface of the shared export service. Modules import from here only.
import { api } from '../ipc'
import { toCsv } from './csv'
import { docToHtml } from './html'
import { paperFrom } from './types'
import type { DocContext, ExportDoc, PaperOptions } from './types'

export * from './types'
export { documentShell, esc, fieldsBlock, footerText } from './html'
export { billHtml, type BillDoc, type BillTotal } from './bill'
export { toCsv } from './csv'

interface SaveResult {
  saved: boolean
  path?: string
}

function stamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * `[ModuleName]_[DocumentNo-or-DateRange]_[YYYY-MM-DD].ext`
 * Characters that are illegal in filenames are collapsed to hyphens.
 */
export function exportFileName(module: string, scope: string | undefined, ext: 'pdf' | 'csv'): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  const parts = [module, scope, stamp()].filter((p): p is string => !!p && p.trim() !== '').map(clean)
  return `${parts.join('_')}.${ext}`
}

/** Filename-safe description of the active date filter. */
export function rangeScope(from: string, to: string): string {
  return from === to ? from : `${from}_to_${to}`
}

/** Human-readable date filter for the document header. */
export function rangeLabel(from: string, to: string): string {
  const fmt = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString()
  return from === to ? fmt(from) : `${fmt(from)} — ${fmt(to)}`
}

export async function savePdf(html: string, fileName: string, paper: PaperOptions): Promise<SaveResult> {
  return api<SaveResult>('export:pdf', { html, fileName, paper })
}

export async function saveCsv(csv: string, fileName: string): Promise<SaveResult> {
  return api<SaveResult>('export:csv', { csv, fileName })
}

/** PDF for a report described by an ExportDoc. */
export async function exportDocPdf(doc: ExportDoc, ctx: DocContext): Promise<SaveResult> {
  // Page geometry always comes from the same settings the HTML was rendered
  // with, so a PDF can never disagree with its print preview.
  return savePdf(docToHtml(doc, ctx), exportFileName(doc.module, doc.scope, 'pdf'), paperFrom(ctx.settings))
}

/** CSV for a report described by an ExportDoc. */
export async function exportDocCsv(doc: ExportDoc): Promise<SaveResult> {
  return saveCsv(toCsv(doc), exportFileName(doc.module, doc.scope, 'csv'))
}

export { docToHtml }
// Printing goes through `usePrinter`, which is the only place that knows the
// device, copies and colour mode. There is deliberately no fire-and-forget
// print helper here: a caller that cannot report a failure should not print.
export { useDocContext, usePrinter, effectiveCurrency, type PrintOptions } from './context'
