import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Router, type Response, type NextFunction } from 'express'
import multer from 'multer'
import JSZip from 'jszip'
import {
  authMiddleware,
  requirePermission,
  type AuthRequest,
} from '../middleware/auth.js'
import { roleHasPermission } from '../lib/permissionsCatalog.js'
import { folderAccessibleToUser, storedFileAccessibleToUser } from '../lib/fileAccess.js'
import { db } from '../db/index.js'
import { asyncRoute } from '../utils/asyncRoute.js'

const router = Router()
router.use(authMiddleware)

const FILES_SEGMENT = 'files'
function filesUploadDir(): string {
  return path.join(process.cwd(), 'uploads', FILES_SEGMENT)
}

function ensureUploadDir() {
  const dir = filesUploadDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

const maxMbRaw = Number(process.env.FILES_MAX_MB)
const maxMb = Number.isFinite(maxMbRaw) && maxMbRaw > 0 ? Math.min(500, maxMbRaw) : 50
const maxBytes = maxMb * 1024 * 1024

function safeOriginalFilename(name: string): string {
  const t = (name || 'upload').replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return t ? t.slice(0, 500) : 'upload'
}

function safeZipPathSegment(name: string): string {
  const t = (name || '_').replace(/[\u0000-\u001f\u007f/\\]/g, '-').trim() || '_'
  return t.slice(0, 200)
}

function normalizeFolderName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  if (!t || t.length > 200) return null
  if (/[/\\]/.test(t)) return null
  return t
}

function canModifyFileMeta(user: NonNullable<AuthRequest['user']>, uploadedBy: string): boolean {
  if (roleHasPermission(user.permissions, '*')) return true
  if (roleHasPermission(user.permissions, 'files.manage')) return true
  return user.id === uploadedBy
}

function requireFilesManage(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(403).json({ error: 'Forbidden' })
  if (!roleHasPermission(req.user.permissions, 'files.manage') && !roleHasPermission(req.user.permissions, '*')) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  next()
}

/** True if `descendantId` is `ancestorId` or nested under it. */
async function isFolderUnderAncestor(descendantId: string, ancestorId: string): Promise<boolean> {
  let cur: string | null = descendantId
  const seen = new Set<string>()
  while (cur) {
    if (cur === ancestorId) return true
    if (seen.has(cur)) break
    seen.add(cur)
    const row = (await db.prepare('SELECT parent_id FROM file_folders WHERE id = ?').get(cur)) as
      | { parent_id: string | null }
      | undefined
    cur = row?.parent_id ?? null
  }
  return false
}

async function getFolderAclLayersFromDb(folderId: string | null): Promise<string[][]> {
  const layers: string[][] = []
  let cur: string | null = folderId
  const seen = new Set<string>()
  while (cur) {
    if (seen.has(cur)) break
    seen.add(cur)
    const row = (await db
      .prepare('SELECT parent_id, allowed_role_slugs FROM file_folders WHERE id = ?')
      .get(cur)) as { parent_id: string | null; allowed_role_slugs: string | null } | undefined
    if (!row) break
    const raw = row.allowed_role_slugs?.trim()
    if (raw) {
      try {
        const slugs = JSON.parse(raw) as unknown
        if (Array.isArray(slugs) && slugs.length > 0) {
          const layer = slugs
            .filter((x): x is string => typeof x === 'string')
            .map((s) => s.trim())
            .filter(Boolean)
          if (layer.length) layers.push(layer)
        }
      } catch {
        /* ignore malformed */
      }
    }
    cur = row.parent_id
  }
  return layers
}

async function folderChainAccessibleFromNode(
  folderId: string | null,
  user: NonNullable<AuthRequest['user']>
): Promise<boolean> {
  let cur: string | null = folderId
  const seen = new Set<string>()
  while (cur) {
    if (seen.has(cur)) break
    seen.add(cur)
    const row = (await db
      .prepare('SELECT parent_id, allowed_role_slugs, created_by FROM file_folders WHERE id = ?')
      .get(cur)) as { parent_id: string | null; allowed_role_slugs: string | null; created_by: string | null } | undefined
    if (!row) return false
    if (
      !folderAccessibleToUser(
        { allowed_role_slugs: row.allowed_role_slugs, created_by: row.created_by },
        { id: user.id, roles: user.roles, permissions: user.permissions }
      )
    ) {
      return false
    }
    cur = row.parent_id
  }
  return true
}

