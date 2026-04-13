import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { api, isAbortLikeError } from '../api/client'
import { useAlertConfirm } from '../contexts/AlertConfirmContext'
import { PopupSelect } from '../components/ui/PopupSelect'

type BackupFrequency = 'hourly' | 'everyNHours' | 'daily' | 'weekly'

type BackupScheduleBlock = {
  enabled: boolean
  frequency: BackupFrequency
  everyNHours: number
  timeLocal: string
  weekday: number
  minuteOffset: number
}

type BackupSettings = {
  dropboxRclonePath: string | null
  uploadToDropbox: boolean
  databaseSchedule: BackupScheduleBlock
  databaseFullSchedule: BackupScheduleBlock
  mirrorSchedule: BackupScheduleBlock
  includeDatabase: boolean
  includeDatabaseFull: boolean
  includeWiki: boolean
  includeUploadsFiles: boolean
  includeUploadsTesting: boolean
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
  onDiskMirrorMode: 'sync' | 'copy'
  discordWebhook: string
  /** Shown in Discord so multiple apps can share one webhook. */
  discordNotifyLabel: string
  mailTo: string
  notifyOnFailure: boolean
  notifyOnSuccess: boolean
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

type BackupHistoryEntry = {
  id: string
  kind: 'database' | 'database_full' | 'mirror'
  startedAt: string
  finishedAt: string
  durationMs: number
  ok: boolean
  message: string
  bytesTransferred?: number
  scopeSummary?: string
}

type BackupGetResponse = {
  settings: BackupSettings
  history: BackupHistoryEntry[]
  databaseKind: 'postgres' | 'sqlite'
  nextDatabaseRunAt: string | null
  nextDatabaseFullRunAt: string | null
  nextMirrorRunAt: string | null
}

function SettingsCollapsible({
  title,
  subtitle,
  kicker,
  defaultOpen = true,
  variant = 'none',
  children,
}: {
  title: string
  subtitle?: string
  /** Small label above the title (e.g. Shared, Job 1). */
  kicker?: string
  defaultOpen?: boolean
  /** Left accent for database vs files vs shared sections on Backup page. */
  variant?: 'none' | 'shared' | 'database' | 'files'
  children: ReactNode
}) {
  const accent =
    variant === 'database'
      ? 'border-l-4 border-l-sky-500'
      : variant === 'files'
        ? 'border-l-4 border-l-emerald-600'
        : variant === 'shared'
          ? 'border-l-4 border-l-foreground/25'
          : ''
  return (
    <details
      className={`group mb-4 rounded-lg border border-border bg-card/50 [&_summary::-webkit-details-marker]:hidden ${accent}`}
      defaultOpen={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-5 py-4 hover:bg-background/40">
        <div className="min-w-0 flex-1">
          {kicker ? (
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground/50">{kicker}</p>
          ) : null}
          <h2 className={`text-lg font-medium text-foreground ${kicker ? 'mt-1' : ''}`}>{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-foreground/75">{subtitle}</p> : null}
        </div>
        <span
          className="mt-1 shrink-0 text-sm text-foreground/40 transition-transform duration-200 group-open:rotate-180"
          aria-hidden
        >
          ▼
        </span>
      </summary>
      <div className="border-t border-border px-5 pb-5 pt-4">
        <div className="space-y-5">{children}</div>
      </div>
    </details>
  )
}

const FREQ_OPTIONS: { value: BackupFrequency; label: string }[] = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'everyNHours', label: 'Every N hours' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
]

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const SAVE_NOTICE_MS = 2800

function scheduleBlockFields(
  idPrefix: string,
  block: BackupScheduleBlock,
  onChange: (b: BackupScheduleBlock) => void
) {
  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={block.enabled}
          onChange={(e) => onChange({ ...block, enabled: e.target.checked })}
          className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
        />
        <span className="text-sm font-medium text-foreground">Schedule enabled</span>
      </label>
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground" htmlFor={`${idPrefix}-freq`}>
            Frequency
          </label>
          <PopupSelect
            id={`${idPrefix}-freq`}
            label=""
            value={block.frequency}
            onChange={(v) => (v ? onChange({ ...block, frequency: v as BackupFrequency }) : null)}
            options={FREQ_OPTIONS}
            className="min-w-[180px]"
          />
        </div>
        {block.frequency === 'everyNHours' ? (
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground" htmlFor={`${idPrefix}-n`}>
              Every N hours
            </label>
            <input
              id={`${idPrefix}-n`}
              type="number"
              min={1}
              max={168}
              value={block.everyNHours}
              onChange={(e) =>
                onChange({ ...block, everyNHours: Math.min(168, Math.max(1, parseInt(e.target.value, 10) || 1)) })
              }
              className="w-24 rounded-lg border border-border bg-background px-3 py-2 text-foreground"
            />
          </div>
        ) : null}
        {(block.frequency === 'daily' || block.frequency === 'weekly') && (
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground" htmlFor={`${idPrefix}-time`}>
              Local time
            </label>
            <input
              id={`${idPrefix}-time`}
              type="text"
              placeholder="02:00"
              value={block.timeLocal}
              onChange={(e) => onChange({ ...block, timeLocal: e.target.value })}
              className="w-28 rounded-lg border border-border bg-background px-3 py-2 text-foreground"
            />
          </div>
        )}
        {block.frequency === 'weekly' && (
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground" htmlFor={`${idPrefix}-dow`}>
              Weekday
            </label>
            <PopupSelect
              id={`${idPrefix}-dow`}
              label=""
              value={String(block.weekday)}
              onChange={(v) => (v !== '' ? onChange({ ...block, weekday: parseInt(v, 10) }) : null)}
              options={WEEKDAYS.map((label, i) => ({ value: String(i), label }))}
              className="min-w-[160px]"
            />
          </div>
        )}
        {(block.frequency === 'hourly' || block.frequency === 'everyNHours') && (
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground" htmlFor={`${idPrefix}-mo`}>
              Minute offset
            </label>
            <input
              id={`${idPrefix}-mo`}
              type="number"
              min={0}
              max={59}
              value={block.minuteOffset}
              onChange={(e) =>
                onChange({
                  ...block,
                  minuteOffset: Math.min(59, Math.max(0, parseInt(e.target.value, 10) || 0)),
                })
              }
              className="w-20 rounded-lg border border-border bg-background px-3 py-2 text-foreground"
            />
          </div>
        )}
      </div>
    </div>
  )
}

export function BackupPage() {
  const { showAlert } = useAlertConfirm()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveNotice, setSaveNotice] = useState(false)
  const [databaseKind, setDatabaseKind] = useState<'postgres' | 'sqlite'>('sqlite')
  const [nextDatabaseRunAt, setNextDatabaseRunAt] = useState<string | null>(null)
  const [nextDatabaseFullRunAt, setNextDatabaseFullRunAt] = useState<string | null>(null)
  const [nextMirrorRunAt, setNextMirrorRunAt] = useState<string | null>(null)
  const [history, setHistory] = useState<BackupHistoryEntry[]>([])
  const [form, setForm] = useState<BackupSettings | null>(null)
  const [runBusy, setRunBusy] = useState<'idle' | 'database' | 'database_full' | 'mirror' | 'both'>('idle')
  const [runExpect, setRunExpect] = useState<'database' | 'database_full' | 'mirror' | 'both' | null>(null)
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const [statusPoll, setStatusPoll] = useState(0)
  const [discordTestLoading, setDiscordTestLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setLoadError('')
    void api
      .get<BackupGetResponse>('/backup')
      .then((r) => {
        setForm(r.data.settings)
        setHistory(r.data.history)
        setDatabaseKind(r.data.databaseKind)
        setNextDatabaseRunAt(r.data.nextDatabaseRunAt)
        setNextDatabaseFullRunAt(r.data.nextDatabaseFullRunAt)
        setNextMirrorRunAt(r.data.nextMirrorRunAt)
      })
      .catch((e) => {
        if (isAbortLikeError(e)) return
        setLoadError(e?.response?.data?.error ?? 'Could not load backup settings')
        setForm(null)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!saveNotice) return
    const t = window.setTimeout(() => setSaveNotice(false), SAVE_NOTICE_MS)
    return () => window.clearTimeout(t)
  }, [saveNotice])

  useEffect(() => {
    if (statusPoll <= 0 || !runExpect || runStartedAt == null) return
    const t = window.setInterval(() => {
      void api
        .get<BackupGetResponse>('/backup')
        .then((r) => {
          const h = r.data.history
          const since = runStartedAt - 2000
          const recent = h.filter((x) => new Date(x.startedAt).getTime() >= since)
          const hasDb = recent.some((x) => x.kind === 'database')
          const hasDbFull = recent.some((x) => x.kind === 'database_full')
          const hasMir = recent.some((x) => x.kind === 'mirror')
          let done = false
          if (runExpect === 'database') done = hasDb
          else if (runExpect === 'database_full') done = hasDbFull
          else if (runExpect === 'mirror') done = hasMir
          else if (runExpect === 'both') done = hasDb && hasMir
          if (done) {
            setForm(r.data.settings)
            setHistory(r.data.history)
            setDatabaseKind(r.data.databaseKind)
            setNextDatabaseRunAt(r.data.nextDatabaseRunAt)
            setNextDatabaseFullRunAt(r.data.nextDatabaseFullRunAt)
            setNextMirrorRunAt(r.data.nextMirrorRunAt)
            setRunBusy('idle')
            setRunExpect(null)
            setRunStartedAt(null)
            setStatusPoll(0)
          }
        })
        .catch(() => {
          /* */
        })
    }, 1400)
    return () => window.clearInterval(t)
  }, [statusPoll, runExpect, runStartedAt])

  /** Persists current form to the server (backup jobs always read from server KV). */
  const persistSettings = async (opts?: { showSavedNotice?: boolean }): Promise<boolean> => {
    if (!form) return false
    setSaving(true)
    try {
      const { data } = await api.put<BackupGetResponse>('/backup', {
        dropboxRclonePath: form.dropboxRclonePath,
        uploadToDropbox: form.uploadToDropbox,
        databaseSchedule: form.databaseSchedule,
        databaseFullSchedule: form.databaseFullSchedule,
        mirrorSchedule: form.mirrorSchedule,
        includeDatabase: form.includeDatabase,
        includeDatabaseFull: form.includeDatabaseFull,
        includeWiki: form.includeWiki,
        includeUploadsFiles: form.includeUploadsFiles,
        includeUploadsTesting: form.includeUploadsTesting,
        includeUploadsHome: form.includeUploadsHome,
        includeWikiSeed: form.includeWikiSeed,
        includeHomeIntro: form.includeHomeIntro,
        includeConfigJson: form.includeConfigJson,
        includeBackupConf: form.includeBackupConf,
        localStagingDir: form.localStagingDir,
        keepLastBackups: form.keepLastBackups,
        maxAgeDays: form.maxAgeDays,
        keepLastFullDatabaseBackups: form.keepLastFullDatabaseBackups,
        maxAgeDaysFullDatabase: form.maxAgeDaysFullDatabase,
        minFreeDiskMb: form.minFreeDiskMb,
        rcloneBwlimit: form.rcloneBwlimit,
        onDiskMirrorMode: form.onDiskMirrorMode,
        discordWebhook: form.discordWebhook,
        discordNotifyLabel: form.discordNotifyLabel,
        mailTo: form.mailTo,
        notifyOnFailure: form.notifyOnFailure,
        notifyOnSuccess: form.notifyOnSuccess,
      })
      setForm(data.settings)
      setHistory(data.history)
      setDatabaseKind(data.databaseKind)
      setNextDatabaseRunAt(data.nextDatabaseRunAt)
      setNextDatabaseFullRunAt(data.nextDatabaseFullRunAt)
      setNextMirrorRunAt(data.nextMirrorRunAt)
      if (opts?.showSavedNotice !== false) setSaveNotice(true)
      return true
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to save'
      showAlert(msg)
      return false
    } finally {
      setSaving(false)
    }
  }

  const save = async () => {
    await persistSettings({ showSavedNotice: true })
  }

  const runTarget = async (target: 'database' | 'database_full' | 'mirror' | 'both') => {
    const persisted = await persistSettings({ showSavedNotice: false })
    if (!persisted) return
    try {
      const started = Date.now()
      setRunStartedAt(started)
      setRunExpect(target)
      await api.post('/backup/run', { target })
      setRunBusy(target)
      setStatusPoll((n) => n + 1)
    } catch (e: unknown) {
      setRunStartedAt(null)
      setRunExpect(null)
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Run failed'
      showAlert(msg)
    }
  }

  const testDiscord = async () => {
    if (!form) return
    setDiscordTestLoading(true)
    try {
      await api.post('/backup/test-discord', {
        discordWebhook: form.discordWebhook,
        discordNotifyLabel: form.discordNotifyLabel,
      })
      showAlert('Test message sent. Check the Discord channel for this webhook.')
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Could not send test message'
      showAlert(msg)
    } finally {
      setDiscordTestLoading(false)
    }
  }

  const downloadLatest = async (variant: 'standard' | 'full' = 'standard') => {
    try {
      const res = await api.get<Blob>('/backup/download/latest', {
        responseType: 'blob',
        params: variant === 'full' ? { variant: 'full' } : {},
      })
      const blob = res.data
      if (blob.type === 'application/json' || blob.size < 500) {
        const txt = await blob.text()
        try {
          const j = JSON.parse(txt) as { error?: string }
          if (j.error) {
            showAlert(j.error)
            return
          }
        } catch {
          /* fall through */
        }
      }
      const cd = res.headers['content-disposition'] as string | undefined
      let name = variant === 'full' ? 'db-full-snapshot.zip' : 'db-snapshot.zip'
      const m = cd && /filename="([^"]+)"/.exec(cd)
      if (m?.[1]) name = m[1]
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: unknown) {
      const ax = e as { response?: { data?: Blob } }
      const b = ax.response?.data
      if (b instanceof Blob) {
        try {
          const j = JSON.parse(await b.text()) as { error?: string }
          showAlert(j.error ?? 'Download failed')
          return
        } catch {
          /* */
        }
      }
      showAlert('Download failed')
    }
  }

  if (loading && !form) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-foreground">Backup</h1>
        <p className="text-sm text-foreground/60">Loading…</p>
      </div>
    )
  }

  if (loadError || !form) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-foreground">Backup</h1>
        <p className="text-sm text-red-600 dark:text-red-400">{loadError || 'No data'}</p>
      </div>
    )
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold text-foreground">Backup</h1>
      <p className="mb-6 max-w-3xl text-sm leading-relaxed text-foreground/75">
        Backups include <strong className="font-medium text-foreground">database snapshots</strong>, an optional{' '}
        <strong className="font-medium text-foreground">full database archive</strong> (separate schedule/retention), and a{' '}
        <strong className="font-medium text-emerald-700 dark:text-emerald-400">files</strong> mirror (wiki, uploads, optional
        paths). Configure each below. Requires <code className="text-xs">rclone</code> on the server for Dropbox. Never backs
        up <code className="text-xs">.env</code>.
      </p>

      <div className="mb-8 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4 text-sm dark:bg-sky-950/20">
          <h3 className="text-sm font-semibold text-sky-800 dark:text-sky-300">Database snapshots</h3>
          <p className="mt-0.5 text-xs text-foreground/65">Engine: {databaseKind === 'postgres' ? 'PostgreSQL' : 'SQLite'}</p>
          <p className="mt-2 text-foreground/85">
            <span className="font-medium text-foreground">Next run:</span>{' '}
            {nextDatabaseRunAt ? new Date(nextDatabaseRunAt).toLocaleString() : '—'}
          </p>
          {form.lastDatabaseRunAt ? (
            <p className="mt-1 text-foreground/80">
              <span className="font-medium text-foreground">Last:</span> {new Date(form.lastDatabaseRunAt).toLocaleString()}{' '}
              {form.lastDatabaseRunOk === true ? '· OK' : form.lastDatabaseRunOk === false ? '· failed' : ''}
              {form.lastDatabaseRunMessage ? (
                <span className="text-foreground/65"> ({form.lastDatabaseRunMessage})</span>
              ) : null}
            </p>
          ) : (
            <p className="mt-1 text-foreground/55">No database run yet.</p>
          )}
        </div>
        <div className="rounded-xl border border-sky-400/25 bg-sky-500/[0.03] p-4 text-sm dark:bg-sky-950/10">
          <h3 className="text-sm font-semibold text-sky-900 dark:text-sky-200">Full database archive</h3>
          <p className="mt-0.5 text-xs text-foreground/65">Separate schedule &amp; retention · db-full-snapshots/</p>
          <p className="mt-2 text-foreground/85">
            <span className="font-medium text-foreground">Next run:</span>{' '}
            {nextDatabaseFullRunAt ? new Date(nextDatabaseFullRunAt).toLocaleString() : '—'}
          </p>
          {form.lastDatabaseFullRunAt ? (
            <p className="mt-1 text-foreground/80">
              <span className="font-medium text-foreground">Last:</span>{' '}
              {new Date(form.lastDatabaseFullRunAt).toLocaleString()}{' '}
              {form.lastDatabaseFullRunOk === true ? '· OK' : form.lastDatabaseFullRunOk === false ? '· failed' : ''}
              {form.lastDatabaseFullRunMessage ? (
                <span className="text-foreground/65"> ({form.lastDatabaseFullRunMessage})</span>
              ) : null}
            </p>
          ) : (
            <p className="mt-1 text-foreground/55">No full archive run yet.</p>
          )}
        </div>
        <div className="rounded-xl border border-emerald-600/30 bg-emerald-500/5 p-4 text-sm dark:bg-emerald-950/20">
          <h3 className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">Files &amp; wiki mirror</h3>
          <p className="mt-0.5 text-xs text-foreground/65">Incremental sync to Dropbox under mirror/</p>
          <p className="mt-2 text-foreground/85">
            <span className="font-medium text-foreground">Next run:</span>{' '}
            {nextMirrorRunAt ? new Date(nextMirrorRunAt).toLocaleString() : '—'}
          </p>
          {form.lastMirrorRunAt ? (
            <p className="mt-1 text-foreground/80">
              <span className="font-medium text-foreground">Last:</span> {new Date(form.lastMirrorRunAt).toLocaleString()}{' '}
              {form.lastMirrorRunOk === true ? '· OK' : form.lastMirrorRunOk === false ? '· failed' : ''}
              {form.lastMirrorRunMessage ? (
                <span className="text-foreground/65"> ({form.lastMirrorRunMessage})</span>
              ) : null}
            </p>
          ) : (
            <p className="mt-1 text-foreground/55">No mirror run yet.</p>
          )}
        </div>
      </div>

      <SettingsCollapsible
        kicker="Shared"
        title="Dropbox &amp; this server"
        subtitle="One remote path: db-snapshots/ (frequent), db-full-snapshots/ (optional second DB job), mirror/ for files. Staging holds local copies and lock files."
        variant="shared"
        defaultOpen
      >
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={form.uploadToDropbox}
            onChange={(e) => setForm((f) => (f ? { ...f, uploadToDropbox: e.target.checked } : f))}
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
          />
          <span className="text-sm font-medium text-foreground">
            Upload to Dropbox (database snapshots, full database archives, files mirror)
          </span>
        </label>
        <div className="max-w-xl">
          <label className="mb-1 block text-sm font-medium text-foreground" htmlFor="dropbox-path">
            rclone remote path
          </label>
          <input
            id="dropbox-path"
            type="text"
            value={form.dropboxRclonePath ?? ''}
            onChange={(e) => setForm((f) => (f ? { ...f, dropboxRclonePath: e.target.value || null } : f))}
            placeholder="dropbox:Backups/dc-automation"
            disabled={!form.uploadToDropbox}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground disabled:opacity-50"
          />
          <p className="mt-1 text-xs text-foreground/60">Configure remotes with rclone on the host. No trailing slash.</p>
        </div>
        <div className="max-w-md">
          <label className="mb-1 block text-sm font-medium text-foreground" htmlFor="bwlimit">
            rclone bandwidth limit (both jobs)
          </label>
          <input
            id="bwlimit"
            type="text"
            value={form.rcloneBwlimit}
            onChange={(e) => setForm((f) => (f ? { ...f, rcloneBwlimit: e.target.value } : f))}
            placeholder="e.g. 1M or empty for unlimited"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </div>
        <div className="max-w-xl border-t border-border pt-5">
          <label className="mb-1 block text-sm font-medium text-foreground" htmlFor="staging">
            Local staging directory (absolute)
          </label>
          <input
            id="staging"
            type="text"
            value={form.localStagingDir}
            onChange={(e) => setForm((f) => (f ? { ...f, localStagingDir: e.target.value } : f))}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
          />
          <p className="mt-1 text-xs text-foreground/60">Used for DB snapshots, locks, and temporary files during uploads.</p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground" htmlFor="minfree">
            Minimum free disk space (MiB, 0 = skip check)
          </label>
          <input
            id="minfree"
            type="number"
            min={0}
            value={form.minFreeDiskMb ?? 0}
            onChange={(e) =>
              setForm((f) =>
                f
                  ? {
                      ...f,
                      minFreeDiskMb: Math.max(0, parseInt(e.target.value, 10) || 0),
                    }
                  : f
              )
            }
            className="w-36 rounded-lg border border-border bg-background px-3 py-2 text-foreground"
          />
        </div>
      </SettingsCollapsible>

      <SettingsCollapsible
        kicker="Job 1"
        title="Database"
        subtitle="PostgreSQL (pg_dump) or SQLite online copy into db-snapshots/&lt;stamp&gt;/. If nothing changed in the database since the last successful dump, the run is skipped (no new folder; same for the full archive job). Delete staging/db-backup-last-fingerprint.json to force the next run. Prune settings below apply only to this tree. A separate full archive job (db-full-snapshots/) is below."
        variant="database"
        defaultOpen
      >
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={form.includeDatabase}
            onChange={(e) => setForm((f) => (f ? { ...f, includeDatabase: e.target.checked } : f))}
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
          />
          <span className="text-sm font-medium text-foreground">Include database in scheduled and manual backups</span>
        </label>
        <div>
          <p className="mb-2 text-sm font-medium text-foreground">When to run (database only)</p>
          {scheduleBlockFields('db', form.databaseSchedule, (databaseSchedule) => setForm((f) => (f ? { ...f, databaseSchedule } : f)))}
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-foreground">Keep database snapshots on disk and Dropbox</p>
          <p className="mb-3 text-xs text-foreground/60">Applies only to db-snapshots/, not mirror/.</p>
          <div className="flex flex-wrap gap-6">
            <div>
              <label className="mb-1 block text-sm text-foreground" htmlFor="keep">
                Keep last N
              </label>
              <input
                id="keep"
                type="number"
                min={1}
                max={500}
                value={form.keepLastBackups}
                onChange={(e) =>
                  setForm((f) =>
                    f
                      ? {
                          ...f,
                          keepLastBackups: Math.min(500, Math.max(1, parseInt(e.target.value, 10) || 1)),
                        }
                      : f
                  )
                }
                className="w-28 rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-foreground" htmlFor="maxage">
                Max age (days, 0 = off)
              </label>
              <input
                id="maxage"
                type="number"
                min={0}
                max={3650}
                value={form.maxAgeDays}
                onChange={(e) =>
                  setForm((f) =>
                    f
                      ? {
                          ...f,
                          maxAgeDays: Math.min(3650, Math.max(0, parseInt(e.target.value, 10) || 0)),
                        }
                      : f
                  )
                }
                className="w-28 rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <button
            type="button"
            disabled={runBusy !== 'idle' || saving}
            onClick={() => void runTarget('database')}
            className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm font-medium text-sky-900 hover:bg-sky-500/20 disabled:opacity-50 dark:text-sky-100"
          >
            Run database backup now
          </button>
          <button
            type="button"
            onClick={() => void downloadLatest('standard')}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-background/80"
          >
            Download latest DB snapshot (zip)
          </button>
        </div>

        <div className="border-t border-border pt-6">
          <p className="mb-2 text-sm font-medium text-foreground">Full database archive</p>
          <p className="mb-3 text-xs text-foreground/60">
            Optional second job: same logical dump as above, written under <code className="text-xs">db-full-snapshots/</code> on
            the remote with its own schedule and retention (for example weekly copies you keep longer than frequent snapshots).
          </p>
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={form.includeDatabaseFull}
              onChange={(e) => setForm((f) => (f ? { ...f, includeDatabaseFull: e.target.checked } : f))}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
            />
            <span className="text-sm font-medium text-foreground">Enable full database archive job</span>
          </label>
          <p className="mt-2 text-xs text-foreground/55">
            <strong className="font-medium text-foreground/70">How it works:</strong> same SQLite / pg_dump output as snapshots, but
            stored under <code className="text-xs">…/db-full-snapshots/&lt;stamp&gt;/</code> (local staging + Dropbox if upload is
            on). Turn on <strong className="font-medium">Schedule enabled</strong> below for automatic runs; otherwise use
            &quot;Run full database backup now&quot; (saves settings first). If this master switch is off, the job is skipped and
            run history will show that message.
          </p>
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium text-foreground">When to run (full archive only)</p>
            {scheduleBlockFields('dbf', form.databaseFullSchedule, (databaseFullSchedule) =>
              setForm((f) => (f ? { ...f, databaseFullSchedule } : f))
            )}
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-foreground">Keep full archives on disk and Dropbox</p>
            <p className="mb-3 text-xs text-foreground/60">Applies only to db-full-snapshots/, not db-snapshots/.</p>
            <div className="flex flex-wrap gap-6">
              <div>
                <label className="mb-1 block text-sm text-foreground" htmlFor="keep-full">
                  Keep last N
                </label>
                <input
                  id="keep-full"
                  type="number"
                  min={1}
                  max={500}
                  value={form.keepLastFullDatabaseBackups}
                  onChange={(e) =>
                    setForm((f) =>
                      f
                        ? {
                            ...f,
                            keepLastFullDatabaseBackups: Math.min(
                              500,
                              Math.max(1, parseInt(e.target.value, 10) || 1)
                            ),
                          }
                        : f
                    )
                  }
                  className="w-28 rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-foreground" htmlFor="maxage-full">
                  Max age (days, 0 = off)
                </label>
                <input
                  id="maxage-full"
                  type="number"
                  min={0}
                  max={3650}
                  value={form.maxAgeDaysFullDatabase}
                  onChange={(e) =>
                    setForm((f) =>
                      f
                        ? {
                            ...f,
                            maxAgeDaysFullDatabase: Math.min(
                              3650,
                              Math.max(0, parseInt(e.target.value, 10) || 0)
                            ),
                          }
                        : f
                    )
                  }
                  className="w-28 rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                />
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={runBusy !== 'idle' || saving}
              onClick={() => void runTarget('database_full')}
              className="rounded-lg border border-sky-600/35 bg-sky-500/15 px-3 py-2 text-sm font-medium text-sky-950 hover:bg-sky-500/25 disabled:opacity-50 dark:text-sky-50"
            >
              Run full database backup now
            </button>
            <button
              type="button"
              onClick={() => void downloadLatest('full')}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-background/80"
            >
              Download latest full archive (zip)
            </button>
          </div>
        </div>
      </SettingsCollapsible>

      <SettingsCollapsible
        kicker="Job 2"
        title="Files &amp; wiki mirror"
        subtitle="Rclone sync or copy from this server to mirror/… on the remote. Only changed files transfer. Does not create per-run history on Dropbox—use database snapshots for point-in-time relational data."
        variant="files"
        defaultOpen
      >
        <div className="space-y-6">
          <div>
            <p className="mb-2 text-sm font-medium text-foreground">Wiki</p>
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={form.includeWiki}
                onChange={(e) => setForm((f) => (f ? { ...f, includeWiki: e.target.checked } : f))}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              />
              <span className="text-sm text-foreground">
                <code className="text-xs">content/wiki/</code> — pages, metadata, recycle
              </span>
            </label>
          </div>

          <div>
            <p className="mb-1 text-sm font-medium text-foreground">Uploads</p>
            <p className="mb-3 text-xs text-foreground/65">
              Choose which folders under <code className="text-xs">uploads/</code> to mirror. Other subfolders or loose files in{' '}
              <code className="text-xs">uploads/</code> are not included unless you mirror the standard folders that contain them.
            </p>
            <div className="space-y-2.5 rounded-lg border border-border/80 bg-background/50 p-3">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={form.includeUploadsFiles}
                  onChange={(e) => setForm((f) => (f ? { ...f, includeUploadsFiles: e.target.checked } : f))}
                  className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
                <span className="text-sm text-foreground">
                  <code className="text-xs">uploads/files/</code> — Files module library
                </span>
              </label>
              <p className="mb-1 ml-7 text-xs text-foreground/55">
                Also mirrors <code className="text-xs">mirror/uploads/files-original/</code> on the remote: same files with
                library folder paths and original filenames (the UUID-on-disk tree remains under{' '}
                <code className="text-xs">mirror/uploads/files/</code> for restore).
              </p>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={form.includeUploadsTesting}
                  onChange={(e) => setForm((f) => (f ? { ...f, includeUploadsTesting: e.target.checked } : f))}
                  className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
                <span className="text-sm text-foreground">
                  <code className="text-xs">uploads/testing/</code> — Test plan images &amp; attachments
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={form.includeUploadsHome}
                  onChange={(e) => setForm((f) => (f ? { ...f, includeUploadsHome: e.target.checked } : f))}
                  className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
                <span className="text-sm text-foreground">
                  <code className="text-xs">uploads/home/</code> — Home hub assets, favicon, etc.
                </span>
              </label>
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-foreground">Other paths</p>
            <p className="mb-2 text-xs text-foreground/60">Optional; only mirrored if the path exists on disk.</p>
            <div className="space-y-3">
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={form.includeWikiSeed}
                onChange={(e) => setForm((f) => (f ? { ...f, includeWikiSeed: e.target.checked } : f))}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              />
              <span className="text-sm text-foreground">content/wiki-seed/</span>
            </label>
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={form.includeHomeIntro}
                onChange={(e) => setForm((f) => (f ? { ...f, includeHomeIntro: e.target.checked } : f))}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              />
              <span className="text-sm text-foreground">content/home-intro.md</span>
            </label>
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={form.includeConfigJson}
                onChange={(e) => setForm((f) => (f ? { ...f, includeConfigJson: e.target.checked } : f))}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              />
              <span className="text-sm text-foreground">config.json (may contain secrets)</span>
            </label>
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={form.includeBackupConf}
                onChange={(e) => setForm((f) => (f ? { ...f, includeBackupConf: e.target.checked } : f))}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              />
              <span className="text-sm text-foreground">scripts/backup.conf</span>
            </label>
            </div>
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-foreground">Mirror behavior</p>
          <div className="flex flex-wrap gap-6">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="mirror-mode"
                checked={form.onDiskMirrorMode === 'sync'}
                onChange={() => setForm((f) => (f ? { ...f, onDiskMirrorMode: 'sync' } : f))}
                className="h-4 w-4 border-border text-primary focus:ring-primary"
              />
              <span className="text-sm text-foreground">sync — remote matches this server (deletes propagate)</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="mirror-mode"
                checked={form.onDiskMirrorMode === 'copy'}
                onChange={() => setForm((f) => (f ? { ...f, onDiskMirrorMode: 'copy' } : f))}
                className="h-4 w-4 border-border text-primary focus:ring-primary"
              />
              <span className="text-sm text-foreground">copy — additive only (remote may keep extra files)</span>
            </label>
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-foreground">When to run (files mirror only)</p>
          {scheduleBlockFields('mir', form.mirrorSchedule, (mirrorSchedule) => setForm((f) => (f ? { ...f, mirrorSchedule } : f)))}
        </div>
        <div className="border-t border-border pt-4">
          <button
            type="button"
            disabled={runBusy !== 'idle' || saving}
            onClick={() => void runTarget('mirror')}
            className="rounded-lg border border-emerald-600/40 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-100"
          >
            Run files mirror now
          </button>
        </div>
      </SettingsCollapsible>

      <SettingsCollapsible
        title="Notifications"
        subtitle="Discord webhook, optional label for this server, and optional mail apply to database, full database, and mirror runs."
        defaultOpen={false}
      >
        <div className="max-w-xl space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground" htmlFor="discord-webhook">
              Discord webhook URL
            </label>
            <input
              id="discord-webhook"
              type="url"
              placeholder="https://discord.com/api/webhooks/…"
              value={form.discordWebhook}
              onChange={(e) => setForm((f) => (f ? { ...f, discordWebhook: e.target.value } : f))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={discordTestLoading || !form.discordWebhook?.trim()}
                onClick={() => void testDiscord()}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-background/80 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {discordTestLoading ? 'Sending…' : 'Send test message'}
              </button>
              <span className="text-xs text-foreground/60">
                Uses the URL and label in the fields (save settings separately to persist them).
              </span>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground" htmlFor="discord-notify-label">
              Discord notification label (optional)
            </label>
            <input
              id="discord-notify-label"
              type="text"
              placeholder="e.g. prod, Salem, dc-auto-110"
              maxLength={120}
              value={form.discordNotifyLabel}
              onChange={(e) => setForm((f) => (f ? { ...f, discordNotifyLabel: e.target.value } : f))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
            <p className="mt-1 text-xs text-foreground/60">
              Shown as the webhook display name and in message titles so you can tell this server apart when several apps use the same channel.
            </p>
          </div>
          <input
            type="email"
            placeholder="Email address (mail command)"
            value={form.mailTo}
            onChange={(e) => setForm((f) => (f ? { ...f, mailTo: e.target.value } : f))}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={form.notifyOnFailure}
              onChange={(e) => setForm((f) => (f ? { ...f, notifyOnFailure: e.target.checked } : f))}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
            />
            <span className="text-sm text-foreground">Notify on failure</span>
          </label>
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={form.notifyOnSuccess}
              onChange={(e) => setForm((f) => (f ? { ...f, notifyOnSuccess: e.target.checked } : f))}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
            />
            <span className="text-sm text-foreground">Notify on success</span>
          </label>
        </div>
      </SettingsCollapsible>

      <SettingsCollapsible
        title="Run history"
        subtitle="Last 20 runs (database snapshots, full database, mirror)."
        defaultOpen={false}
      >
        {history.length === 0 ? (
          <p className="text-sm text-foreground/60">No runs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-foreground/70">
                  <th className="py-2 pr-4 font-medium">Kind</th>
                  <th className="py-2 pr-4 font-medium">Scope</th>
                  <th className="py-2 pr-4 font-medium">Finished</th>
                  <th className="py-2 pr-4 font-medium">Duration</th>
                  <th className="py-2 pr-4 font-medium">Result</th>
                  <th className="py-2 font-medium">Message</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b border-border/60">
                    <td className="py-2 pr-4 font-mono text-xs">
                      {h.kind === 'database_full' ? 'database_full' : h.kind}
                    </td>
                    <td className="max-w-[180px] truncate py-2 pr-4 text-xs text-foreground/75" title={h.scopeSummary}>
                      {h.scopeSummary ?? '—'}
                    </td>
                    <td className="py-2 pr-4 text-foreground/85">{new Date(h.finishedAt).toLocaleString()}</td>
                    <td className="py-2 pr-4">{h.durationMs >= 1000 ? `${(h.durationMs / 1000).toFixed(1)}s` : `${h.durationMs}ms`}</td>
                    <td className="py-2 pr-4">{h.ok ? 'OK' : 'Failed'}</td>
                    <td className="max-w-md truncate py-2 text-foreground/80" title={h.message}>
                      {h.message}
                      {h.bytesTransferred != null ? ` · ${h.bytesTransferred} B (reported)` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsCollapsible>

      <div className="mb-8 rounded-lg border border-border bg-card/30 px-4 py-4">
        <p className="mb-3 text-sm font-medium text-foreground">Save &amp; run everything</p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save settings'}
          </button>
          {saveNotice ? (
            <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400" role="status">
              Saved
            </span>
          ) : null}
          <button
            type="button"
            disabled={runBusy !== 'idle' || saving}
            onClick={() => void runTarget('both')}
            className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-background/80 disabled:opacity-50"
          >
            Run database + files now
          </button>
          <button
            type="button"
            onClick={() => load()}
            className="rounded-lg px-3 py-2 text-sm text-foreground/80 underline hover:text-foreground"
          >
            Refresh status
          </button>
        </div>
        <p className="mt-2 text-xs text-foreground/55">
          Run buttons save your settings first, then start the job (the server only sees saved configuration).
        </p>
      </div>
      {runBusy !== 'idle' ? (
        <p className="text-sm text-foreground/70" role="status">
          Running{' '}
          {runBusy === 'both'
            ? 'database and files'
            : runBusy === 'database_full'
              ? 'full database'
              : runBusy}{' '}
          backup…
        </p>
      ) : null}
    </div>
  )
}
