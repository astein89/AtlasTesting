import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { Router } from 'express'
import JSZip from 'jszip'
import { isUsingPostgres } from '../db/index.js'
import { getNextScheduleRun } from '../lib/backupScheduleMath.js'
import {
  getBackupHistory,
  getBackupSettings,
  mergeBackupPatch,
  parseBackupPutBody,
  setBackupSettings,
  validateBackupSettingsForSave,
  type BackupSettings,
} from '../lib/backupSettings.js'
import { runBackupTarget } from '../lib/backupJob.js'
import { scheduleBackupTimers } from '../lib/backupScheduler.js'
import { sendDiscordBackupTest } from '../lib/backupDiscordNotify.js'
import { authMiddleware, requirePermission, type AuthRequest } from '../middleware/auth.js'
import { asyncRoute } from '../utils/asyncRoute.js'

const router = Router()

/** Last accepted POST /run (in-process only; for UI status). */
let lastBackupJob: { jobId: string; target: string; startedAt: string } | null = null

function lockPath(stagingAbs: string, name: string) {
  return path.join(stagingAbs, name)
}

function latestSnapshotDir(settings: BackupSettings, variant: 'standard' | 'full' = 'standard'): string | null {
  const sub = variant === 'full' ? 'db-full-snapshots' : 'db-snapshots'
  const root = path.join(path.resolve(settings.localStagingDir), sub)
  if (!fs.existsSync(root)) return null
  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{8}-\d{4}$/.test(d.name))
    .map((d) => d.name)
    .sort()
    .reverse()
  if (dirs.length === 0) return null
  return path.join(root, dirs[0]!)
}

/** Stream a zip of the snapshot folder without buffering the whole archive in memory. */
function zipSnapshotToNodeStream(absDir: string, rootName: string): Readable {
  const zip = new JSZip()
  function walk(abs: string, rel: string) {
    const entries = fs.readdirSync(abs, { withFileTypes: true })
    for (const e of entries) {
      const p = path.join(abs, e.name)
      const z = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(p, z)
      else zip.file(z, fs.createReadStream(p))
    }
  }
  walk(absDir, rootName)
  const nodeStream = zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE' })
  return nodeStream as Readable
}

router.get(
  '/',
  authMiddleware,
  requirePermission('backup.manage'),
  asyncRoute(async (_req: AuthRequest, res) => {
    const settings = await getBackupSettings()
    const history = await getBackupHistory()
    const now = new Date()
    const nextDb = getNextScheduleRun(now, settings.databaseSchedule)
    const nextDbFull = getNextScheduleRun(now, settings.databaseFullSchedule)
    const nextMir = getNextScheduleRun(now, settings.mirrorSchedule)
    res.json({
      settings,
      history,
      databaseKind: isUsingPostgres() ? 'postgres' : 'sqlite',
      nextDatabaseRunAt: nextDb?.toISOString() ?? null,
      nextDatabaseFullRunAt: nextDbFull?.toISOString() ?? null,
      nextMirrorRunAt: nextMir?.toISOString() ?? null,
    })
  })
)

router.put(
  '/',
  authMiddleware,
  requirePermission('backup.manage'),
  asyncRoute(async (req: AuthRequest, res) => {
    const parsed = parseBackupPutBody(req.body)
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error })
    }
    const current = await getBackupSettings()
    const merged = mergeBackupPatch(current, parsed.patch)
    const v = validateBackupSettingsForSave(merged)
    if (!v.ok) {
      return res.status(400).json({ error: v.error })
    }
    await setBackupSettings(merged)
    scheduleBackupTimers()
    const settings = await getBackupSettings()
    const history = await getBackupHistory()
    const nowAfter = new Date()
    res.json({
      settings,
      history,
      databaseKind: isUsingPostgres() ? 'postgres' : 'sqlite',
      nextDatabaseRunAt: getNextScheduleRun(nowAfter, settings.databaseSchedule)?.toISOString() ?? null,
      nextDatabaseFullRunAt: getNextScheduleRun(nowAfter, settings.databaseFullSchedule)?.toISOString() ?? null,
      nextMirrorRunAt: getNextScheduleRun(nowAfter, settings.mirrorSchedule)?.toISOString() ?? null,
    })
  })
)

