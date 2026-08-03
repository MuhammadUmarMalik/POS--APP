// RFC 4180 CSV generation from an ExportDoc. Money is emitted as a plain
// decimal number with no currency symbol and no thousands separators, so cells
// land in a spreadsheet as numbers rather than text.
import type { AnySection, CellValue, ExportDoc } from './types'

/**
 * Leading =, +, @ and tab make Excel/Sheets evaluate the cell as a formula.
 * Only strings are guarded — negative numbers must keep their minus sign.
 */
function neutralise(text: string): string {
  return /^[=+@\t\r]/.test(text) ? `'${text}` : text
}

function escapeCell(value: CellValue): string {
  if (value == null) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  const text = neutralise(String(value))
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Integer paisa → a decimal number Excel reads as currency-free numeric. */
function paisaToNumber(value: CellValue): CellValue {
  if (value == null || value === '') return ''
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n / 100 : ''
}

function sectionRows(s: AnySection): string[] {
  const lines: string[] = []
  if (s.title) lines.push(escapeCell(s.title))
  lines.push(s.columns.map((c) => escapeCell(c.header)).join(','))

  for (const row of s.rows) {
    lines.push(
      s.columns
        .map((c) => {
          const raw = c.value(row)
          return escapeCell(c.money ? paisaToNumber(raw) : raw)
        })
        .join(',')
    )
  }

  if (s.footer) {
    // Footer cells belong to their column, so they take the same money
    // conversion as the body — otherwise the CSV total would disagree with the
    // PDF total. Padded to the column count so a mis-sized footer cannot shift
    // columns.
    const cells = s.columns.map((c, i) => {
      const raw = s.footer?.[i] ?? ''
      return escapeCell(c.money ? paisaToNumber(raw) : raw)
    })
    lines.push(cells.join(','))
  }
  return lines
}

/**
 * Single-section documents produce a clean header-plus-rows table that imports
 * directly. Multi-section documents separate each table with a blank line —
 * unavoidable when one report holds several differently-shaped tables.
 */
export function toCsv(doc: ExportDoc): string {
  const blocks = doc.sections.map(sectionRows).map((lines) => lines.join('\r\n'))
  return blocks.join('\r\n\r\n') + '\r\n'
}
