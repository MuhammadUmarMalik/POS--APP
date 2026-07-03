import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Admin UI: source in ./admin, built into ./public (served by Express).
export default defineConfig({
  root: path.join(__dirname, 'admin'),
  plugins: [react(), tailwindcss()],
  build: { outDir: path.join(__dirname, 'public'), emptyOutDir: true },
  server: { proxy: { '/api': 'http://localhost:8080' } },
})
