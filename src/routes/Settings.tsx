import { type ReactNode, useEffect, useState } from 'react'
import { api } from '../api/client'
import { useAlertConfirm } from '../contexts/AlertConfirmContext'
import { useUserPreference } from '../hooks/useUserPreference'
import {
  type PasswordPolicy,
  describePasswordRequirements,
} from '../lib/passwordPolicy'
import { useDateTimeConfigContext } from '../contexts/DateTimeConfigContext'
import {
  DATE_TIME_PRESETS,
  formatDateWithConfig,
  formatTimeWithConfig,
  formatDateTimeWithConfig,
} from '../lib/dateTimeConfig'
import { PopupSelect } from '../components/ui/PopupSelect'
import {
  WIKI_MD_ENGINE_PREF_KEY,
  type WikiMarkdownEngine,
} from '@/components/wiki/wikiMarkdownEditorTypes'
import { useConditionalFormatPresets } from '../contexts/ConditionalFormatPresetsContext'
import type { CfColorPreset } from '../lib/conditionalFormatPresets'
import { HomeModuleOrderSettingsSection } from '@/components/home/HomeModuleOrderSettingsSection'
import { useAuthStore } from '@/store/authStore'

const EXAMPLE_DATE = new Date('2025-03-15T14:30:00')

const PW_LEN_MIN = 4
const PW_LEN_MAX = 24

function SettingsCollapsible({
  title,
  subtitle,
  defaultOpen = true,
  children,
}: {
  title: string
  subtitle?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  return (
    <details
      className="group mb-4 rounded-lg border border-border bg-card/50 [&_summary::-webkit-details-marker]:hidden"
      defaultOpen={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-5 py-4 hover:bg-background/40">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-medium text-foreground">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-foreground/75">{subtitle}</p> : null}
        </div>
        <span
          className="mt-1 shrink-0 text-sm text-foreground/40 transition-transform duration-200 group-open:rotate-180"
          aria-hidden
        >
          ▼
        </span>
      </summary>
      <div className="border-t border-border px-5 pb-5 pt-4">{children}</div>
    </details>
  )
}

const SAVE_NOTICE_MS = 2800

const FILES_RECYCLE_MIN = 1
const FILES_RECYCLE_MAX = 3650

function FilesRecycleRetentionSection() {
  const { showAlert } = useAlertConfirm()
  const [retentionDays, setRetentionDays] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveNotice, setSaveNotice] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .get<{ retentionDays: number }>('/settings/files-recycle')
      .then((r) => {
        if (!cancelled) {
          setRetentionDays(r.data.retentionDays)
          setLoadError('')
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRetentionDays(null)
          setLoadError('Could not load files recycle settings.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!saveNotice) return
    const t = window.setTimeout(() => setSaveNotice(false), SAVE_NOTICE_MS)
    return () => window.clearTimeout(t)
  }, [saveNotice])

  const save = async () => {
    if (retentionDays == null) return
    setSaving(true)
    setSaveNotice(false)
    try {
      const { data } = await api.put<{ retentionDays: number }>('/settings/files-recycle', {
        retentionDays,
      })
      setRetentionDays(data.retentionDays)
      setSaveNotice(true)
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to save'
      showAlert(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {loadError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
      ) : loading || retentionDays == null ? (
        <p className="text-sm text-foreground/60">Loading…</p>
      ) : (
        <>
          <p className="mb-4 text-sm text-foreground/80">
            Files removed from the library stay on disk in the recycle bin for this many days, then are deleted
            permanently (once per day at local midnight).
          </p>
          <div className="mb-4 flex flex-wrap items-end gap-4">
            <div>
              <label htmlFor="files-recycle-days" className="mb-1 block text-sm font-medium text-foreground">
                Retention (days)
              </label>
              <input
                id="files-recycle-days"
                type="number"
                min={FILES_RECYCLE_MIN}
                max={FILES_RECYCLE_MAX}
                value={retentionDays}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10)
                  const v = Number.isFinite(n)
                    ? Math.min(FILES_RECYCLE_MAX, Math.max(FILES_RECYCLE_MIN, n))
                    : FILES_RECYCLE_MIN
                  setRetentionDays(v)
                }}
                className="w-28 rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saveNotice ? (
              <span
                className="text-sm font-medium text-emerald-600 dark:text-emerald-400"
                role="status"
                aria-live="polite"
              >
                Saved
              </span>
            ) : null}
          </div>
        </>
      )}
    </>
  )
}

