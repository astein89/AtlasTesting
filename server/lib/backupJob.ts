import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import Database from 'better-sqlite3'
import { resolveDatabaseUrl } from '../config.js'
import { db, getSqliteDatabaseForBackup, isUsingPostgres } from '../db/index.js'
import {
  appendBackupHistory,
  backupProjectRoot,
  getBackupSettings,
  setBackupSettings,
  type BackupSettings,
} from './backupSettings.js'
import { sendDiscordBackupEmbed, type DiscordEmbedField } from './backupDiscordNotify.js'

const execFileAsync = promisify(execFile)

/** Persisted after a successful DB dump so we can skip redundant runs (same idea as `PRAGMA data_version` in sqlite-dropbox-backup.sh). */
const DB_FINGERPRINT_FILE = 'db-backup-last-fingerprint.json'

/** After a successful files mirror, so scheduled runs can skip when on-disk trees (and DB, when needed for files-original) are unchanged. */
const MIRROR_FINGERPRINT_FILE = 'mirror-last-fingerprint.json'

type DbFingerprint = { engine: 'sqlite' | 'postgres'; token: string }

function fingerprintFilePath(stagingAbs: string): string {
  return path.join(stagingAbs, DB_FINGERPRINT_FILE)
}

function readStoredDbFingerprint(stagingAbs: string): DbFingerprint | null {
  try {
    const p = fingerprintFilePath(stagingAbs)
    if (!fs.existsSync(p)) return null
    const j = JSON.parse(fs.readFileSync(p, 'utf8')) as unknown
    if (!j || typeof j !== 'object') return null
    const o = j as Record<string, unknown>
    const engine = o.engine === 'sqlite' || o.engine === 'postgres' ? o.engine : null
    const token = typeof o.token === 'string' ? o.token : null
    if (engine && token) return { engine, token }
  } catch {
    /* */
  }
  return null
}

function writeStoredDbFingerprint(stagingAbs: string, fp: DbFingerprint): void {
  fs.mkdirSync(stagingAbs, { recursive: true })
  fs.writeFileSync(fingerprintFilePath(stagingAbs), JSON.stringify(fp, null, 2), 'utf8')
}

function mirrorFingerprintPath(stagingAbs: string): string {
  return path.join(stagingAbs, MIRROR_FINGERPRINT_FILE)
}

function readStoredMirrorToken(stagingAbs: string): string | null {
  try {
    const p = mirrorFingerprintPath(stagingAbs)
    if (!fs.existsSync(p)) return null
    const j = JSON.parse(fs.readFileSync(p, 'utf8')) as unknown
    if (!j || typeof j !== 'object') return null
    const t = (j as Record<string, unknown>).token
    return typeof t === 'string' && t.length > 0 ? t : null
  } catch {
    return null
  }
}

function writeStoredMirrorToken(stagingAbs: string, token: string): void {
  fs.mkdirSync(stagingAbs, { recursive: true })
  fs.writeFileSync(mirrorFingerprintPath(stagingAbs), JSON.stringify({ token }, null, 2), 'utf8')
}

/**
 * Skip bookkeeping (`setBackupSettings`, `appendBackupHistory`) mutates the DB, which changes
 * `computeLiveDbFingerprint` / mirror skip tokens. Without persisting the new baseline, the next
 * run would always think data changed and take a full snapshot again.
 */
async function syncStoredDbFingerprintWithLive(stagingAbs: string): Promise<void> {
  fs.mkdirSync(stagingAbs, { recursive: true })
  const fp = await computeLiveDbFingerprint()
  if (fp) writeStoredDbFingerprint(stagingAbs, fp)
}

async function syncStoredMirrorTokenWithLive(stagingAbs: string, settings: BackupSettings): Promise<void> {
  const { token } = await computeMirrorSkipState(settings)
  if (token) writeStoredMirrorToken(stagingAbs, token)
}

/**
 * Sorted walk of mirror roots: path:size:mtime for each file (stable skip key for on-disk scope).
 * `hasFiles` is false when every root is missing, empty, or contains only directories.
 */
function hashMirrorFileTrees(roots: { rel: string; abs: string }[]): { hash: string; hasFiles: boolean } {
  const lines: string[] = []

  function walk(absPath: string, relPath: string): void {
    if (!fs.existsSync(absPath)) return
    const st = fs.statSync(absPath)
    if (st.isFile()) {
      lines.push(`${relPath}:${st.size}:${Math.floor(st.mtimeMs)}`)
      return
    }
    if (!st.isDirectory()) return
    for (const name of fs.readdirSync(absPath)) {
      walk(path.join(absPath, name), `${relPath}/${name}`)
    }
  }

  for (const { rel, abs } of roots) {
    walk(abs, rel)
  }
  lines.sort()
  const joined = lines.join('\n')
  return {
    hasFiles: lines.length > 0,
    hash: createHash('sha256').update(joined, 'utf8').digest('hex'),
  }
}

/**
 * When `uploads/files` + `files-original` mirror is enabled, include DB fingerprint so renames / folder moves
 * (metadata-only) still invalidate the skip key.
 */
