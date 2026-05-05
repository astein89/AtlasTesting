import { useEffect, useState } from 'react'
import { getAmrSettings, putAmrSettings, testAmrFleetConnection } from '@/api/amr'
import { useAlertConfirm } from '@/contexts/AlertConfirmContext'
import {
  HIDE_FLEET_COMPLETE_AFTER_MINUTE_OPTIONS,
  labelHideFleetCompleteOption,
} from '@/utils/amrAppMissions'
import { useAuthStore } from '@/store/authStore'

export function AmrSettings() {
  const { showAlert } = useAlertConfirm()
  const canEdit = useAuthStore((s) => s.hasPermission('amr.settings'))
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [authKey, setAuthKey] = useState('')
  const [form, setForm] = useState({
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
    authKeyConfigured: false,
  })

  useEffect(() => {
    void getAmrSettings()
      .then((s) => {
        setForm({
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
          authKeyConfigured: s.authKeyConfigured,
        })
      })
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    try {
      await putAmrSettings({
        ...form,
        authKey: authKey.trim() || undefined,
      })
      setAuthKey('')
      const s = await getAmrSettings()
      setForm((f) => ({ ...f, authKeyConfigured: s.authKeyConfigured }))
      showAlert('AMR settings were saved successfully.', 'Settings saved')
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Could not save AMR settings.'
      showAlert(msg, 'Save failed')
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

  if (loading) return <p className="text-sm text-foreground/60">Loading…</p>

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">AMR settings</h1>
        <p className="mt-1 text-sm text-foreground/70">
          Fleet connection is stored on the server; the auth key is never shown after save. Use Save settings at the
          bottom to persist changes (connection test uses the last saved config).
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

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
            onClick={() => void save()}
          >
            Save settings
          </button>
        </div>
      )}
    </div>
  )
}

export default AmrSettings
