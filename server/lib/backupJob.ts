import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import Database from 'better-sqlite3'
import { resolveDatabaseUrl } from '../config.js'
import { getSqliteDatabaseForBackup, isUsingPostgres } from '../db/index.js'
import {
  appendBackupHistory,
  backupProjectRoot,
  getBackupSettings,
  setBackupSettings,
  type BackupSettings,
} from './backupSettings.js'
import { sendDiscordBackupEmbed, type DiscordEmbedField } from './backupDiscordNotify.js'

const execFileAsync = promisify(execFile)

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

async function notify(
  settings: BackupSettings,
  ok: boolean,
  title: string,
  body: string,
  embedFields?: DiscordEmbedField[]
) {
  if (ok && !settings.notifyOnSuccess) return
  if (!ok && !settings.notifyOnFailure) return
  const msg = `${title}\n${body}`
  if (settings.discordWebhook?.trim()) {
    await sendDiscordBackupEmbed(settings.discordWebhook.trim(), {
      ok,
      title,
      description: body,
      fields: embedFields,
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

export async function runDatabaseBackup(): Promise<BackupRunResult> {
  const started = Date.now()
  const settings = await getBackupSettings()
  if (!settings.includeDatabase) {
    return { ok: true, skipped: true, message: 'Database backup not included in scope', durationMs: Date.now() - started }
  }

  const staging = path.resolve(settings.localStagingDir)
  const lockPath = path.join(staging, 'backup-db.lock')
  fs.mkdirSync(staging, { recursive: true })
  const release = acquireLock(lockPath)
  if (!release) {
    return { ok: true, skipped: true, message: 'Database backup already in progress', durationMs: Date.now() - started }
  }

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

    const stamp = timeStamp()
    const snapDir = path.join(staging, 'db-snapshots', stamp)
    fs.mkdirSync(snapDir, { recursive: true })

    if (isUsingPostgres()) {
      const url = resolveDatabaseUrl()
      if (!url) throw new Error('DATABASE_URL not configured')
      const dumpPath = path.join(snapDir, 'database.dump')
      await execFileAsync('pg_dump', ['--format=custom', '--file', dumpPath, url], {
        maxBuffer: 64 * 1024 * 1024,
        env: process.env,
      })
      try {
        await execFileAsync('pg_restore', ['--list', dumpPath], { maxBuffer: 10 * 1024 * 1024 })
      } catch {
        /* list may fail on huge; pg_dump already succeeded */
      }
    } else {
      const raw = getSqliteDatabaseForBackup()
      if (!raw) throw new Error('SQLite database not available')
      const dest = path.join(snapDir, 'dc-automation-backup.db')
      await raw.backup(dest)
      const okInt = await sqliteIntegrityOnFile(dest)
      if (!okInt) throw new Error('SQLite backup failed integrity_check')
    }

    const manifest = {
      stamp,
      databaseKind: isUsingPostgres() ? 'postgres' : 'sqlite',
      createdAt: new Date().toISOString(),
      scope: { includeDatabase: settings.includeDatabase },
    }
    fs.writeFileSync(path.join(snapDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

    if (settings.uploadToDropbox && settings.dropboxRclonePath) {
      const remoteBase = settings.dropboxRclonePath.replace(/\/+$/, '')
      const remoteFinal = `${remoteBase}/db-snapshots/${stamp}`
      const remoteUploading = `${remoteBase}/db-snapshots/${stamp}.uploading`
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

    await pruneDbSnapshots(settings)

    const durationMs = Date.now() - started
    const s2 = await getBackupSettings()
    s2.lastDatabaseRunAt = new Date().toISOString()
    s2.lastDatabaseRunOk = true
    s2.lastDatabaseRunMessage = `OK ${stamp}`
    await setBackupSettings(s2)

    await appendBackupHistory({
      kind: 'database',
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs,
      ok: true,
      message: stamp,
      scopeSummary: databaseScopeSummary(),
    })

    await notify(settings, true, 'Database backup', `Snapshot **${stamp}** completed successfully.`, [
      { name: 'Engine', value: isUsingPostgres() ? 'PostgreSQL' : 'SQLite', inline: true },
      { name: 'Duration', value: `${(durationMs / 1000).toFixed(1)} s`, inline: true },
      { name: 'Scope', value: databaseScopeSummary(), inline: true },
    ])
    return { ok: true, message: stamp, durationMs }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const durationMs = Date.now() - started
    const s2 = await getBackupSettings()
    s2.lastDatabaseRunAt = new Date().toISOString()
    s2.lastDatabaseRunOk = false
    s2.lastDatabaseRunMessage = msg
    await setBackupSettings(s2)
    await appendBackupHistory({
      kind: 'database',
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs,
      ok: false,
      message: msg,
      scopeSummary: databaseScopeSummary(),
    })
    await notify(settings, false, 'Database backup failed', msg, [
      { name: 'Duration', value: `${(durationMs / 1000).toFixed(1)} s`, inline: true },
      { name: 'Scope', value: databaseScopeSummary(), inline: true },
    ])
    return { ok: false, message: msg, durationMs }
  } finally {
    release()
  }
}

async function pruneDbSnapshots(settings: BackupSettings): Promise<void> {
  const staging = path.resolve(settings.localStagingDir)
  const root = path.join(staging, 'db-snapshots')
  if (!fs.existsSync(root)) return

  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{8}-\d{4}$/.test(d.name))
    .map((d) => d.name)
    .sort()
    .reverse()

  const keep = settings.keepLastBackups
  const maxAgeMs = settings.maxAgeDays > 0 ? settings.maxAgeDays * 24 * 60 * 60 * 1000 : 0
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
        await runRclone(['purge', `${remoteBase}/db-snapshots/${name}`], settings)
      } catch {
        /* */
      }
    }
  }
}

function databaseScopeSummary(): string {
  return 'database'
}

function mirrorScopeSummary(settings: BackupSettings): string {
  const parts: string[] = []
  if (settings.includeWiki) parts.push('wiki')
  if (settings.includeUploadsFiles) parts.push('uploads/files')
  if (settings.includeUploadsTesting) parts.push('uploads/testing')
  if (settings.includeUploadsHome) parts.push('uploads/home')
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
    await notify(settings, true, 'Files mirror backup', 'Incremental mirror to Dropbox finished.', [
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
    await notify(settings, false, 'Files mirror backup failed', msg, [
      { name: 'Duration', value: `${(durationMs / 1000).toFixed(1)} s`, inline: true },
      { name: 'Scope', value: mirrorScopeSummary(settings), inline: false },
    ])
    return { ok: false, message: msg, durationMs }
  } finally {
    release()
  }
}

export async function runBackupTarget(target: 'database' | 'mirror' | 'both'): Promise<{
  database?: BackupRunResult
  mirror?: BackupRunResult
}> {
  const out: { database?: BackupRunResult; mirror?: BackupRunResult } = {}
  if (target === 'database' || target === 'both') {
    out.database = await runDatabaseBackup()
  }
  if (target === 'mirror' || target === 'both') {
    out.mirror = await runMirrorBackup()
  }
  return out
}
