import { BrowserWindow } from 'electron'

// Virtual print drivers prompt for a file path, which must never happen mid-sale.
const VIRTUAL_PRINTER = /print to pdf|xps document writer|onenote|send to|fax/i

function doPrint(
  win: BrowserWindow,
  options: Electron.WebContentsPrintOptions
): Promise<boolean> {
  return new Promise((resolve) => {
    win.webContents.print(
      { printBackground: true, margins: { marginType: 'none' }, ...options },
      (success) => resolve(success)
    )
  })
}

/**
 * Print an HTML document. Receipts print silently to a real (non-virtual)
 * printer — preferring the OS default — so completing a sale never pops a
 * "save as file" prompt. Pass silent: false to show the system print dialog.
 */
export async function printHtml(input: { html: string; silent?: boolean }): Promise<{ printed: boolean }> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(input.html))

    if (input.silent === false) {
      return { printed: await doPrint(win, { silent: false }) }
    }

    const printers = await win.webContents.getPrintersAsync()
    const real = printers.filter((p) => !VIRTUAL_PRINTER.test(p.displayName || p.name))
    const target = real.find((p) => p.isDefault) ?? real[0]
    if (!target) {
      throw new Error('no printer connected — set up a receipt printer in Windows')
    }

    const printed = await doPrint(win, { silent: true, deviceName: target.name })
    if (!printed) {
      throw new Error(`printer "${target.displayName || target.name}" did not accept the job`)
    }
    return { printed }
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}
