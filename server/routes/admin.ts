import { execFileSync } from 'node:child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'node:url'
import { Router } from 'express'
import { db, isUsingPostgres } from '../db/index.js'
import { authMiddleware, requirePermission, type AuthRequest } from '../middleware/auth.js'
import { asyncRoute } from '../utils/asyncRoute.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const levelsUp = __dirname.includes(`${path.sep}dist${path.sep}`) ? 3 : 2
const projectRoot = path.resolve(__dirname, ...Array(levelsUp).fill('..'))

let cachedAppVersion: string | null = null

type GitBuildMeta = {
  commit: string | null
  commitShort: string | null
  branch: string | null
  committedAt: string | null
  commitSubject: string | null
  generatedAt: string | null
  /** How this metadata was resolved (for debugging). */
  source: 'env' | 'file' | 'runtime' | 'none'
}

let cachedGitMeta: GitBuildMeta | undefined

function readGitMetaFromFile(): GitBuildMeta | null {
  try {
    const raw = fs.readFileSync(path.join(projectRoot, 'build-version.json'), 'utf8')
    const j = JSON.parse(raw) as Record<string, unknown>
    const commit = typeof j.commit === 'string' ? j.commit : null
    return {
      commit,
      commitShort: typeof j.commitShort === 'string' ? j.commitShort : null,
      branch: typeof j.branch === 'string' ? j.branch : null,
      committedAt: typeof j.committedAt === 'string' ? j.committedAt : null,
      commitSubject: typeof j.commitSubject === 'string' ? j.commitSubject : null,
      generatedAt: typeof j.generatedAt === 'string' ? j.generatedAt : null,
      source: 'file',
    }
  } catch {
    return null
  }
}

function readGitMetaFromRuntime(): GitBuildMeta | null {
  const run = (args: string[]) => {
    try {
      return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8' }).trim()
    } catch {
      return ''
    }
  }
  const commit = run(['rev-parse', 'HEAD'])
  if (!commit) return null
  return {
    commit,
    commitShort: run(['rev-parse', '--short', 'HEAD']) || null,
    branch: run(['rev-parse', '--abbrev-ref', 'HEAD']) || null,
    committedAt: run(['log', '-1', '--format=%cI']) || null,
    commitSubject: run(['log', '-1', '--format=%s']) || null,
    generatedAt: new Date().toISOString(),
    source: 'runtime',
  }
}

/**
 * Git snapshot for this deployment: from env (CI), build-version.json (npm run build),
 * or a one-time `git` invocation when developing without a generated file.
 */
function getGitBuildMeta(): GitBuildMeta {
  if (cachedGitMeta) return cachedGitMeta

  const envCommit = process.env.APP_GIT_COMMIT?.trim()
  if (envCommit) {
    cachedGitMeta = {
      commit: envCommit,
      commitShort: process.env.APP_GIT_COMMIT_SHORT?.trim() || envCommit.slice(0, 7),
      branch: process.env.APP_GIT_BRANCH?.trim() || null,
      committedAt: process.env.APP_GIT_COMMITTED_AT?.trim() || null,
      commitSubject: process.env.APP_GIT_COMMIT_SUBJECT?.trim() || null,
      generatedAt: process.env.APP_BUILD_GENERATED_AT?.trim() || null,
      source: 'env',
    }
    return cachedGitMeta
  }

  const fromFile = readGitMetaFromFile()
  if (fromFile?.commit) {
    cachedGitMeta = fromFile
    return cachedGitMeta
  }

  const fromGit = readGitMetaFromRuntime()
  if (fromGit) {
    cachedGitMeta = fromGit
    return cachedGitMeta
  }

  cachedGitMeta = {
    commit: null,
    commitShort: null,
    branch: null,
    committedAt: null,
    commitSubject: null,
    generatedAt: null,
    source: 'none',
  }
  return cachedGitMeta
}

function getAppVersion(): string {
  if (cachedAppVersion != null) return cachedAppVersion
  try {
    const raw = fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
    const pkg = JSON.parse(raw) as { version?: string }
    cachedAppVersion = typeof pkg.version === 'string' ? pkg.version : 'unknown'
  } catch {
    cachedAppVersion = 'unknown'
  }
  return cachedAppVersion
}

async function pingDatabase(): Promise<{
  ok: boolean
  backend: 'sqlite' | 'postgres'
  error?: string
}> {
  const backend = isUsingPostgres() ? 'postgres' : 'sqlite'
  try {
    await db.prepare('SELECT 1').get()
    return { ok: true, backend }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Database check failed'
    return { ok: false, backend, error: msg }
  }
}

const router = Router()

/** All non-internal application tables (admin list). */
async function listAppTableNames(): Promise<string[]> {
  if (isUsingPostgres()) {
    const rows = (await db
      .prepare(
        `SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename`
      )
      .all()) as Array<{ name: string }>
    return rows.map((r) => r.name)
  }
  const rows = (await db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    )
    .all()) as Array<{ name: string }>
  return rows.map((r) => r.name)
}

async function isAppTable(name: string): Promise<boolean> {
  if (isUsingPostgres()) {
    const row = (await db
      .prepare(
        `SELECT 1 AS ok FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = ?`
      )
      .get(name)) as { ok: number } | undefined
    return row != null
  }
  const row = (await db
    .prepare(
      `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name = ?`
    )
    .get(name)) as { ok: number } | undefined
  return row != null
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

router.get(
  '/status',
  authMiddleware,
  requirePermission('module.admin'),
  asyncRoute(async (_, res) => {
    const database = await pingDatabase()
    res.json({
      ok: true,
      version: getAppVersion(),
      git: getGitBuildMeta(),
      nodeVersion: process.version,
      uptimeSeconds: Math.floor(process.uptime()),
      environment: process.env.NODE_ENV ?? 'development',
      database,
    })
  })
)

router.get(
  '/tables',
  authMiddleware,
  requirePermission('admin.db'),
  asyncRoute(async (_, res) => {
    try {
      res.json(await listAppTableNames())
    } catch {
      res.status(500).json({ error: 'Failed to list tables' })
    }
  })
)

router.get(
  '/tables/:name',
  authMiddleware,
  requirePermission('admin.db'),
  asyncRoute(async (req: AuthRequest, res) => {
    const { name } = req.params
    if (!(await isAppTable(name))) {
      return res.status(400).json({ error: 'Invalid or unknown table name' })
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500)
    const offset = parseInt(req.query.offset as string) || 0

    try {
      const q = `SELECT * FROM ${quoteIdent(name)} LIMIT ? OFFSET ?`
      const rows = await db.prepare(q).all(limit, offset)
      res.json(rows)
    } catch {
      res.status(500).json({ error: 'Failed to fetch table data' })
    }
  })
)

export { router as adminRouter }
