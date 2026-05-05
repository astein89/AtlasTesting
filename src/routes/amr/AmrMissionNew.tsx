import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DraggableAttributes,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { v4 as uuidv4 } from 'uuid'
import {
  AMR_MULTISTOP_MISSION_PATH,
  type AmrFleetSettings,
  amrFleetProxy,
  createMultistopMission,
  getAmrSettings,
  getAmrStands,
} from '@/api/amr'
import { AmrMissionNewDebugModal } from '@/components/amr/AmrMissionNewDebugModal'
import { ToggleSwitch } from '@/components/ui/ToggleSwitch'
import { AmrRobotSelectModal, type AmrRobotPickRow } from '@/components/amr/AmrRobotSelectModal'
import {
  AmrStandPickerModal,
  enterOrientationForStandRef,
  LocationPinIcon,
  type AmrStandPickerRow,
} from '@/components/amr/AmrStandPickerModal'
import { amrPath } from '@/lib/appPaths'
import { getBasePath } from '@/lib/basePath'
import { useAuthStore } from '@/store/authStore'
import { previewRackMoveMissionCode } from '@/utils/amrDcaCode'
import { buildMultistopFleetTimeline, buildRackMoveFleetForwardPreview } from '@/utils/amrRackMoveFleetPreview'
import { isActiveRobotFleetStatus } from '@/utils/amrRobotStatus'

type Leg = {
  id: string
  position: string
  putDown: boolean
  /** After this stop (multi-stop only); ignored for final destination. */
  continueMode?: 'manual' | 'auto'
  autoContinueSeconds?: number
}

/** Fixed-position stand suggest list (escapes modal overflow clipping). */
type AmrStandSuggestPopoverLayout = {
  left: number
  width: number
  maxHeight: number
  placement: 'below' | 'above'
  top?: number
  bottom?: number
}

function newLeg(partial?: Partial<Omit<Leg, 'id'>>): Leg {
  return {
    id: uuidv4(),
    position: '',
    putDown: false,
    continueMode: 'manual',
    autoContinueSeconds: 0,
    ...partial,
  }
}

/** First stop is never a drop; last stop is always a drop. Intermediate rows keep user putDown. */
function normalizePutDown(prev: Leg[]): Leg[] {
  const n = prev.length
  if (n < 2) return prev
  let changed = false
  const next = prev.map((l, i) => {
    if (i === 0) {
      if (l.putDown === false) return l
      changed = true
      return { ...l, putDown: false }
    }
    if (i === n - 1) {
      if (l.putDown === true) return l
      changed = true
      return { ...l, putDown: true }
    }
    return l
  })
  return changed ? next : prev
}

type GripProps = {
  attributes: DraggableAttributes
  listeners: Record<string, unknown> | undefined
}

function SortableLegCard({
  id,
  disableDrag,
  children,
}: {
  id: string
  disableDrag: boolean
  children: (grip: GripProps) => ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: disableDrag,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`grid gap-3 rounded-lg border border-border/80 p-3 sm:grid-cols-2 lg:grid-cols-3 ${
        isDragging ? 'z-[5] scale-[1.01] opacity-95 shadow-lg ring-2 ring-ring' : ''
      }`}
    >
      {children({ attributes, listeners })}
    </div>
  )
}

function normalizeExternalRefFromStands(stands: AmrStandPickerRow[], raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  const exact = stands.find((s) => s.external_ref === t)
  if (exact) return exact.external_ref
  const ci = stands.find((s) => s.external_ref.trim().toLowerCase() === t.toLowerCase())
  return ci?.external_ref ?? t
}

function batteryPctFromFleet(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return null
  return Math.min(100, Math.max(0, Math.round(n)))
}

function fleetRobotQueryRows(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== 'object') return []
  const arr = (data as { data?: unknown }).data
  if (!Array.isArray(arr)) return []
  return arr.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x))
}

function filterStandsForSuggest(stands: AmrStandPickerRow[], query: string): AmrStandPickerRow[] {
  const sorted = [...stands].sort((a, b) => a.external_ref.localeCompare(b.external_ref))
  const t = query.trim().toLowerCase()
  if (!t) return sorted.slice(0, 80)
  return sorted.filter((s) => s.external_ref.toLowerCase().includes(t)).slice(0, 80)
}

export type AmrMissionNewFormProps = {
  variant?: 'page' | 'modal'
  /** When set (e.g. modal), overrides router location for `container` / `from` query params. */
  initialSearch?: string
  onRequestClose?: () => void
}

