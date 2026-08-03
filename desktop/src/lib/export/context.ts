// How every screen gets a DocContext and reaches the printer.
//
// Modules call `useDocContext()` and `usePrinter()` — they never read the
// settings store directly and never build a print payload by hand. That is what
// keeps page setup identical across sales, purchases, ledgers and reports.
import { useMemo } from 'react'
import { api } from '../ipc'
import { useAuth, useCurrency } from '../../stores/auth'
import { usePrintSettings } from '../../stores/printSettings'
import type { DocContext, PrintSettings } from './types'

/** Symbol chosen for receipts, falling back to the shop currency. */
export function effectiveCurrency(settings: PrintSettings, shopCurrency: string): string {
  return settings.currency_symbol?.trim() || shopCurrency
}

/**
 * Document context built from the shop's saved settings.
 *
 * `override` is a per-print change — the user picking A5 for one report without
 * touching the shop default. It is merged on top and never persisted.
 */
export function useDocContext(override?: Partial<PrintSettings>): DocContext {
  const shop = useAuth((s) => s.state?.shop ?? null)
  const shopCurrency = useCurrency()
  const saved = usePrintSettings((s) => s.settings)

  // Depend on the override's contents, not its identity: callers pass a fresh
  // object literal on every render and a new ctx would re-render the tree.
  const overrideKey = override ? JSON.stringify(override) : ''

  return useMemo(() => {
    const settings: PrintSettings = override ? { ...saved, ...override } : saved
    return { shop, currency: effectiveCurrency(settings, shopCurrency), settings }
  }, [shop, shopCurrency, saved, overrideKey]) // eslint-disable-line react-hooks/exhaustive-deps
}

export interface PrintOptions {
  /** false shows the system print dialog. Silent uses the configured printer. */
  silent?: boolean
}

/**
 * Sends HTML to the printer with the copies, colour mode and device from the
 * effective settings. Rejects with a readable message when the printer is
 * missing — auto-print must never fail silently.
 */
export function usePrinter() {
  const printerName = usePrintSettings((s) => s.printerName)

  return useMemo(
    () => ({
      printerName,
      print: (html: string, settings: PrintSettings, options: PrintOptions = {}) =>
        api<{ printed: boolean; printer?: string }>('print:html', {
          html,
          silent: options.silent,
          deviceName: printerName ?? undefined,
          copies: settings.copies,
          color: settings.color_mode,
        }),
    }),
    [printerName]
  )
}