async function computeMirrorSkipState(
  settings: BackupSettings
): Promise<{ token: string | null; hasFiles: boolean }> {
  const roots = mirrorRoots(settings)
  if (roots.length === 0) return { token: null, hasFiles: false }
  const { hash: fileHash, hasFiles } = hashMirrorFileTrees(roots)
  if (settings.includeUploadsFiles) {
    const dbFp = await computeLiveDbFingerprint()
    return { token: `v1:${fileHash}:${dbFp?.token ?? 'null'}`, hasFiles }
  }
  return { token: `v1:${fileHash}:`, hasFiles }
}

/**
 * SQLite: `PRAGMA data_version` (increments on writes).
 * Postgres: cumulative tuple change counters from `pg_stat_user_tables` (stable across idle WAL/checkpoint activity).
 * Do not use WAL LSN here — it advances even when application data is unchanged.
 * Returns null → do not skip (always backup).
 */
async function computeLiveDbFingerprint(): Promise<DbFingerprint | null> {
  if (isUsingPostgres()) {
    try {
      const row = (await db
        .prepare(
          `SELECT
             COALESCE(SUM(COALESCE(n_tup_ins, 0))::bigint, 0)::text || ':' ||
             COALESCE(SUM(COALESCE(n_tup_upd, 0))::bigint, 0)::text || ':' ||
             COALESCE(SUM(COALESCE(n_tup_del, 0))::bigint, 0)::text || ':' ||
             COUNT(*)::text AS fp
           FROM pg_stat_user_tables`
        )
        .get()) as { fp: string | null } | undefined
      const fp = row?.fp?.trim()
      if (fp) return { engine: 'postgres', token: `pg_tuples:${fp}` }
    } catch {
      /* */
    }
    return null
  }

  const raw = getSqliteDatabaseForBackup()
  if (!raw) return null
  try {
    const dv = raw.pragma('data_version', { simple: true }) as number | bigint | string | undefined
    const n = typeof dv === 'bigint' ? Number(dv) : Number(dv)
    if (Number.isFinite(n)) return { engine: 'sqlite', token: `data_version:${n}` }
  } catch {
    /* */
  }
  try {
    const name = raw.name
    if (name && name !== ':memory:' && !raw.memory) {
      const st = fs.statSync(name)
      return { engine: 'sqlite', token: `file:${st.size}:${Math.floor(st.mtimeMs)}` }
    }
  } catch {
    /* */
  }
  return null
}

const SQLITE_RESTORE_README = `SQLite — restore notes
============================
This folder contains dc-automation-backup.db, a consistent online backup of the live SQLite database file.

1. Stop the DC Automation app (and anything else using the database file).
2. Replace the database file on disk (see DB_PATH; often dc-automation.db in the app root) with dc-automation-backup.db from this folder.
3. Start the app.

Use a snapshot from a compatible app/schema era; run migrations after restore if the app version changed.`

function globalsExportFailureLine(globalsError: string): string {
  const compact = globalsError.replace(/\s+/g, ' ').trim()
  const isPgAuthidDenied =
    /pg_authid/i.test(compact) ||
    (/permission denied/i.test(compact) && /pg_dumpall/i.test(compact))
  if (isPgAuthidDenied) {
    return 'globals.sql — not included. Non-superuser roles cannot run a full globals export (pg_dumpall needs access to system catalogs such as pg_authid). This is expected for a normal application login. database.dump still contains the full database; on the target, create a matching login role or use pg_restore with --no-owner --no-acl. Optional: run pg_dumpall --globals-only once as a superuser (e.g. postgres) on the source if you need a roles script.'
  }
  const truncated = compact.length > 320 ? `${compact.slice(0, 320)}…` : compact
  return `globals.sql — not included (export failed: ${truncated}). Create roles manually or run pg_dumpall --globals-only as a superuser on the source.`
}

function buildPostgresRestoreReadme(o: { globalsExported: boolean; globalsError?: string }): string {
  const globalsExplain = o.globalsExported
    ? 'globals.sql — roles and other cluster-wide objects (pg_dumpall --globals-only). Review before applying on the target; you may need a superuser.'
    : o.globalsError
      ? globalsExportFailureLine(o.globalsError)
      : 'globals.sql — not generated.'

  return `PostgreSQL — restore notes
===========================
Files in this folder:
- database.dump — custom-format logical backup (pg_dump -Fc --create): schema, data, and objects in this database, plus commands to recreate the database when used with pg_restore --create.
- ${globalsExplain}

Typical restore to a new cluster (adjust -h -p -U; use pg_restore from a client version ≥ the server that produced the dump):

1) Optional — roles:    psql -v ON_ERROR_STOP=1 -f globals.sql -d postgres
2) Database + data:     pg_restore --verbose --create --clean --if-exists --no-owner --no-acl -d postgres database.dump

To load into an already-created empty database, omit --create and pass -d your_db.

Not included: other databases on the same server, replication configuration, and some provider-specific cluster settings. On hosted Postgres, globals export may be restricted — create roles in the provider UI if needed.`
}

