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

// Middleware: for GET under basePath (except /api), serve file from dist or pass through (no route pattern)
if (isProd && basePath) {
  const distPath = path.join(__dirname, '..')
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    let pathname = req.path ?? req.url?.split('?')[0] ?? ''
    if (!pathname.startsWith('/')) pathname = '/' + pathname
    if (!pathname.startsWith(basePath + '/') && pathname !== basePath) return next()
    if (pathname.startsWith(basePath + '/api')) return next()
    const subpath = pathname === basePath ? 'index.html' : pathname.slice(basePath.length).replace(/^\/+/, '')
    const filePath = path.join(distPath, subpath)
    const resolved = path.resolve(filePath)
    const distResolved = path.resolve(distPath)
    if (!resolved.startsWith(distResolved)) return next()
    fs.stat(resolved, (err, stat) => {
      if (err || !stat.isFile()) {
        if (subpath.startsWith('assets/')) console.warn('[basePath] stat failed:', resolved, err?.message ?? 'not a file')
        return next()
      }
      res.sendFile(resolved)
    })
  })
  // SPA fallback: GET under basePath (not /api) that didn't match a file
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    let pathname = req.path ?? req.url?.split('?')[0] ?? ''
    if (!pathname.startsWith('/')) pathname = '/' + pathname
    if (!pathname.startsWith(basePath + '/') && pathname !== basePath) return next()
    if (pathname.startsWith(basePath + '/api')) return next()
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

function mountRoutes(prefix: string) {
  app.use(`${prefix}/api/auth`, authRouter)
  app.use(`${prefix}/api/admin`, adminRouter)
  app.use(`${prefix}/api/fields`, fieldsRouter)
  app.use(`${prefix}/api/test-plans`, testPlansRouter)
  app.use(`${prefix}/api/records`, recordsRouter)
  app.use(`${prefix}/api/users`, usersRouter)
  app.use(`${prefix}/api/preferences`, preferencesRouter)
  app.use(`${prefix}/api/upload`, uploadsRouter)
  app.use(`${prefix}/api/uploads`, express.static(path.join(process.cwd(), 'uploads')))
}

mountRoutes(basePath || '/')

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
  app.get('*', (_, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`)
})
