import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { homedir } from 'os'

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

export default defineConfig({
  appType: 'spa',
  base,
  cacheDir,
  plugins: [
    react(),
    // Fix favicon and apple-touch-icon paths when served under a base path (e.g. /dc-automation on Pi)
    {
      name: 'html-favicon-base',
      transformIndexHtml(html) {
        const iconHref = base === '/' ? '/icon.png' : `${base}icon.png`
        return html
          .replace(/(<link rel="icon"[^>]+href=")[^"]*(")/, `$1${iconHref}$2`)
          .replace(/(<link rel="apple-touch-icon"[^>]+href=")[^"]*(")/, `$1${iconHref}$2`)
      },
    },
  ],
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
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
    include: ['papaparse'],
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
