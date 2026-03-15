import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const base = process.env.VITE_BASE_PATH ? `${process.env.VITE_BASE_PATH.replace(/\/$/, '')}/` : '/'

export default defineConfig({
  appType: 'spa',
  base,
  plugins: [
    react(),
    // Fix favicon and apple-touch-icon paths when served under a base path (e.g. /automation-testing on Pi)
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
