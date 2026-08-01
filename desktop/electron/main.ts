import { app, BrowserWindow, dialog } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { openDb, closeDb } from './db'
import { registerIpc } from './ipc'
import { registerImageProtocol } from './services/images'
import { startAutoSyncScheduler } from './services/sync'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

let win: BrowserWindow | null

function createWindow() {
  win = new BrowserWindow({
    title: 'POS Desktop',
    show: false,
    backgroundColor: '#f8fafc',
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Do not expose Chromium's blank surface. Show the window only after the
  // renderer has produced its first frame (the inline startup screen or React).
  win.once('ready-to-show', () => {
    win?.maximize()
    win?.show()
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('before-quit', () => {
  closeDb()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(async () => {
  if (process.env.POS_SMOKE === '1') {
    const { runSmokeTest } = await import('./smoke')
    let code = 1
    try {
      code = await runSmokeTest()
    } catch (err) {
      console.error('SMOKE CRASH', err)
    }
    app.exit(code)
    return
  }
  try {
    openDb()
  } catch (err) {
    dialog.showErrorBox('POS Desktop — database error', String(err))
    app.exit(1)
    return
  }
  registerImageProtocol()
  registerIpc(!!VITE_DEV_SERVER_URL)
  startAutoSyncScheduler()
  createWindow()
})
