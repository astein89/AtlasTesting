import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AmrFleetSettings, ZoneCategory } from '@/api/amr'
import { amrFleetProxy, getAmrMissionRecords, getAmrSettings, getAmrStands } from '@/api/amr'
import { useAlertConfirm } from '@/contexts/AlertConfirmContext'
import { useAuthStore } from '@/store/authStore'
import { useAmrMissionNewModal } from '@/contexts/AmrMissionNewModalContext'
import {
  AmrStandPickerModal,
  enterOrientationForStandRef,
  LocationPinIcon,
  type AmrStandPickerRow,
} from '@/components/amr/AmrStandPickerModal'
import { containerInMapChipClass, containerInMapFriendly } from '@/utils/amrContainerFleet'

type ContainerRow = Record<string, unknown>

type FieldDef = { key: string; label: string }

type FleetResponse = { success?: boolean; message?: string | null; code?: string }

const CONTAINER_DETAIL_SECTIONS: { title: string; keys: FieldDef[] }[] = [
  {
    title: 'Location & map',
    keys: [
      { key: 'mapCode', label: 'Map' },
      { key: 'districtCode', label: 'District' },
      { key: 'nodeCode', label: 'Node code' },
      { key: 'orientation', label: 'Orientation (°)' },
    ],
  },
  {
    title: 'Status & load',
    keys: [
      { key: 'inMapStatus', label: 'In-map status' },
      { key: 'emptyFullStatus', label: 'Empty / full' },
      { key: 'isCarry', label: 'Carry flag' },
    ],
  },
]

const SUMMARY_ONLY_KEYS = new Set(['inMapStatus'])

const NUMERIC_KEYS = new Set(['orientation', 'emptyFullStatus', 'isCarry', 'inMapStatus'])

function apiErrorMessage(e: unknown): string {
  const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
  if (typeof msg === 'string' && msg.trim()) return msg
  if (e instanceof Error) return e.message
  return 'Something went wrong.'
}

function assertFleetAccepted(data: unknown, operation: string) {
  const r = data as FleetResponse
  if (r && typeof r === 'object' && r.success === false) {
    const m = r.message
    throw new Error(typeof m === 'string' && m.trim() ? m : `${operation} was rejected by the fleet`)
  }
}

function humanizeKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^\s+/, '')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatFieldPlain(_key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function buildContainerInPayload(
  settings: AmrFleetSettings,
  opts: {
    containerCode: string
    position: string
    containerModelCode: string
    enterOrientation: string
    isNew: boolean
  }
) {
  const requestId = `dc-ci-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return {
    orgId: settings.orgId?.trim() || 'DCAuto',
    requestId,
    containerType: settings.containerType?.trim() || 'Tray(AMR)',
    containerModelCode: opts.containerModelCode.trim() || settings.containerModelCode?.trim() || 'Pallet',
    position: opts.position.trim(),
    containerCode: opts.containerCode.trim(),
    enterOrientation: opts.enterOrientation.trim() || '0',
    isNew: opts.isNew,
  }
}

function buildContainerOutPayload(settings: AmrFleetSettings, containerCode: string, positionHint: string) {
  const requestId = `dc-co-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return {
    orgId: settings.orgId?.trim() || 'DCAuto',
    requestId,
    containerType: settings.containerType?.trim() || 'Tray(AMR)',
    containerModelCode: settings.containerModelCode?.trim() || 'Pallet',
    containerCode: containerCode.trim(),
    position: positionHint.trim(),
    isDelete: true,
  }
}

function InMapChip({ value }: { value: unknown }) {
  const { label, code } = containerInMapFriendly(value)
  const chipCls = containerInMapChipClass(code)
  return (
    <span
      title={code != null ? `inMapStatus ${code}` : undefined}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${chipCls}`}
    >
      <span>{label}</span>
      {code != null ? (
        <span className="font-mono text-[11px] font-normal tabular-nums opacity-70">{code}</span>
      ) : null}
    </span>
  )
}

/** Fleet may expose persistence on container rows; missions created with “persistent container” also flag by code. */
/** Best-effort current map position from fleet container row (field names vary by fleet version). */
function primaryPositionFromContainerRow(row: ContainerRow): string {
  const keys = [
    'nodeCode',
    'node_code',
    'finalNodeCode',
    'final_node_code',
    'targetCellCodeForeign',
    'target_cell_code_foreign',
    'beginCellCodeForeign',
    'begin_cell_code_foreign',
    'nodeForeignCode',
    'node_foreign_code',
  ] as const
  for (const k of keys) {
    const v = row[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

function containerCodeFromRow(row: ContainerRow): string {
  return String(row.containerCode ?? row.container_code ?? '').trim()
}

function containerModelCodeFromRow(row: ContainerRow): string {
  return String(row.containerModelCode ?? row.container_model_code ?? '').trim()
}

function fleetReportsPersistent(row: ContainerRow): boolean {
  const keys = ['persistentContainer', 'persistent_container', 'isPersistent', 'persistContainer'] as const
  for (const k of keys) {
    const v = row[k]
    if (v === true || v === 1 || v === '1') return true
    if (typeof v === 'string' && ['true', 'yes'].includes(v.toLowerCase())) return true
  }
  return false
}

function containerIsPersistent(row: ContainerRow, persistentMissionCodes: Set<string>): boolean {
  if (fleetReportsPersistent(row)) return true
  const code = containerCodeFromRow(row)
  return code !== '' && persistentMissionCodes.has(code)
}

function PersistentChip() {
  return (
    <span
      title="Marked persistent (fleet or app mission)"
      className="inline-flex shrink-0 items-center rounded-full border border-violet-500/45 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-900 dark:text-violet-100"
    >
      Persistent
    </span>
  )
}

function ContainerCardChevron() {
  return (
    <svg
      className="h-5 w-5 shrink-0 text-foreground/25 transition group-hover:translate-x-0.5 group-hover:text-primary/70"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  )
}

function ContainerGridCard({
  row,
  onSelect,
  onMove,
  showPersistent,
}: {
  row: ContainerRow
  onSelect: () => void
  /** Opens move (containerIn with isNew: false) without opening detail first */
  onMove?: () => void
  showPersistent: boolean
}) {
  const code = containerCodeFromRow(row)
  const model = containerModelCodeFromRow(row)
  const node = primaryPositionFromContainerRow(row)

  return (
    <div className="group relative flex w-full flex-col overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-b from-card via-card to-muted/15 text-left shadow-sm ring-offset-background transition duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md">
      <span
        className="pointer-events-none absolute inset-y-3 left-0 w-1 rounded-r-full bg-gradient-to-b from-primary/70 via-primary/45 to-primary/15"
        aria-hidden
      />
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full flex-1 flex-col p-4 pl-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground/45">Container</p>
            <p className="mt-0.5 truncate font-mono text-base font-semibold tracking-tight text-foreground">
              {code || '—'}
            </p>
            {model ? (
              <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-foreground/65" title={model}>
                {model}
              </p>
            ) : node ? (
              <p className="mt-1.5 truncate font-mono text-xs text-foreground/60" title={node}>
                {node}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 pt-0.5">
            <ContainerCardChevron />
          </div>
        </div>

        <div className="mt-4 space-y-3 border-t border-border/50 pt-4">
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-foreground/40">Map status</p>
            <div className="flex flex-wrap items-center gap-2">
              <InMapChip value={row.inMapStatus} />
              {showPersistent ? <PersistentChip /> : null}
            </div>
          </div>
          {node ? (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground/40">Node</p>
              <p className="truncate font-mono text-xs text-foreground/85" title={node}>
                {node}
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-foreground/45">No node assigned</p>
          )}
        </div>
      </button>
      <div className="flex items-stretch border-t border-border/40 bg-muted/25">
        {onMove ? (
          <button
            type="button"
            className="min-h-[44px] flex-1 border-r border-border/40 px-3 text-xs font-medium text-primary hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onClick={onMove}
          >
            Move…
          </button>
        ) : null}
        <button
          type="button"
          className={`min-h-[44px] flex-1 px-3 text-xs font-medium text-foreground/55 transition hover:bg-muted/40 hover:text-foreground/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${onMove ? '' : 'w-full'}`}
          onClick={onSelect}
        >
          Details
        </button>
      </div>
    </div>
  )
}

function FieldRows({ rows }: { rows: { key: string; label: string; node: ReactNode }[] }) {
  return (
    <div className="divide-y divide-border/80">
      {rows.map(({ key, label, node }) => (
        <div
          key={key}
          className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
        >
          <dt className="shrink-0 text-[13px] text-foreground/55">{label}</dt>
          <dd className="min-w-0 text-right text-sm text-foreground sm:text-right">{node}</dd>
        </div>
      ))}
    </div>
  )
}

function renderContainerCell(key: string, raw: unknown): ReactNode {
  if (key === 'inMapStatus') {
    const { label, code } = containerInMapFriendly(raw)
    return (
      <span className="inline-flex flex-wrap items-center justify-end gap-2 tabular-nums">
        <span>{label}</span>
        {code != null ? (
          <span className="font-mono text-[13px] text-foreground/65">{code}</span>
        ) : null}
      </span>
    )
  }
  const plain = formatFieldPlain(key, raw)
  if (plain === '—') return <span className="text-foreground/45">—</span>
  const monoKeys = new Set(['nodeCode', 'containerCode', 'mapCode', 'districtCode', 'containerModelCode'])
  const className = [
    'break-all',
    monoKeys.has(key) ? 'font-mono text-[13px]' : '',
    NUMERIC_KEYS.has(key) ? 'tabular-nums' : '',
  ]
    .filter(Boolean)
    .join(' ')
  return <span className={className}>{plain}</span>
}

function ContainerDetailBody({ detail, showPersistent }: { detail: ContainerRow; showPersistent: boolean }) {
  const { sections, extraRows } = useMemo(() => {
    const seen = new Set<string>()
    seen.add('containerCode')
    if (detail.containerModelCode != null && String(detail.containerModelCode).trim() !== '') {
      seen.add('containerModelCode')
    }

    const sectionsOut = CONTAINER_DETAIL_SECTIONS.map(({ title, keys }) => {
      const rows = keys
        .filter(({ key }) => key in detail)
        .map(({ key, label }) => {
          seen.add(key)
          if (SUMMARY_ONLY_KEYS.has(key)) return null
          return {
            key,
            label,
            node: renderContainerCell(key, detail[key]),
          }
        })
        .filter((r): r is { key: string; label: string; node: ReactNode } => r !== null)
      return { title, rows }
    }).filter((s) => s.rows.length > 0)

    const extraKeys = Object.keys(detail)
      .filter((k) => !seen.has(k))
      .sort((a, b) => a.localeCompare(b))
    const extra = extraKeys.map((key) => ({
      key,
      label: humanizeKey(key),
      node: renderContainerCell(key, detail[key]),
    }))
    return { sections: sectionsOut, extraRows: extra }
  }, [detail])

  const titleCode = containerCodeFromRow(detail)
  const model = containerModelCodeFromRow(detail)

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-gradient-to-br from-muted/60 to-muted/20 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground/45">Fleet container</p>
        <p className="mt-1 font-mono text-xl font-semibold tracking-tight text-foreground">{titleCode || '—'}</p>
        {model ? <p className="mt-1 text-sm leading-snug text-foreground/75">{model}</p> : null}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <InMapChip value={detail.inMapStatus} />
          {showPersistent ? <PersistentChip /> : null}
        </div>
      </div>

      <div className="grid gap-4">
        {sections.map(({ title, rows }) => (
          <section key={title} className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
            <h3 className="mb-1 border-b border-border/70 pb-2 text-xs font-semibold uppercase tracking-wide text-foreground/55">
              {title}
            </h3>
            <FieldRows rows={rows} />
          </section>
        ))}
      </div>

      {extraRows.length > 0 ? (
        <section className="rounded-xl border border-dashed border-border bg-muted/15 px-4 py-3">
          <h3 className="mb-1 border-b border-border/70 pb-2 text-xs font-semibold uppercase tracking-wide text-foreground/50">
            Other fields
          </h3>
          <FieldRows rows={extraRows} />
        </section>
      ) : null}

      <details className="group rounded-lg border border-border/80 bg-muted/20">
        <summary className="cursor-pointer select-none px-3 py-2.5 text-sm font-medium text-foreground/70 hover:bg-muted/40">
          Raw JSON
          <span className="ml-2 text-xs font-normal text-foreground/45">(debug)</span>
        </summary>
        <pre className="max-h-[min(200px,22vh)] overflow-auto border-t border-border/60 bg-muted/30 p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
          {JSON.stringify(detail, null, 2)}
        </pre>
      </details>
    </div>
  )
}

function ContainerFleetFormModal({
  open,
  settings,
  onClose,
  onSubmit,
}: {
  open: boolean
  settings: AmrFleetSettings
  onClose: () => void
  onSubmit: (
    payload: {
      containerCode: string
      position: string
      containerModelCode: string
      enterOrientation: string
      isNew: boolean
    },
    options?: { openMissionAfter?: boolean }
  ) => Promise<void>
}) {
  const [containerCode, setContainerCode] = useState('')
  const [position, setPosition] = useState('')
  const [stands, setStands] = useState<AmrStandPickerRow[]>([])
  const [zoneCategories, setZoneCategories] = useState<ZoneCategory[]>([])
  const [standPickerOpen, setStandPickerOpen] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setErr(null)
    setStandPickerOpen(false)
    setContainerCode('')
    setPosition('')
    void getAmrStands().then((rows) =>
      setStands(
        rows.map((r) => ({
          id: String(r.id),
          external_ref: String(r.external_ref ?? ''),
          zone: r.zone != null ? String(r.zone) : '',
          location_label: String(r.location_label ?? ''),
          orientation: String(r.orientation ?? '0'),
          block_pickup: Number(r.block_pickup ?? 0),
          block_dropoff: Number(r.block_dropoff ?? 0),
        }))
      )
    )
    void getAmrSettings().then((s) => {
      setZoneCategories(Array.isArray(s.zoneCategories) ? s.zoneCategories : [])
    })
  }, [open])

  if (!open) return null

  const handleSubmit = async (mode: 'existing' | 'newMapOpen') => {
    const cc = containerCode.trim()
    const pos = position.trim()
    if (!cc) {
      setErr('Container code is required.')
      return
    }
    if (!pos) {
      setErr('Select a location (stand External Ref).')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      await onSubmit(
        {
          containerCode: cc,
          position: pos,
          containerModelCode: settings.containerModelCode?.trim() || 'Pallet',
          enterOrientation: enterOrientationForStandRef(stands, pos),
          isNew: mode !== 'existing',
        },
        { openMissionAfter: mode === 'newMapOpen' }
      )
      onClose()
    } catch (e) {
      setErr(apiErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg"
        role="dialog"
        aria-labelledby="amr-container-form-title"
        aria-modal="true"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id="amr-container-form-title" className="text-base font-semibold text-foreground">
            Add container (containerIn)
          </h2>
          <button type="button" className="shrink-0 rounded-lg px-2 py-1 text-sm hover:bg-background" onClick={onClose}>
            Cancel
          </button>
        </div>
        {err ? (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-red-600/45 bg-red-600/10 px-3 py-2 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-200"
          >
            {err}
          </div>
        ) : null}
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/70">Container code</label>
            <input
              type="text"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm"
              value={containerCode}
              onChange={(e) => setContainerCode(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/70">Location (External Ref)</label>
            <div className="flex min-w-0 items-center gap-2">
              <select
                className="min-h-[40px] min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
              >
                <option value="">Select stand…</option>
                {stands.map((s) => (
                  <option key={s.id} value={s.external_ref}>
                    {s.external_ref}
                    {s.zone ? ` (${s.zone})` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="flex h-10 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-foreground/80 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Choose location on map"
                title="Choose location"
                onClick={() => setStandPickerOpen(true)}
              >
                <LocationPinIcon className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-1 text-[11px] text-foreground/55">
              Same stands as New mission. Fleet container model comes from AMR settings; enter orientation is taken from
              the stand record for this location.
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            title="Fleet treats this container as already registered (containerIn with isNew: false)."
            className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-background disabled:opacity-50"
            onClick={() => void handleSubmit('existing')}
          >
            {busy ? 'Sending…' : 'Existing'}
          </button>
          <button
            type="button"
            disabled={busy}
            title="Register a new container on the map (isNew: true), then open the move mission wizard."
            className="rounded-lg border border-primary/45 bg-primary/10 px-4 py-2 text-sm font-medium text-foreground hover:bg-primary/15 disabled:opacity-50"
            onClick={() => void handleSubmit('newMapOpen')}
          >
            {busy ? 'Sending…' : 'Create and open'}
          </button>
          <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-background" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
      {standPickerOpen ? (
        <AmrStandPickerModal
          stands={stands}
          stackOrder="aboveDialogs"
          mode="any"
          zoneCategories={zoneCategories}
          onClose={() => setStandPickerOpen(false)}
          onSelect={(externalRef) => {
            setPosition(externalRef)
            setStandPickerOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}

export function AmrContainers() {
  const amrNewMissionModal = useAmrMissionNewModal()
  const canFleetMutate = useAuthStore(
    (s) => s.hasPermission('amr.missions.manage') || s.hasPermission('amr.tools.dev')
  )
  const canCreateMission = useAuthStore((s) => s.hasPermission('amr.missions.manage'))
  const { showAlert, showConfirm } = useAlertConfirm()

  const [rows, setRows] = useState<ContainerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [detail, setDetail] = useState<ContainerRow | null>(null)
  const [pollMs, setPollMs] = useState(5000)
  const [fleetSettings, setFleetSettings] = useState<AmrFleetSettings | null>(null)
  const [addContainerModalOpen, setAddContainerModalOpen] = useState(false)
  const [persistentMissionCodes, setPersistentMissionCodes] = useState<Set<string>>(new Set())

  useEffect(() => {
    void getAmrSettings().then((s) => {
      setPollMs(Math.max(3000, s.pollMsContainers))
      setFleetSettings(s)
    })
  }, [])

  const loadPersistentMissionCodes = useCallback(async () => {
    try {
      const records = await getAmrMissionRecords()
      const next = new Set<string>()
      for (const r of records) {
        if (Number(r.persistent_container) !== 1) continue
        const c = String(r.container_code ?? '').trim()
        if (c) next.add(c)
      }
      setPersistentMissionCodes(next)
    } catch {
      /* ignore — chips fall back to fleet-only flags */
    }
  }, [])

  const loadRows = useCallback(async (opts?: { showSpinner?: boolean }) => {
    const showSpinner = opts?.showSpinner === true
    if (showSpinner) setLoading(true)
    try {
      const data = await amrFleetProxy('containerQueryAll', {
        containerCode: '',
        nodeCode: '',
        inMapStatus: '1',
      })
      const body = data as { data?: ContainerRow[] }
      setRows(Array.isArray(body?.data) ? body.data : [])
      setErr('')
    } catch {
      setErr('Failed to load containers')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRows()
    void loadPersistentMissionCodes()
    const t = setInterval(() => {
      void loadRows()
      void loadPersistentMissionCodes()
    }, pollMs)
    return () => clearInterval(t)
  }, [pollMs, loadRows, loadPersistentMissionCodes])

  useEffect(() => {
    if (!detail) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetail(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [detail])

  const runContainerIn = async (fields: {
    containerCode: string
    position: string
    containerModelCode: string
    enterOrientation: string
    isNew: boolean
  }) => {
    if (!fleetSettings) throw new Error('Fleet settings not loaded yet.')
    const payload = buildContainerInPayload(fleetSettings, fields)
    const data = await amrFleetProxy('containerIn', payload)
    assertFleetAccepted(data, 'containerIn')
    await loadRows()
  }

  const removeContainer = async (row: ContainerRow) => {
    if (!fleetSettings) {
      showAlert('Fleet settings not loaded yet.')
      return
    }
    const code = containerCodeFromRow(row)
    if (!code) return
    const ok = await showConfirm(
      `Remove container "${code}" from the fleet map? This calls containerOut.`,
      {
        title: 'Remove container',
        confirmLabel: 'Remove',
        variant: 'danger',
      }
    )
    if (!ok) return
    try {
      const positionHint = primaryPositionFromContainerRow(row)
      const data = await amrFleetProxy(
        'containerOut',
        buildContainerOutPayload(fleetSettings, code, positionHint)
      )
      assertFleetAccepted(data, 'containerOut')
      showAlert('Container removed from map.')
      setDetail(null)
      await loadRows()
    } catch (e) {
      showAlert(apiErrorMessage(e))
    }
  }

  const settingsReady = fleetSettings !== null

  const goMissionMoveFromRow = (row: ContainerRow) => {
    const code = containerCodeFromRow(row)
    const from = primaryPositionFromContainerRow(row)
    const qs = new URLSearchParams()
    if (code) qs.set('container', code)
    if (from) qs.set('from', from)
    const search = qs.toString()
    const fullSearch = search ? `?${search}` : ''
    amrNewMissionModal?.openNewMission({ search: fullSearch || undefined })
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Containers</h1>
          <p className="mt-1 text-sm text-foreground/70">
            In-map containers via containerQueryAll (inMapStatus=1). Polls while this page is open.{' '}
            Move opens the RACK_MOVE mission wizard; Add uses
            fleet containerIn; Remove uses containerOut. Fleet mutations require permission.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="min-h-[44px] shrink-0 rounded-lg border border-border px-4 text-sm hover:bg-background"
            onClick={() => {
              void loadRows({ showSpinner: true })
              void loadPersistentMissionCodes()
            }}
          >
            Refresh
          </button>
          {canFleetMutate ? (
            <button
              type="button"
              className="min-h-[44px] shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              disabled={!settingsReady}
              onClick={() => setAddContainerModalOpen(true)}
            >
              Add container
            </button>
          ) : null}
        </div>
      </div>
      {loading ? (
        <p className="text-sm text-foreground/60">Loading…</p>
      ) : err ? (
        <p className="text-sm text-red-600">{err}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r, i) => (
            <ContainerGridCard
              key={`${containerCodeFromRow(r) || `row-${i}`}-${i}`}
              row={r}
              showPersistent={containerIsPersistent(r, persistentMissionCodes)}
              onSelect={() => setDetail(r)}
              onMove={canCreateMission ? () => goMissionMoveFromRow(r) : undefined}
            />
          ))}
        </div>
      )}

      {detail ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <h2 className="text-base font-semibold text-foreground">Container detail</h2>
              <div className="flex flex-wrap items-center gap-2">
                {canFleetMutate && settingsReady ? (
                  <>
                    {canCreateMission ? (
                      <button
                        type="button"
                        className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-background"
                        onClick={() => {
                          const row = { ...detail }
                          setDetail(null)
                          goMissionMoveFromRow(row)
                        }}
                      >
                        Move…
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="rounded-lg border border-red-600/40 px-3 py-1.5 text-sm text-red-700 hover:bg-red-500/10 dark:text-red-400"
                      onClick={() => void removeContainer(detail)}
                    >
                      Remove
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="shrink-0 rounded-lg px-2 py-1 text-sm hover:bg-background"
                  onClick={() => setDetail(null)}
                >
                  Close
                </button>
              </div>
            </div>
            <ContainerDetailBody
              detail={detail}
              showPersistent={containerIsPersistent(detail, persistentMissionCodes)}
            />
          </div>
        </div>
      ) : null}

      {fleetSettings && addContainerModalOpen ? (
        <ContainerFleetFormModal
          open
          settings={fleetSettings}
          onClose={() => setAddContainerModalOpen(false)}
          onSubmit={async (fields, opts) => {
            await runContainerIn(fields)
            if (opts?.openMissionAfter && canCreateMission) {
              const code = fields.containerCode.trim()
              const pos = fields.position.trim()
              amrNewMissionModal?.openNewMission({
                search: `?container=${encodeURIComponent(code)}&from=${encodeURIComponent(pos)}`,
              })
              showAlert('Container added — opening move mission…')
            } else if (fields.isNew) {
              showAlert('Container added to map.')
            } else {
              showAlert('Container updated on map.')
            }
          }}
        />
      ) : null}
    </div>
  )
}

export default AmrContainers
