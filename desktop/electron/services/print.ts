import { BrowserWindow } from 'electron'

/**
 * Print an HTML document. Receipts print silently to the default printer;
 * if silent printing fails (e.g. no default printer) we fall back to the dialog.
 */
export async function printHtml(input: { html: string; silent?: boolean }): Promise<{ printed: boolean }> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(input.html))
    const printed = await new Promise<boolean>((resolve) => {
      win.webContents.print(
        {
          silent: input.silent ?? true,
          printBackground: true,
          margins: { marginType: 'none' },
        },
        (success) => resolve(success)
      )
    })
    if (!printed && input.silent !== false) {
      // Retry with the system dialog so the user can pick a printer.
      const retried = await new Promise<boolean>((resolve) => {
        win.webContents.print({ silent: false, printBackground: true }, (s) => resolve(s))
      })
      return { printed: retried }
    }
    return { printed }
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}
