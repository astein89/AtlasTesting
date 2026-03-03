import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { runSeed } from './db/seed.js'
import { authRouter } from './routes/auth.js'
import { adminRouter } from './routes/admin.js'
import { fieldsRouter } from './routes/fields.js'
import { testPlansRouter } from './routes/testPlans.js'
import { testsRouter } from './routes/tests.js'
import { runsRouter } from './routes/runs.js'
import { usersRouter } from './routes/users.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3001
const isProd = process.env.NODE_ENV === 'production'

app.use(cors({ origin: true, credentials: true }))
app.use(express.json())

app.use('/api/auth', authRouter)
app.use('/api/admin', adminRouter)
app.use('/api/fields', fieldsRouter)
app.use('/api/test-plans', testPlansRouter)
app.use('/api/tests', testsRouter)
app.use('/api/runs', runsRouter)
app.use('/api/users', usersRouter)

runSeed()

if (isProd) {
  const distPath = path.join(__dirname, '..', 'dist')
  app.use(express.static(distPath))
  app.get('*', (_, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