async function writePostgresSnapshotArtifacts(
  snapDir: string,
  databaseUrl: string
): Promise<{ globalsExported: boolean; globalsError?: string }> {
  const dumpPath = path.join(snapDir, 'database.dump')
  await execFileAsync(
    'pg_dump',
    ['--format=custom', '--create', '--file', dumpPath, databaseUrl],
    {
      maxBuffer: 256 * 1024 * 1024,
      env: process.env,
      timeout: 3_600_000,
    }
  )
  try {
    await execFileAsync('pg_restore', ['--list', dumpPath], { maxBuffer: 10 * 1024 * 1024 })
  } catch {
    /* list may fail on huge dumps; pg_dump already succeeded */
  }

  let globalsExported = false
  let globalsError: string | undefined
  const globalsPath = path.join(snapDir, 'globals.sql')
  try {
    await execFileAsync('pg_dumpall', ['--globals-only', '--file', globalsPath, '--dbname', databaseUrl], {
      maxBuffer: 32 * 1024 * 1024,
      env: process.env,
      timeout: 300_000,
    })
    globalsExported = fs.existsSync(globalsPath) && fs.statSync(globalsPath).size > 0
  } catch (e) {
    globalsError = e instanceof Error ? e.message : String(e)
    try {
      if (fs.existsSync(globalsPath)) fs.unlinkSync(globalsPath)
    } catch {
      /* */
    }
  }

  fs.writeFileSync(path.join(snapDir, 'RESTORE_README.txt'), buildPostgresRestoreReadme({ globalsExported, globalsError }), 'utf8')
  return { globalsExported, globalsError }
}

function timeStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

function acquireLock(lockPath: string): (() => void) | null {
  try {
    const fd = fs.openSync(lockPath, 'wx')
    fs.writeFileSync(fd, `${process.pid}\n`)
    return () => {
      try {
        fs.closeSync(fd)
        fs.unlinkSync(lockPath)
      } catch {
        /* */
      }
    }
  } catch {
    return null
  }
}

function rcloneBaseArgs(settings: BackupSettings): string[] {
  const args = ['--retries', '5', '--low-level-retries', '10', '--timeout', '2m']
  if (settings.rcloneBwlimit?.trim()) {
    args.push('--bwlimit', settings.rcloneBwlimit.trim())
  }
  return args
}

async function runRclone(args: string[], settings: BackupSettings): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const full = ['rclone', ...rcloneBaseArgs(settings), ...args]
    const child = spawn(full[0], full.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (c) => {
      stdout += String(c)
    })
    child.stderr?.on('data', (c) => {
      stderr += String(c)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(stderr || stdout || `rclone exited ${code}`))
    })
  })
}

async function checkFreeDiskMb(dir: string): Promise<number | null> {
  try {
    const fsp = await import('node:fs/promises')
    const statfs = (fsp as unknown as { statfs?: (p: string) => Promise<{ bsize: bigint; bavail: bigint }> })
      .statfs
    if (typeof statfs !== 'function') return null
    const s = await statfs(dir)
    const bsize = Number(s.bsize)
    const bavail = Number(s.bavail)
    return Math.floor((bavail * bsize) / (1024 * 1024))
  } catch {
    return null
  }
}

type BackupNotifyKind = 'database' | 'database_full' | 'mirror'

function shouldSendBackupNotify(settings: BackupSettings, ok: boolean, kind: BackupNotifyKind): boolean {
  if (ok) {
    if (kind === 'database') return settings.notifyDatabaseOnSuccess
    if (kind === 'database_full') return settings.notifyDatabaseFullOnSuccess
    return settings.notifyMirrorOnSuccess
  }
  if (kind === 'database') return settings.notifyDatabaseOnFailure
  if (kind === 'database_full') return settings.notifyDatabaseFullOnFailure
  return settings.notifyMirrorOnFailure
}

async function notify(
  settings: BackupSettings,
  ok: boolean,
  kind: BackupNotifyKind,
  title: string,
  body: string,
  embedFields?: DiscordEmbedField[]
) {
  if (!shouldSendBackupNotify(settings, ok, kind)) return
  const msg = `${title}\n${body}`
  if (settings.discordWebhook?.trim()) {
    await sendDiscordBackupEmbed(settings.discordWebhook.trim(), {
      ok,
      title,
      description: body,
      fields: embedFields,
      notifyLabel: settings.discordNotifyLabel?.trim() || null,
    })
  }
  if (settings.mailTo?.trim()) {
    try {
      await new Promise<void>((resolve, reject) => {
        const to = settings.mailTo.trim()
        const child = spawn('mail', ['-s', title.slice(0, 80), to], {
          stdio: ['pipe', 'ignore', 'pipe'],
        })
        child.stdin?.write(msg)
        child.stdin?.end()
        child.on('error', reject)
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`mail exited ${code}`))))
      })
    } catch {
      /* */
    }
  }
}

async function sqliteIntegrityOnFile(dbPath: string): Promise<boolean> {
  let db: Database.Database | null = null
  try {
    db = new Database(dbPath, { readonly: true })
    const row = db.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined
    const v = row && typeof row === 'object' && 'integrity_check' in row ? row.integrity_check : undefined
    return v === 'ok'
  } catch {
    return false
  } finally {
    try {
      db?.close()
    } catch {
      /* */
    }
  }
}

export type BackupRunResult = {
  ok: boolean
  skipped?: boolean
  message: string
  durationMs: number
  bytesTransferred?: number
}

type DbSnapshotVariant = 'standard' | 'full'

