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
    // Handler: serve file from dist if exists, else index.html
    const serveBasePath = (req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.warn('[serveBasePath] hit path=', req.path, 'url=', req.url)
      let pathname = req.path
      if (!pathname.startsWith('/')) pathname = '/' + pathname
      if (!pathname.startsWith(basePath)) return next()
      const subpath = pathname.slice(basePath.length).replace(/^\/+/, '') || 'index.html'
      const filePath = path.join(distPath, subpath)
      const resolved = path.resolve(filePath)
      const distResolved = path.resolve(distPath)
      if (!resolved.startsWith(distResolved)) return next()
      fs.stat(resolved, (err, stat) => {
        if (err || !stat.isFile()) {
          return res.sendFile(path.join(distPath, 'index.html'))
        }
        res.sendFile(resolved)
      })
    }
    // Use regex so path definitely matches (Express * in string path may not match multiple segments)
    const basePathEscaped = basePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    app.get(new RegExp(`^${basePathEscaped}/?(.*)$`), serveBasePath)
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
