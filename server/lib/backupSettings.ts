import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { z } from 'zod'
import { db } from '../db/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const upToRoot = __dirname.includes(`${path.sep}dist${path.sep}`) ? 3 : 2
export const backupProjectRoot = path.resolve(__dirname, ...Array(upToRoot).fill('..' as const))

export const BACKUP_SETTINGS_KV_KEY = 'backup_settings'
export const BACKUP_HISTORY_KV_KEY = 'backup_run_history'

export const backupFrequencySchema = z.enum(['hourly', 'everyNHours', 'daily', 'weekly'])

export const backupScheduleBlockSchema = z.object({
  enabled: z.boolean(),
  frequency: backupFrequencySchema,
  everyNHours: z.number().int().min(1).max(168).default(3),
  timeLocal: z.string().default('02:00'),
  weekday: z.number().int().min(0).max(6).default(0),
  minuteOffset: z.number().int().min(0).max(59).default(0),
})

export type BackupScheduleBlock = z.infer<typeof backupScheduleBlockSchema>

export const onDiskMirrorModeSchema = z.enum(['sync', 'copy'])

export const backupSettingsBodySchema = z.object({
  dropboxRclonePath: z.string().nullable().optional(),
  uploadToDropbox: z.boolean().optional(),
  databaseSchedule: backupScheduleBlockSchema.optional(),
  databaseFullSchedule: backupScheduleBlockSchema.optional(),
  mirrorSchedule: backupScheduleBlockSchema.optional(),
  includeDatabase: z.boolean().optional(),
  includeDatabaseFull: z.boolean().optional(),
  includeWiki: z.boolean().optional(),
  /** @deprecated Prefer includeUploadsFiles/Testing/Home; still accepted for older clients. */
  includeUploads: z.boolean().optional(),
  includeUploadsFiles: z.boolean().optional(),
  includeUploadsTesting: z.boolean().optional(),
  includeUploadsHome: z.boolean().optional(),
  includeWikiSeed: z.boolean().optional(),
  includeHomeIntro: z.boolean().optional(),
  includeConfigJson: z.boolean().optional(),
  includeBackupConf: z.boolean().optional(),
  localStagingDir: z.string().optional(),
  keepLastBackups: z.number().int().min(1).max(500).optional(),
  maxAgeDays: z.number().int().min(0).max(3650).optional(),
  keepLastFullDatabaseBackups: z.number().int().min(1).max(500).optional(),
  maxAgeDaysFullDatabase: z.number().int().min(0).max(3650).optional(),
  minFreeDiskMb: z.number().int().min(0).optional().nullable(),
  rcloneBwlimit: z.string().optional(),
  onDiskMirrorMode: onDiskMirrorModeSchema.optional(),
  discordWebhook: z.string().optional(),
  /** Shown in Discord (webhook username + embed title) to tell deployments apart when one webhook is reused. */
  discordNotifyLabel: z.string().max(120).optional(),
  mailTo: z.string().optional(),
  /** @deprecated Prefer notifyDatabase* / notifyDatabaseFull* / notifyMirror*; still applied when granular keys are omitted. */
  notifyOnFailure: z.boolean().optional(),
  /** @deprecated Prefer per-type success toggles; still applied when granular keys are omitted. */
  notifyOnSuccess: z.boolean().optional(),
  notifyDatabaseOnSuccess: z.boolean().optional(),
  notifyDatabaseOnFailure: z.boolean().optional(),
  notifyDatabaseFullOnSuccess: z.boolean().optional(),
  notifyDatabaseFullOnFailure: z.boolean().optional(),
  notifyMirrorOnSuccess: z.boolean().optional(),
  notifyMirrorOnFailure: z.boolean().optional(),
})