/** So skipped runs show up in history and last-run status (otherwise manual/scheduled skips look like no-op). */
async function recordDatabaseSnapshotSkipped(
  variant: DbSnapshotVariant,
  started: number,
  message: string
): Promise<void> {
  const durationMs = Date.now() - started
  const scopeLine = variant === 'standard' ? databaseScopeSummary() : databaseFullScopeSummary()
  const historyKind = variant === 'standard' ? 'database' : 'database_full'
  const s2 = await getBackupSettings()
  const now = new Date().toISOString()
  if (variant === 'standard') {
    s2.lastDatabaseRunAt = now
    s2.lastDatabaseRunOk = true
    s2.lastDatabaseRunMessage = message
  } else {
    s2.lastDatabaseFullRunAt = now
    s2.lastDatabaseFullRunOk = true
    s2.lastDatabaseFullRunMessage = message
  }
  await setBackupSettings(s2)
  await appendBackupHistory({
    kind: historyKind,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs,
    ok: true,
    message,
    scopeSummary: scopeLine,
  })
  const stagingAbs = path.resolve(s2.localStagingDir)
  await syncStoredDbFingerprintWithLive(stagingAbs)
}

async function recordMirrorSkipped(started: number, message: string): Promise<void> {
  const durationMs = Date.now() - started
  const s2 = await getBackupSettings()
  const now = new Date().toISOString()
  s2.lastMirrorRunAt = now
  s2.lastMirrorRunOk = true
  s2.lastMirrorRunMessage = message
  await setBackupSettings(s2)
  await appendBackupHistory({
    kind: 'mirror',
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs,
    ok: true,
    message,
    scopeSummary: mirrorScopeSummary(s2),
  })
  const stagingAbs = path.resolve(s2.localStagingDir)
  await syncStoredMirrorTokenWithLive(stagingAbs, s2)
}

