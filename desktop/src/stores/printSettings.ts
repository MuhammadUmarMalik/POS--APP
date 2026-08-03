// The renderer's single source of truth for printer & receipt settings.
//
// Every print, PDF and receipt in the app reads from this store. Because it is
// one zustand store, saving in Settings updates every open screen immediately —
// there is no per-module copy to invalidate and no restart required.
//
// Settings themselves live in the DB (per shop). The chosen printer is the one
// exception: printer names are per-machine, so a second till would inherit a
// device it does not have. That value stays in local storage.
import { create } from 'zustand'
import { api } from '../lib/ipc'
import { DEFAULT_PRINT_SETTINGS } from '../shared/printDefaults'
import type { PrintSettings, Printer } from '../shared/types'
import type { PrintSettingsInput } from '../shared/schemas'

const PRINTER_KEY = 'pos.default-printer.v1'

function readPrinter(): string | null {
  try {
    return localStorage.getItem(PRINTER_KEY) || null
  } catch {
    return null
  }
}

function writePrinter(name: string | null): void {
  try {
    if (name) localStorage.setItem(PRINTER_KEY, name)
    else localStorage.removeItem(PRINTER_KEY)
  } catch {
    // Printer choice is a convenience; storage failures fall back to the OS
    // default rather than blocking a sale.
  }
}

interface PrintSettingsStore {
  settings: PrintSettings
  /** False until the first load resolves. Templates still render on defaults. */
  loaded: boolean
  /** Device name for silent printing, or null to use the OS default. */
  printerName: string | null
  load: () => Promise<void>
  save: (input: PrintSettingsInput) => Promise<void>
  reset: () => Promise<void>
  setPrinter: (name: string | null) => void
  listPrinters: () => Promise<Printer[]>
}

let loadPromise: Promise<void> | null = null

export const usePrintSettings = create<PrintSettingsStore>((set) => ({
  settings: DEFAULT_PRINT_SETTINGS,
  loaded: false,
  printerName: readPrinter(),

  load: () => {
    // Several screens mount at once on startup; collapse them into one call.
    if (!loadPromise) {
      loadPromise = api<PrintSettings>('printSettings:get')
        .then((settings) => set({ settings, loaded: true }))
        .catch(() => {
          // An unreachable settings table must never stop a shop from printing.
          set({ loaded: true })
        })
        .finally(() => {
          loadPromise = null
        })
    }
    return loadPromise
  },

  save: async (input) => {
    const settings = await api<PrintSettings>('printSettings:update', input)
    set({ settings })
  },

  reset: async () => {
    const settings = await api<PrintSettings>('printSettings:reset')
    set({ settings })
  },

  setPrinter: (name) => {
    writePrinter(name)
    set({ printerName: name })
  },

  listPrinters: () => api<Printer[]>('printers:list'),
}))

/** Saved settings for the current shop. Defaults until the first load lands. */
export function usePrintSettingsValue(): PrintSettings {
  return usePrintSettings((s) => s.settings)
}