async function storedFileAllowedForUser(row: StoredFileRow, user: NonNullable<AuthRequest['user']>): Promise<boolean> {
  const layers = await getFolderAclLayersFromDb(row.folder_id)
  return storedFileAccessibleToUser(
    {
      uploaded_by: row.uploaded_by,
      allowed_role_slugs: row.allowed_role_slugs,
      folder_id: row.folder_id,
      inherit_folder_acl: row.inherit_folder_acl,
    },
    { id: user.id, roles: user.roles, permissions: user.permissions },
    layers
  )
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureUploadDir()
    cb(null, filesUploadDir())
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 32)
    cb(null, `${randomUUID()}${ext.toLowerCase()}`)
  },
})

/** Block obvious double-click vectors only; `.com` matched names like `report.com`, `.msi`/`.dll` are common for test artifacts. */
const BLOCKED_UPLOAD_EXTENSIONS = new Set(['exe', 'bat', 'cmd', 'scr', 'pif'])

function fileFilter(_req: AuthRequest, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  const raw = file.originalname || ''
  const ext = path.extname(raw).replace(/^\./, '').toLowerCase()
  if (ext && BLOCKED_UPLOAD_EXTENSIONS.has(ext)) {
    cb(new Error(`This file type is not allowed (.${ext})`))
    return
  }
  cb(null, true)
}

const upload = multer({
  storage,
  limits: { fileSize: maxBytes },
  fileFilter,
})

export type StoredFileRow = {
  id: string
  original_filename: string
  storage_filename: string
  mime_type: string | null
  size_bytes: number | null
  uploaded_by: string
  created_at: string | null
  folder_id: string | null
  allowed_role_slugs: string | null
  required_permission: string | null
  /** 1 = follow folder ACL chain; 0 = use only `allowed_role_slugs` on this row. */
  inherit_folder_acl: number | null
  uploaded_by_username?: string | null
}

export type FileFolderRow = {
  id: string
  parent_id: string | null
  name: string
  created_at: string | null
  allowed_role_slugs: string | null
  created_by: string | null
}

type FileFolderTreeNode = FileFolderRow & { children: FileFolderTreeNode[] }

function buildFolderTree(rows: FileFolderRow[]): FileFolderTreeNode[] {
  const map = new Map<string, FileFolderTreeNode>()
  for (const r of rows) {
    map.set(r.id, { ...r, children: [] })
  }
  const roots: FileFolderTreeNode[] = []
  for (const node of map.values()) {
    const pid = node.parent_id
    if (!pid) {
      roots.push(node)
      continue
    }
    const p = map.get(pid)
    if (p) p.children.push(node)
    else roots.push(node)
  }
  const sortRec = (nodes: FileFolderTreeNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    for (const n of nodes) sortRec(n.children)
  }
  sortRec(roots)
  return roots
}

function parseSort(req: AuthRequest): { sortBy: 'name' | 'date' | 'size' | 'type'; order: 'asc' | 'desc' } {
  const raw = typeof req.query.sortBy === 'string' ? req.query.sortBy : ''
  const sortBy =
    raw === 'name' || raw === 'date' || raw === 'size' || raw === 'type' ? raw : 'date'
  const order = req.query.order === 'asc' ? 'asc' : 'desc'
  return { sortBy, order }
}

