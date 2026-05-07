import { useCallback, useEffect, useMemo, useState } from 'react'
import { useBlocker, type BlockerFunction } from 'react-router-dom'
import {
  getAmrSettings,
  putAmrSettings,
  testAmrFleetConnection,
  testAmrHyperionConnection,
  type AmrFleetSettings,
} from '@/api/amr'
import { useAlertConfirm } from '@/contexts/AlertConfirmContext'
import {
  HIDE_FLEET_COMPLETE_AFTER_MINUTE_OPTIONS,
  labelHideFleetCompleteOption,
} from '@/utils/amrAppMissions'
import { useAuthStore } from '@/store/authStore'
import { ConfirmModal } from '@/components/ui/ConfirmModal'

type AmrSettingsFormState = {
  serverIp: string
  serverPort: number
  useHttps: boolean
  orgId: string
  robotType: string
  robotModels: string[]
  robotIdsDefault: string[]
  containerType: string
  containerModelCode: string
  pollMsMissions: number
  pollMsMissionWorker: number
  pollMsRobots: number
  pollMsContainers: number
  hideFleetCompleteAfterMinutesDefault: number | null
  missionCreateStandPresenceSanityCheck: boolean
  missionQueueingEnabled: boolean
  palletDropConfirmTimeoutMs: number
  authKeyConfigured: boolean
  hyperionServerIp: string
  hyperionServerPort: number
  hyperionUseHttps: boolean
  hyperionUsername: string
  hyperionPasswordConfigured: boolean
}

