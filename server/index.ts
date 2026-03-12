import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { runSeed } from './db/seed.js'
import { authRouter } from './routes/auth.js'
import { adminRouter } from './routes/admin.js'
import { fieldsRouter } from './routes/fields.js'
import { testPlansRouter } from './routes/testPlans.js'
import { recordsRouter } from './routes/records.js'
import { usersRouter } from './routes/users.js'
import { preferencesRouter } from './routes/preferences.js'
import { uploadsRouter } from './routes/uploads.js'
import { sanitizeForLog } from './utils/sanitizeLog.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = Number(process.env.PORT) || 3001
const isProd = process.env.NODE_ENV === 'production'
const basePath = (process.env.BASE_PATH ?? '').replace(/\/$/, '')

app.use(cors({ origin: true, credentials: true }))
app.use(express.json())

// When BASE_PATH is unset, prefix should be '' so API mounts at `/api`, not `//api`
const prefix = basePath || ''
const apiRouter = express.Router()
apiRouter.get('/health', (_req, res) => res.json({ ok: true }))
apiRouter.use('/auth', authRouter)
apiRouter.use('/admin', adminRouter)
apiRouter.use('/fields', fieldsRouter)
apiRouter.use('/test-plans', testPlansRouter)
apiRouter.use('/records', recordsRouter)
apiRouter.use('/users', usersRouter)
apiRouter.use('/preferences', preferencesRouter)
apiRouter.use('/upload', uploadsRouter)
apiRouter.use('/uploads', express.static(path.join(process.cwd(), 'uploads')))
app.use(`${prefix}/api`, apiRouter)

// Debug: log request path for auth (remove after fixing 404)
app.use((req, res, next) => {
  if (req.path?.includes('auth') || req.url?.includes('auth')) {
    console.warn('[auth req]', req.method, 'path=', req.path, 'url=', req.url)
  }
  next()
})

// Middleware: for GET under basePath (except /api), serve file from dist or pass through (no route pattern)
if (isProd && basePath) {
  const distPath = path.join(__dirname, '..')
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    let pathname = req.path ?? req.url?.split('?')[0] ?? ''
    if (!pathname.startsWith('/')) pathname = '/' + pathname
    // req.path may be relative to mount (e.g. /assets/foo when app is under /automation-testing)
    const underBasePath = pathname.startsWith(basePath + '/') || pathname === basePath
    const relativePath = pathname.startsWith('/assets/') || pathname === '/' || pathname === ''
    if (!underBasePath && !relativePath) return next()
    if (pathname.startsWith(basePath + '/api') || pathname.startsWith('/api')) return next()
    const subpath = underBasePath
      ? (pathname === basePath ? 'index.html' : pathname.slice(basePath.length).replace(/^\/+/, ''))
      : (pathname === '/' || pathname === '' ? 'index.html' : pathname.replace(/^\/+/, ''))
    const filePath = path.join(distPath, subpath)
    const resolved = path.resolve(filePath)
    const distResolved = path.resolve(distPath)
    if (!resolved.startsWith(distResolved)) return next()
    fs.stat(resolved, (err, stat) => {
      if (err || !stat.isFile()) return next()
      res.sendFile(resolved)
    })
  })
  // SPA fallback: GET under basePath or relative path that didn't match a file
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    let pathname = req.path ?? req.url?.split('?')[0] ?? ''
    if (!pathname.startsWith('/')) pathname = '/' + pathname
    const underBasePath = pathname.startsWith(basePath + '/') || pathname === basePath
    const relativePath = pathname.startsWith('/assets/') || pathname === '/' || pathname === ''
    if (!underBasePath && !relativePath) return next()
    if (pathname.startsWith(basePath + '/api') || pathname.startsWith('/api')) return next()
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

// Log errors with upload paths redacted
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(sanitizeForLog(err.message))
  if (err.stack) console.error(sanitizeForLog(err.stack))
  res.status(500).json({ error: 'Internal server error' })
})

runSeed()

if (isProd && !basePath) {
  const distPath = path.join(__dirname, '..')
  app.use(express.static(distPath))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next()
    res.sendFile(path.join(distPath, 'index.html'))
  })
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }))
}

app.listen(PORT, '0.0.0.0', () => {
  const p = basePath || '(none)'
  console.log(`Server running on http://0.0.0.0:${PORT} BASE_PATH=${p}`)
})
