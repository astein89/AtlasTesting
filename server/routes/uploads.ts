import { Router } from 'express'
import fs from 'fs'
import multer from 'multer'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { authMiddleware, requireCanEditData, type AuthRequest } from '../middleware/auth.js'

const router = Router()
router.use(authMiddleware)

function sanitizeFilename(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'image'
  return base.slice(0, 200)
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(process.cwd(), 'uploads')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg'
    const safe = sanitizeFilename(path.basename(file.originalname, path.extname(file.originalname)))
    if (safe && safe !== 'image') {
      let final = safe + ext.toLowerCase()
      let n = 0
      const dir = path.join(process.cwd(), 'uploads')
      while (fs.existsSync(path.join(dir, final))) {
        n += 1
        final = `${safe}_${n}${ext.toLowerCase()}`
      }
      cb(null, final)
    } else {
      cb(null, `${uuidv4()}${ext.toLowerCase()}`)
    }
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /^image\/(jpeg|jpg|png|gif|webp|heic)$/i
    if (allowed.test(file.mimetype)) cb(null, true)
    else cb(new Error('Only images (jpeg, png, gif, webp, heic) allowed'))
  },
})

router.post('/', requireCanEditData, upload.array('images', 20), (req: AuthRequest, res) => {
  const files = req.files as Express.Multer.File[]
  const base = '/api/uploads/'
  const paths = (files || []).map((f) => base + f.filename) as string[]
  res.json({ paths })
})

router.post('/single', requireCanEditData, upload.single('image'), (req: AuthRequest, res) => {
  const file = req.file
  if (!file) return res.status(400).json({ error: 'No image uploaded' })
  res.json({ path: '/api/uploads/' + file.filename } as { path: string })
})

export { router as uploadsRouter }