async function listFilesInFolder(
  folderId: string | null,
  sortBy: string,
  order: string
): Promise<StoredFileRow[]> {
  const dir = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
  let orderSql: string
  switch (sortBy) {
    case 'name':
      orderSql = `LOWER(sf.original_filename) ${dir}`
      break
    case 'size':
      orderSql = `(sf.size_bytes IS NULL) ASC, sf.size_bytes ${dir}`
      break
    case 'type':
      orderSql = `LOWER(COALESCE(sf.mime_type, '')) ${dir}, LOWER(sf.original_filename) ASC`
      break
    case 'date':
    default:
      orderSql = `sf.created_at ${dir}`
  }
  const sql = `
    SELECT sf.id, sf.original_filename, sf.storage_filename, sf.mime_type, sf.size_bytes,
           sf.uploaded_by, sf.created_at, sf.folder_id, sf.allowed_role_slugs, sf.required_permission,
           COALESCE(sf.inherit_folder_acl, 1) AS inherit_folder_acl,
           u.username AS uploaded_by_username
    FROM stored_files sf
    LEFT JOIN users u ON u.id = sf.uploaded_by
    WHERE ((sf.folder_id = ?) OR (sf.folder_id IS NULL AND (CAST(? AS TEXT) IS NULL)))
    ORDER BY ${orderSql}
  `
  return (await db.prepare(sql).all(folderId, folderId)) as StoredFileRow[]
}

async function getFileRow(id: string): Promise<StoredFileRow | undefined> {
  return (await db
    .prepare(
      `SELECT sf.id, sf.original_filename, sf.storage_filename, sf.mime_type, sf.size_bytes,
              sf.uploaded_by, sf.created_at, COALESCE(sf.inherit_folder_acl, 1) AS inherit_folder_acl,
              sf.folder_id, sf.allowed_role_slugs, sf.required_permission,
              u.username AS uploaded_by_username
       FROM stored_files sf
       LEFT JOIN users u ON u.id = sf.uploaded_by
       WHERE sf.id = ?`
    )
    .get(id)) as StoredFileRow | undefined
}