function WikiRecycleRetentionSection() {
  const { showAlert } = useAlertConfirm()
  const [retentionDays, setRetentionDays] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveNotice, setSaveNotice] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .get<{ retentionDays: number }>('/settings/wiki-recycle')
      .then((r) => {
        if (!cancelled) {
          setRetentionDays(r.data.retentionDays)
          setLoadError('')
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRetentionDays(null)
          setLoadError('Could not load wiki recycle settings.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!saveNotice) return
    const t = window.setTimeout(() => setSaveNotice(false), SAVE_NOTICE_MS)
    return () => window.clearTimeout(t)
  }, [saveNotice])

  const save = async () => {
    if (retentionDays == null) return
    setSaving(true)
    setSaveNotice(false)
    try {
      const { data } = await api.put<{ retentionDays: number }>('/settings/wiki-recycle', {
        retentionDays,
      })
      setRetentionDays(data.retentionDays)
      setSaveNotice(true)
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to save'
      showAlert(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {loadError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
      ) : loading || retentionDays == null ? (
        <p className="text-sm text-foreground/60">Loading…</p>
      ) : (
        <>
          <p className="mb-4 text-sm text-foreground/80">
            Wiki pages moved to the recycle bin are kept for this many days, then removed permanently (once per day
            at local midnight).
          </p>
          <div className="mb-4 flex flex-wrap items-end gap-4">
            <div>
              <label htmlFor="wiki-recycle-days" className="mb-1 block text-sm font-medium text-foreground">
                Retention (days)
              </label>
              <input
                id="wiki-recycle-days"
                type="number"
                min={FILES_RECYCLE_MIN}
                max={FILES_RECYCLE_MAX}
                value={retentionDays}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10)
                  const v = Number.isFinite(n)
                    ? Math.min(FILES_RECYCLE_MAX, Math.max(FILES_RECYCLE_MIN, n))
                    : FILES_RECYCLE_MIN
                  setRetentionDays(v)
                }}
                className="w-28 rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saveNotice ? (
              <span
                className="text-sm font-medium text-emerald-600 dark:text-emerald-400"
                role="status"
                aria-live="polite"
              >
                Saved
              </span>
            ) : null}
          </div>
        </>
      )}
    </>
  )
}

