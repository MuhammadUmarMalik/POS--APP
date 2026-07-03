import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { openDb } from './db.js'
import { deviceRoutes } from './deviceRoutes.js'
import { adminRoutes } from './adminRoutes.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 8080)

export function createApp() {
  openDb()
  const app = express()
  // Sync pushes carry whole tables; activation requests carry a base64 screenshot.
  app.use(express.json({ limit: '25mb' }))
  app.use(deviceRoutes)
  app.use(adminRoutes)

  // Admin UI (built by vite into ../public).
  const publicDir = path.join(__dirname, '..', 'public')
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir))
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next()
      res.sendFile(path.join(publicDir, 'index.html'))
    })
  }
  return app
}

// Started directly (not imported by the smoke test).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  createApp().listen(PORT, () => {
    console.log(`[pos-cloud] listening on http://localhost:${PORT}`)
  })
}