function sendFileBytes(
  res: Response,
  row: { storage_filename: string; original_filename: string; mime_type: string | null },
  disposition: 'inline' | 'attachment'
) {
  const dir = path.resolve(filesUploadDir())
  const diskPath = path.resolve(path.join(dir, row.storage_filename))
  if (!diskPath.startsWith(dir)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  if (!fs.existsSync(diskPath)) {
    res.status(410).json({ error: 'File missing on disk' })
    return
  }
  const downloadName = safeOriginalFilename(row.original_filename)
  if (row.mime_type?.trim()) {
    res.setHeader('Content-Type', row.mime_type.trim())
  }
  if (disposition === 'inline') {
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(downloadName)}`)
  }
  if (disposition === 'attachment') {
    res.download(diskPath, downloadName)
    return
  }
  res.sendFile(diskPath)
}

// ——— Folders ———

router.get(
  '/folders/tree',
  requirePermission('module.files'),
  asyncRoute(async (req: AuthRequest, res) => {
    const rows = (await db
      .prepare(
        `SELECT id, parent_id, name, created_at, allowed_role_slugs, created_by
       FROM file_folders ORDER BY LOWER(name) ASC`
      )
      .all()) as FileFolderRow[]
    const user = req.user!
    const filtered: FileFolderRow[] = []
    for (const r of rows) {
      if (await folderChainAccessibleFromNode(r.id, user)) filtered.push(r)
    }
    res.json(buildFolderTree(filtered))
  })
)

router.get(
  '/folders',
  requirePermission('module.files'),
  asyncRoute(async (req: AuthRequest, res) => {
    const parentRaw = req.query.parentId
    const parentId = typeof parentRaw === 'string' && parentRaw.trim() ? parentRaw.trim() : null
    const rows = (await db
      .prepare(
        `SELECT id, parent_id, name, created_at, allowed_role_slugs, created_by FROM file_folders
       WHERE ((parent_id = ?) OR (parent_id IS NULL AND (CAST(? AS TEXT) IS NULL)))
       ORDER BY LOWER(name) ASC`
      )
      .all(parentId, parentId)) as FileFolderRow[]
    const user = req.user!
    const filtered: FileFolderRow[] = []
    for (const r of rows) {
      if (await folderChainAccessibleFromNode(r.id, user)) filtered.push(r)
    }
    res.json(filtered)
  })
)

/** Zip of all files in this folder and subfolders the user may access (role/uploader rules). */
router.get(
  '/folders/:folderId/download',
  requirePermission('module.files'),
  (req: AuthRequest, res, next) => {
    void (async () => {
      try {
        const folderId = req.params.folderId
        const root = (await db.prepare('SELECT id, parent_id, name FROM file_folders WHERE id = ?').get(folderId)) as
          | { id: string; parent_id: string | null; name: string }
          | undefined
        if (!root) {
          res.status(404).json({ error: 'Not found' })
          return
        }

        const user = req.user!
        if (!(await folderChainAccessibleFromNode(folderId, user))) {
          res.status(404).json({ error: 'Not found' })
          return
        }

        const folderQueue = [folderId]
        const seenFolders = new Set<string>()
        const subtreeIds: string[] = []
        while (folderQueue.length) {
          const id = folderQueue.shift()!
          if (seenFolders.has(id)) continue
          seenFolders.add(id)
          subtreeIds.push(id)
          const kids = (await db.prepare('SELECT id FROM file_folders WHERE parent_id = ?').all(id)) as { id: string }[]
          for (const k of kids) folderQueue.push(k.id)
        }

        const folderRows =
          subtreeIds.length > 0
            ? ((await db
                .prepare(
                  `SELECT id, parent_id, name FROM file_folders WHERE id IN (${subtreeIds.map(() => '?').join(',')})`
                )
                .all(...subtreeIds)) as { id: string; parent_id: string | null; name: string }[])
            : []
        const idToFolder = new Map(folderRows.map((r) => [r.id, r]))

        const placeholders = subtreeIds.map(() => '?').join(',')
        const fileRows = (await db
          .prepare(
            `SELECT sf.id, sf.original_filename, sf.storage_filename, sf.folder_id,
                  sf.uploaded_by, sf.allowed_role_slugs, COALESCE(sf.inherit_folder_acl, 1) AS inherit_folder_acl
           FROM stored_files sf
           WHERE sf.folder_id IN (${placeholders})`
          )
          .all(...subtreeIds)) as {
          id: string
          original_filename: string
          storage_filename: string
          folder_id: string | null
          uploaded_by: string
          allowed_role_slugs: string | null
          inherit_folder_acl: number | null
        }[]

        const accessible: typeof fileRows = []
        for (const r of fileRows) {
          const ok = await storedFileAllowedForUser(
            {
              id: r.id,
              original_filename: r.original_filename,
              storage_filename: r.storage_filename,
              mime_type: null,
              size_bytes: null,
              uploaded_by: r.uploaded_by,
              created_at: null,
              folder_id: r.folder_id,
              allowed_role_slugs: r.allowed_role_slugs,
              required_permission: null,
              inherit_folder_acl: r.inherit_folder_acl,
            },
            user
          )
          if (ok) accessible.push(r)
        }

        const zip = new JSZip()
        const rootSeg = safeZipPathSegment(root.name)
        const rootZip = zip.folder(rootSeg)
        if (!rootZip) {
          res.status(500).json({ error: 'Could not build archive' })
          return
        }

        const uploadDir = path.resolve(filesUploadDir())
        const usedNames = new Set<string>()

        for (const file of accessible) {
          const baseName = safeOriginalFilename(file.original_filename)
          let rel: string
          if (!file.folder_id || file.folder_id === folderId) {
            rel = baseName
          } else {
            const segs: string[] = []
            let cur: string | null = file.folder_id
            while (cur && cur !== folderId) {
              const row = idToFolder.get(cur)
              if (!row) break
              segs.unshift(safeZipPathSegment(row.name))
              cur = row.parent_id
            }
            rel = segs.length ? `${segs.join('/')}/${baseName}` : baseName
          }
          let unique = rel.replace(/\\/g, '/')
          let n = 0
          while (usedNames.has(unique.toLowerCase())) {
            n++
            const dot = baseName.lastIndexOf('.')
            const stem = dot > 0 ? baseName.slice(0, dot) : baseName
            const ext = dot > 0 ? baseName.slice(dot) : ''
            const parentPrefix = unique.includes('/') ? `${unique.slice(0, unique.lastIndexOf('/') + 1)}` : ''
            unique = `${parentPrefix}${stem}_${n}${ext}`
          }
          usedNames.add(unique.toLowerCase())

          const diskPath = path.resolve(path.join(uploadDir, file.storage_filename))
          if (!diskPath.startsWith(uploadDir) || !fs.existsSync(diskPath)) continue
          const buf = fs.readFileSync(diskPath)
          rootZip.file(unique, buf)
        }

        const body = await zip.generateAsync({
          type: 'nodebuffer',
          compression: 'DEFLATE',
          compressionOptions: { level: 6 },
        })
        const zipBase =
          safeOriginalFilename(root.name).replace(/[/\\]/g, '-').replace(/\.zip$/i, '') || 'folder'
        const zipName = `${zipBase}.zip`
        res.setHeader('Content-Type', 'application/zip')
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`)
        res.send(body)
      } catch (err) {
        next(err)
      }
    })()
  }
)

