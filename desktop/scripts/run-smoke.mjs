/**
 * Runs the acceptance suite (electron/smoke.ts) in a real Electron main process.
 *
 * The suite cannot be run with plain `node`: it exercises the same IPC services,
 * app paths and better-sqlite3 build that ship to a shop, so it has to run in the
 * runtime those were compiled for. main.ts checks POS_SMOKE and calls
 * runSmokeTest() from app.whenReady(), then exits with the assertion count.
 *
 * Two things this wrapper exists to get right, and that a bare npm script on
 * Windows gets wrong:
 *
 *  1. ELECTRON_RUN_AS_NODE must be UNSET. Some shells and IDE terminals export
 *     it; when it is set Electron boots as a plain Node process, the ESM main
 *     bundle fails to load, and the failure looks nothing like its cause.
 *  2. The exit code must be propagated, or CI would go green on a failing suite.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import electronPath from 'electron'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const mainBundle = join(root, 'dist-electron', 'main.js')

if (!existsSync(mainBundle)) {
  console.error(
    `\nThe main process has not been bundled yet (${mainBundle} is missing).\n` +
      'Run `npm run build:main` first, or just `npm test` which does both.\n'
  )
  process.exit(1)
}

const env = { ...process.env, POS_SMOKE: '1' }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electronPath, ['.'], { cwd: root, env, stdio: 'inherit' })

child.on('error', (err) => {
  console.error('Could not start Electron:', err.message)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`\nThe suite was killed by ${signal}.`)
    process.exit(1)
  }
  process.exit(code ?? 1)
})