export function AmrMissionNewForm({
  variant = 'page',
  initialSearch,
  onRequestClose,
}: AmrMissionNewFormProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const effectiveSearch = initialSearch !== undefined ? initialSearch : location.search
  const canManage = useAuthStore((s) => s.hasPermission('amr.missions.manage'))
  const canAmrApiDebug = useAuthStore((s) => s.hasPermission('amr.tools.dev'))
  const [stands, setStands] = useState<AmrStandPickerRow[]>([])
  const [pickerLegIdx, setPickerLegIdx] = useState<number | null>(null)
  const [generatedMissionCode] = useState(() => previewRackMoveMissionCode())
  const [containerCode, setContainerCode] = useState('')
  const [persistent, setPersistent] = useState(false)
  const [legs, setLegs] = useState<Leg[]>(() => [
    newLeg({ putDown: false, continueMode: 'auto', autoContinueSeconds: 1 }),
    newLeg({ putDown: true }),
  ])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [rackMoveDebugLastErrorJson, setRackMoveDebugLastErrorJson] = useState<unknown>(null)
  const [rackMoveDebugFleetSettings, setRackMoveDebugFleetSettings] = useState<AmrFleetSettings | null>(null)
  const [robotFleetRows, setRobotFleetRows] = useState<Record<string, unknown>[]>([])
  const [robotFleetLoading, setRobotFleetLoading] = useState(false)
  const [robotFleetErr, setRobotFleetErr] = useState<string | null>(null)
  const [pollMsRobots, setPollMsRobots] = useState(5000)
  const [robotSelectOpen, setRobotSelectOpen] = useState(false)
  const [debugModalOpen, setDebugModalOpen] = useState(false)
  const [selectedRobotIds, setSelectedRobotIds] = useState<string[]>([])

  const containerInputRef = useRef<HTMLInputElement | null>(null)
  const legPositionInputRefs = useRef<(HTMLInputElement | null)[]>([])
  const createMissionButtonRef = useRef<HTMLButtonElement | null>(null)
  const suggestCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const robotFleetMountedRef = useRef(true)

  const [openSuggestLegIdx, setOpenSuggestLegIdx] = useState<number | null>(null)
  const [suggestLayout, setSuggestLayout] = useState<AmrStandSuggestPopoverLayout | null>(null)

  const suggestedStands = useMemo(() => {
    if (openSuggestLegIdx === null) return []
    const q = legs[openSuggestLegIdx]?.position ?? ''
    return filterStandsForSuggest(stands, q)
  }, [openSuggestLegIdx, legs, stands])

  useEffect(() => {
    return () => {
      if (suggestCloseTimerRef.current) clearTimeout(suggestCloseTimerRef.current)
    }
  }, [])

  const cancelSuggestClose = () => {
    if (suggestCloseTimerRef.current) {
      clearTimeout(suggestCloseTimerRef.current)
      suggestCloseTimerRef.current = null
    }
  }

  const scheduleSuggestClose = () => {
    cancelSuggestClose()
    suggestCloseTimerRef.current = setTimeout(() => setOpenSuggestLegIdx(null), 180)
  }

  useEffect(() => {
    void getAmrStands().then((rows) =>
      setStands(
        rows.map((r) => ({
          id: String(r.id),
          external_ref: String(r.external_ref ?? ''),
          zone: r.zone != null ? String(r.zone) : '',
          location_label: String(r.location_label ?? ''),
          orientation: String(r.orientation ?? '0'),
        }))
      )
    )
  }, [])

  useEffect(() => {
    robotFleetMountedRef.current = true
    return () => {
      robotFleetMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    void getAmrSettings().then((s) => setPollMsRobots(Math.max(3000, s.pollMsRobots)))
  }, [])

  const loadRobotFleet = useCallback(async (opts?: { showSpinner?: boolean }) => {
    const showSpinner = opts?.showSpinner === true
    if (showSpinner) setRobotFleetLoading(true)
    try {
      const data = await amrFleetProxy('robotQuery', { robotId: '', robotType: '' })
      if (!robotFleetMountedRef.current) return
      setRobotFleetRows(fleetRobotQueryRows(data))
      setRobotFleetErr(null)
    } catch {
      if (!robotFleetMountedRef.current) return
      setRobotFleetErr('Could not load fleet robots.')
      setRobotFleetRows([])
    } finally {
      if (robotFleetMountedRef.current && showSpinner) setRobotFleetLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!canManage || !robotSelectOpen) return
    void loadRobotFleet({ showSpinner: true })
  }, [canManage, robotSelectOpen, loadRobotFleet])

  useEffect(() => {
    if (!canManage || !robotSelectOpen) return
    const t = window.setInterval(() => void loadRobotFleet(), pollMsRobots)
    return () => window.clearInterval(t)
  }, [canManage, robotSelectOpen, pollMsRobots, loadRobotFleet])

  const activeRobotsForPicker = useMemo((): AmrRobotPickRow[] => {
    const out: AmrRobotPickRow[] = []
    for (const r of robotFleetRows) {
      const st = r.status
      if (!isActiveRobotFleetStatus(st)) continue
      const id = String(r.robotId ?? r.robot_id ?? '').trim()
      if (!id) continue
      out.push({
        id,
        robotType: String(r.robotType ?? r.robot_type ?? '').trim(),
        status: st,
        batteryPct: batteryPctFromFleet(r.batteryLevel ?? r.battery_level),
      })
    }
    out.sort((a, b) => a.id.localeCompare(b.id))
    return out
  }, [robotFleetRows])

  /** Deep-link from Containers → Move (`?container=` and optional `?from=` = current node / external ref for first stop). */
  const lockStartLocation = useMemo(() => {
    return new URLSearchParams(effectiveSearch).get('from')?.trim() ?? ''
  }, [effectiveSearch])

  useEffect(() => {
    const params = new URLSearchParams(effectiveSearch)
    const c = params.get('container')?.trim()
    const from = params.get('from')?.trim()
    if (c) setContainerCode(c)
    if (from) {
      setLegs((prev) => {
        if (!prev.length) return prev
        const next = [...prev]
        next[0] = { ...next[0], position: from }
        return normalizePutDown(next)
      })
    }
  }, [effectiveSearch])

  /** Keep first stop aligned with `from` while that query param is present (locked start). */
  useEffect(() => {
    if (!lockStartLocation) return
    setLegs((prev) => {
      if (!prev.length) return prev
      if (prev[0].position === lockStartLocation) return prev
      const next = [...prev]
      next[0] = { ...next[0], position: lockStartLocation }
      return normalizePutDown(next)
    })
  }, [lockStartLocation])

  const updateStandSuggestLayout = useCallback(() => {
    const idx = openSuggestLegIdx
    if (idx === null) {
      setSuggestLayout(null)
      return
    }
    if (lockStartLocation && idx === 0) {
      setSuggestLayout(null)
      return
    }
    const el = legPositionInputRefs.current[idx]
    if (!el) {
      setSuggestLayout(null)
      return
    }
    const rect = el.getBoundingClientRect()
    const margin = 4
    const maxListPx = 192
    const spaceBelow = window.innerHeight - rect.bottom - margin
    const spaceAbove = rect.top - margin
    const minSpace = 48
    const preferBelow = spaceBelow >= minSpace && spaceBelow >= spaceAbove
    if (preferBelow) {
      setSuggestLayout({
        placement: 'below',
        left: rect.left,
        top: rect.bottom + margin,
        width: Math.max(rect.width, 200),
        maxHeight: Math.min(maxListPx, Math.max(80, spaceBelow)),
      })
    } else {
      setSuggestLayout({
        placement: 'above',
        left: rect.left,
        bottom: window.innerHeight - rect.top + margin,
        width: Math.max(rect.width, 200),
        maxHeight: Math.min(maxListPx, Math.max(80, spaceAbove)),
      })
    }
  }, [openSuggestLegIdx, lockStartLocation])

  useLayoutEffect(() => {
    updateStandSuggestLayout()
  }, [updateStandSuggestLayout, suggestedStands.length, legs.length])

  useEffect(() => {
    if (openSuggestLegIdx === null) {
      setSuggestLayout(null)
      return
    }
    const onScrollOrResize = () => updateStandSuggestLayout()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [openSuggestLegIdx, updateStandSuggestLayout])

  const legsOrderKey = useMemo(() => legs.map((l) => l.id).join('|'), [legs])

  useEffect(() => {
    setLegs((prev) => normalizePutDown(prev))
  }, [legsOrderKey, legs.length])

  useEffect(() => {
    if (!canManage) return
    containerInputRef.current?.focus()
  }, [canManage])

  useEffect(() => {
    if (!canAmrApiDebug) return
    void getAmrSettings().then(setRackMoveDebugFleetSettings)
  }, [canAmrApiDebug])

  const buildMissionData = () => {
    return legs.map((leg, i) => ({
      sequence: i + 1,
      position: leg.position.trim(),
      type: 'NODE_POINT',
      passStrategy: 'AUTO' as const,
      waitingMillis: 0,
      putDown: leg.putDown,
    }))
  }

  const buildMultistopPayload = (): Record<string, unknown> => {
    const pickupPosition = legs[0]?.position.trim() ?? ''
    const enterOrientation = enterOrientationForStandRef(stands, pickupPosition)
    const destLegs = legs.slice(1)
    const pickupLeg = legs[0]
    const pickupContinue: Record<string, unknown> =
      pickupLeg?.continueMode === 'auto'
        ? {
            continueMode: 'auto',
            autoContinueSeconds: Math.max(
              1,
              Math.min(Math.floor(pickupLeg.autoContinueSeconds ?? 0), 86400)
            ),
          }
        : { continueMode: 'manual' }
    const destinations = destLegs.map((l, i) => {
      const isLast = i === destLegs.length - 1
      /** Row `legs[i+1]` matches this destination stop; release before the next segment uses that row. */
      const cm = legs[i + 1] ?? l
      const mode = isLast ? 'manual' : (cm.continueMode ?? 'manual')
      const base = {
        position: l.position.trim(),
        passStrategy: 'AUTO' as const,
        waitingMillis: 0,
        continueMode: mode,
      }
      if (mode === 'auto') {
        const sec = Math.max(1, Math.min(Math.floor(cm.autoContinueSeconds ?? 0), 86400))
        return { ...base, autoContinueSeconds: sec }
      }
      return base
    })
    const payload: Record<string, unknown> = {
      pickupPosition,
      pickupContinue,
      destinations,
      persistentContainer: persistent,
      enterOrientation,
    }
    if (containerCode.trim()) payload.containerCode = containerCode.trim()
    if (selectedRobotIds.length > 0) payload.robotIds = selectedRobotIds
    return payload
  }

  /** Two stops or more: DC creates a multistop session (containerIn then submitMission for segment 0). */
  const hasThreeOrMoreStops = legs.length > 2

  const rackMoveDebugRequest = useMemo(() => {
    const base = buildMultistopPayload()
    const p = legs[0]?.position.trim() ?? ''
    const d0 = legs[1]
    const md =
      p && d0?.position.trim()
        ? [
            {
              sequence: 1,
              position: p,
              type: 'NODE_POINT',
              passStrategy: 'AUTO',
              waitingMillis: 0,
              putDown: false,
            },
            {
              sequence: 2,
              position: d0.position.trim(),
              type: 'NODE_POINT',
              passStrategy: 'AUTO',
              waitingMillis: 0,
              putDown: d0.putDown,
            },
          ]
        : null
    return {
      ...base,
      _preview_note:
        'Server always calls containerIn first, then submitMission (segment 0). Further segments use Continue on Missions.',
      _preview_first_submitMission_missionData: md,
    }
  }, [generatedMissionCode, containerCode, persistent, legs, stands, selectedRobotIds])

  const rackMoveDebugRequestUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${getBasePath()}/api${AMR_MULTISTOP_MISSION_PATH}`
      : `${getBasePath()}/api${AMR_MULTISTOP_MISSION_PATH}`

  /** Two-node preview for rack-move; first segment for multistop (same shape). */
  const fleetPreviewInput = useMemo((): Record<string, unknown> => {
    const p = legs[0]?.position.trim() ?? ''
    const d0 = legs[1]
    if (!p || !d0?.position.trim()) return { missionData: [] }
    return {
      missionCode: generatedMissionCode,
      persistentContainer: persistent,
      enterOrientation: enterOrientationForStandRef(stands, p),
      containerCode: containerCode.trim() || undefined,
      robotIds: selectedRobotIds.length > 0 ? selectedRobotIds : undefined,
      missionData: [
        {
          sequence: 1,
          position: p,
          type: 'NODE_POINT',
          passStrategy: 'AUTO',
          waitingMillis: 0,
          putDown: false,
        },
        {
          sequence: 2,
          position: d0.position.trim(),
          type: 'NODE_POINT',
          passStrategy: 'AUTO',
          waitingMillis: 0,
          putDown: d0.putDown,
        },
      ],
      lockRobotAfterFinish: hasThreeOrMoreStops ? 'true' : 'false',
    }
  }, [
    legs,
    generatedMissionCode,
    persistent,
    stands,
    containerCode,
    selectedRobotIds,
    hasThreeOrMoreStops,
  ])

  const rackMoveFleetForwardPreview = useMemo(() => {
    if (!rackMoveDebugFleetSettings) return null
    return buildRackMoveFleetForwardPreview(rackMoveDebugFleetSettings, fleetPreviewInput)
  }, [rackMoveDebugFleetSettings, fleetPreviewInput])

  const multistopFleetTimeline = useMemo(() => {
    if (!rackMoveDebugFleetSettings) return null
    const pickupPosition = legs[0]?.position.trim() ?? ''
    const destinations = legs.slice(1).map((l) => ({
      position: l.position.trim(),
      passStrategy: 'AUTO' as const,
      waitingMillis: 0,
    }))
    return buildMultistopFleetTimeline(rackMoveDebugFleetSettings, {
      pickupPosition,
      destinations,
      persistent,
      robotIds: selectedRobotIds.length > 0 ? selectedRobotIds : undefined,
    })
  }, [rackMoveDebugFleetSettings, legs, persistent, selectedRobotIds])

  if (!canManage && variant === 'page') {
    return (
      <p className="text-sm text-foreground/70">
        You do not have permission to create missions.{' '}
        <Link className="text-primary underline" to={amrPath('missions')}>
          Back
        </Link>
      </p>
    )
  }

  const submit = async (openOverviewAfter = false) => {
    setError('')
    if (canAmrApiDebug) setRackMoveDebugLastErrorJson(null)
    const missionData = buildMissionData()
    for (const step of missionData) {
      if (!step.position) {
        setError('Each stop needs a location (External Ref).')
        return
      }
    }

    if (legs.length >= 2) {
      for (let idx = 0; idx < legs.length - 1; idx++) {
        const leg = legs[idx]
        if (leg.continueMode === 'auto' && (leg.autoContinueSeconds ?? 0) < 1) {
          setError(`Stop ${idx + 1}: Auto Release needs at least 1 second.`)
          return
        }
      }
    }

    setSaving(true)
    try {
      const data = (await createMultistopMission(buildMultistopPayload())) as {
        multistopSessionId?: unknown
      }
      const sid =
        typeof data.multistopSessionId === 'string' ? data.multistopSessionId.trim() : ''
      if (openOverviewAfter && sid) {
        navigate(
          `${amrPath('missions')}?${new URLSearchParams({ multistopSummary: sid }).toString()}`
        )
      } else {
        navigate(amrPath('missions'))
      }
      onRequestClose?.()
    } catch (e: unknown) {
      const ax = e as { response?: { data?: unknown } }
      if (canAmrApiDebug) setRackMoveDebugLastErrorJson(ax?.response?.data ?? { message: String(e) })
      setError(
        (ax?.response?.data as { error?: string } | undefined)?.error ?? 'Mission create failed'
      )
    } finally {
      setSaving(false)
    }
  }

  const updateLeg = (idx: number, patch: Partial<Leg>) => {
    setLegs((prev) => {
      if (idx === 0 && lockStartLocation && 'position' in patch) return prev
      const n = prev.length
      if ('putDown' in patch && n >= 2 && (idx === 0 || idx === n - 1)) return prev
      return normalizePutDown(prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
    })
  }

  /** Adds another stop; three or more stops use chained fleet missions and Continue on Missions. */
  const addLeg = () => {
    setLegs((prev) =>
      normalizePutDown([
        ...prev,
        newLeg({
          putDown: true,
        }),
      ])
    )
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleLegDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      setLegs((prev) => {
        const oldIndex = prev.findIndex((l) => l.id === active.id)
        const newIndex = prev.findIndex((l) => l.id === over.id)
        if (oldIndex < 0 || newIndex < 0) return prev
        if (lockStartLocation && (oldIndex === 0 || newIndex === 0)) return prev
        return normalizePutDown(arrayMove(prev, oldIndex, newIndex))
      })
    },
    [lockStartLocation]
  )

  const removeLeg = (idx: number) => {
    if (legs.length <= 2) return
    if (lockStartLocation && idx === 0) return
    setLegs((prev) => {
      if (prev.length <= 2) return prev
      if (lockStartLocation && idx === 0) return prev
      return normalizePutDown(prev.filter((_, i) => i !== idx))
    })
  }

  const focusFirstEditableLegInput = () => {
    for (let i = 0; i < legs.length; i++) {
      if (i === 0 && lockStartLocation) continue
      legPositionInputRefs.current[i]?.focus()
      return
    }
    createMissionButtonRef.current?.focus()
  }

  const focusNextLegPositionInput = (currentIdx: number) => {
    for (let i = currentIdx + 1; i < legs.length; i++) {
      if (i === 0 && lockStartLocation) continue
      legPositionInputRefs.current[i]?.focus()
      return
    }
    createMissionButtonRef.current?.focus()
  }

  const missionActionRow = (
    <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {(variant === 'modal' || canAmrApiDebug) && (
          <button
            type="button"
            className="inline-flex min-h-[44px] items-center rounded-lg border border-dashed border-amber-500/45 bg-amber-500/[0.06] px-4 text-sm text-foreground/90 hover:bg-amber-500/10 dark:border-amber-500/35 dark:bg-amber-500/[0.08]"
            onClick={() => setDebugModalOpen(true)}
          >
            Debug…
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {variant === 'modal' ? (
          <button
            type="button"
            className="inline-flex min-h-[44px] items-center rounded-lg border border-border px-4 text-sm hover:bg-background"
            onClick={() => {
              navigate(amrPath('missions'))
              onRequestClose?.()
            }}
          >
            Cancel
          </button>
        ) : (
          <Link
            to={amrPath('missions')}
            className="inline-flex min-h-[44px] items-center rounded-lg border border-border px-4 text-sm"
          >
            Cancel
          </Link>
        )}
        {variant === 'modal' ? (
          <button
            type="button"
            disabled={saving || !canManage}
            className="inline-flex min-h-[44px] items-center rounded-lg border border-border px-4 text-sm hover:bg-background disabled:opacity-50"
            onClick={() => void submit(true)}
          >
            {saving ? 'Submitting…' : 'Create and show'}
          </button>
        ) : null}
        <button
          ref={createMissionButtonRef}
          type="button"
          disabled={saving || !canManage}
          className="min-h-[44px] rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          onClick={() => void submit()}
        >
          {saving ? 'Submitting…' : 'Create mission'}
        </button>
      </div>
    </div>
  )

  const missionFields = (
    <>
      <div className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div>
          <span className="text-sm text-foreground/80">Mission code</span>
          <p className="mt-1 break-all font-mono text-base font-semibold tracking-tight text-foreground">
            {generatedMissionCode}
          </p>
        </div>
        <label className="block text-sm">
          <span className="text-foreground/80">Container code (optional)</span>
          <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
            <input
              ref={containerInputRef}
              autoComplete="off"
              enterKeyHint="next"
              className="w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-base sm:flex-1 md:text-sm"
              value={containerCode}
              onChange={(e) => setContainerCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                focusFirstEditableLegInput()
              }}
              placeholder="Auto-generated if empty"
            />
            <div className="flex shrink-0 items-center gap-3">
              <ToggleSwitch
                checked={persistent}
                onCheckedChange={setPersistent}
                aria-label={persistent ? 'Keep Container' : 'Remove Container'}
                size="sm"
                className="shrink-0"
              />
              <span className="min-w-0 text-sm">
                {persistent ? 'Keep Container' : 'Remove Container'}
              </span>
            </div>
          </div>
        </label>
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="min-w-0 text-sm font-medium">Mission stops</h2>
          <button
            type="button"
            className="shrink-0 text-sm text-primary hover:underline"
            onClick={addLeg}
          >
            Add Stop
          </button>
        </div>
        <p className="text-xs text-foreground/60">
          Drag the grip beside each stop to reorder. When opened from a container deep link, the first stop stays fixed.
        </p>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleLegDragEnd}>
          <SortableContext items={legs.map((l) => l.id)} strategy={verticalListSortingStrategy}>
            {legs.map((leg, idx) => {
              const startLocked = idx === 0 && Boolean(lockStartLocation)
              const dragLocked = Boolean(lockStartLocation && idx === 0)
              const canRemove = legs.length > 2 && !(lockStartLocation && idx === 0)
              const putDownOn =
                idx === 0 ? false : idx === legs.length - 1 ? true : leg.putDown
              const putLocked = idx === 0 || idx === legs.length - 1
              return (
                <SortableLegCard key={leg.id} id={leg.id} disableDrag={dragLocked}>
                  {(grip) => (
                    <>
            <div className="col-span-full flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={`flex h-10 w-10 shrink-0 touch-none items-center justify-center rounded-lg border border-border bg-muted/40 text-foreground/55 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  dragLocked ? 'cursor-not-allowed opacity-40' : 'cursor-grab active:cursor-grabbing'
                }`}
                aria-label={dragLocked ? 'First stop order is fixed' : 'Drag to reorder'}
                title={dragLocked ? 'First stop is fixed for this move' : 'Drag to reorder'}
                disabled={dragLocked}
                {...(dragLocked ? {} : { ...grip.attributes, ...grip.listeners })}
              >
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <circle cx="9" cy="8" r="1.5" />
                  <circle cx="15" cy="8" r="1.5" />
                  <circle cx="9" cy="12" r="1.5" />
                  <circle cx="15" cy="12" r="1.5" />
                  <circle cx="9" cy="16" r="1.5" />
                  <circle cx="15" cy="16" r="1.5" />
                </svg>
              </button>
              <span className="min-w-0 flex-1 text-xs font-medium text-foreground/65">
                Stop {idx + 1}
                {idx === legs.length - 1 ? (
                  <span className="ml-1.5 font-normal text-foreground/45">· last</span>
                ) : null}
              </span>
              <button
                type="button"
                disabled={!canRemove}
                title={
                  !canRemove
                    ? lockStartLocation && idx === 0
                      ? 'Cannot remove locked first stop'
                      : 'At least two stops required'
                    : 'Remove this stop'
                }
                className="shrink-0 rounded-md border border-red-500/30 bg-background px-2 py-1 text-xs text-red-600 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400"
                onClick={() => removeLeg(idx)}
              >
                Remove
              </button>
            </div>
            <div className="col-span-full min-w-0">
              <label
                htmlFor={`amr-mission-leg-pos-${idx}`}
                className="block text-sm text-foreground/80"
              >
                Location (External Ref)
                {startLocked ? (
                  <span className="ml-1.5 font-normal text-foreground/50">· locked (container position)</span>
                ) : null}
              </label>
              <div className="mt-1 grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-x-4 lg:gap-y-2">
                <div className="flex min-h-[40px] min-w-0 w-full items-stretch gap-2 lg:col-start-1 lg:row-start-1">
                  <div className="relative min-w-0 flex-1">
                    <input
                      ref={(el) => {
                        legPositionInputRefs.current[idx] = el
                      }}
                      id={`amr-mission-leg-pos-${idx}`}
                      autoComplete="off"
                      enterKeyHint={idx < legs.length - 1 ? 'next' : 'done'}
                      disabled={startLocked}
                      title={startLocked ? undefined : 'Scan or pick a stand External Ref (keyboard / barcode)'}
                      className={`min-h-[40px] w-full rounded-lg border border-border bg-background py-2 pl-3 font-mono text-base md:text-sm disabled:cursor-not-allowed disabled:opacity-70 ${!startLocked && leg.position.trim() ? 'pr-10' : 'pr-3'}`}
                      value={leg.position}
                      onChange={(e) => updateLeg(idx, { position: e.target.value })}
                      onFocus={() => {
                        if (startLocked) return
                        cancelSuggestClose()
                        setOpenSuggestLegIdx(idx)
                      }}
                      onBlur={() => {
                        if (startLocked) return
                        const n = normalizeExternalRefFromStands(stands, leg.position)
                        if (n !== leg.position) updateLeg(idx, { position: n })
                        scheduleSuggestClose()
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setOpenSuggestLegIdx(null)
                          return
                        }
                        if (e.key !== 'Enter') return
                        e.preventDefault()
                        setOpenSuggestLegIdx(null)
                        focusNextLegPositionInput(idx)
                      }}
                      placeholder={startLocked ? '' : 'Scan or type External Ref…'}
                    />
                    {!startLocked && leg.position.trim() ? (
                      <button
                        type="button"
                        tabIndex={-1}
                        className="absolute right-1.5 top-1/2 z-[15] flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-foreground/55 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label="Clear location"
                        title="Clear"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          updateLeg(idx, { position: '' })
                          setOpenSuggestLegIdx(null)
                        }}
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={startLocked}
                    className="flex h-10 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-foreground/80 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={`Choose location on map for stop ${idx + 1}`}
                    title={startLocked ? 'Start location is fixed for this container move' : 'Choose location'}
                    onClick={() => {
                      setOpenSuggestLegIdx(null)
                      setPickerLegIdx(idx)
                    }}
                  >
                    <LocationPinIcon className="h-5 w-5" />
                  </button>
                </div>
                <div className="flex flex-col gap-2 lg:col-start-2 lg:row-start-1 lg:max-w-[min(100%,20rem)] lg:shrink-0">
                  <div
                    className={`flex items-center gap-3 ${
                      putLocked ? 'text-foreground/70' : ''
                    }`}
                  >
                    <ToggleSwitch
                      checked={putDownOn}
                      disabled={putLocked}
                      onCheckedChange={(on) => updateLeg(idx, { putDown: on })}
                      aria-label={putDownOn ? 'Drop Pallet' : 'Pickup Pallet'}
                      title={
                        putLocked
                          ? idx === 0
                            ? 'First stop is always pickup'
                            : 'Final stop is always drop'
                          : undefined
                      }
                      size="sm"
                      className="shrink-0"
                    />
                    <span className="min-w-0 flex-1 text-sm">
                      {putDownOn ? 'Drop Pallet' : 'Pickup Pallet'}
                    </span>
                  </div>
                  {idx < legs.length - 1 ? (
                    <div className="flex items-center gap-3">
                      <ToggleSwitch
                        checked={leg.continueMode === 'auto'}
                        onCheckedChange={(on) =>
                          updateLeg(idx, {
                            continueMode: on ? 'auto' : 'manual',
                            autoContinueSeconds: leg.autoContinueSeconds ?? 0,
                          })
                        }
                        aria-label={
                          leg.continueMode === 'auto' ? 'Auto Release' : 'Manual Release'
                        }
                        size="sm"
                        className="shrink-0"
                      />
                      <span className="min-w-0 flex-1 text-sm">
                        {leg.continueMode === 'auto' ? 'Auto Release' : 'Manual Release'}
                      </span>
                    </div>
                  ) : null}
                </div>
                {idx < legs.length - 1 && leg.continueMode === 'auto' ? (
                  <label
                    htmlFor={`amr-mission-leg-continue-secs-${idx}`}
                    className="flex flex-wrap items-center gap-2 pl-1 text-sm text-foreground/85 lg:col-start-2 lg:row-start-2 lg:max-w-[min(100%,20rem)]"
                  >
                    <span className="text-foreground/70">After</span>
                    <input
                      id={`amr-mission-leg-continue-secs-${idx}`}
                      type="number"
                      min={0}
                      max={86400}
                      inputMode="numeric"
                      className="w-[5.5rem] rounded-md border border-border bg-background px-2 py-1 font-mono text-sm"
                      value={leg.autoContinueSeconds ?? 0}
                      onChange={(e) => {
                        const n = Number(e.target.value)
                        updateLeg(idx, {
                          continueMode: 'auto',
                          autoContinueSeconds: Number.isFinite(n) ? n : 0,
                        })
                      }}
                    />
                    <span>s</span>
                  </label>
                ) : null}
              </div>
            </div>
                    </>
                  )}
                </SortableLegCard>
              );
            })}
          </SortableContext>
        </DndContext>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="space-y-3">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h2 className="text-sm font-medium">Robots</h2>
            <p className="text-xs text-foreground/60">
              {selectedRobotIds.length > 0
                ? `${selectedRobotIds.length} robot(s) included on submitMission.`
                : 'Optional — AMR settings defaults apply when none selected.'}
            </p>
          </div>
          <button
            type="button"
            className="min-h-[44px] w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90"
            onClick={() => setRobotSelectOpen(true)}
          >
            Select robots…
          </button>
        </div>
      </div>

      {openSuggestLegIdx !== null &&
      suggestLayout &&
      !(lockStartLocation && openSuggestLegIdx === 0) &&
      (suggestedStands.length > 0 || stands.length > 0)
        ? createPortal(
            suggestedStands.length > 0 ? (
              <ul
                style={{
                  position: 'fixed',
                  left: suggestLayout.left,
                  width: suggestLayout.width,
                  maxHeight: suggestLayout.maxHeight,
                  zIndex: 100,
                  ...(suggestLayout.placement === 'below'
                    ? { top: suggestLayout.top }
                    : { bottom: suggestLayout.bottom }),
                }}
                className="overflow-y-auto rounded-lg border border-border bg-card py-1 text-card-foreground shadow-lg"
                role="listbox"
              >
                {suggestedStands.map((s) => (
                  <li key={s.id} role="option">
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left font-mono text-sm font-medium hover:bg-muted"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        const i = openSuggestLegIdx
                        if (i === null) return
                        updateLeg(i, { position: s.external_ref })
                        setOpenSuggestLegIdx(null)
                      }}
                    >
                      {s.external_ref}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div
                style={{
                  position: 'fixed',
                  left: suggestLayout.left,
                  width: suggestLayout.width,
                  zIndex: 100,
                  ...(suggestLayout.placement === 'below'
                    ? { top: suggestLayout.top }
                    : { bottom: suggestLayout.bottom }),
                }}
                className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground/70 shadow-lg"
              >
                No matching stands
              </div>
            ),
            document.body
          )
        : null}
    </>
  )

  return (
    <>
      {variant === 'modal' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto space-y-6">
            {!canManage ? (
              <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground/80">
                You do not have permission to create missions. Use Cancel to return to Missions or close this dialog.
              </p>
            ) : null}
            {canManage ? missionFields : null}
            {canManage && error ? <p className="text-sm text-red-600">{error}</p> : null}
          </div>
          <div className="shrink-0 border-t border-border bg-card pt-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] -mx-4 px-4 sm:-mx-5 sm:px-5">
            {missionActionRow}
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-3xl space-y-6 pb-24">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">New Mission</h1>
            <p className="mt-1 text-sm text-foreground/70">
              Create uses <span className="font-medium text-foreground">containerIn</span> then{' '}
              <span className="font-medium text-foreground">submitMission</span> for the first stop (same order for two or
              more stops). Positions must match fleet external codes (stands). Use{' '}
              <span className="font-medium text-foreground">Add Stop</span> for extra destinations; then{' '}
              <span className="font-medium text-foreground">Continue</span> on Missions for each following stop.
            </p>
          </div>
          {missionFields}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {missionActionRow}
        </div>
      )}

      {(variant === 'modal' || canAmrApiDebug) && (
        <AmrMissionNewDebugModal
          open={debugModalOpen}
          onClose={() => setDebugModalOpen(false)}
          showDevPayloads={canAmrApiDebug}
          rackMoveDebugRequestUrl={rackMoveDebugRequestUrl}
          rackMoveDebugRequest={rackMoveDebugRequest}
          usesMultistop={true}
          rackMoveDebugFleetSettings={rackMoveDebugFleetSettings}
          rackMoveFleetForwardPreview={rackMoveFleetForwardPreview}
          multistopFleetTimeline={multistopFleetTimeline}
          rackMoveDebugLastErrorJson={rackMoveDebugLastErrorJson}
        />
      )}

      {pickerLegIdx !== null && !(pickerLegIdx === 0 && lockStartLocation) ? (
        <AmrStandPickerModal
          stackOrder={variant === 'modal' ? 'aboveDialogs' : 'base'}
          stands={stands}
          onClose={() => setPickerLegIdx(null)}
          onSelect={(externalRef) => {
            const idx = pickerLegIdx
            if (idx === null) return
            updateLeg(idx, { position: externalRef })
            setPickerLegIdx(null)
            queueMicrotask(() => focusNextLegPositionInput(idx))
          }}
        />
      ) : null}

      <AmrRobotSelectModal
        open={robotSelectOpen}
        onClose={() => setRobotSelectOpen(false)}
        rows={activeRobotsForPicker}
        selectedIds={selectedRobotIds}
        onConfirm={(ids) => setSelectedRobotIds(ids)}
        loading={robotFleetLoading}
        error={robotFleetErr}
        onRefresh={() => void loadRobotFleet({ showSpinner: true })}
      />
    </>
  )
}

/** Full-page route — prefer opening {@link AmrMissionNewForm} in the modal from layout. */
export function AmrMissionNew() {
  return <AmrMissionNewForm variant="page" />
}

export default AmrMissionNew