export type BackupSettings = {
  dropboxRclonePath: string | null
  uploadToDropbox: boolean
  databaseSchedule: BackupScheduleBlock
  /** Separate full logical dump schedule; stores under db-full-snapshots/ with its own retention. */
  databaseFullSchedule: BackupScheduleBlock
  mirrorSchedule: BackupScheduleBlock
  includeDatabase: boolean
  /** Second job: same dump format as snapshots, different schedule/retention (db-full-snapshots/). */
  includeDatabaseFull: boolean
  includeWiki: boolean
  /** Mirror uploads/files/ (Files module library). */
  includeUploadsFiles: boolean
  /** Mirror uploads/testing/ (test plan images, etc.). */
  includeUploadsTesting: boolean
  /** Mirror uploads/home/ (home assets, favicon, etc.). */
  includeUploadsHome: boolean
  includeWikiSeed: boolean
  includeHomeIntro: boolean
  includeConfigJson: boolean
  includeBackupConf: boolean
  localStagingDir: string
  keepLastBackups: number
  maxAgeDays: number
  keepLastFullDatabaseBackups: number
  maxAgeDaysFullDatabase: number
  minFreeDiskMb: number | null
  rcloneBwlimit: string
  onDiskMirrorMode: z.infer<typeof onDiskMirrorModeSchema>
  discordWebhook: string
  discordNotifyLabel: string
  mailTo: string
  notifyDatabaseOnSuccess: boolean
  notifyDatabaseOnFailure: boolean
  notifyDatabaseFullOnSuccess: boolean
  notifyDatabaseFullOnFailure: boolean
  notifyMirrorOnSuccess: boolean
  notifyMirrorOnFailure: boolean
  lastDatabaseRunAt: string | null
  lastDatabaseRunOk: boolean | null
  lastDatabaseRunMessage: string | null
  lastDatabaseFullRunAt: string | null
  lastDatabaseFullRunOk: boolean | null
  lastDatabaseFullRunMessage: string | null
  lastMirrorRunAt: string | null
  lastMirrorRunOk: boolean | null
  lastMirrorRunMessage: string | null
}

const defaultSchedule = (): BackupScheduleBlock => ({
  enabled: false,
  frequency: 'daily',
  everyNHours: 3,
  timeLocal: '02:00',
  weekday: 0,
  minuteOffset: 0,
})

export function defaultBackupSettings(): BackupSettings {
  return {
    dropboxRclonePath: null,
    uploadToDropbox: true,
    databaseSchedule: defaultSchedule(),
    databaseFullSchedule: { ...defaultSchedule(), enabled: false, frequency: 'weekly', timeLocal: '04:00' },
    mirrorSchedule: { ...defaultSchedule(), timeLocal: '03:00' },
    includeDatabase: true,
    includeDatabaseFull: false,
    includeWiki: true,
    includeUploadsFiles: true,
    includeUploadsTesting: true,
    includeUploadsHome: true,
    includeWikiSeed: false,
    includeHomeIntro: false,
    includeConfigJson: false,
    includeBackupConf: false,
    localStagingDir: path.join(backupProjectRoot, 'backup-staging'),
    keepLastBackups: 24,
    maxAgeDays: 0,
    keepLastFullDatabaseBackups: 12,
    maxAgeDaysFullDatabase: 365,
    minFreeDiskMb: 500,
    rcloneBwlimit: '',
    onDiskMirrorMode: 'sync',
    discordWebhook: '',
    discordNotifyLabel: '',
    mailTo: '',
    notifyDatabaseOnSuccess: false,
    notifyDatabaseOnFailure: true,
    notifyDatabaseFullOnSuccess: false,
    notifyDatabaseFullOnFailure: true,
    notifyMirrorOnSuccess: false,
    notifyMirrorOnFailure: true,
    lastDatabaseRunAt: null,
    lastDatabaseRunOk: null,
    lastDatabaseRunMessage: null,
    lastDatabaseFullRunAt: null,
    lastDatabaseFullRunOk: null,
    lastDatabaseFullRunMessage: null,
    lastMirrorRunAt: null,
    lastMirrorRunOk: null,
    lastMirrorRunMessage: null,
  }
}

/** Legacy `includeUploads` maps to all three; granular keys override when present. */
function migrateUploadsMirrorFlags(
  o: Record<string, unknown>,
  base: BackupSettings
): Pick<BackupSettings, 'includeUploadsFiles' | 'includeUploadsTesting' | 'includeUploadsHome'> {
  const hasGranular =
    typeof o.includeUploadsFiles === 'boolean' ||
    typeof o.includeUploadsTesting === 'boolean' ||
    typeof o.includeUploadsHome === 'boolean'
  if (hasGranular) {
    return {
      includeUploadsFiles:
        typeof o.includeUploadsFiles === 'boolean' ? o.includeUploadsFiles : base.includeUploadsFiles,
      includeUploadsTesting:
        typeof o.includeUploadsTesting === 'boolean' ? o.includeUploadsTesting : base.includeUploadsTesting,
      includeUploadsHome:
        typeof o.includeUploadsHome === 'boolean' ? o.includeUploadsHome : base.includeUploadsHome,
    }
  }
  const legacy = typeof o.includeUploads === 'boolean' ? o.includeUploads : base.includeUploadsFiles
  return {
    includeUploadsFiles: legacy,
    includeUploadsTesting: legacy,
    includeUploadsHome: legacy,
  }
}