async function runDatabaseSnapshotVariant(variant: DbSnapshotVariant): Promise<BackupRunResult> {
  const started = Date.now()
  const settings = await getBackupSettings()
  const include = variant === 'standard' ? settings.includeDatabase : settings.includeDatabaseFull
  if (!include) {
    const msg =
      variant === 'standard' ? 'Database backup not included in scope' : 'Full database backup is not enabled'
    await recordDatabaseSnapshotSkipped(variant, started, msg)
    return {
      ok: true,
      skipped: true,
      message: msg,
      durationMs: Date.now() - started,
    }
  }

  const staging = path.resolve(settings.localStagingDir)
  const lockPath = path.join(staging, 'backup-db.lock')
  fs.mkdirSync(staging, { recursive: true })
  const release = acquireLock(lockPath)
  if (!release) {
    const msg = 'Database backup already in progress'
    await recordDatabaseSnapshotSkipped(variant, started, msg)
    return {
      ok: true,
      skipped: true,
      message: msg,
      durationMs: Date.now() - started,
    }
  }

  const localDirName = variant === 'standard' ? 'db-snapshots' : 'db-full-snapshots'
  const scopeLine = variant === 'standard' ? databaseScopeSummary() : databaseFullScopeSummary()
  const historyKind = variant === 'standard' ? 'database' : 'database_full'

  try {
    if (settings.uploadToDropbox && settings.dropboxRclonePath) {
      try {
        await execFileAsync('rclone', ['version'], { timeout: 15_000, env: process.env })
      } catch {
        throw new Error('rclone not found on PATH (required for Dropbox upload)')
      }
    }
    if (isUsingPostgres()) {
      try {
        await execFileAsync('pg_dump', ['--version'], { timeout: 15_000, env: process.env })
      } catch {
        throw new Error('pg_dump not found on PATH')
      }
    }

    if (settings.minFreeDiskMb != null && settings.minFreeDiskMb > 0) {
      const free = await checkFreeDiskMb(staging)
      if (free != null && free < settings.minFreeDiskMb) {
        throw new Error(`Insufficient free disk space (${free} MiB free, need ${settings.minFreeDiskMb} MiB)`)
      }
    }

    const fpNow = await computeLiveDbFingerprint()
    const fpStored = readStoredDbFingerprint(staging)
    if (fpNow && fpStored && fpStored.engine === fpNow.engine && fpStored.token === fpNow.token) {
      const msg = 'No database changes since last backup'
      await recordDatabaseSnapshotSkipped(variant, started, msg)
      return { ok: true, skipped: true, message: msg, durationMs: Date.now() - started }
    }

    const stamp = timeStamp()
    const snapDir = path.join(staging, localDirName, stamp)
    fs.mkdirSync(snapDir, { recursive: true })

    let postgresRestoreHints: {
      dumpFile: string
      globalsFile: string | null
      globalsError?: string
    } | null = null

    if (isUsingPostgres()) {
      const url = resolveDatabaseUrl()
      if (!url) throw new Error('DATABASE_URL not configured')
      const pgExtra = await writePostgresSnapshotArtifacts(snapDir, url)
      postgresRestoreHints = {
        dumpFile: 'database.dump',
        globalsFile: pgExtra.globalsExported ? 'globals.sql' : null,
        ...(pgExtra.globalsError ? { globalsError: pgExtra.globalsError } : {}),
      }
    } else {
      const raw = getSqliteDatabaseForBackup()
      if (!raw) throw new Error('SQLite database not available')
      const dest = path.join(snapDir, 'dc-automation-backup.db')
      await raw.backup(dest)
      const okInt = await sqliteIntegrityOnFile(dest)
      if (!okInt) throw new Error('SQLite backup failed integrity_check')
      fs.writeFileSync(path.join(snapDir, 'RESTORE_README.txt'), SQLITE_RESTORE_README, 'utf8')
    }

    const manifest = {
      stamp,
      variant: variant === 'full' ? 'full' : 'standard',
      databaseKind: isUsingPostgres() ? 'postgres' : 'sqlite',
      createdAt: new Date().toISOString(),
      scope:
        variant === 'standard'
          ? { includeDatabase: settings.includeDatabase }
          : { includeDatabaseFull: settings.includeDatabaseFull },
      ...(postgresRestoreHints ? { postgresRestore: postgresRestoreHints } : {}),
      ...(isUsingPostgres() ? {} : { sqliteRestore: { dataFile: 'dc-automation-backup.db', readme: 'RESTORE_README.txt' } }),
    }
    fs.writeFileSync(path.join(snapDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

    if (settings.uploadToDropbox && settings.dropboxRclonePath) {
      const remoteBase = settings.dropboxRclonePath.replace(/\/+$/, '')
      const remoteFinal = `${remoteBase}/${localDirName}/${stamp}`
      const remoteUploading = `${remoteBase}/${localDirName}/${stamp}.uploading`
      await runRclone(['copy', snapDir, remoteUploading], settings)
      try {
        await runRclone(['moveto', remoteUploading, remoteFinal], settings)
      } catch (movetoErr) {
        try {
          await runRclone(['purge', remoteUploading], settings)
        } catch {
          /* */
        }
        throw movetoErr
      }
    }

    await pruneDbSnapshotsForVariant(settings, variant)

    const fpFinal = await computeLiveDbFingerprint()
    if (fpFinal) writeStoredDbFingerprint(staging, fpFinal)

    const durationMs = Date.now() - started
    const s2 = await getBackupSettings()
    if (variant === 'standard') {
      s2.lastDatabaseRunAt = new Date().toISOString()
      s2.lastDatabaseRunOk = true
      s2.lastDatabaseRunMessage = `OK ${stamp}`
    } else {
      s2.lastDatabaseFullRunAt = new Date().toISOString()
      s2.lastDatabaseFullRunOk = true
      s2.lastDatabaseFullRunMessage = `OK ${stamp}`
    }
    await setBackupSettings(s2)

    await appendBackupHistory({
      kind: historyKind,
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs,
      ok: true,
      message: stamp,
      scopeSummary: scopeLine,
    })

    const titleOk = variant === 'full' ? 'Full database backup' : 'Database backup'
    const descOk =
      variant === 'full'
        ? `Full archive **${stamp}** completed (db-full-snapshots).`
        : `Snapshot **${stamp}** completed successfully.`
    await notify(settings, true, variant === 'full' ? 'database_full' : 'database', titleOk, descOk, [
      { name: 'Engine', value: isUsingPostgres() ? 'PostgreSQL' : 'SQLite', inline: true },
      { name: 'Duration', value: `${(durationMs / 1000).toFixed(1)} s`, inline: true },
      { name: 'Scope', value: scopeLine, inline: true },
    ])
    return { ok: true, message: stamp, durationMs }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const durationMs = Date.now() - started
    const s2 = await getBackupSettings()
    if (variant === 'standard') {
      s2.lastDatabaseRunAt = new Date().toISOString()
      s2.lastDatabaseRunOk = false
      s2.lastDatabaseRunMessage = msg
    } else {
      s2.lastDatabaseFullRunAt = new Date().toISOString()
      s2.lastDatabaseFullRunOk = false
      s2.lastDatabaseFullRunMessage = msg
    }
    await setBackupSettings(s2)
    await appendBackupHistory({
      kind: historyKind,
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs,
      ok: false,
      message: msg,
      scopeSummary: scopeLine,
    })
    const titleFail = variant === 'full' ? 'Full database backup failed' : 'Database backup failed'
    await notify(settings, false, variant === 'full' ? 'database_full' : 'database', titleFail, msg, [
      { name: 'Duration', value: `${(durationMs / 1000).toFixed(1)} s`, inline: true },
      { name: 'Scope', value: scopeLine, inline: true },
    ])
    return { ok: false, message: msg, durationMs }
  } finally {
    release()
  }
}

export async function runDatabaseBackup(): Promise<BackupRunResult> {
  return runDatabaseSnapshotVariant('standard')
}

export async function runDatabaseFullBackup(): Promise<BackupRunResult> {
  return runDatabaseSnapshotVariant('full')
}

async function pruneDbSnapshotsForVariant(settings: BackupSettings, variant: DbSnapshotVariant): Promise<void> {
  const staging = path.resolve(settings.localStagingDir)
  const localDirName = variant === 'standard' ? 'db-snapshots' : 'db-full-snapshots'
  const root = path.join(staging, localDirName)
  if (!fs.existsSync(root)) return

  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{8}-\d{4}$/.test(d.name))
    .map((d) => d.name)
    .sort()
    .reverse()

  const keep = variant === 'standard' ? settings.keepLastBackups : settings.keepLastFullDatabaseBackups
  const maxAgeDays = variant === 'standard' ? settings.maxAgeDays : settings.maxAgeDaysFullDatabase
  const maxAgeMs = maxAgeDays > 0 ? maxAgeDays * 24 * 60 * 60 * 1000 : 0
  const cutoff = maxAgeMs > 0 ? Date.now() - maxAgeMs : 0

  const remoteBase = settings.dropboxRclonePath?.replace(/\/+$/, '')

  for (let i = 0; i < dirs.length; i++) {
    const name = dirs[i]
    const full = path.join(root, name)
    const mtime = fs.statSync(full).mtimeMs
    const tooOld = maxAgeMs > 0 && mtime < cutoff
    const beyondKeep = i >= keep
    if (!tooOld && !beyondKeep) continue
    try {
      fs.rmSync(full, { recursive: true, force: true })
    } catch {
      /* */
    }
    if (settings.uploadToDropbox && remoteBase) {
      try {
        await runRclone(['purge', `${remoteBase}/${localDirName}/${name}`], settings)
      } catch {
        /* */
      }
    }
  }
}

function databaseScopeSummary(): string {
  return 'database'
}

function databaseFullScopeSummary(): string {
  return 'database (full archive)'
}

function mirrorScopeSummary(settings: BackupSettings): string {
  const parts: string[] = []
  if (settings.includeWiki) parts.push('wiki')
  if (settings.includeUploadsFiles) {
    parts.push('uploads/files (UUID on disk)')
    parts.push('uploads/files-original (library names)')
  }
  if (settings.includeUploadsTesting) parts.push('uploads/testing')
  if (settings.includeUploadsHome) parts.push('uploads/home')
  if (settings.includeUploadsWiki) parts.push('uploads/wiki')
  if (settings.includeWikiSeed) parts.push('wiki-seed')
  if (settings.includeHomeIntro) parts.push('home-intro')
  if (settings.includeConfigJson) parts.push('config.json')
  if (settings.includeBackupConf) parts.push('backup.conf')
  return parts.length > 0 ? parts.join(', ') : '(no paths enabled)'
}

function mirrorRoots(settings: BackupSettings): { rel: string; abs: string }[] {
  const roots: { rel: string; abs: string }[] = []
  if (settings.includeWiki) roots.push({ rel: 'content/wiki', abs: path.join(backupProjectRoot, 'content', 'wiki') })
  if (settings.includeUploadsFiles) {
    const p = path.join(backupProjectRoot, 'uploads', 'files')
    if (fs.existsSync(p)) roots.push({ rel: 'uploads/files', abs: p })
  }
  if (settings.includeUploadsTesting) {
    const p = path.join(backupProjectRoot, 'uploads', 'testing')
    if (fs.existsSync(p)) roots.push({ rel: 'uploads/testing', abs: p })
  }
  if (settings.includeUploadsHome) {
    const p = path.join(backupProjectRoot, 'uploads', 'home')
    if (fs.existsSync(p)) roots.push({ rel: 'uploads/home', abs: p })
  }
  if (settings.includeUploadsWiki) {
    const p = path.join(backupProjectRoot, 'uploads', 'wiki')
    if (fs.existsSync(p)) roots.push({ rel: 'uploads/wiki', abs: p })
  }
  if (settings.includeWikiSeed) {
    const p = path.join(backupProjectRoot, 'content', 'wiki-seed')
    if (fs.existsSync(p)) roots.push({ rel: 'content/wiki-seed', abs: p })
  }
  if (settings.includeHomeIntro) {
    const p = path.join(backupProjectRoot, 'content', 'home-intro.md')
    if (fs.existsSync(p)) roots.push({ rel: 'content/home-intro.md', abs: p })
  }
  if (settings.includeConfigJson) {
    const p = path.join(backupProjectRoot, 'config.json')
    if (fs.existsSync(p)) roots.push({ rel: 'config.json', abs: p })
  }
  if (settings.includeBackupConf) {
    const p = path.join(backupProjectRoot, 'scripts', 'backup.conf')
    if (fs.existsSync(p)) roots.push({ rel: 'scripts/backup.conf', abs: p })
  }
  return roots
}

function safeBackupFolderSegment(name: string): string {
  const t = (name || '_').replace(/[\u0000-\u001f\u007f/\\]/g, '-').trim() || '_'
  return t.slice(0, 200)
}

/** Match Files module display names; strip path chars so tree layout is safe on all platforms. */
function safeBackupOriginalFilename(name: string): string {
  const t = (name || 'upload').replace(/[\u0000-\u001f\u007f]/g, '').trim()
  const base = (t ? t.slice(0, 500) : 'upload').replace(/[/\\]/g, '-')
  return base.slice(0, 255) || 'upload'
}

async function folderPathSegmentsForStoredFileFolder(folderId: string | null): Promise<string[]> {
  const segments: string[] = []
  let id: string | null = folderId?.trim() || null
  const guard = new Set<string>()
  while (id) {
    if (guard.has(id)) break
    guard.add(id)
    const row = (await db
      .prepare('SELECT parent_id, name FROM file_folders WHERE id = ?')
      .get(id)) as { parent_id: string | null; name: string } | undefined
    if (!row) break
    segments.unshift(safeBackupFolderSegment(row.name))
    id = row.parent_id?.trim() || null
  }
  return segments
}

/**
 * Second mirror of the Files library: same bytes as `uploads/files/` but paths follow folder + **original_filename**
 * from `stored_files` (human-readable on Dropbox). The raw UUID tree under `mirror/uploads/files/` remains for restore.
 */
async function mirrorUploadsFilesOriginalNamesLayout(
  stagingAbs: string,
  remoteBase: string,
  settings: BackupSettings
): Promise<{ stdout: string; stderr: string } | null> {
  const filesRoot = path.join(backupProjectRoot, 'uploads', 'files')
  if (!fs.existsSync(filesRoot)) return null

  const layoutDir = path.join(stagingAbs, 'mirror-files-original-layout')
  fs.rmSync(layoutDir, { recursive: true, force: true })
  fs.mkdirSync(layoutDir, { recursive: true })

  const rows = (await db
    .prepare(
      `SELECT original_filename, storage_filename, folder_id FROM stored_files
       WHERE (deleted_at IS NULL OR deleted_at = '')`
    )
    .all()) as { original_filename: string; storage_filename: string; folder_id: string | null }[]

  const usedLowerByDir = new Map<string, Set<string>>()
  function pickUniqueFilename(dirKey: string, proposed: string): string {
    let set = usedLowerByDir.get(dirKey)
    if (!set) {
      set = new Set<string>()
      usedLowerByDir.set(dirKey, set)
    }
    const ext = path.extname(proposed)
    const stem = ext ? proposed.slice(0, -ext.length) : proposed
    let n = 0
    let candidate = proposed
    while (set.has(candidate.toLowerCase())) {
      n += 1
      candidate = `${stem}_${n}${ext}`
    }
    set.add(candidate.toLowerCase())
    return candidate
  }

  for (const row of rows) {
    const src = path.join(filesRoot, row.storage_filename)
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue

    const segments = await folderPathSegmentsForStoredFileFolder(row.folder_id)
    const dirKey = segments.length > 0 ? segments.join('/') : '_library_root'
    const proposed = safeBackupOriginalFilename(row.original_filename)
    const finalName = pickUniqueFilename(dirKey, proposed)

    const destDir =
      segments.length > 0 ? path.join(layoutDir, ...segments) : path.join(layoutDir, '_library_root')
    fs.mkdirSync(destDir, { recursive: true })
    fs.copyFileSync(src, path.join(destDir, finalName))
  }

  const remoteDest = `${remoteBase}/mirror/uploads/files-original`
  return runRclone(['sync', layoutDir, remoteDest, '--stats-one-line'], settings)
}

export async function runMirrorBackup(): Promise<BackupRunResult> {
  const started = Date.now()
  const settings = await getBackupSettings()
  const roots = mirrorRoots(settings)
  if (roots.length === 0) {
    return { ok: true, skipped: true, message: 'No file paths selected for mirror', durationMs: Date.now() - started }
  }

  const staging = path.resolve(settings.localStagingDir)
  const lockPath = path.join(staging, 'backup-mirror.lock')
  fs.mkdirSync(staging, { recursive: true })
  const release = acquireLock(lockPath)
  if (!release) {
    return { ok: true, skipped: true, message: 'Files backup already in progress', durationMs: Date.now() - started }
  }

  try {
    if (!settings.uploadToDropbox || !settings.dropboxRclonePath) {
      throw new Error('Dropbox upload is disabled or path missing — required for mirror backup')
    }

    const { token: mirrorTok, hasFiles: mirrorHasFiles } = await computeMirrorSkipState(settings)
    const storedMt = readStoredMirrorToken(staging)
    if (mirrorTok && storedMt && mirrorTok === storedMt) {
      const msg = 'No file or database changes since last mirror'
      await recordMirrorSkipped(started, msg)
      return { ok: true, skipped: true, message: msg, durationMs: Date.now() - started }
    }

    if (!mirrorHasFiles) {
      const msg = 'No files to mirror under selected paths'
      await recordMirrorSkipped(started, msg)
      return { ok: true, skipped: true, message: msg, durationMs: Date.now() - started }
    }

    try {
      await execFileAsync('rclone', ['version'], { timeout: 15_000, env: process.env })
    } catch {
      throw new Error('rclone not found on PATH')
    }

    if (settings.minFreeDiskMb != null && settings.minFreeDiskMb > 0) {
      const free = await checkFreeDiskMb(staging)
      if (free != null && free < settings.minFreeDiskMb) {
        throw new Error(`Insufficient free disk space (${free} MiB free)`)
      }
    }

    const remoteBase = settings.dropboxRclonePath.replace(/\/+$/, '')
    const sub = settings.onDiskMirrorMode === 'sync' ? 'sync' : 'copy'
    let bytes = 0

    const uploadsFilesDir = path.join(backupProjectRoot, 'uploads', 'files')
    if (settings.includeUploadsFiles && fs.existsSync(uploadsFilesDir)) {
      const statOrig = await mirrorUploadsFilesOriginalNamesLayout(staging, remoteBase, settings)
      if (statOrig) {
        const m0 = /([0-9,]+)\s*Bytes/i.exec(statOrig.stderr + statOrig.stdout)
        if (m0) bytes += parseInt(m0[1].replace(/,/g, ''), 10) || 0
      }
    }

    for (const { rel, abs } of roots) {
      if (!fs.existsSync(abs)) continue
      const dest = `${remoteBase}/mirror/${rel}`
      const st = fs.statSync(abs)
      const statOut = st.isFile()
        ? await runRclone(['copyto', abs, dest], settings)
        : await runRclone([sub, abs, dest, '--stats-one-line'], settings)
      const m = /([0-9,]+)\s*Bytes/i.exec(statOut.stderr + statOut.stdout)
      if (m) bytes += parseInt(m[1].replace(/,/g, ''), 10) || 0
    }

    const { token: mirrorTokFinal } = await computeMirrorSkipState(settings)
    if (mirrorTokFinal) writeStoredMirrorToken(staging, mirrorTokFinal)

    const durationMs = Date.now() - started
    const s2 = await getBackupSettings()
    s2.lastMirrorRunAt = new Date().toISOString()
    s2.lastMirrorRunOk = true
    s2.lastMirrorRunMessage = 'OK'
    await setBackupSettings(s2)

    await appendBackupHistory({
      kind: 'mirror',
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs,
      ok: true,
      message: 'Mirror complete',
      bytesTransferred: bytes || undefined,
      scopeSummary: mirrorScopeSummary(settings),
    })
    const byteStr =
      bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(2)} MB (reported)` : `${bytes.toLocaleString()} B (reported)`
    await notify(settings, true, 'mirror', 'Files mirror backup', 'Incremental mirror to Dropbox finished.', [
      { name: 'Mode', value: settings.onDiskMirrorMode, inline: true },
      { name: 'Duration', value: `${(durationMs / 1000).toFixed(1)} s`, inline: true },
      { name: 'Scope', value: mirrorScopeSummary(settings), inline: false },
      ...(bytes > 0 ? [{ name: 'Transferred', value: byteStr, inline: false }] : []),
    ])
    return { ok: true, message: 'Mirror complete', durationMs, bytesTransferred: bytes }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const durationMs = Date.now() - started
    const s2 = await getBackupSettings()
    s2.lastMirrorRunAt = new Date().toISOString()
    s2.lastMirrorRunOk = false
    s2.lastMirrorRunMessage = msg
    await setBackupSettings(s2)
    await appendBackupHistory({
      kind: 'mirror',
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs,
      ok: false,
      message: msg,
      scopeSummary: mirrorScopeSummary(settings),
    })
    await notify(settings, false, 'mirror', 'Files mirror backup failed', msg, [
      { name: 'Duration', value: `${(durationMs / 1000).toFixed(1)} s`, inline: true },
      { name: 'Scope', value: mirrorScopeSummary(settings), inline: false },
    ])
    return { ok: false, message: msg, durationMs }
  } finally {
    release()
  }
}

/** Phases reported for manual POST /api/backup/run jobs (in-process only). */
export type BackupRunPhase = 'database' | 'database_full' | 'mirror'

export type BackupActiveRun = {
  jobId: string
  target: 'database' | 'database_full' | 'mirror' | 'both' | 'all'
  phase: BackupRunPhase
  /** 1-based index of the current phase */
  step: number
  stepsTotal: number
}

let backupActiveRun: BackupActiveRun | null = null

export function getBackupActiveRun(): BackupActiveRun | null {
  return backupActiveRun
}

function phasesForTarget(target: BackupActiveRun['target']): BackupRunPhase[] {
  switch (target) {
    case 'database':
      return ['database']
    case 'database_full':
      return ['database_full']
    case 'mirror':
      return ['mirror']
    case 'both':
      return ['database', 'mirror']
    case 'all':
      return ['database', 'database_full', 'mirror']
    default:
      return []
  }
}

function setBackupActivePhase(jobId: string, target: BackupActiveRun['target'], phase: BackupRunPhase) {
  const phases = phasesForTarget(target)
  const step = Math.max(1, phases.indexOf(phase) + 1)
  backupActiveRun = { jobId, target, phase, step, stepsTotal: phases.length }
}

function clearBackupActiveRun(jobId: string) {
  if (backupActiveRun?.jobId === jobId) backupActiveRun = null
}

export async function runBackupTarget(
  target: 'database' | 'database_full' | 'mirror' | 'both' | 'all',
  jobId?: string
): Promise<{
  database?: BackupRunResult
  databaseFull?: BackupRunResult
  mirror?: BackupRunResult
}> {
  const out: { database?: BackupRunResult; databaseFull?: BackupRunResult; mirror?: BackupRunResult } = {}
  const track = (phase: BackupRunPhase) => {
    if (jobId) setBackupActivePhase(jobId, target, phase)
  }
  try {
    if (target === 'database' || target === 'both' || target === 'all') {
      track('database')
      out.database = await runDatabaseBackup()
    }
    if (target === 'database_full' || target === 'all') {
      track('database_full')
      out.databaseFull = await runDatabaseFullBackup()
    }
    if (target === 'mirror' || target === 'both' || target === 'all') {
      track('mirror')
      out.mirror = await runMirrorBackup()
    }
  } finally {
    if (jobId) clearBackupActiveRun(jobId)
  }
  return out
}