router.post(
  '/test-discord',
  authMiddleware,
  requirePermission('backup.manage'),
  asyncRoute(async (req: AuthRequest, res) => {
    const fromBody =
      typeof (req.body as { discordWebhook?: unknown })?.discordWebhook === 'string'
        ? (req.body as { discordWebhook: string }).discordWebhook.trim()
        : ''
    const settings = await getBackupSettings()
    const url = fromBody || settings.discordWebhook?.trim() || ''
    const result = await sendDiscordBackupTest(url)
    if (!result.ok) {
      return res.status(400).json({ error: result.error })
    }
    res.json({ ok: true })
  })
)

router.post(
  '/run',
  authMiddleware,
  requirePermission('backup.manage'),
  asyncRoute(async (req: AuthRequest, res) => {
    const raw = (req.query.target as string | undefined) ?? (req.body as { target?: string })?.target ?? 'both'
    const target =
      raw === 'database' || raw === 'database_full' || raw === 'mirror' || raw === 'both' ? raw : null
    if (!target) {
      return res.status(400).json({ error: 'target must be database, database_full, mirror, or both' })
    }
    const jobId = randomUUID()
    lastBackupJob = { jobId, target, startedAt: new Date().toISOString() }
    res.status(202).json({ jobId, target, accepted: true })
    setImmediate(() => {
      void runBackupTarget(target).catch((e) => {
        console.error('[backup run]', e)
      })
    })
  })
)

router.get(
  '/status',
  authMiddleware,
  requirePermission('backup.manage'),
  asyncRoute(async (_req: AuthRequest, res) => {
    const settings = await getBackupSettings()
    const staging = path.resolve(settings.localStagingDir)
    const dbLock = fs.existsSync(lockPath(staging, 'backup-db.lock'))
    const mirrorLock = fs.existsSync(lockPath(staging, 'backup-mirror.lock'))
    res.json({
      database: {
        running: dbLock,
        lastMessage: settings.lastDatabaseRunMessage,
        lastRunAt: settings.lastDatabaseRunAt,
        lastOk: settings.lastDatabaseRunOk,
      },
      databaseFull: {
        running: dbLock,
        lastMessage: settings.lastDatabaseFullRunMessage,
        lastRunAt: settings.lastDatabaseFullRunAt,
        lastOk: settings.lastDatabaseFullRunOk,
      },
      mirror: {
        running: mirrorLock,
        lastMessage: settings.lastMirrorRunMessage,
        lastRunAt: settings.lastMirrorRunAt,
        lastOk: settings.lastMirrorRunOk,
      },
      lastJob: lastBackupJob,
    })
  })
)

router.get(
  '/download/latest',
  authMiddleware,
  requirePermission('backup.manage'),
  asyncRoute(async (req: AuthRequest, res) => {
    const settings = await getBackupSettings()
    const variant =
      req.query.variant === 'full' || req.query.kind === 'full' ? ('full' as const) : ('standard' as const)
    const dir = latestSnapshotDir(settings, variant)
    if (!dir || !fs.existsSync(dir)) {
      return res.status(404).json({ error: 'No local database snapshot found' })
    }
    const resolvedRoot = path.resolve(settings.localStagingDir)
    const resolvedDir = path.resolve(dir)
    if (!resolvedDir.startsWith(resolvedRoot + path.sep) && resolvedDir !== resolvedRoot) {
      return res.status(400).json({ error: 'Invalid snapshot path' })
    }
    const stamp = path.basename(resolvedDir)
    const stream = zipSnapshotToNodeStream(resolvedDir, stamp)
    const prefix = variant === 'full' ? 'db-full-snapshot' : 'db-snapshot'
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${prefix}-${stamp}.zip"`)
    stream.on('error', (err) => {
      console.error('[backup download]', err)
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to build archive' })
      }
    })
    stream.pipe(res)
  })
)

export { router as backupRouter }
