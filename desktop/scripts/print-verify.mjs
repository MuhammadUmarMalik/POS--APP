// Runs the print smoke test: builds the HTML fixtures, compiles the main
// process, then launches Electron so every document goes through the real
// Chromium printToPDF pipeline.
//
//   npm run verify:print
//
// Spawning from node rather than an npm script keeps this working on Windows
// shells and lets us clear ELECTRON_RUN_AS_NODE, which otherwise makes the
// electron binary behave as plain node and never open a browser window.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const win = process.platform === 'win32'
const npm = win ? 'npm.cmd' : 'npm'

// Node 22 refuses to spawn .cmd shims without a shell, and a shell needs the
// quoting done by hand.
function run(cmd, args, env) {
  const quote = (s) => (win && /\s/.test(s) ? `"${s}"` : s)
  const r = spawnSync(win ? quote(cmd) : cmd, win ? args.map(quote) : args, {
    cwd: root,
    stdio: 'inherit',
    shell: win,
    env: { ...process.env, ...env },
  })
  if (r.error) throw r.error
  return r.status ?? 1
}

// 1. Build the fixtures — this also re-runs every export assertion.
let code = run(npm, ['run', 'verify:export'])
if (code !== 0) process.exit(code)

// 2. Compile the main process if it is missing or older than its sources.
const mainJs = path.join(root, 'dist-electron', 'main.js')
const newestSource = fs
  .readdirSync(path.join(root, 'electron'), { recursive: true })
  .map((f) => path.join(root, 'electron', String(f)))
  .filter((f) => f.endsWith('.ts'))
  .reduce((a, f) => Math.max(a, fs.statSync(f).mtimeMs), 0)

if (!fs.existsSync(mainJs) || fs.statSync(mainJs).mtimeMs < newestSource) {
  code = run(npm, ['run', 'build:main'])
  if (code !== 0) process.exit(code)
}

// 3. Render everything through the real printer pipeline.
const electronBin = path.join(root, 'node_modules', '.bin', win ? 'electron.cmd' : 'electron')
// ELECTRON_RUN_AS_NODE makes the electron binary behave as plain node, which
// leaves it with no Chromium and so nothing to render a PDF with.
process.exit(run(electronBin, [mainJs], { ELECTRON_RUN_AS_NODE: undefined, POS_PRINT_SMOKE: '1' }))