/** Parse stored origin into fields matching the Fleet connection layout. */
function hyperionConnectionFromBaseUrl(baseUrl: string | undefined): {
  hyperionServerIp: string
  hyperionServerPort: number
  hyperionUseHttps: boolean
} {
  const t = (baseUrl ?? '').trim()
  if (!t) {
    return { hyperionServerIp: '', hyperionServerPort: 80, hyperionUseHttps: false }
  }
  try {
    const u = new URL(t.includes('://') ? t : `http://${t}`)
    const useHttps = u.protocol === 'https:'
    let port = u.port ? Number(u.port) : useHttps ? 443 : 80
    if (!Number.isFinite(port)) port = useHttps ? 443 : 80
    return { hyperionServerIp: u.hostname, hyperionServerPort: port, hyperionUseHttps: useHttps }
  } catch {
    const stripped = t.replace(/^https?:\/\//i, '')
    const hostPart = stripped.split('/')[0] ?? ''
    const [host, portStr] = hostPart.includes(':') ? hostPart.split(':') : [hostPart, '']
    const port = portStr ? Number(portStr) : 80
    return {
      hyperionServerIp: host ?? '',
      hyperionServerPort: Number.isFinite(port) ? port : 80,
      hyperionUseHttps: /^https:/i.test(t),
    }
  }
}

function hyperionBaseUrlFromConnection(
  hyperionServerIp: string,
  hyperionServerPort: number,
  hyperionUseHttps: boolean
): string {
  const host = hyperionServerIp.trim()
  if (!host) return ''
  const scheme = hyperionUseHttps ? 'https' : 'http'
  const def = hyperionUseHttps ? 443 : 80
  const p = Number(hyperionServerPort)
  const portNum = Number.isFinite(p) ? p : def
  const portSuffix = portNum !== def ? `:${portNum}` : ''
  return `${scheme}://${host}${portSuffix}`
}

function amrFleetSettingsToForm(s: AmrFleetSettings): AmrSettingsFormState {
  return {
    serverIp: s.serverIp,
    serverPort: s.serverPort,
    useHttps: s.useHttps,
    orgId: s.orgId,
    robotType: s.robotType,
    robotModels: s.robotModels ?? [],
    robotIdsDefault: s.robotIdsDefault ?? [],
    containerType: s.containerType,
    containerModelCode: s.containerModelCode,
    pollMsMissions: s.pollMsMissions,
    pollMsMissionWorker: s.pollMsMissionWorker ?? s.pollMsMissions,
    pollMsRobots: s.pollMsRobots,
    pollMsContainers: s.pollMsContainers,
    hideFleetCompleteAfterMinutesDefault: s.hideFleetCompleteAfterMinutesDefault ?? null,
    missionCreateStandPresenceSanityCheck: s.missionCreateStandPresenceSanityCheck !== false,
    missionQueueingEnabled: s.missionQueueingEnabled !== false,
    palletDropConfirmTimeoutMs:
      typeof s.palletDropConfirmTimeoutMs === 'number' && Number.isFinite(s.palletDropConfirmTimeoutMs)
        ? s.palletDropConfirmTimeoutMs
        : 10000,
    authKeyConfigured: s.authKeyConfigured,
    ...hyperionConnectionFromBaseUrl(s.hyperionBaseUrl),
    hyperionUsername: s.hyperionUsername ?? '',
    hyperionPasswordConfigured: s.hyperionPasswordConfigured ?? false,
  }
}

function serializeAmrSettingsBaseline(form: AmrSettingsFormState): string {
  return JSON.stringify(form)
}

export function AmrSettings() {
  const { showAlert } = useAlertConfirm()
  const canEdit = useAuthStore((s) => s.hasPermission('amr.settings'))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedBaseline, setSavedBaseline] = useState('')
  const [testing, setTesting] = useState(false)
  const [hyperionTesting, setHyperionTesting] = useState(false)
  const [authKey, setAuthKey] = useState('')
  const [hyperionPassword, setHyperionPassword] = useState('')
  const [form, setForm] = useState<AmrSettingsFormState>({
    serverIp: '',
    serverPort: 80,
    useHttps: false,
    orgId: 'DCAuto',
    robotType: 'LIFT',
    robotModels: [] as string[],
    robotIdsDefault: [] as string[],
    containerType: 'Tray(AMR)',
    containerModelCode: 'Pallet',
    pollMsMissions: 5000,
    pollMsMissionWorker: 5000,
    pollMsRobots: 5000,
    pollMsContainers: 5000,
    hideFleetCompleteAfterMinutesDefault: null as number | null,
    missionCreateStandPresenceSanityCheck: true,
    missionQueueingEnabled: true,
    palletDropConfirmTimeoutMs: 10000,
    authKeyConfigured: false,
    ...hyperionConnectionFromBaseUrl(''),
    hyperionUsername: '',
    hyperionPasswordConfigured: false,
  })

  useEffect(() => {
    void getAmrSettings()
      .then((s) => {
        const next = amrFleetSettingsToForm(s)
        setForm(next)
        setSavedBaseline(serializeAmrSettingsBaseline(next))
      })
      .finally(() => setLoading(false))
  }, [])

  const isDirty = useMemo(() => {
    if (authKey.trim() !== '' || hyperionPassword.trim() !== '') return true
    return serializeAmrSettingsBaseline(form) !== savedBaseline
  }, [form, savedBaseline, authKey, hyperionPassword])

  const blocker = useBlocker(
    useCallback<BlockerFunction>(
      ({ currentLocation, nextLocation }) => {
        if (!isDirty) return false
        return (
          currentLocation.pathname !== nextLocation.pathname ||
          currentLocation.search !== nextLocation.search ||
          currentLocation.hash !== nextLocation.hash
        )
      },
      [isDirty]
    )
  )

  useEffect(() => {
    if (!isDirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isDirty])

  const save = async () => {
    if (!canEdit) return
    setSaving(true)
    try {
      const { hyperionServerIp, hyperionServerPort, hyperionUseHttps, ...formForApi } = form
      await putAmrSettings({
        ...formForApi,
        hyperionBaseUrl: hyperionBaseUrlFromConnection(hyperionServerIp, hyperionServerPort, hyperionUseHttps),
        authKey: authKey.trim() || undefined,
        hyperionPassword: hyperionPassword.trim() || undefined,
      })
      setAuthKey('')
      setHyperionPassword('')
      const s = await getAmrSettings()
      const next = amrFleetSettingsToForm(s)
      setForm(next)
      setSavedBaseline(serializeAmrSettingsBaseline(next))
      showAlert('AMR settings were saved successfully.', 'Settings saved')
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Could not save AMR settings.'
      showAlert(msg, 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    setTesting(true)
    try {
      const r = await testAmrFleetConnection()
      alert(JSON.stringify(r).slice(0, 800))
    } catch (e: unknown) {
      const ax = e as { response?: { data?: unknown } }
      alert(JSON.stringify(ax?.response?.data ?? 'Error'))
    } finally {
      setTesting(false)
    }
  }

  const testHyperion = async () => {
    setHyperionTesting(true)
    try {
      const r = await testAmrHyperionConnection()
      showAlert(
        `${r.message} (${r.presenceEntryCount} stand ref(s) in response).`,
        'Hyperion connection'
      )
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Hyperion connection test failed.'
      showAlert(msg, 'Hyperion test failed')
    } finally {
      setHyperionTesting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
        <p className="text-sm text-foreground/60">Loading…</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
      <ConfirmModal
        open={blocker.state === 'blocked'}
        title="Leave without saving?"
        message="You have unsaved changes to AMR settings. If you leave now, they will be lost."
        confirmLabel="Leave"
        cancelLabel="Stay"
        variant="danger"
        onCancel={() => {
          if (blocker.state === 'blocked') blocker.reset()
        }}
        onConfirm={() => {
          if (blocker.state === 'blocked') blocker.proceed()
        }}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
          <div className="mx-auto w-full max-w-2xl space-y-6 pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">AMR settings</h1>
          <p className="mt-1 text-sm text-foreground/70">
            Fleet and Hyperion credentials are stored on the server; secrets are never shown after save. Save stays fixed
            at the bottom of the screen; only the form scrolls. Connection tests use the last saved config. Leaving the
            page with unsaved edits will prompt you.
          </p>
        </div>

      <section className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div>
          <h2 className="text-sm font-medium">Fleet connection</h2>
          <p className="mt-1 text-xs text-foreground/60">HTTP endpoint and credentials for the fleet API proxy.</p>
        </div>
        <label className="block text-sm">
          Server IP / hostname
          <input
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            disabled={!canEdit}
            value={form.serverIp}
            onChange={(e) => setForm((f) => ({ ...f, serverIp: e.target.value }))}
          />
        </label>
        <label className="block text-sm">
          Server port
          <input
            type="number"
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            disabled={!canEdit}
            value={form.serverPort}
            onChange={(e) => setForm((f) => ({ ...f, serverPort: Number(e.target.value) }))}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.useHttps}
            disabled={!canEdit}
            onChange={(e) => setForm((f) => ({ ...f, useHttps: e.target.checked }))}
          />
          Use HTTPS
        </label>
        <label className="block text-sm">
          Auth key {form.authKeyConfigured ? '(configured — enter to replace)' : ''}
          <input
            type="password"
            autoComplete="off"
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            disabled={!canEdit}
            value={authKey}
            onChange={(e) => setAuthKey(e.target.value)}
            placeholder="Authorization header value"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50"
            disabled={testing}
            onClick={() => void test()}
          >
            {testing ? 'Testing…' : 'Test connection'}
          </button>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div>
          <h2 className="text-sm font-medium">Hyperion connection</h2>
          <p className="mt-1 text-xs text-foreground/60">
            HTTP endpoint and HTTP Basic credentials for Hyperion (e.g. stand presence at{' '}
            <code className="text-[11px]">/stand-presence</code>). Stored on the server; password is never shown after save.
          </p>
        </div>
        <label className="block text-sm">
          Server IP / hostname
          <input
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            disabled={!canEdit}
            value={form.hyperionServerIp}
            onChange={(e) => setForm((f) => ({ ...f, hyperionServerIp: e.target.value }))}
            placeholder="10.73.220.197"
            autoComplete="off"
          />
        </label>
        <label className="block text-sm">
          Server port
          <input
            type="number"
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            disabled={!canEdit}
            value={form.hyperionServerPort}
            onChange={(e) => setForm((f) => ({ ...f, hyperionServerPort: Number(e.target.value) }))}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.hyperionUseHttps}
            disabled={!canEdit}
            onChange={(e) => setForm((f) => ({ ...f, hyperionUseHttps: e.target.checked }))}
          />
          Use HTTPS
        </label>
        <label className="block text-sm">
          Username
          <input
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            disabled={!canEdit}
            value={form.hyperionUsername}
            onChange={(e) => setForm((f) => ({ ...f, hyperionUsername: e.target.value }))}
            autoComplete="off"
          />
        </label>
        <label className="block text-sm">
          Password {form.hyperionPasswordConfigured ? '(configured — enter to replace)' : ''}
          <input
            type="password"
            autoComplete="new-password"
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            disabled={!canEdit}
            value={hyperionPassword}
            onChange={(e) => setHyperionPassword(e.target.value)}
            placeholder="Hyperion API password"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50"
            disabled={hyperionTesting}
            onClick={() => void testHyperion()}
          >
            {hyperionTesting ? 'Testing…' : 'Test connection'}
          </button>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div>
          <h2 className="text-sm font-medium">Mission settings</h2>
          <p className="mt-1 text-xs text-foreground/60">
            Presence checks, queueing, and post-lower confirmation use Hyperion when it is configured above.
          </p>
        </div>
        <label className="flex cursor-pointer items-start gap-3 text-sm leading-snug">
          <input
            type="checkbox"
            className="mt-0.5 shrink-0 rounded border-border"
            checked={form.missionCreateStandPresenceSanityCheck}
            disabled={!canEdit}
            onChange={(e) =>
              setForm((f) => ({ ...f, missionCreateStandPresenceSanityCheck: e.target.checked }))
            }
          />
          <span>
            <span className="font-medium text-foreground">Stand presence check before mission create</span>
            <span className="mt-1 block text-xs text-foreground/65">
              When enabled, creating a multistop mission (new mission or from a template) queries Hyperion before
              submit. If stop 1 appears empty but another stop reports a pallet, a confirmation appears. Uncheck to
              skip that request and dialog. In-mission pallet chips and Containers refresh behavior are unchanged.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 text-sm leading-snug">
          <input
            type="checkbox"
            className="mt-0.5 shrink-0 rounded border-border"
            checked={form.missionQueueingEnabled}
            disabled={!canEdit}
            onChange={(e) => setForm((f) => ({ ...f, missionQueueingEnabled: e.target.checked }))}
          />
          <span>
            <span className="font-medium text-foreground">Enable mission queueing</span>
            <span className="mt-1 block text-xs text-foreground/65">
              When enabled, blocked destination missions are queued and dispatched automatically once the stand clears.
              Queueing also controls post-lower stand reservation checks.
            </span>
          </span>
        </label>
        <label className="block text-sm">
          Post-lower pallet confirm timeout (ms)
          <input
            type="number"
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            disabled={!canEdit}
            min={1000}
            max={600000}
            value={form.palletDropConfirmTimeoutMs}
            onChange={(e) =>
              setForm((f) => ({ ...f, palletDropConfirmTimeoutMs: Number(e.target.value) }))
            }
          />
          <span className="mt-1 block text-[11px] text-foreground/55">
            Worker keeps polling stand presence after a lower until pallet is detected or this timeout expires.
          </span>
        </label>
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div>
          <h2 className="text-sm font-medium">Mission &amp; fleet defaults</h2>
          <p className="mt-1 text-xs text-foreground/60">
            Default identifiers sent with new missions and fleet queries (org, robot, container).
          </p>
        </div>
        <label className="block text-sm">
          orgId
          <input
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            disabled={!canEdit}
            value={form.orgId}
            onChange={(e) => setForm((f) => ({ ...f, orgId: e.target.value }))}
          />
        </label>
        <label className="block text-sm">
          robotType
          <input
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            disabled={!canEdit}
            value={form.robotType}
            onChange={(e) => setForm((f) => ({ ...f, robotType: e.target.value }))}
          />
        </label>
        <label className="block text-sm">
          robotModels (comma-separated)
          <input
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            disabled={!canEdit}
            value={form.robotModels.join(', ')}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                robotModels: e.target.value
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean),
              }))
            }
          />
        </label>
        <label className="block text-sm">
          containerType / containerModelCode
          <div className="mt-1 flex gap-2">
            <input
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              disabled={!canEdit}
              value={form.containerType}
              onChange={(e) => setForm((f) => ({ ...f, containerType: e.target.value }))}
            />
            <input
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              disabled={!canEdit}
              value={form.containerModelCode}
              onChange={(e) => setForm((f) => ({ ...f, containerModelCode: e.target.value }))}
            />
          </div>
        </label>
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div>
          <h2 className="text-sm font-medium">Polling &amp; refresh</h2>
          <p className="mt-1 text-xs text-foreground/60">
            Minimum interval 1000 ms (server-enforced). The mission worker and the app missions table share one cadence;
            the fleet-only job list on the missions page uses the missions UI interval below. Robots and Containers pages
            use their own values.
          </p>
        </div>
        <label className="block text-sm">
          Default: hide fleet-complete missions after (missions page)
          <select
            className="mt-1 w-full max-w-md rounded-lg border border-border bg-background px-3 py-2 text-sm"
            disabled={!canEdit}
            value={
              form.hideFleetCompleteAfterMinutesDefault == null
                ? ''
                : String(form.hideFleetCompleteAfterMinutesDefault)
            }
            onChange={(e) => {
              const v = e.target.value
              setForm((f) => ({
                ...f,
                hideFleetCompleteAfterMinutesDefault:
                  v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null,
              }))
            }}
          >
            <option value="">Don&apos;t hide (by completion age)</option>
            {HIDE_FLEET_COMPLETE_AFTER_MINUTE_OPTIONS.map((mins) => (
              <option key={mins} value={String(mins)}>
                {labelHideFleetCompleteOption(mins)}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] text-foreground/55">
            Applies when a browser has not set its own missions table control (local override). Uses fleet-complete time (
            <code className="text-[11px]">updated_at</code>).
          </span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            Mission worker + app missions table (ms)
            <input
              type="number"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              disabled={!canEdit}
              value={form.pollMsMissionWorker}
              onChange={(e) => setForm((f) => ({ ...f, pollMsMissionWorker: Number(e.target.value) }))}
            />
          </label>
          <label className="block text-sm">
            Missions UI: fleet-only list + worker fallback (ms)
            <input
              type="number"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              disabled={!canEdit}
              value={form.pollMsMissions}
              onChange={(e) => setForm((f) => ({ ...f, pollMsMissions: Number(e.target.value) }))}
            />
          </label>
          <label className="block text-sm">
            Robots page refresh (ms)
            <input
              type="number"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              disabled={!canEdit}
              value={form.pollMsRobots}
              onChange={(e) => setForm((f) => ({ ...f, pollMsRobots: Number(e.target.value) }))}
            />
          </label>
          <label className="block text-sm">
            Containers page refresh (ms)
            <input
              type="number"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              disabled={!canEdit}
              value={form.pollMsContainers}
              onChange={(e) => setForm((f) => ({ ...f, pollMsContainers: Number(e.target.value) }))}
            />
          </label>
        </div>
      </section>
          </div>
        </div>

        <div className="relative z-30 shrink-0 border-t border-border bg-background py-3 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.12)]">
          <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-3">
            <p
              className={`min-h-[1.25rem] text-xs ${
                isDirty
                  ? 'font-medium text-amber-800 dark:text-amber-200'
                  : 'text-foreground/55'
              }`}
            >
              {isDirty
                ? 'Unsaved changes'
                : canEdit
                  ? 'All changes saved'
                  : 'View only — no permission to edit'}
            </p>
            <button
              type="button"
              className="min-h-[44px] rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
              disabled={!canEdit || saving || !isDirty}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AmrSettings