function mergeSettings(raw: unknown): BackupSettings {
  const base = defaultBackupSettings()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  const parseBlock = (x: unknown, fallback: BackupScheduleBlock): BackupScheduleBlock => {
    const r = backupScheduleBlockSchema.safeParse(x)
    return r.success ? { ...fallback, ...r.data } : fallback
  }
  return {
    ...base,
    dropboxRclonePath:
      o.dropboxRclonePath === null || o.dropboxRclonePath === undefined
        ? base.dropboxRclonePath
        : typeof o.dropboxRclonePath === 'string'
          ? o.dropboxRclonePath.trim() || null
          : base.dropboxRclonePath,
    uploadToDropbox: typeof o.uploadToDropbox === 'boolean' ? o.uploadToDropbox : base.uploadToDropbox,
    databaseSchedule: parseBlock(o.databaseSchedule, base.databaseSchedule),
    databaseFullSchedule: parseBlock(o.databaseFullSchedule, base.databaseFullSchedule),
    mirrorSchedule: parseBlock(o.mirrorSchedule, base.mirrorSchedule),
    includeDatabase: typeof o.includeDatabase === 'boolean' ? o.includeDatabase : base.includeDatabase,
    includeDatabaseFull: typeof o.includeDatabaseFull === 'boolean' ? o.includeDatabaseFull : base.includeDatabaseFull,
    includeWiki: typeof o.includeWiki === 'boolean' ? o.includeWiki : base.includeWiki,
    ...migrateUploadsMirrorFlags(o, base),
    includeWikiSeed: typeof o.includeWikiSeed === 'boolean' ? o.includeWikiSeed : base.includeWikiSeed,
    includeHomeIntro: typeof o.includeHomeIntro === 'boolean' ? o.includeHomeIntro : base.includeHomeIntro,
    includeConfigJson: typeof o.includeConfigJson === 'boolean' ? o.includeConfigJson : base.includeConfigJson,
    includeBackupConf: typeof o.includeBackupConf === 'boolean' ? o.includeBackupConf : base.includeBackupConf,
    localStagingDir: typeof o.localStagingDir === 'string' && o.localStagingDir.trim()
      ? o.localStagingDir.trim()
      : base.localStagingDir,
    keepLastBackups:
      typeof o.keepLastBackups === 'number' && Number.isFinite(o.keepLastBackups)
        ? Math.min(500, Math.max(1, Math.floor(o.keepLastBackups)))
        : base.keepLastBackups,
    maxAgeDays:
      typeof o.maxAgeDays === 'number' && Number.isFinite(o.maxAgeDays)
        ? Math.min(3650, Math.max(0, Math.floor(o.maxAgeDays)))
        : base.maxAgeDays,
    keepLastFullDatabaseBackups:
      typeof o.keepLastFullDatabaseBackups === 'number' && Number.isFinite(o.keepLastFullDatabaseBackups)
        ? Math.min(500, Math.max(1, Math.floor(o.keepLastFullDatabaseBackups)))
        : base.keepLastFullDatabaseBackups,
    maxAgeDaysFullDatabase:
      typeof o.maxAgeDaysFullDatabase === 'number' && Number.isFinite(o.maxAgeDaysFullDatabase)
        ? Math.min(3650, Math.max(0, Math.floor(o.maxAgeDaysFullDatabase)))
        : base.maxAgeDaysFullDatabase,
    minFreeDiskMb:
      o.minFreeDiskMb === null || o.minFreeDiskMb === undefined
        ? base.minFreeDiskMb
        : typeof o.minFreeDiskMb === 'number' && Number.isFinite(o.minFreeDiskMb)
          ? Math.max(0, Math.floor(o.minFreeDiskMb))
          : base.minFreeDiskMb,
    rcloneBwlimit: typeof o.rcloneBwlimit === 'string' ? o.rcloneBwlimit.trim() : base.rcloneBwlimit,
    onDiskMirrorMode:
      o.onDiskMirrorMode === 'sync' || o.onDiskMirrorMode === 'copy' ? o.onDiskMirrorMode : base.onDiskMirrorMode,
    discordWebhook: typeof o.discordWebhook === 'string' ? o.discordWebhook.trim() : base.discordWebhook,
    discordNotifyLabel:
      typeof o.discordNotifyLabel === 'string'
        ? o.discordNotifyLabel.trim().slice(0, 120)
        : base.discordNotifyLabel,
    mailTo: typeof o.mailTo === 'string' ? o.mailTo.trim() : base.mailTo,
    notifyDatabaseOnSuccess:
      typeof o.notifyDatabaseOnSuccess === 'boolean'
        ? o.notifyDatabaseOnSuccess
        : typeof o.notifyOnSuccess === 'boolean'
          ? o.notifyOnSuccess
          : base.notifyDatabaseOnSuccess,
    notifyDatabaseOnFailure:
      typeof o.notifyDatabaseOnFailure === 'boolean'
        ? o.notifyDatabaseOnFailure
        : typeof o.notifyOnFailure === 'boolean'
          ? o.notifyOnFailure
          : base.notifyDatabaseOnFailure,
    notifyDatabaseFullOnSuccess:
      typeof o.notifyDatabaseFullOnSuccess === 'boolean'
        ? o.notifyDatabaseFullOnSuccess
        : typeof o.notifyOnSuccess === 'boolean'
          ? o.notifyOnSuccess
          : base.notifyDatabaseFullOnSuccess,
    notifyDatabaseFullOnFailure:
      typeof o.notifyDatabaseFullOnFailure === 'boolean'
        ? o.notifyDatabaseFullOnFailure
        : typeof o.notifyOnFailure === 'boolean'
          ? o.notifyOnFailure
          : base.notifyDatabaseFullOnFailure,
    notifyMirrorOnSuccess:
      typeof o.notifyMirrorOnSuccess === 'boolean'
        ? o.notifyMirrorOnSuccess
        : typeof o.notifyOnSuccess === 'boolean'
          ? o.notifyOnSuccess
          : base.notifyMirrorOnSuccess,
    notifyMirrorOnFailure:
      typeof o.notifyMirrorOnFailure === 'boolean'
        ? o.notifyMirrorOnFailure
        : typeof o.notifyOnFailure === 'boolean'
          ? o.notifyOnFailure
          : base.notifyMirrorOnFailure,
    lastDatabaseRunAt: typeof o.lastDatabaseRunAt === 'string' ? o.lastDatabaseRunAt : base.lastDatabaseRunAt,
    lastDatabaseRunOk: typeof o.lastDatabaseRunOk === 'boolean' ? o.lastDatabaseRunOk : base.lastDatabaseRunOk,
    lastDatabaseRunMessage:
      typeof o.lastDatabaseRunMessage === 'string' ? o.lastDatabaseRunMessage : base.lastDatabaseRunMessage,
    lastDatabaseFullRunAt:
      typeof o.lastDatabaseFullRunAt === 'string' ? o.lastDatabaseFullRunAt : base.lastDatabaseFullRunAt,
    lastDatabaseFullRunOk:
      typeof o.lastDatabaseFullRunOk === 'boolean' ? o.lastDatabaseFullRunOk : base.lastDatabaseFullRunOk,
    lastDatabaseFullRunMessage:
      typeof o.lastDatabaseFullRunMessage === 'string' ? o.lastDatabaseFullRunMessage : base.lastDatabaseFullRunMessage,
    lastMirrorRunAt: typeof o.lastMirrorRunAt === 'string' ? o.lastMirrorRunAt : base.lastMirrorRunAt,
    lastMirrorRunOk: typeof o.lastMirrorRunOk === 'boolean' ? o.lastMirrorRunOk : base.lastMirrorRunOk,
    lastMirrorRunMessage:
      typeof o.lastMirrorRunMessage === 'string' ? o.lastMirrorRunMessage : base.lastMirrorRunMessage,
  }
}

