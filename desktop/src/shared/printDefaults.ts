// Defaults for printer & receipt settings, shared by the main process (used when
// a shop has no saved row) and the renderer (used before the first load lands,
// and by "Reset to defaults" in the Settings form).
//
// Defined once here so an empty settings table and a freshly reset form can
// never disagree about what "default" means.
import type { PrintSettings } from './types'

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  paper_size: 'A4',
  landscape: false,
  margin_top_mm: 12,
  margin_right_mm: 12,
  margin_bottom_mm: 12,
  margin_left_mm: 12,
  color_mode: 'color',
  page_numbers: true,
  copies: 1,
  auto_print_on_save: false,

  // Counter-side sales default to the 80 mm roll, matching how the POS behaved
  // before these settings existed.
  receipt_template: 'thermal',
  show_logo: true,
  show_header: true,
  header_text: null,
  footer_text: null,
  show_prepared_by: true,
  show_notes: true,
  currency_symbol: null,
  currency_position: 'before',
}
