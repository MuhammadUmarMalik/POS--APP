// Product images live in userData/product-images and are served to the
// renderer through the pos-img:// protocol (registered in main.ts).
import { app, dialog, BrowserWindow, protocol } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { uid, AppError } from './helpers'

const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

export function imagesDir(): string {
  const dir = path.join(app.getPath('userData'), 'product-images')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function registerImageProtocol() {
  protocol.handle('pos-img', async (request) => {
    const name = path.basename(decodeURIComponent(new URL(request.url).hostname + new URL(request.url).pathname))
    const file = path.join(imagesDir(), name)
    if (!fs.existsSync(file)) return new Response('Not found', { status: 404 })
    return new Response(await fs.promises.readFile(file) as unknown as BodyInit, {
      headers: { 'content-type': mimeFor(path.extname(file)) },
    })
  })
}

function mimeFor(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.png': return 'image/png'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    default: return 'image/jpeg'
  }
}

/** Open a file picker and copy the chosen images into the store. Returns stored file names. */
export async function pickProductImages(): Promise<string[]> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Choose product images',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
  })
  if (canceled || filePaths.length === 0) return []
  const dir = imagesDir()
  const names: string[] = []
  for (const src of filePaths.slice(0, 8)) {
    const ext = path.extname(src).toLowerCase()
    if (!ALLOWED_EXT.has(ext)) throw new AppError(`Unsupported image type: ${ext}`)
    const stat = await fs.promises.stat(src)
    if (stat.size > 5 * 1024 * 1024) throw new AppError('Images must be under 5 MB each')
    const name = `${uid()}${ext}`
    await fs.promises.copyFile(src, path.join(dir, name))
    names.push(name)
  }
  return names
}

/** Best-effort removal of image files that are no longer referenced. */
export function deleteImageFiles(fileNames: string[]) {
  const dir = imagesDir()
  for (const name of fileNames) {
    try {
      fs.unlinkSync(path.join(dir, path.basename(name)))
    } catch {
      /* already gone — fine */
    }
  }
}