export async function getBackupSettings(): Promise<BackupSettings> {
  const row = (await db.prepare('SELECT value FROM app_kv WHERE key = ?').get(BACKUP_SETTINGS_KV_KEY)) as
    | { value: string }
    | undefined
  if (!row?.value?.trim()) return defaultBackupSettings()
  try {
    const parsed = JSON.parse(row.value) as unknown
    return mergeSettings(parsed)
  } catch {
    return defaultBackupSettings()
  }
}

export async function setBackupSettings(settings: BackupSettings): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_kv (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`
    )
    .run(BACKUP_SETTINGS_KV_KEY, JSON.stringify(settings))
}

export type BackupHistoryEntry = {
  id: string
  kind: 'database' | 'database_full' | 'mirror'
  startedAt: string
  finishedAt: string
  durationMs: number
  ok: boolean
  message: string
  bytesTransferred?: number
  /** Short list of what was included (e.g. database, wiki, uploads). */
  scopeSummary?: string
}

export async function getBackupHistory(): Promise<BackupHistoryEntry[]> {
  const row = (await db.prepare('SELECT value FROM app_kv WHERE key = ?').get(BACKUP_HISTORY_KV_KEY)) as
    | { value: string }
    | undefined
  if (!row?.value?.trim()) return []
  try {
    const parsed = JSON.parse(row.value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (x): x is BackupHistoryEntry =>
        typeof x === 'object' &&
        x !== null &&
        typeof (x as BackupHistoryEntry).id === 'string' &&
        ((x as BackupHistoryEntry).kind === 'database' ||
          (x as BackupHistoryEntry).kind === 'database_full' ||
          (x as BackupHistoryEntry).kind === 'mirror')
    ) as BackupHistoryEntry[]
  } catch {
    return []
  }
}

const MAX_HISTORY = 20

export async function appendBackupHistory(entry: Omit<BackupHistoryEntry, 'id'> & { id?: string }): Promise<void> {
  const list = await getBackupHistory()
  const id = entry.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  const full: BackupHistoryEntry = {
    id,
    kind: entry.kind,
    startedAt: entry.startedAt,
    finishedAt: entry.finishedAt,
    durationMs: entry.durationMs,
    ok: entry.ok,
    message: entry.message,
    bytesTransferred: entry.bytesTransferred,
    scopeSummary: entry.scopeSummary,
  }
  const next = [full, ...list].slice(0, MAX_HISTORY)
  await db
    .prepare(
      `INSERT INTO app_kv (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`
    )
    .run(BACKUP_HISTORY_KV_KEY, JSON.stringify(next))
}

export function parseBackupPutBody(body: unknown): { ok: true; patch: z.infer<typeof backupSettingsBodySchema> } | { ok: false; error: string } {
  const parsed = backupSettingsBodySchema.safeParse(body)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors.map((e) => e.message).join('; ') || 'Invalid body' }
  }
  return { ok: true, patch: parsed.data }
}

/** Merge a validated PATCH body into current settings (deep-merge schedule blocks). */
export function mergeBackupPatch(current: BackupSettings, patch: z.infer<typeof backupSettingsBodySchema>): BackupSettings {
  const p = patch
  const raw: Record<string, unknown> = { ...current }
  if (p.dropboxRclonePath !== undefined) raw.dropboxRclonePath = p.dropboxRclonePath
  if (p.uploadToDropbox !== undefined) raw.uploadToDropbox = p.uploadToDropbox
  if (p.databaseSchedule !== undefined) {
    raw.databaseSchedule = { ...current.databaseSchedule, ...p.databaseSchedule }
  }
  if (p.databaseFullSchedule !== undefined) {
    raw.databaseFullSchedule = { ...current.databaseFullSchedule, ...p.databaseFullSchedule }
  }
  if (p.mirrorSchedule !== undefined) {
    raw.mirrorSchedule = { ...current.mirrorSchedule, ...p.mirrorSchedule }
  }
  if (p.includeDatabase !== undefined) raw.includeDatabase = p.includeDatabase
  if (p.includeDatabaseFull !== undefined) raw.includeDatabaseFull = p.includeDatabaseFull
  if (p.includeWiki !== undefined) raw.includeWiki = p.includeWiki
  if (p.includeUploadsFiles !== undefined) raw.includeUploadsFiles = p.includeUploadsFiles
  if (p.includeUploadsTesting !== undefined) raw.includeUploadsTesting = p.includeUploadsTesting
  if (p.includeUploadsHome !== undefined) raw.includeUploadsHome = p.includeUploadsHome
  if (p.includeUploads !== undefined && p.includeUploadsFiles === undefined && p.includeUploadsTesting === undefined && p.includeUploadsHome === undefined) {
    raw.includeUploadsFiles = p.includeUploads
    raw.includeUploadsTesting = p.includeUploads
    raw.includeUploadsHome = p.includeUploads
  }
  if (p.includeWikiSeed !== undefined) raw.includeWikiSeed = p.includeWikiSeed
  if (p.includeHomeIntro !== undefined) raw.includeHomeIntro = p.includeHomeIntro
  if (p.includeConfigJson !== undefined) raw.includeConfigJson = p.includeConfigJson
  if (p.includeBackupConf !== undefined) raw.includeBackupConf = p.includeBackupConf
  if (p.localStagingDir !== undefined) raw.localStagingDir = p.localStagingDir
  if (p.keepLastBackups !== undefined) raw.keepLastBackups = p.keepLastBackups
  if (p.maxAgeDays !== undefined) raw.maxAgeDays = p.maxAgeDays
  if (p.keepLastFullDatabaseBackups !== undefined) raw.keepLastFullDatabaseBackups = p.keepLastFullDatabaseBackups
  if (p.maxAgeDaysFullDatabase !== undefined) raw.maxAgeDaysFullDatabase = p.maxAgeDaysFullDatabase
  if (p.minFreeDiskMb !== undefined) raw.minFreeDiskMb = p.minFreeDiskMb
  if (p.rcloneBwlimit !== undefined) raw.rcloneBwlimit = p.rcloneBwlimit
  if (p.onDiskMirrorMode !== undefined) raw.onDiskMirrorMode = p.onDiskMirrorMode
  if (p.discordWebhook !== undefined) raw.discordWebhook = p.discordWebhook
  if (p.discordNotifyLabel !== undefined) raw.discordNotifyLabel = p.discordNotifyLabel
  if (p.mailTo !== undefined) raw.mailTo = p.mailTo
  if (p.notifyDatabaseOnSuccess !== undefined) raw.notifyDatabaseOnSuccess = p.notifyDatabaseOnSuccess
  if (p.notifyDatabaseOnFailure !== undefined) raw.notifyDatabaseOnFailure = p.notifyDatabaseOnFailure
  if (p.notifyDatabaseFullOnSuccess !== undefined) raw.notifyDatabaseFullOnSuccess = p.notifyDatabaseFullOnSuccess
  if (p.notifyDatabaseFullOnFailure !== undefined) raw.notifyDatabaseFullOnFailure = p.notifyDatabaseFullOnFailure
  if (p.notifyMirrorOnSuccess !== undefined) raw.notifyMirrorOnSuccess = p.notifyMirrorOnSuccess
  if (p.notifyMirrorOnFailure !== undefined) raw.notifyMirrorOnFailure = p.notifyMirrorOnFailure
  if (p.notifyOnSuccess !== undefined) {
    if (p.notifyDatabaseOnSuccess === undefined) raw.notifyDatabaseOnSuccess = p.notifyOnSuccess
    if (p.notifyDatabaseFullOnSuccess === undefined) raw.notifyDatabaseFullOnSuccess = p.notifyOnSuccess
    if (p.notifyMirrorOnSuccess === undefined) raw.notifyMirrorOnSuccess = p.notifyOnSuccess
  }
  if (p.notifyOnFailure !== undefined) {
    if (p.notifyDatabaseOnFailure === undefined) raw.notifyDatabaseOnFailure = p.notifyOnFailure
    if (p.notifyDatabaseFullOnFailure === undefined) raw.notifyDatabaseFullOnFailure = p.notifyOnFailure
    if (p.notifyMirrorOnFailure === undefined) raw.notifyMirrorOnFailure = p.notifyOnFailure
  }
  return mergeSettings(raw)
}

function validateRclonePath(s: string | null): string | null {
  if (s == null || s.trim() === '') return null
  const t = s.trim()
  if (t.length > 2048) return null
  if (!/^[A-Za-z0-9_.-]+:/.test(t)) return null
  return t.replace(/\/+$/, '')
}

export function validateBackupSettingsForSave(s: BackupSettings): { ok: true } | { ok: false; error: string } {
  const p = validateRclonePath(s.dropboxRclonePath)
  if (s.uploadToDropbox && !p) {
    return { ok: false, error: 'Dropbox path must look like remote:folder (e.g. dropbox:Backups/dc-automation)' }
  }
  if (!path.isAbsolute(s.localStagingDir)) {
    return { ok: false, error: 'Local staging directory must be an absolute path' }
  }
  if (s.localStagingDir.includes('\0')) {
    return { ok: false, error: 'Invalid staging path' }
  }
  const resolvedStaging = path.resolve(s.localStagingDir)
  try {
    if (fs.existsSync(resolvedStaging)) {
      fs.realpathSync(resolvedStaging)
    }
  } catch {
    return { ok: false, error: 'Local staging directory could not be resolved; check permissions and path' }
  }
  return { ok: true }
}
