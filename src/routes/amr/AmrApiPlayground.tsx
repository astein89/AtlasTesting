import { useMemo, useState } from 'react'
import { amrFleetProxy, postStandPresence } from '@/api/amr'
import { useAuthStore } from '@/store/authStore'

function parseStandIds(text: string): string[] {
  const parts = text.split(/[\s,]+/)
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of parts) {
    const t = p.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

const OPS = [
  'submitMission',
  'jobQuery',
  'robotQuery',
  'containerIn',
  'containerOut',
  'containerQuery',
  'containerQueryAll',
  'missionCancel',
  'operationFeedback',
] as const

const EXAMPLES: Record<string, string> = {
  jobQuery: JSON.stringify({ jobCode: '' }, null, 2),
  robotQuery: JSON.stringify({ robotId: '', robotType: '' }, null, 2),
  containerQuery: JSON.stringify({ containerCode: '', nodeCode: '' }, null, 2),
  containerQueryAll: JSON.stringify(
    { containerCode: '', nodeCode: '', inMapStatus: '' },
    null,
    2
  ),
  submitMission: JSON.stringify(
    {
      orgId: 'DCAuto',
      requestId: 'demo-mission',
      missionCode: 'demo-mission',
      missionType: 'RACK_MOVE',
      robotType: 'LIFT',
      lockRobotAfterFinish: 'false',
      unlockRobotId: '',
      robotModels: ['KMP 600P-EU-D diffDrive'],
      robotIds: [],
      missionData: [
        {
          sequence: 1,
          position: 'S1-AMR-01',
          type: 'NODE_POINT',
          passStrategy: 'AUTO',
          waitingMillis: 0,
          putDown: false,
        },
        {
          sequence: 2,
          position: 'PD-AMR-01',
          type: 'NODE_POINT',
          passStrategy: 'AUTO',
          waitingMillis: 0,
          putDown: true,
        },
      ],
    },
    null,
    2
  ),
  containerIn: JSON.stringify(
    {
      orgId: 'DCAuto',
      requestId: 'ci-demo',
      containerType: 'Tray(AMR)',
      containerModelCode: 'Pallet',
      position: 'S1-AMR-01',
      containerCode: 'PG12345678',
      enterOrientation: '0',
      isNew: true,
    },
    null,
    2
  ),
  containerOut: JSON.stringify(
    {
      orgId: 'DCAuto',
      requestId: 'co-demo',
      containerType: 'Tray(AMR)',
      containerModelCode: 'Pallet',
      position: 'PD-AMR-01',
      isDelete: true,
    },
    null,
    2
  ),
  missionCancel: JSON.stringify(
    { requestId: 'cancel-req', missionCode: 'demo-mission', cancelMode: 'NORMAL' },
    null,
    2
  ),
  operationFeedback: JSON.stringify(
    { requestId: 'fb-demo', missionCode: 'demo-mission' },
    null,
    2
  ),
}

export function AmrApiPlayground() {
  const allowed = useAuthStore(
    (s) =>
      s.hasPermission('amr.tools.dev') ||
      s.hasPermission('amr.settings') ||
      s.hasPermission('module.amr')
  )
  const [op, setOp] = useState<string>('robotQuery')
  const [body, setBody] = useState(EXAMPLES.robotQuery ?? '{}')
  const [out, setOut] = useState('')
  const [ms, setMs] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [standIdsInput, setStandIdsInput] = useState('S1-AMR-01\nPD-AMR-01')
  const [standPresenceOut, setStandPresenceOut] = useState('')
  const [standPresenceMs, setStandPresenceMs] = useState<number | null>(null)
  const [standPresenceLoading, setStandPresenceLoading] = useState(false)

  const example = useMemo(() => EXAMPLES[op] ?? '{}', [op])

  if (!allowed) {
    return (
      <p className="text-sm text-foreground/70">
        You need AMR module access (e.g. <code className="text-xs">module.amr</code>) or{' '}
        <code className="text-xs">amr.tools.dev</code>.
      </p>
    )
  }

  const send = async () => {
    setLoading(true)
    setOut('')
    const t0 = performance.now()
    try {
      let payload: unknown = {}
      try {
        payload = JSON.parse(body || '{}')
      } catch {
        setOut('Invalid JSON body')
        setMs(null)
        return
      }
      const data = await amrFleetProxy(op, payload)
      setMs(Math.round(performance.now() - t0))
      setOut(JSON.stringify(data, null, 2))
    } catch (e: unknown) {
      const ax = e as { response?: { data?: unknown } }
      setOut(JSON.stringify(ax?.response?.data ?? String(e), null, 2))
      setMs(Math.round(performance.now() - t0))
    } finally {
      setLoading(false)
    }
  }

  const queryStandPresence = async () => {
    setStandPresenceLoading(true)
    setStandPresenceOut('')
    const t0 = performance.now()
    try {
      const ids = parseStandIds(standIdsInput)
      const presence = await postStandPresence(ids)
      setStandPresenceMs(Math.round(performance.now() - t0))
      setStandPresenceOut(JSON.stringify({ standIds: ids, presence }, null, 2))
    } catch (e: unknown) {
      const ax = e as { response?: { data?: unknown; status?: number } }
      setStandPresenceOut(
        JSON.stringify(
          {
            error: ax?.response?.data ?? String(e),
            status: ax?.response?.status,
          },
          null,
          2
        )
      )
      setStandPresenceMs(Math.round(performance.now() - t0))
    } finally {
      setStandPresenceLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
        Diagnostics only — requests use the same server proxy as production and your saved fleet settings.
      </div>
      <h1 className="text-xl font-semibold tracking-tight">API playground</h1>
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">
          Operation
          <select
            className="mt-1 block rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={op}
            onChange={(e) => {
              setOp(e.target.value)
              setBody(EXAMPLES[e.target.value] ?? '{}')
            }}
          >
            {OPS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="self-end rounded-lg border border-border px-4 py-2 text-sm"
          onClick={() => setBody(example)}
        >
          Load example
        </button>
      </div>
      <textarea
        className="min-h-[220px] w-full rounded-xl border border-border bg-background p-3 font-mono text-xs"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={loading}
          className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          onClick={() => void send()}
        >
          {loading ? 'Sending…' : 'Send'}
        </button>
        {ms != null && <span className="text-xs text-foreground/60">{ms} ms</span>}
      </div>
      {out && (
        <pre className="max-h-[480px] overflow-auto rounded-xl border border-border bg-muted/30 p-3 text-xs">
          {out}
        </pre>
      )}

      <div className="border-t border-border pt-6">
        <h2 className="text-lg font-semibold tracking-tight">Stand presence</h2>
        <p className="mt-1 text-sm text-foreground/70">
          <code className="rounded bg-muted px-1 py-0.5 text-xs">POST /amr/dc/stands/presence</code> — batch pallet
          presence from Hyperion for stand <span className="font-mono">external_ref</span> values (same as mission /
          picker).
        </p>
        <label className="mt-3 block text-sm">
          Stand refs (comma, space, or newline separated)
          <textarea
            className="mt-1 min-h-[100px] w-full rounded-xl border border-border bg-background p-3 font-mono text-xs"
            value={standIdsInput}
            onChange={(e) => setStandIdsInput(e.target.value)}
            placeholder="S1-AMR-01&#10;PD-AMR-01"
            spellCheck={false}
          />
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={standPresenceLoading}
            className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
            onClick={() => void queryStandPresence()}
          >
            {standPresenceLoading ? 'Querying…' : 'Query presence'}
          </button>
          {standPresenceMs != null && (
            <span className="text-xs text-foreground/60">{standPresenceMs} ms</span>
          )}
        </div>
        {standPresenceOut ? (
          <pre className="mt-3 max-h-[360px] overflow-auto rounded-xl border border-border bg-muted/30 p-3 text-xs">
            {standPresenceOut}
          </pre>
        ) : null}
      </div>
    </div>
  )
}

export default AmrApiPlayground
