// The one data model every printable report and document in the app is
// described with. A module declares its columns and rows once; CSV, PDF and
// the print preview are all derived from that single description, so exported
// values can never drift from what the screen shows.
import type { ColorMode, PaperSize, PrintSettings, Shop } from '../../shared/types'

export type { ColorMode, PaperSize, PrintSettings }

export type CellValue = string | number | null | undefined

export interface ExportColumn<T> {
  header: string
  /**
   * Raw value. Numbers must stay numbers — CSV writes them unformatted so
   * spreadsheets can sum them.
   */
  value: (row: T) => CellValue
  /** Value is integer paisa: CSV gets a plain decimal, PDF gets formatted money. */
  money?: boolean
  align?: 'left' | 'right'
}

export interface ExportSection<T = never> {
  title?: string
  columns: ExportColumn<T>[]
  rows: T[]
  /** Bold summary row. Must line up with `columns`; use null for blank cells. */
  footer?: CellValue[]
  emptyText?: string
}

/** Erases the row type so sections of different shapes can share one document. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySection = ExportSection<any>

/** Keeps per-column type inference at the call site while erasing it here. */
export function section<T>(s: ExportSection<T>): AnySection {
  return s as AnySection
}

export interface ExportDoc {
  /** PascalCase id used in the filename, e.g. "SalesReport", "SalesInvoice". */
  module: string
  /** Document number or date range for the filename, e.g. "SAL-2026-0001". */
  scope?: string
  title: string
  subtitle?: string
  /** Applied filters and context, printed under the title. */
  meta?: [string, string][]
  /** Headline figures rendered as cards above the tables. */
  stats?: { label: string; value: string }[]
  sections: AnySection[]
  /** Explanatory note printed under the tables. */
  note?: string
}

/**
 * Page geometry handed to the main process. Derived from PrintSettings by
 * `paperFrom` — never assembled by a module, so no screen can invent its own
 * page setup.
 */
export interface PaperOptions {
  size: PaperSize
  landscape: boolean
  marginTopMm: number
  marginRightMm: number
  marginBottomMm: number
  marginLeftMm: number
  color: ColorMode
  pageNumbers: boolean
}

export function paperFrom(s: PrintSettings): PaperOptions {
  return {
    size: s.paper_size,
    landscape: s.landscape,
    marginTopMm: s.margin_top_mm,
    marginRightMm: s.margin_right_mm,
    marginBottomMm: s.margin_bottom_mm,
    marginLeftMm: s.margin_left_mm,
    color: s.color_mode,
    pageNumbers: s.page_numbers,
  }
}

/**
 * Everything a template needs to render. `settings` is the shop's saved
 * printer/receipt configuration, already merged with any per-print override, so
 * a template never reads settings itself — it renders exactly what it is given.
 */
export interface DocContext {
  shop: Shop | null
  /** Effective symbol: the receipt override if set, else the shop currency. */
  currency: string
  settings: PrintSettings
}

/**
 * Optional bill fields whose visibility is driven by the receipt toggles. A
 * field with a toggle on but no value prints as a blank ruled line for the
 * counter to fill in by hand — an unsigned invoice still leaves room to sign.
 */
export interface DocFields {
  preparedBy?: string | null
  notes?: string | null
}