router.post(
  '/folders',
  requirePermission('module.files'),
  requireFilesManage,
  asyncRoute(async (req: AuthRequest, res) => {
    const name = normalizeFolderName(req.body?.name)
    if (!name) return res.status(400).json({ error: 'Invalid folder name' })
    const parentRaw = req.body?.parentId
    const parentId = typeof parentRaw === 'string' && parentRaw.trim() ? parentRaw.trim() : null
    if (parentId) {
      const p = (await db.prepare('SELECT id FROM file_folders WHERE id = ?').get(parentId)) as { id: string } | undefined
      if (!p) return res.status(400).json({ error: 'Parent folder not found' })
    }

    let allowed_role_slugs: string | null = null
    if ('allowedRoleSlugs' in (req.body ?? {})) {
      const ar = (req.body as { allowedRoleSlugs?: unknown }).allowedRoleSlugs
      if (ar === null) {
        allowed_role_slugs = null
      } else if (Array.isArray(ar) && ar.every((x: unknown) => typeof x === 'string')) {
        allowed_role_slugs = ar.length === 0 ? null : JSON.stringify(ar)
      } else {
        return res.status(400).json({ error: 'allowedRoleSlugs must be an array of strings or null' })
      }
    } else if (parentId) {
      const pr = (await db.prepare('SELECT allowed_role_slugs FROM file_folders WHERE id = ?').get(parentId)) as
        | { allowed_role_slugs: string | null }
        | undefined
      allowed_role_slugs = pr?.allowed_role_slugs ?? null
    }

    const id = randomUUID()
    try {
      await db
        .prepare(
          `INSERT INTO file_folders (id, parent_id, name, created_by, allowed_role_slugs) VALUES (?, ?, ?, ?, ?)`
        )
        .run(id, parentId, name, req.user!.id, allowed_role_slugs)
    } catch {
      return res.status(409).json({ error: 'A folder with that name already exists here' })
    }
    const row = (await db
      .prepare(
        `SELECT id, parent_id, name, created_at, allowed_role_slugs, created_by FROM file_folders WHERE id = ?`
      )
      .get(id)) as FileFolderRow
    res.status(201).json(row)
  })
)