function PasswordPolicySection() {
  const { showAlert } = useAlertConfirm()
  const [policy, setPolicy] = useState<PasswordPolicy | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveNotice, setSaveNotice] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .get<PasswordPolicy>('/settings/password-policy')
      .then((r) => {
        if (!cancelled) {
          setPolicy(r.data)
          setLoadError('')
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPolicy(null)
          setLoadError('Could not load password policy.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!saveNotice) return
    const t = window.setTimeout(() => setSaveNotice(false), SAVE_NOTICE_MS)
    return () => window.clearTimeout(t)
  }, [saveNotice])

  const save = async () => {
    if (!policy) return
    setSaving(true)
    setSaveNotice(false)
    try {
      const { data } = await api.put<PasswordPolicy>('/settings/password-policy', policy)
      setPolicy(data)
      setSaveNotice(true)
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to save'
      showAlert(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {loadError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
      ) : loading || !policy ? (
        <p className="text-sm text-foreground/60">Loading…</p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-end gap-4">
            <div>
              <label htmlFor="pw-min-len" className="mb-1 block text-sm font-medium text-foreground">
                Minimum length
              </label>
              <input
                id="pw-min-len"
                type="number"
                min={PW_LEN_MIN}
                max={PW_LEN_MAX}
                value={policy.minLength}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10)
                  const v = Number.isFinite(n)
                    ? Math.min(PW_LEN_MAX, Math.max(PW_LEN_MIN, n))
                    : PW_LEN_MIN
                  setPolicy((p) => (p ? { ...p, minLength: v } : p))
                }}
                className="w-24 rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              />
            </div>
          </div>
          <ul className="mb-4 space-y-2">
            {(
              [
                ['requireUppercase', 'Require an uppercase letter'] as const,
                ['requireLowercase', 'Require a lowercase letter'] as const,
                ['requireDigit', 'Require a digit'] as const,
                ['requireSpecial', 'Require a special character (not letter or digit)'] as const,
              ] as const
            ).map(([key, label]) => (
              <li key={key}>
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={policy[key]}
                    onChange={(e) => setPolicy((p) => (p ? { ...p, [key]: e.target.checked } : p))}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <span className="text-sm font-medium text-foreground">{label}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="mb-4 rounded-lg border border-border/80 bg-background/60 px-3 py-2 text-sm text-foreground/75">
            <span className="font-semibold text-foreground/90">Summary: </span>
            {describePasswordRequirements(policy).join(' · ')}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save password policy'}
            </button>
            {saveNotice ? (
              <span
                className="text-sm font-medium text-emerald-600 dark:text-emerald-400"
                role="status"
                aria-live="polite"
              >
                Saved
              </span>
            ) : null}
          </div>
        </>
      )}
    </>
  )
}

function AdminerUrlSection() {
  const { showAlert } = useAlertConfirm()
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveNotice, setSaveNotice] = useState(false)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let cancelled = false
    api
      .get<{ url: string | null }>('/settings/adminer-url')
      .then((r) => {
        if (!cancelled) {
          setDraft(r.data?.url ?? '')
          setLoadError('')
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load Adminer URL.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!saveNotice) return
    const t = window.setTimeout(() => setSaveNotice(false), SAVE_NOTICE_MS)
    return () => window.clearTimeout(t)
  }, [saveNotice])

  const save = async () => {
    setSaving(true)
    setSaveNotice(false)
    try {
      const trimmed = draft.trim()
      const { data } = await api.put<{ url: string | null }>('/settings/adminer-url', {
        url: trimmed === '' ? null : trimmed,
      })
      setDraft(data.url ?? '')
      setSaveNotice(true)
      window.dispatchEvent(new Event('dc:adminer-url-saved'))
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to save'
      showAlert(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {loadError ? <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p> : null}
      {loading ? (
        <p className="text-sm text-foreground/60">Loading…</p>
      ) : (
        <>
          <p className="mb-4 text-sm text-foreground/80">
            Target for the <strong className="font-medium text-foreground">Adminer</strong> link in the Admin sidebar. Use a path on this site (e.g.{' '}
            <code className="rounded bg-background px-1">/adminer</code>) or a full <code className="rounded bg-background px-1">https://…</code> URL. Leave
            empty to use the build default (<code className="rounded bg-background px-1">VITE_ADMINER_URL</code> or{' '}
            <code className="rounded bg-background px-1">/adminer</code>). See Raspberry Pi setup docs for installing Adminer behind Caddy.
          </p>
          <div className="mb-4 max-w-xl">
            <label htmlFor="adminer-url" className="mb-1 block text-sm font-medium text-foreground">
              Adminer URL
            </label>
            <input
              id="adminer-url"
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="/adminer"
              autoComplete="off"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-foreground/40"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saveNotice ? (
              <span
                className="text-sm font-medium text-emerald-600 dark:text-emerald-400"
                role="status"
                aria-live="polite"
              >
                Saved
              </span>
            ) : null}
          </div>
        </>
      )}
    </>
  )
}

function CfPresetRowEditor({
  row,
  index,
  onChange,
  onRemove,
}: {
  row: CfColorPreset
  index: number
  onChange: (i: number, patch: Partial<CfColorPreset>) => void
  onRemove: (i: number) => void
}) {
  const t = row.hex.trim().toLowerCase()
  const m3 = /^#([0-9a-f]{3})$/.exec(t)
  const expanded =
    m3 != null ? `#${m3[1][0]}${m3[1][0]}${m3[1][1]}${m3[1][1]}${m3[1][2]}${m3[1][2]}` : t
  const hexOk = /^#[0-9a-f]{6}$/.test(expanded)
  const pickerVal = hexOk ? expanded : '#808080'
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/80 px-3 py-2">
      <input
        type="color"
        aria-label={`Color ${index + 1}`}
        value={pickerVal}
        onChange={(e) => onChange(index, { hex: e.target.value })}
        className="h-9 w-11 shrink-0 cursor-pointer rounded border border-border"
      />
      <input
        type="text"
        value={row.hex}
        onChange={(e) => onChange(index, { hex: e.target.value })}
        placeholder="#hex"
        className="w-24 rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground"
      />
      <input
        type="text"
        value={row.label}
        onChange={(e) => onChange(index, { label: e.target.value })}
        placeholder="Label (tooltip)"
        className="min-w-[8rem] flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
      />
      <button
        type="button"
        onClick={() => onRemove(index)}
        className="shrink-0 rounded border border-red-500/40 px-2 py-1 text-xs text-red-600 hover:bg-red-500/10 dark:text-red-400"
      >
        Remove
      </button>
    </div>
  )
}

