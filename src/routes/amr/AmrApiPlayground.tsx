import { useMemo, useState } from 'react'
import { api } from '@/api/client'
import { amrFleetProxy } from '@/api/amr'
import { useAuthStore } from '@/store/authStore'

/** Non-fleet routes invoked from the same “Operation” control (body JSON applies where relevant). */
const DC_STAND_PRESENCE = '__dc:POST /amr/dc/stands/presence'
const DC_HYPERION_TEST = '__dc:POST /amr/dc/hyperion/test'
const DC_FLEET_TEST = '__dc:POST /amr/dc/fleet/test'

type PlaygroundRow = {
  category: string
  id: string
  /** Short label in the dropdown */
  label: string
  /** Hint under the editor */
  hint: string
  example: string
}

const ROWS: PlaygroundRow[] = [
  {
    category: 'Fleet · queries',
    id: 'jobQuery',
    label: 'jobQuery',
    hint: 'Fleet POST /api/amr/jobQuery — empty jobCode lists jobs.',
    example: JSON.stringify({ jobCode: '' }, null, 2),
  },
  {
    category: 'Fleet · queries',
    id: 'robotQuery',
    label: 'robotQuery',
    hint: 'Fleet POST /api/amr/robotQuery — optional filters.',
    example: JSON.stringify({ robotId: '', robotType: '' }, null, 2),
  },
  {
    category: 'Fleet · queries',
    id: 'containerQuery',
    label: 'containerQuery',
    hint: 'Fleet POST /api/amr/containerQuery — single-container style query.',
    example: JSON.stringify(
      {
        containerCode: '',
        nodeCode: '',
      },
      null,
      2
    ),
  },
  {
    category: 'Fleet · queries',
    id: 'containerQueryAll',
    label: 'containerQueryAll',
    hint: 'Fleet POST /api/amr/containerQueryAll — inMapStatus "0" | "1" filters in-map containers.',
    example: JSON.stringify(
      {
        containerCode: '',
        nodeCode: '',
        inMapStatus: '1',
      },
      null,
      2
    ),
  },
  {
    category: 'Fleet · missions & feedback',
    id: 'submitMission',
    label: 'submitMission',
    hint: 'Fleet POST /api/amr/submitMission — missionData steps match fleet rack-move API.',
    example: JSON.stringify(
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
        containerCode: '',
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
  },
  {
    category: 'Fleet · missions & feedback',
    id: 'missionCancel',
    label: 'missionCancel',
    hint: 'Fleet POST /api/amr/missionCancel.',
    example: JSON.stringify(
      {
        requestId: 'cancel-req',
        missionCode: 'demo-mission',
        cancelMode: 'NORMAL',
      },
      null,
      2
    ),
  },
  {
    category: 'Fleet · missions & feedback',
    id: 'operationFeedback',
    label: 'operationFeedback',
    hint: 'Fleet POST /api/amr/operationFeedback.',
    example: JSON.stringify(
      {
        requestId: 'fb-demo',
        missionCode: 'demo-mission',
      },
      null,
      2
    ),
  },
  {
    category: 'Fleet · containers',
    id: 'containerIn',
    label: 'containerIn',
    hint: 'Fleet POST /api/amr/containerIn — isNew false when container already on map (see containerFleetAlreadyRegistered).',
    example: JSON.stringify(
      {
        orgId: 'DCAuto',
        requestId: 'ci-demo',
        containerType: 'Tray(AMR)',
        containerModelCode: 'Pallet',
        position: 'S1-AMR-01',
        containerCode: 'PG12345678',
        enterOrientation: '0',
        isNew: true,
        containerFleetAlreadyRegistered: false,
        persistentContainer: false,
      },
      null,
      2
    ),
  },
  {
    category: 'Fleet · containers',
    id: 'containerOut',
    label: 'containerOut',
    hint: 'Fleet POST /api/amr/containerOut — remove by containerCode and/or position.',
    example: JSON.stringify(
      {
        orgId: 'DCAuto',
        requestId: 'co-demo',
        containerType: 'Tray(AMR)',
        containerModelCode: 'Pallet',
        containerCode: '',
        position: 'PD-AMR-01',
        isDelete: true,
      },
      null,
      2
    ),
  },
  {
    category: 'Hyperion & DC',
    id: DC_STAND_PRESENCE,
    label: 'stands/presence (Hyperion batch)',
    hint: 'DC POST /amr/dc/stands/presence — body must be JSON with standIds (external_ref strings). Not proxied as fleet operation.',
    example: JSON.stringify({ standIds: ['S1-AMR-01', 'PD-AMR-01'] }, null, 2),
  },
  {
    category: 'Hyperion & DC',
    id: DC_HYPERION_TEST,
    label: 'hyperion/test',
    hint: 'DC POST /amr/dc/hyperion/test — empty POST to verify Hyperion URL and credentials; request body ignored.',
    example: JSON.stringify({}, null, 2),
  },
  {
    category: 'Hyperion & DC',
    id: DC_FLEET_TEST,
    label: 'fleet/test',
    hint: 'DC POST /amr/dc/fleet/test — probes fleet via robotQuery; request body ignored.',
    example: JSON.stringify({}, null, 2),
  },
]

function examplesById(): Record<string, string> {
  const m: Record<string, string> = {}
  for (const r of ROWS) m[r.id] = r.example
  return m
}

function rowById(id: string): PlaygroundRow | undefined {
  return ROWS.find((r) => r.id === id)
}

function categoriesInOrder(): string[] {
  const seen: string[] = []
  for (const r of ROWS) {
    if (!seen.includes(r.category)) seen.push(r.category)
  }
  return seen
}

export function AmrApiPlayground() {
  const allowed = useAuthStore(
    (s) =>
      s.hasPermission('amr.tools.dev') ||
      s.hasPermission('amr.settings') ||
      s.hasPermission('module.amr')
  )
  const EXAMPLES = useMemo(() => examplesById(), [])
  const [op, setOp] = useState<string>('robotQuery')
  const [body, setBody] = useState(EXAMPLES.robotQuery ?? '{}')
  const [out, setOut] = useState('')
  const [ms, setMs] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  const currentRow = rowById(op)
  const example = EXAMPLES[op] ?? '{}'

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
      if (op === DC_STAND_PRESENCE) {
        let parsed: unknown
        try {
          parsed = JSON.parse(body || '{}')
        } catch {
          setOut('Invalid JSON body')
          setMs(null)
          return
        }
        const raw = parsed as { standIds?: unknown }
        let standIds: string[] = []
        if (Array.isArray(raw.standIds)) {
          standIds = raw.standIds.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean)
        }
        const res = await api.post<{ presence: Record<string, boolean> }>('/amr/dc/stands/presence', {
          standIds,
        })
        setMs(Math.round(performance.now() - t0))
        setOut(JSON.stringify({ standIds, presence: res.data.presence }, null, 2))
        return
      }

      if (op === DC_HYPERION_TEST) {
        const res = await api.post<unknown>('/amr/dc/hyperion/test')
        setMs(Math.round(performance.now() - t0))
        setOut(JSON.stringify(res.data, null, 2))
        return
      }

      if (op === DC_FLEET_TEST) {
        const res = await api.post<unknown>('/amr/dc/fleet/test')
        setMs(Math.round(performance.now() - t0))
        setOut(JSON.stringify(res.data, null, 2))
        return
      }

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

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
        Diagnostics only — fleet operations use POST /amr/dc/fleet; Hyperion &amp; DC rows call their documented routes
        directly.
      </div>
      <h1 className="text-xl font-semibold tracking-tight">API playground</h1>
      <div className="flex flex-wrap gap-3">
        <label className="min-w-[min(100%,20rem)] flex-1 text-sm">
          Operation
          <select
            className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={op}
            onChange={(e) => {
              const v = e.target.value
              setOp(v)
              setBody(EXAMPLES[v] ?? '{}')
            }}
          >
            {categoriesInOrder().map((cat) => (
              <optgroup key={cat} label={cat}>
                {ROWS.filter((r) => r.category === cat).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </optgroup>
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
      {currentRow ? (
        <p className="text-xs leading-relaxed text-foreground/65">{currentRow.hint}</p>
      ) : null}
      <textarea
        className="min-h-[260px] w-full rounded-xl border border-border bg-background p-3 font-mono text-xs"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        spellCheck={false}
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
      {out ? (
        <pre className="max-h-[min(70vh,520px)] overflow-auto rounded-xl border border-border bg-muted/30 p-3 text-xs">
          {out}
        </pre>
      ) : null}
    </div>
  )
}

export default AmrApiPlayground