router.patch(
  '/folders/:folderId',
  requirePermission('module.files'),
  requireFilesManage,
  asyncRoute(async (req: AuthRequest, res) => {
    const folderId = req.params.folderId
    const existing = (await db
      .prepare('SELECT id, parent_id, name, allowed_role_slugs FROM file_folders WHERE id = ?')
      .get(folderId)) as
      | { id: string; parent_id: string | null; name: string; allowed_role_slugs: string | null }
      | undefined
    if (!existing) return res.status(404).json({ error: 'Not found' })

    let nextParent = existing.parent_id
    if ('parentId' in req.body) {
      const pr = req.body.parentId
      if (pr === null || pr === '') {
        nextParent = null
      } else if (typeof pr === 'string' && pr.trim()) {
        nextParent = pr.trim()
        if (nextParent === folderId) {
          return res.status(400).json({ error: 'Cannot move folder into itself' })
        }
        if (await isFolderUnderAncestor(nextParent, folderId)) {
          return res.status(400).json({ error: 'Cannot move folder under its descendant' })
        }
        const p = (await db.prepare('SELECT id FROM file_folders WHERE id = ?').get(nextParent)) as
          | { id: string }
          | undefined
        if (!p) return res.status(400).json({ error: 'Parent folder not found' })
      }
    }

    let nextName = existing.name
    if (typeof req.body?.name === 'string') {
      const nn = normalizeFolderName(req.body.name)
      if (!nn) return res.status(400).json({ error: 'Invalid folder name' })
      nextName = nn
    }

    let nextSlugs = existing.allowed_role_slugs
    if ('allowedRoleSlugs' in (req.body ?? {})) {
      const ar = (req.body as { allowedRoleSlugs?: unknown }).allowedRoleSlugs
      if (ar === null) {
        nextSlugs = null
      } else if (Array.isArray(ar) && ar.every((x: unknown) => typeof x === 'string')) {
        nextSlugs = ar.length === 0 ? null : JSON.stringify(ar)
      } else {
        return res.status(400).json({ error: 'allowedRoleSlugs must be an array of strings or null' })
      }
    }

    const body = req.body as Record<string, unknown>
    if (!('parentId' in body) && !('name' in body) && !('allowedRoleSlugs' in body)) {
      return res.status(400).json({ error: 'No updates' })
    }

    try {
      await db
        .prepare('UPDATE file_folders SET parent_id = ?, name = ?, allowed_role_slugs = ? WHERE id = ?')
        .run(nextParent, nextName, nextSlugs, folderId)
    } catch {
      return res.status(409).json({ error: 'A folder with that name already exists here' })
    }
    const row = (await db
      .prepare(
        `SELECT id, parent_id, name, created_at, allowed_role_slugs, created_by FROM file_folders WHERE id = ?`
      )
      .get(folderId)) as FileFolderRow
    res.json(row)
  })
)

router.delete(
  '/folders/:folderId',
  requirePermission('module.files'),
  requireFilesManage,
  asyncRoute(async (req: AuthRequest, res) => {
    const folderId = req.params.folderId
    const nChild = (await db.prepare('SELECT COUNT(*) as c FROM file_folders WHERE parent_id = ?').get(folderId)) as {
      c: number
    }
    const nFiles = (await db.prepare('SELECT COUNT(*) as c FROM stored_files WHERE folder_id = ?').get(folderId)) as {
      c: number
    }
    if ((nChild?.c ?? 0) > 0 || (nFiles?.c ?? 0) > 0) {
      return res.status(409).json({ error: 'Folder is not empty' })
    }
    const r = await db.prepare('DELETE FROM file_folders WHERE id = ?').run(folderId)
    if (r.changes === 0) return res.status(404).json({ error: 'Not found' })
    res.json({ ok: true })
  })
)

// ——— Files listing & upload ———

router.get(
  '/',
  requirePermission('module.files'),
  asyncRoute(async (req: AuthRequest, res) => {
    const folderRaw = req.query.folderId
    const folderId = typeof folderRaw === 'string' && folderRaw.trim() ? folderRaw.trim() : null
    const { sortBy, order } = parseSort(req)
    const rows = await listFilesInFolder(folderId, sortBy, order)
    const user = req.user!
    const filtered: StoredFileRow[] = []
    for (const r of rows) {
      if (await storedFileAllowedForUser(r, user)) filtered.push(r)
    }
    res.json(filtered)
  })
)