export function Settings() {
  const canEditHome = useAuthStore((s) => s.hasPermission('home.edit'))
  const [config, setConfig] = useDateTimeConfigContext()
  const [openRecordsViewOnly, setOpenRecordsViewOnly] = useUserPreference('atlas-open-records-view-only', false)
  const [persistTableFilters, setPersistTableFilters] = useUserPreference('atlas-persist-table-filters', false)
  const [wikiMdEngine, setWikiMdEngine] = useUserPreference<WikiMarkdownEngine>(
    WIKI_MD_ENGINE_PREF_KEY,
    'md-editor-rt'
  )
  const { presets: cfPresets, setPresets: setCfPresets, resetPresetsToDefaults } = useConditionalFormatPresets()

  const currentPresetIndex = DATE_TIME_PRESETS.findIndex(
    (p) =>
      p.value.dateFormat === config.dateFormat &&
      p.value.timeFormat === config.timeFormat &&
      p.value.dateTimeFormat === config.dateTimeFormat
  )

  const presetValue = currentPresetIndex >= 0 ? String(currentPresetIndex) : 'custom'
  const presetOptions = [
    ...DATE_TIME_PRESETS.map((p, i) => ({ value: String(i), label: p.label })),
    { value: 'custom', label: 'Custom' },
  ]

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-foreground">Settings</h1>

      <SettingsCollapsible
        title="Password requirements"
        subtitle="Rules for new user passwords and admin resets. Length 4–24 characters; existing logins unchanged until a new password is set."
      >
        <PasswordPolicySection />
      </SettingsCollapsible>

      {canEditHome ? (
        <SettingsCollapsible
          title="Home hub module cards"
          subtitle="Reorder tiles, hide modules from the hub only, and set custom titles, descriptions, and icon artwork for each module card."
        >
          <HomeModuleOrderSettingsSection />
        </SettingsCollapsible>
      ) : null}

      <SettingsCollapsible
        title="Recycle bins"
        subtitle="Retention for soft-deleted files and wiki pages before they are removed permanently (purged once per day at local midnight)."
      >
        <div className="space-y-8">
          <div>
            <h3 className="mb-3 text-sm font-semibold text-foreground">Files</h3>
            <FilesRecycleRetentionSection />
          </div>
          <div>
            <h3 className="mb-3 text-sm font-semibold text-foreground">Wiki</h3>
            <WikiRecycleRetentionSection />
          </div>
        </div>
      </SettingsCollapsible>

      <SettingsCollapsible
        title="Adminer"
        subtitle="Optional URL for the Admin database console link in the Admin sidebar."
      >
        <AdminerUrlSection />
      </SettingsCollapsible>

      <SettingsCollapsible
        title="Markdown editor"
        subtitle="Editor used for wiki pages and the home welcome message. Published pages and previews use md-editor-rt’s renderer (same as the rich editor’s preview). Saved to your account."
      >
        <fieldset>
          <legend className="sr-only">Markdown editor type</legend>
          <div className="space-y-3">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="wiki-md-engine"
                value="md-editor-rt"
                checked={wikiMdEngine === 'md-editor-rt'}
                onChange={() => setWikiMdEngine('md-editor-rt')}
                className="mt-1 h-4 w-4 border-border text-primary focus:ring-primary"
              />
              <span>
                <span className="text-sm font-medium text-foreground">Rich editor (md-editor-rt)</span>
                <span className="mt-0.5 block text-sm text-foreground/70">
                  CodeMirror-based editor with toolbar; preview matches published wiki/home content.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="wiki-md-engine"
                value="classic"
                checked={wikiMdEngine === 'classic'}
                onChange={() => setWikiMdEngine('classic')}
                className="mt-1 h-4 w-4 border-border text-primary focus:ring-primary"
              />
              <span>
                <span className="text-sm font-medium text-foreground">Classic</span>
                <span className="mt-0.5 block text-sm text-foreground/70">
                  Textarea with compact toolbar; side preview uses the same md-editor-rt renderer as published pages.
                </span>
              </span>
            </label>
          </div>
        </fieldset>
      </SettingsCollapsible>

      <SettingsCollapsible
        title="Date & time"
        subtitle="How dates and times are shown (plan runs, recorded at, exports)."
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          <label htmlFor="date-time-preset" className="text-sm font-medium text-foreground/90">
            Preset
          </label>
          <PopupSelect
            id="date-time-preset"
            label=""
            value={presetValue}
            onChange={(v) => {
              if (v !== 'custom' && v !== '') {
                const idx = Number(v)
                if (idx >= 0 && idx < DATE_TIME_PRESETS.length) {
                  setConfig(DATE_TIME_PRESETS[idx].value)
                }
              }
            }}
            options={presetOptions}
            className="min-w-[220px] max-w-full"
          />
        </div>
        <p className="mt-3 text-sm text-foreground/70">
          Date: {formatDateWithConfig(EXAMPLE_DATE, config)} · Time: {formatTimeWithConfig(EXAMPLE_DATE, config)} · Date and time: {formatDateTimeWithConfig(EXAMPLE_DATE, config)}
        </p>
      </SettingsCollapsible>

      <SettingsCollapsible
        title="Data"
        subtitle="Behavior when working with test plan data rows and table filters."
      >
        <p className="mb-4 text-sm text-foreground/80">
          When view-only is enabled, clicking a data row opens it read-only; use Edit in the modal to change it.
        </p>
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={openRecordsViewOnly}
            onChange={(e) => setOpenRecordsViewOnly(e.target.checked)}
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
          />
          <span className="text-sm font-medium text-foreground">Open data rows in view-only</span>
        </label>
        <label className="mt-4 flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={persistTableFilters}
            onChange={(e) => setPersistTableFilters(e.target.checked)}
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
          />
          <span className="text-sm font-medium text-foreground">Persist table filters between devices</span>
        </label>
        <p className="mt-1 text-sm text-foreground/70">
          When enabled, search and column filters are saved to your account and sync across devices.
        </p>
      </SettingsCollapsible>

      <SettingsCollapsible
        title="Conditional formatting"
        subtitle="Extra color swatches for conditional format rules on data fields. “No fill” and “Aa” stay always available. Saved to your account."
      >
        <div className="mb-6 space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Fill (background) swatches</h3>
          <div className="space-y-2">
            {cfPresets.fill.map((row, i) => (
              <CfPresetRowEditor
                key={`fill-${i}-${row.hex}`}
                row={row}
                index={i}
                onChange={(idx, patch) =>
                  setCfPresets((prev) => ({
                    ...prev,
                    fill: prev.fill.map((r, j) => (j === idx ? { ...r, ...patch } : r)),
                  }))
                }
                onRemove={(idx) =>
                  setCfPresets((prev) => ({
                    ...prev,
                    fill: prev.fill.filter((_, j) => j !== idx),
                  }))
                }
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              setCfPresets((prev) => ({
                ...prev,
                fill: [...prev.fill, { hex: '#fef08a', label: '' }],
              }))
            }
            className="mt-2 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-background"
          >
            + Add fill color
          </button>
        </div>
        <div className="mb-4 space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Text color swatches</h3>
          <div className="space-y-2">
            {cfPresets.text.map((row, i) => (
              <CfPresetRowEditor
                key={`text-${i}-${row.hex}`}
                row={row}
                index={i}
                onChange={(idx, patch) =>
                  setCfPresets((prev) => ({
                    ...prev,
                    text: prev.text.map((r, j) => (j === idx ? { ...r, ...patch } : r)),
                  }))
                }
                onRemove={(idx) =>
                  setCfPresets((prev) => ({
                    ...prev,
                    text: prev.text.filter((_, j) => j !== idx),
                  }))
                }
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              setCfPresets((prev) => ({
                ...prev,
                text: [...prev.text, { hex: '#b91c1c', label: '' }],
              }))
            }
            className="mt-2 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-background"
          >
            + Add text color
          </button>
        </div>
        <button
          type="button"
          onClick={() => resetPresetsToDefaults()}
          className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-background"
        >
          Reset fill &amp; text lists to app defaults
        </button>
      </SettingsCollapsible>
    </div>
  )
}
