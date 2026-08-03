import { app, BrowserWindow, dialog } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { openDb, closeDb } from './db'
import { registerIpc } from './ipc'
import { registerImageProtocol } from './services/images'
import { startSubscriptionScheduler } from './services/subscription'
import { startGoogleDriveBackupScheduler } from './services/googleDriveBackup'
import { startLocalBackupScheduler, backupOnClose } from './services/localAutoBackup'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

let win: BrowserWindow | null

// Two processes on one pos.db is how a shop loses a day of sales. It also
// matters for restore: relaunching hands the database over to a new process,
// and a leftover instance holding the old file would fight it for the lock.
// The headless suites run their own throwaway data directory, so they opt out.
const headless = process.env.POS_SMOKE === '1' || process.env.POS_PRINT_SMOKE === '1'
if (!headless && !app.requestSingleInstanceLock()) {
  app.exit(0)
}

app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

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

// A shop that closes at 8pm would never reach a backup scheduled for 9pm, so
// the last thing the app does is back itself up. The quit is deferred exactly
// once — backupOnClose never throws and never runs longer than its own timeout,
// so this cannot leave the app unable to close.
let closingBackupStarted = false
app.on('before-quit', (event) => {
  if (closingBackupStarted) {
    closeDb()
    return
  }
  closingBackupStarted = true
  event.preventDefault()
  void backupOnClose().finally(() => {
    closeDb()
    app.quit()
  })
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
  if (process.env.POS_PRINT_SMOKE === '1') {
    const { runPrintSmokeTest } = await import('./printSmoke')
    let code = 1
    try {
      code = await runPrintSmokeTest()
    } catch (err) {
      console.error('PRINT SMOKE CRASH', err)
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
  // Anything failing between here and createWindow() would otherwise reject the
  // whenReady promise silently, leaving the shop staring at no window at all.
  try {
    registerImageProtocol()
    registerIpc(!!VITE_DEV_SERVER_URL)
    startSubscriptionScheduler()
    startGoogleDriveBackupScheduler()
    startLocalBackupScheduler()
  } catch (err) {
    dialog.showErrorBox('POS Desktop — startup error', String(err))
    app.exit(1)
    return
  }
  createWindow()
})
