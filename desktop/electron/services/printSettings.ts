// Printer & receipt defaults, persisted per shop. Every printable document in
// the app resolves its page setup from here — there is no per-module print
// config anywhere else in the codebase.
//
// A shop that has never opened the settings screen has no row. Reads fall back
// to DEFAULT_PRINT_SETTINGS rather than inserting on demand, so printing works
// on a fresh install and an empty table can never break a sale.
import { BrowserWindow } from 'electron'
import { getDb } from '../db'
import { uid, now, audit } from './helpers'
import { DEFAULT_PRINT_SETTINGS } from '../../src/shared/printDefaults'
import type { PrintSettings, Printer, Session } from '../../src/shared/types'
import type { PrintSettingsInput } from '../../src/shared/schemas'

interface Row {
  paper_size: string
  landscape: number
  margin_top_mm: number
  margin_right_mm: number
  margin_bottom_mm: number
  margin_left_mm: number
  color_mode: string
  page_numbers: number
  copies: number
  auto_print_on_save: number
  receipt_template: string
  show_logo: number
  show_header: number
  header_text: string | null
  footer_text: string | null
  show_prepared_by: number
  show_notes: number
  currency_symbol: string | null
  currency_position: string
}

const COLUMNS =
  'paper_size, landscape, margin_top_mm, margin_right_mm, margin_bottom_mm, margin_left_mm, ' +
  'color_mode, page_numbers, copies, auto_print_on_save, receipt_template, show_logo, ' +
  'show_header, header_text, footer_text, show_prepared_by, ' +
  'show_notes, currency_symbol, currency_position'

/** SQLite has no boolean type; every flag round-trips through 0/1. */
function fromRow(row: Row): PrintSettings {
  return {
    paper_size: row.paper_size as PrintSettings['paper_size'],
    landscape: row.landscape === 1,
    margin_top_mm: row.margin_top_mm,
    margin_right_mm: row.margin_right_mm,
    margin_bottom_mm: row.margin_bottom_mm,
    margin_left_mm: row.margin_left_mm,
    color_mode: row.color_mode as PrintSettings['color_mode'],
    page_numbers: row.page_numbers === 1,
    copies: row.copies,
    auto_print_on_save: row.auto_print_on_save === 1,
    receipt_template: row.receipt_template as PrintSettings['receipt_template'],
    show_logo: row.show_logo === 1,
    show_header: row.show_header === 1,
    header_text: row.header_text,
    footer_text: row.footer_text,
    show_prepared_by: row.show_prepared_by === 1,
    show_notes: row.show_notes === 1,
    currency_symbol: row.currency_symbol,
    currency_position: row.currency_position as PrintSettings['currency_position'],
  }
}

export function getPrintSettings(shopId: string): PrintSettings {
  const row = getDb()
    .prepare(`SELECT ${COLUMNS} FROM print_settings WHERE shop_id = ?`)
    .get(shopId) as Row | undefined
  return row ? fromRow(row) : DEFAULT_PRINT_SETTINGS
}

/**
 * Upsert on shop_id. Settings are shop-wide, so a shop can only ever have one
 * row — the UNIQUE constraint makes the conflict target unambiguous.
 */
export function updatePrintSettings(session: Session, input: PrintSettingsInput): PrintSettings {
  const ts = now()
  getDb()
    .prepare(
      `INSERT INTO print_settings (
         id, shop_id, ${COLUMNS}, created_at, updated_at
       ) VALUES (
         @id, @shop_id, @paper_size, @landscape, @margin_top_mm, @margin_right_mm,
         @margin_bottom_mm, @margin_left_mm, @color_mode, @page_numbers, @copies,
         @auto_print_on_save, @receipt_template, @show_logo, @show_header, @header_text,
         @footer_text, @show_prepared_by, @show_notes,
         @currency_symbol, @currency_position, @created_at, @updated_at
       )
       ON CONFLICT (shop_id) DO UPDATE SET
         paper_size = excluded.paper_size,
         landscape = excluded.landscape,
         margin_top_mm = excluded.margin_top_mm,
         margin_right_mm = excluded.margin_right_mm,
         margin_bottom_mm = excluded.margin_bottom_mm,
         margin_left_mm = excluded.margin_left_mm,
         color_mode = excluded.color_mode,
         page_numbers = excluded.page_numbers,
         copies = excluded.copies,
         auto_print_on_save = excluded.auto_print_on_save,
         receipt_template = excluded.receipt_template,
         show_logo = excluded.show_logo,
         show_header = excluded.show_header,
         header_text = excluded.header_text,
         footer_text = excluded.footer_text,
         show_prepared_by = excluded.show_prepared_by,
         show_notes = excluded.show_notes,
         currency_symbol = excluded.currency_symbol,
         currency_position = excluded.currency_position,
         updated_at = excluded.updated_at`
    )
    .run({
      id: uid(),
      shop_id: session.shopId,
      ...input,
      landscape: input.landscape ? 1 : 0,
      page_numbers: input.page_numbers ? 1 : 0,
      auto_print_on_save: input.auto_print_on_save ? 1 : 0,
      show_logo: input.show_logo ? 1 : 0,
      show_header: input.show_header ? 1 : 0,
      show_prepared_by: input.show_prepared_by ? 1 : 0,
      show_notes: input.show_notes ? 1 : 0,
      header_text: input.header_text ?? null,
      footer_text: input.footer_text ?? null,
      currency_symbol: input.currency_symbol ?? null,
      created_at: ts,
      updated_at: ts,
    })

  audit(session, 'print_settings.update', input)
  return getPrintSettings(session.shopId)
}

/**
 * Reset to defaults by deleting the row, not by writing the default values.
 * A stored "default-looking" row and no row at all must behave identically, and
 * deleting is the only version that cannot leave a stale column behind if the
 * defaults change in a later release.
 */
export function resetPrintSettings(session: Session): PrintSettings {
  getDb().prepare('DELETE FROM print_settings WHERE shop_id = ?').run(session.shopId)
  audit(session, 'print_settings.reset', {})
  return DEFAULT_PRINT_SETTINGS
}

// Virtual drivers prompt for a file path, which must never happen mid-sale.
// Shared with print.ts so the list the user picks from and the list auto-print
// validates against apply the same rule.
export const VIRTUAL_PRINTER = /print to pdf|xps document writer|onenote|send to|fax/i

/** System printers, for the "default printer" dropdown in Settings. */
export async function listPrinters(): Promise<Printer[]> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win) return []
  const printers = await win.webContents.getPrintersAsync()
  return printers.map((p) => ({
    name: p.name,
    displayName: p.displayName || p.name,
    isDefault: p.isDefault,
    isVirtual: VIRTUAL_PRINTER.test(p.displayName || p.name),
  }))
}
