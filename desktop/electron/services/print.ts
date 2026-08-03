import { BrowserWindow } from 'electron'
import { AppError } from './helpers'
import { VIRTUAL_PRINTER } from './printSettings'
import { colorCss } from './export'

export interface PrintInput {
  html: string
  /** false shows the system print dialog; anything else prints silently. */
  silent?: boolean
  /** Printer chosen in Settings. Falls back to the OS default when absent. */
  deviceName?: string
  copies?: number
  /** Grayscale and black & white both drop to the printer's mono path. */
  color?: 'color' | 'grayscale' | 'bw'
}

function doPrint(
  win: BrowserWindow,
  options: Electron.WebContentsPrintOptions
): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    win.webContents.print(
      { printBackground: true, margins: { marginType: 'none' }, ...options },
      (success, failureReason) => resolve({ ok: success, reason: failureReason })
    )
  })
}

/**
 * Resolves the printer for a silent job. Throws rather than falling back to a
 * virtual driver: an auto-printed receipt that silently opens a "save as file"
 * prompt — or vanishes into OneNote — is worse than a visible error.
 */
async function resolveTarget(win: BrowserWindow, deviceName?: string) {
  const printers = await win.webContents.getPrintersAsync()
  if (printers.length === 0) {
    throw new AppError(
      'No printer is installed on this computer. Add a printer in Windows settings, then try again.'
    )
  }

  if (deviceName) {
    const chosen = printers.find((p) => p.name === deviceName)
    if (!chosen) {
      throw new AppError(
        `The printer saved in Settings ("${deviceName}") is not available. Reconnect it, or ` +
          'choose a different default printer in Settings → Printer & Receipt Settings.'
      )
    }
    return chosen
  }

  const real = printers.filter((p) => !VIRTUAL_PRINTER.test(p.displayName || p.name))
  const target = real.find((p) => p.isDefault) ?? real[0]
  if (!target) {
    throw new AppError(
      'Only "print to file" printers are installed. Set up a real printer in Windows, or ' +
        'choose one in Settings → Printer & Receipt Settings.'
    )
  }
  return target
}

/**
 * Print an HTML document. Receipts print silently to a real printer — the one
 * chosen in Settings, else the OS default — so completing a sale never pops a
 * "save as file" prompt. Pass silent: false to show the system print dialog.
 */
export async function printHtml(input: PrintInput): Promise<{ printed: boolean; printer?: string }> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  try {
    // Same colour handling as the PDF path: Chromium's mono flag alone leaves
    // black & white as a flat grey wash, so the filter does the desaturating and
    // the flag stops the driver mixing colour ink on top of it.
    const mode = input.color ?? 'color'
    const doc = input.html.replace('</head>', `<style>${colorCss(mode)}</style></head>`)
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(doc))

    const common: Electron.WebContentsPrintOptions = {
      copies: Math.min(Math.max(Math.round(input.copies ?? 1), 1), 10),
      color: mode === 'color',
    }

    // The dialog lets the user pick any printer, so a missing default is theirs
    // to resolve — don't pre-empt it with an error.
    if (input.silent === false) {
      const { ok } = await doPrint(win, { ...common, silent: false })
      return { printed: ok }
    }

    const target = await resolveTarget(win, input.deviceName)
    const label = target.displayName || target.name
    const { ok, reason } = await doPrint(win, { ...common, silent: true, deviceName: target.name })
    if (!ok) {
      throw new AppError(
        `Printer "${label}" did not accept the job${reason ? `: ${reason}` : ''}. Check that it ` +
          'is switched on, has paper, and is not showing an error.'
      )
    }
    return { printed: true, printer: label }
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}
