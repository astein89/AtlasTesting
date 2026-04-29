import fs from 'node:fs'
import path from 'path'
import { homedir } from 'os'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const base = process.env.VITE_BASE_PATH ? `${process.env.VITE_BASE_PATH.replace(/\/$/, '')}/` : '/'

/**
 * Vite optimized-deps cache **outside the repo** so:
 * - Dropbox (or similar sync) does not lock `.vite` during rename → `EBUSY` on `deps_temp_*` → `deps`.
 * - We still avoid arbitrary `os.tmpdir()` subfolders, which broke some optimized deps on Windows
 *   (e.g. papaparse via @fs/.../Temp/...).
 */
function viteCacheDir(): string {
  if (process.platform === 'win32') {
    const baseDir = process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local')
    return path.join(baseDir, 'dc-automation-vite-cache')
  }
  const baseDir = process.env.XDG_CACHE_HOME || path.join(homedir(), '.cache')
  return path.join(baseDir, 'dc-automation-vite-cache')
}

const cacheDir = viteCacheDir()
const iconPngFile = path.resolve(__dirname, 'public/icon.png')

export default defineConfig({
  appType: 'spa',
  base,
  cacheDir,
  plugins: [
    react(),
    /**
     * Browsers fetch `/favicon.ico` automatically; a broken or strict‑reject `.ico` leaves a blank tab
     * even when `<link rel="icon" href="/icon.png">` is valid. Serve `public/icon.png` as PNG for that URL (same as production Express).
     */
    {
      name: 'dev-favicon-png',
      enforce: 'pre',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url?.split('?')[0] ?? ''
          if (url !== '/favicon.ico' && !url.endsWith('/favicon.ico')) return next()
          fs.readFile(iconPngFile, (err, buf) => {
            if (err) return next()
            res.setHeader('Content-Type', 'image/png')
            res.setHeader('Cache-Control', 'no-store, must-revalidate')
            res.end(buf)
          })
        })
      },
    },
    /** Avoid stale icons in DevTools after overwriting `public/icon.*`. */
    {
      name: 'dev-no-store-icons',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const pathOnly = req.url?.split('?')[0] ?? ''
          if (/\/(icon|logo)\.(png|svg)$/i.test(pathOnly)) {
            res.setHeader('Cache-Control', 'no-store, must-revalidate')
          }
          next()
        })
      },
    },
    // Fix favicon and apple-touch-icon paths when served under a base path (e.g. /dc-automation on Pi)
    {
      name: 'html-favicon-base',
      transformIndexHtml(html) {
        const svgHref = base === '/' ? '/icon.svg' : `${base}icon.svg`
        const pngHref = base === '/' ? '/icon.png' : `${base}icon.png`
        return html
          .replaceAll('href="/icon.png"', `href="${pngHref}"`)
          .replaceAll('href="/icon.svg"', `href="${svgHref}"`)
          .replace(
            /<\/head>/i,
            `    <link rel="shortcut icon" type="image/png" href="${pngHref}" />\n  </head>`
          )
      },
    },
  ],
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('react-router')) {
            return 'vendor-react'
          }
          if (id.includes('mermaid')) return 'vendor-mermaid'
          if (
            id.includes('md-editor-rt') ||
            id.includes('@codemirror') ||
            id.includes('/codemirror') ||
            id.includes('prettier')
          ) {
            return 'vendor-editor'
          }
          if (id.includes('cron-parser') || id.includes('cronstrue') || id.includes('luxon')) {
            return 'vendor-schedule'
          }
          if (id.includes('jspdf') || id.includes('html2canvas')) return 'vendor-pdf'
          return undefined
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    include: ['papaparse', 'md-editor-rt'],
  },
  server: {
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
})