router.post(
  '/',
  requirePermission('module.files'),
  requireFilesManage,
  (req: AuthRequest, res, next) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (!err) return next()
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: `File exceeds ${maxMb} MB limit` })
        }
        return res.status(400).json({ error: err.message })
      }
      const msg = err instanceof Error ? err.message : 'Upload failed'
      return res.status(400).json({ error: msg })
    })
  },
  asyncRoute(async (req: AuthRequest, res) => {
    const file = req.file
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded (use field name "file")' })
    }
    let folderId: string | null = null
    const body = req.body as { folderId?: string }
    if (typeof body.folderId === 'string' && body.folderId.trim()) {
      folderId = body.folderId.trim()
      const f = (await db.prepare('SELECT id FROM file_folders WHERE id = ?').get(folderId)) as { id: string } | undefined
      if (!f) return res.status(400).json({ error: 'Folder not found' })
    }

    let allowed_role_slugs: string | null = null
    let inherit_folder_acl = 1
    const ar = req.body?.allowedRoleSlugs
    if (typeof ar === 'string' && ar.trim()) {
      try {
        const parsed = JSON.parse(ar) as unknown
        if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
          allowed_role_slugs = JSON.stringify(parsed)
          inherit_folder_acl = 0
        } else {
          return res.status(400).json({ error: 'allowedRoleSlugs must be a JSON array of strings' })
        }
      } catch {
        return res.status(400).json({ error: 'allowedRoleSlugs must be valid JSON' })
      }
    }
    const id = randomUUID()
    const original = safeOriginalFilename(file.originalname)
    const mime = file.mimetype && file.mimetype.trim() ? file.mimetype.trim() : null
    const size = Number.isFinite(file.size) ? Math.trunc(file.size) : null
    await db
      .prepare(
        `INSERT INTO stored_files (id, original_filename, storage_filename, mime_type, size_bytes, uploaded_by, folder_id, allowed_role_slugs, required_permission, inherit_folder_acl)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, original, file.filename, mime, size, req.user!.id, folderId, allowed_role_slugs, null, inherit_folder_acl)
    const row = await getFileRow(id)
    res.status(201).json(row)
  })
)

router.put(
  '/:id',
  requirePermission('module.files'),
  asyncRoute(async (req: AuthRequest, res) => {
    const id = req.params.id
    const row = await getFileRow(id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    if (!req.user) return res.status(403).json({ error: 'Forbidden' })
    if (!canModifyFileMeta(req.user, row.uploaded_by)) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    let folder_id: string | null | undefined = undefined
    if ('folderId' in req.body) {
      const pr = req.body.folderId
      if (pr === null || pr === '') {
        folder_id = null
      } else if (typeof pr === 'string' && pr.trim()) {
        folder_id = pr.trim()
        const f = (await db.prepare('SELECT id FROM file_folders WHERE id = ?').get(folder_id)) as { id: string } | undefined
        if (!f) return res.status(400).json({ error: 'Folder not found' })
      }
    }

    let allowed_role_slugs: string | null | undefined = undefined
    if ('allowedRoleSlugs' in req.body) {
      const ar = req.body.allowedRoleSlugs
      if (ar === null) {
        allowed_role_slugs = null
      } else if (Array.isArray(ar) && ar.every((x: unknown) => typeof x === 'string')) {
        allowed_role_slugs = ar.length === 0 ? null : JSON.stringify(ar)
      } else {
        return res.status(400).json({ error: 'allowedRoleSlugs must be string array or null' })
      }
    }

    let inherit_folder_acl: number | undefined = undefined
    if ('inheritFolderAcl' in req.body) {
      const v = req.body.inheritFolderAcl
      if (typeof v !== 'boolean') {
        return res.status(400).json({ error: 'inheritFolderAcl must be a boolean' })
      }
      inherit_folder_acl = v ? 1 : 0
    }

    let original_filename: string | undefined = undefined
    if ('originalFilename' in req.body) {
      const raw = req.body.originalFilename
      if (raw !== null && typeof raw !== 'string') {
        return res.status(400).json({ error: 'originalFilename must be a string' })
      }
      const safe = safeOriginalFilename(raw ?? '')
      if (!safe.trim()) {
        return res.status(400).json({ error: 'originalFilename is required' })
      }
      original_filename = safe
    }

    if (
      folder_id === undefined &&
      allowed_role_slugs === undefined &&
      original_filename === undefined &&
      inherit_folder_acl === undefined
    ) {
      return res.status(400).json({ error: 'No updates' })
    }

    const nextFolder = folder_id !== undefined ? folder_id : row.folder_id
    const nextRoles = allowed_role_slugs !== undefined ? allowed_role_slugs : row.allowed_role_slugs
    const nextOriginal = original_filename !== undefined ? original_filename : row.original_filename
    const coercedInherit = row.inherit_folder_acl ?? 1
    const nextInherit = inherit_folder_acl !== undefined ? inherit_folder_acl : coercedInherit

    await db
      .prepare(
        `UPDATE stored_files SET folder_id = ?, allowed_role_slugs = ?, original_filename = ?, inherit_folder_acl = ? WHERE id = ?`
      )
      .run(nextFolder, nextRoles, nextOriginal, nextInherit, id)

    const out = await getFileRow(id)
    res.json(out)
  })
)

router.get(
  '/:id/view',
  requirePermission('module.files'),
  asyncRoute(async (req: AuthRequest, res) => {
    const id = req.params.id
    const row = (await db.prepare('SELECT * FROM stored_files WHERE id = ?').get(id)) as
      | (StoredFileRow & { storage_filename: string })
      | undefined
    if (!row) return res.status(404).json({ error: 'Not found' })
    const user = req.user!
    const viewRow: StoredFileRow = {
      id: row.id,
      original_filename: row.original_filename,
      storage_filename: row.storage_filename,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      uploaded_by: row.uploaded_by,
      created_at: row.created_at,
      folder_id: row.folder_id,
      allowed_role_slugs: row.allowed_role_slugs,
      required_permission: row.required_permission,
      inherit_folder_acl: (row as StoredFileRow).inherit_folder_acl ?? 1,
    }
    if (!(await storedFileAllowedForUser(viewRow, user))) {
      return res.status(404).json({ error: 'Not found' })
    }
    sendFileBytes(res, row, 'inline')
  })
)

router.get(
  '/:id/download',
  requirePermission('module.files'),
  asyncRoute(async (req: AuthRequest, res) => {
    const id = req.params.id
    const row = (await db.prepare('SELECT * FROM stored_files WHERE id = ?').get(id)) as
      | (StoredFileRow & { storage_filename: string })
      | undefined
    if (!row) return res.status(404).json({ error: 'Not found' })
    const user = req.user!
    const dlRow: StoredFileRow = {
      id: row.id,
      original_filename: row.original_filename,
      storage_filename: row.storage_filename,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      uploaded_by: row.uploaded_by,
      created_at: row.created_at,
      folder_id: row.folder_id,
      allowed_role_slugs: row.allowed_role_slugs,
      required_permission: row.required_permission,
      inherit_folder_acl: (row as StoredFileRow).inherit_folder_acl ?? 1,
    }
    if (!(await storedFileAllowedForUser(dlRow, user))) {
      return res.status(404).json({ error: 'Not found' })
    }
    sendFileBytes(res, row, 'attachment')
  })
)

router.delete(
  '/:id',
  requirePermission('module.files'),
  asyncRoute(async (req: AuthRequest, res) => {
    const id = req.params.id
    const row = (await db
      .prepare('SELECT storage_filename, uploaded_by FROM stored_files WHERE id = ?')
      .get(id)) as { storage_filename: string; uploaded_by: string } | undefined
    if (!row) return res.status(404).json({ error: 'Not found' })
    if (!req.user) return res.status(403).json({ error: 'Forbidden' })
    if (!canModifyFileMeta(req.user, row.uploaded_by)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    const dir = path.resolve(filesUploadDir())
    const diskPath = path.resolve(path.join(dir, row.storage_filename))
    if (diskPath.startsWith(dir) && fs.existsSync(diskPath)) {
      try {
        fs.unlinkSync(diskPath)
      } catch {
        /* */
      }
    }
    await db.prepare('DELETE FROM stored_files WHERE id = ?').run(id)
    res.json({ ok: true })
  })
)

export { router as filesRouter }
