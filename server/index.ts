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

if (isProd) {
  // distPath: from script location (dist/server/index.js -> dist) so it works under PM2 regardless of cwd
  const distPath = path.join(__dirname, '..')
  if (basePath) {
    // Serve static files under basePath by resolving path manually (avoids express.static mount issues)
    app.use(basePath, (req, res, next) => {
      let pathname = (req.originalUrl ?? req.url).split('?')[0]
      if (!pathname.startsWith('/')) pathname = '/' + pathname
      const after =
        pathname === basePath || pathname === basePath + '/'
          ? '/'
          : pathname.startsWith(basePath + '/')
            ? pathname.slice(basePath.length) || '/'
            : null
      if (after === null) return next()
      const relative = after === '/' ? 'index.html' : after.replace(/^\//, '')
      const filePath = path.join(distPath, relative)
      const resolved = path.resolve(filePath)
      const distResolved = path.resolve(distPath)
      if (!resolved.startsWith(distResolved)) return next()
      fs.stat(resolved, (err, stat) => {
        if (err || !stat.isFile()) return next()
        res.sendFile(resolved)
      })
    })
    app.get(basePath, (_, res) => {
      res.sendFile(path.join(distPath, 'index.html'))
    })
    app.get(`${basePath}/*`, (_, res) => {
      res.sendFile(path.join(distPath, 'index.html'))
    })
  } else {
    app.use(express.static(distPath))
    app.get('*', (_, res) => {
      res.sendFile(path.join(distPath, 'index.html'))
    })
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`)
})
