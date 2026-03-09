import express from 'express'
import cors from 'cors'
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

app.use(cors({ origin: true, credentials: true }))
app.use(express.json())

app.use('/api/auth', authRouter)
app.use('/api/admin', adminRouter)
app.use('/api/fields', fieldsRouter)
app.use('/api/test-plans', testPlansRouter)
app.use('/api/records', recordsRouter)
app.use('/api/users', usersRouter)
app.use('/api/preferences', preferencesRouter)
app.use('/api/upload', uploadsRouter)
app.use('/api/uploads', express.static(path.join(process.cwd(), 'uploads')))

// Log errors with upload paths redacted
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(sanitizeForLog(err.message))
  if (err.stack) console.error(sanitizeForLog(err.stack))
  res.status(500).json({ error: 'Internal server error' })
})

runSeed()

if (isProd) {
  const distPath = path.join(__dirname, '..')
  app.use(express.static(distPath))
  app.get('*', (_, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`)
})
