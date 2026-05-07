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
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  Fragment,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { v4 as uuidv4 } from 'uuid'
import {
  AMR_MULTISTOP_MISSION_PATH,
  type AmrFleetSettings,
  type AmrMissionTemplateListItem,
  type AmrRobotLockRow,
  type ZoneCategory,
  amrFleetProxy,
  continueAmrMultistopSession,
  createAmrMissionTemplate,
  createMultistopMission,
  getAmrStandGroups,
  type AmrStandGroupRow,
  getAmrMissionTemplate,
  getAmrSettings,
  getAmrMissionReplayPayload,
  getAmrStands,
  listAmrMissionTemplates,
  listAmrRobotLocks,
  postStandPresence,
  updateAmrMissionTemplate,
  type AmrMissionReplayPayload,
} from '@/api/amr'
import { getApiErrorMessage } from '@/api/client'
import {
  AmrDestinationOccupiedConfirmBody,
  AmrDestinationOccupiedConfirmFooterRetry,
} from '@/components/amr/AmrDestinationOccupiedConfirmBody'
import {
  AmrPickupAbsentConfirmBody,
  AmrPickupAbsentConfirmFooterRetry,
} from '@/components/amr/AmrPickupAbsentConfirmBody'
import { AmrMissionNewDebugModal } from '@/components/amr/AmrMissionNewDebugModal'
import { ToggleSwitch } from '@/components/ui/ToggleSwitch'
import { AmrRobotSelectModal, type AmrRobotPickRow } from '@/components/amr/AmrRobotSelectModal'
import {
  AmrStandPickerModal,
  enterOrientationForStandRef,
  LocationPinIcon,
  type AmrStandPickerRow,
} from '@/components/amr/AmrStandPickerModal'
import { PalletPresenceGlyph, palletPresenceKindFromState } from '@/components/amr/PalletPresenceGlyph'
import { useAlertConfirm } from '@/contexts/AlertConfirmContext'
import { useToast } from '@/contexts/ToastContext'
import { amrPath } from '@/lib/appPaths'
import { getBasePath } from '@/lib/basePath'
import { useAuthStore } from '@/store/authStore'
import { missionFormToTemplatePayload, type AmrMissionTemplatePayloadV1 } from '@/utils/amrMissionTemplate'
import { previewRackMoveMissionCode } from '@/utils/amrDcaCode'
import {
  shouldWarnFirstSegmentDropOccupied,
  shouldWarnFirstStopPickupAbsent,
} from '@/utils/amrPalletPresenceSanity'
import {
  AMR_STAND_LOCATION_TYPE_NON_STAND,
  normalizeAmrStandLocationType,
  standRefsNonStandWaypoint,
  standRefsSkippingHyperionOccupancy,
} from '@/utils/amrStandLocationType'
import { buildMultistopFleetTimeline, buildRackMoveFleetForwardPreview } from '@/utils/amrRackMoveFleetPreview'
import { isActiveRobotFleetStatus } from '@/utils/amrRobotStatus'

type Leg = {
  id: string
  position: string
  /** Stop 2+ only: lazy-resolve pool; when set, `position` may be empty until dispatch. */
  groupId?: string
  /**
   * Fleet `putDown` when the AMR **arrives** at this stand within its sub-mission (segment end at this stop).
   * **Lower** forks (`true`) vs **lift** forks (`false`). Unused on the first stop; locked lower on the final stop.
   */
  putDown: boolean
  /**
   * Fleet `putDown` at the **start of the next sub-mission**, where this same stand is NODE 1.
   * Surfaced in the UI as the **next** stop's "Depart from <this>" inset card. **Lower** (`true`) vs **lift** (`false`).
   * Stored on the from-leg for serialization but semantically owned by the next sub-mission.
   * Ignored on the last stop (no outgoing segment).
   */
  segmentStartPutDown?: boolean
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

/** Banner copy shown both client-side (preflight) and on server `NO_UNLOCKED_ROBOTS` (HTTP 409). */
const NO_UNLOCKED_ROBOTS_MESSAGE =
  'All active robots are locked. Unlock at least one on the Robots page before creating a mission.'

function newLeg(partial?: Partial<Omit<Leg, 'id'>>): Leg {
  return {
    id: uuidv4(),
    position: '',
    /** Default Lower on arrival for stops 2+; first stop is forced to Lift via {@link normalizePutDown}. */
    putDown: true,
    /** Default Lift at segment start (Depart on stop 3+); first-stop pickup uses the same field for outbound NODE 1. */
    segmentStartPutDown: false,
    continueMode: 'manual',
    autoContinueSeconds: 0,
    ...partial,
  }
}

/** First stop never lowers on arrival; last stop always lowers on arrival. Clear segment-start flags on final stop. */
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
      let row = l
      if (l.putDown !== true) {
        changed = true
        row = { ...row, putDown: true }
      }
      if (row.segmentStartPutDown) {
        changed = true
        row = { ...row, segmentStartPutDown: false }
      }
      return row
    }
    return l
  })
  return changed ? next : prev
}

function finalizeMissionLegUi(legs: Leg[], _standRows: AmrStandPickerRow[]): Leg[] {
  return normalizePutDown(legs)
}

/**
 * Indices `i` where fork state at segment start (`legs[i].segmentStartPutDown`) vs arrival at `legs[i + 1]`
 * looks unintentional: **Lift depart → Lower arrive** matches normal pallet flow and is ignored.
 * We only flag **Lower depart → Lift arrive**. Boundary before the final stop is skipped (last arrival is forced Lower).
 */
function liftSegmentMismatchBoundaryIndices(legs: Leg[]): number[] {
  const n = legs.length
  const out: number[] = []
  if (n < 3) return out
  for (let i = 0; i < n - 1; i++) {
    if (i === n - 2) continue
    const departLower = legs[i].segmentStartPutDown === true
    const arriveLower = legs[i + 1].putDown === true
    if (departLower && !arriveLower) out.push(i)
  }
  return out
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
      className={`flex w-full min-w-0 flex-col gap-3 rounded-lg border border-border/80 p-3 sm:p-4 ${
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

function legRestrictionStatus(
  stands: AmrStandPickerRow[],
  position: string,
  putDownOn: boolean
): { violated: boolean; message: string } {
  const t = position.trim()
  if (!t) return { violated: false, message: '' }
  const m =
    stands.find((s) => s.external_ref === t) ??
    stands.find((s) => s.external_ref.trim().toLowerCase() === t.toLowerCase())
  if (!m) return { violated: false, message: '' }
  if (!putDownOn && Number(m.block_pickup ?? 0) > 0) {
    return { violated: true, message: 'This location does not allow pallet pickup (no lift).' }
  }
  if (putDownOn && Number(m.block_dropoff ?? 0) > 0) {
    return { violated: true, message: 'This location does not allow pallet dropoff (no lower).' }
  }
  return { violated: false, message: '' }
}

type MissionFormFieldError =
  | { kind: 'location'; legIndices: number[] }
  | { kind: 'autoSeconds'; legIndex: number }

function validateNewMissionForm(legs: Leg[]): { ok: true } | { ok: false; message: string; fieldError: MissionFormFieldError } {
  if (legs[0]?.groupId?.trim()) {
    return {
      ok: false,
      message: 'Stop 1 (pickup) must be a single stand — stand groups apply from stop 2 onward.',
      fieldError: { kind: 'location', legIndices: [0] },
    }
  }
  const missingLoc: number[] = []
  for (let i = 0; i < legs.length; i++) {
    const gid = legs[i].groupId?.trim()
    if (!legs[i].position.trim() && !gid) missingLoc.push(i)
  }
  if (missingLoc.length > 0) {
    const stops = missingLoc.map((i) => i + 1).join(', ')
    return {
      ok: false,
      message:
        missingLoc.length === 1
          ? `Stop ${missingLoc[0] + 1} needs a location (External Ref).`
          : `Every stop needs a location (External Ref). Missing: stops ${stops}.`,
      fieldError: { kind: 'location', legIndices: missingLoc },
    }
  }
  if (legs.length >= 2) {
    for (let idx = 0; idx < legs.length - 1; idx++) {
      const leg = legs[idx]
      if (leg.continueMode === 'auto') {
        const s = leg.autoContinueSeconds ?? 0
        if (!Number.isFinite(s) || s < 0 || s > 86400) {
          return {
            ok: false,
            message: `Stop ${idx + 1}: Auto Release needs 0–86400 seconds.`,
            fieldError: { kind: 'autoSeconds', legIndex: idx },
          }
        }
      }
    }
  }
  return { ok: true }
}

/** Containers → Move sends `?container=` + `?from=`; server maps this to fleet `containerIn` with `isNew: false` when the submitted code still matches. */
function shouldSendFleetContainerAlreadyRegistered(
  searchRaw: string,
  containerCodeTrimmed: string
): boolean {
  const cc = containerCodeTrimmed.trim()
  const t = searchRaw.trim()
  if (!cc || !t) return false
  const q = t.startsWith('?') ? t.slice(1) : t
  const params = new URLSearchParams(q)
  const qc = params.get('container')?.trim()
  const qFrom = params.get('from')?.trim()
  if (!qc || !qFrom) return false
  return qc === cc
}

export type AmrMissionNewFormHandle = {
  /** Opens the save-as-template name dialog (same as header / Templates card). */
  openSaveTemplate: () => void
  /** Opens the fleet / submitMission debug dialog (`amr.tools.dev`). */
  openDebug: () => void
  /** Re-fetch pallet presence for stands currently entered on the route (no-op if none). */
  refreshStands: () => void
}

export type AmrMissionNewFormProps = {
  variant?: 'page' | 'modal' | 'templateEditor'
  /** When set (e.g. modal), overrides router location for `container` / `from` query params. */
  initialSearch?: string
  onRequestClose?: () => void
  /** Modal shell: sync validation/API errors to a banner above the form body. */
  onMissionErrorChange?: (message: string) => void
  /** Increment (e.g. after banner dismiss) to clear mission error + field highlights in the form. */
  clearMissionErrorsNonce?: number
  /** Modal shell only: drive header “Refresh stands” disabled / loading from stand presence state. */
  onMissionStandsRefreshState?: (s: { canRefresh: boolean; loading: boolean }) => void
  /** `templateEditor` only: edit existing template id, or omit/null for create. */
  templateEditorId?: string | null
  /** `templateEditor` only: after successful create/update. */
  onTemplateEditorSaved?: () => void
  /** `templateEditor` only (editing): open delete confirmation (handled by parent modal). */
  onRequestDeleteTemplate?: () => void
  /** Disables the delete control while deletion is in progress. */
  deleteTemplateBusy?: boolean
}

export function MissionErrorBanner({
  message,
  onDismiss,
  flush,
}: {
  message: string
  onDismiss: () => void
  /** Full-width strip under a modal title (no rounded card). */
  flush?: boolean
}) {
  const t = message.trim()
  if (!t) return null
  return (
    <div
      role="alert"
      className={
        flush
          ? 'flex items-start justify-between gap-3 border-b border-red-500/35 bg-red-500/10 px-4 py-2.5 text-sm dark:bg-red-500/15 sm:px-5'
          : 'flex items-start justify-between gap-3 rounded-lg border border-red-500/40 bg-red-500/[0.09] px-3 py-2.5 text-sm shadow-sm dark:bg-red-500/15'
      }
    >
      <p className="min-w-0 flex-1 leading-snug text-red-950 dark:text-red-50">{t}</p>
      <button
        type="button"
        className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-red-900/85 hover:bg-red-500/15 dark:text-red-100"
        onClick={onDismiss}
      >
        Dismiss
      </button>
    </div>
  )
}

export const AmrMissionNewForm = forwardRef<AmrMissionNewFormHandle, AmrMissionNewFormProps>(
  function AmrMissionNewForm(
    {
      variant = 'page',
      initialSearch,
      onRequestClose,
      onMissionErrorChange,
      clearMissionErrorsNonce,
      onMissionStandsRefreshState,
      templateEditorId = null,
      onTemplateEditorSaved,
      onRequestDeleteTemplate,
      deleteTemplateBusy = false,
    },
    ref
  ) {
  const navigate = useNavigate()
  const location = useLocation()
  const effectiveSearch = initialSearch !== undefined ? initialSearch : location.search
  const canManage = useAuthStore((s) => s.hasPermission('amr.missions.manage'))
  const canAmrModule = useAuthStore((s) => s.hasPermission('module.amr'))
  const canAmrApiDebug = useAuthStore((s) => s.hasPermission('amr.tools.dev'))
  const canOverrideSpecial = useAuthStore((s) => s.hasPermission('amr.stands.override-special'))
  const canForceRelease = useAuthStore((s) => s.hasPermission('amr.missions.force_release'))
  const { showConfirm, showAlert } = useAlertConfirm()
  const { pushToast } = useToast()
  const [stands, setStands] = useState<AmrStandPickerRow[]>([])
  const [standGroups, setStandGroups] = useState<AmrStandGroupRow[]>([])
  const [zoneCategories, setZoneCategories] = useState<ZoneCategory[]>([])
  const nonStandRefs = useMemo(() => standRefsNonStandWaypoint(stands), [stands])
  const occupancySkipRefs = useMemo(() => standRefsSkippingHyperionOccupancy(stands), [stands])
  const [overrideSpecialLocations, setOverrideSpecialLocations] = useState(false)
  /** After opening the map picker for stop 1, deep-link `?from=` no longer overwrites the field (override / change start). */
  const [startLockReleased, setStartLockReleased] = useState(false)
  const [pickerLegIdx, setPickerLegIdx] = useState<number | null>(null)
  const [generatedMissionCode] = useState(() => previewRackMoveMissionCode())
  const [containerCode, setContainerCode] = useState('')
  const [persistent, setPersistent] = useState(false)
  const [legs, setLegs] = useState<Leg[]>(() => [
    newLeg({ putDown: false, continueMode: 'auto', autoContinueSeconds: 0 }),
    newLeg(),
  ])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [fieldError, setFieldError] = useState<MissionFormFieldError | null>(null)
  const prevClearNonceRef = useRef<number | undefined>(undefined)
  /** True after a client-side validation failure; auto-clear banner when `legs` become valid. API errors keep ref false. */
  const validationErrorActiveRef = useRef(false)

  useEffect(() => {
    onMissionErrorChange?.(error)
  }, [error, onMissionErrorChange])

  useEffect(() => {
    if (clearMissionErrorsNonce === undefined) return
    if (prevClearNonceRef.current === undefined) {
      prevClearNonceRef.current = clearMissionErrorsNonce
      return
    }
    if (clearMissionErrorsNonce === prevClearNonceRef.current) return
    prevClearNonceRef.current = clearMissionErrorsNonce
    setError('')
    setFieldError(null)
    validationErrorActiveRef.current = false
  }, [clearMissionErrorsNonce])

  useEffect(() => {
    const v = validateNewMissionForm(legs)
    if (v.ok) {
      if (validationErrorActiveRef.current) {
        validationErrorActiveRef.current = false
        setError('')
        setFieldError(null)
      }
      return
    }
    if (validationErrorActiveRef.current) {
      setFieldError(v.fieldError)
      setError(v.message)
    }
  }, [legs])
  const [rackMoveDebugLastErrorJson, setRackMoveDebugLastErrorJson] = useState<unknown>(null)
  const [rackMoveDebugFleetSettings, setRackMoveDebugFleetSettings] = useState<AmrFleetSettings | null>(null)
  const [robotFleetRows, setRobotFleetRows] = useState<Record<string, unknown>[]>([])
  const [robotFleetLoading, setRobotFleetLoading] = useState(false)
  const [robotFleetErr, setRobotFleetErr] = useState<string | null>(null)
  const [pollMsRobots, setPollMsRobots] = useState(5000)
  /** Same source as Containers page — drives stand pallet presence auto-refresh. */
  const [pollMsContainers, setPollMsContainers] = useState(5000)
  /** From fleet settings: optional Hyperion sanity confirm before create multistop mission. */
  const [missionCreateStandPresenceSanityCheck, setMissionCreateStandPresenceSanityCheck] = useState(true)
  const [missionQueueingEnabled, setMissionQueueingEnabled] = useState(true)
  const [missionQueuedToastDismissMs, setMissionQueuedToastDismissMs] = useState(10000)
  const [robotSelectOpen, setRobotSelectOpen] = useState(false)
  const [debugModalOpen, setDebugModalOpen] = useState(false)
  const [selectedRobotIds, setSelectedRobotIds] = useState<string[]>([])
  const [robotLocks, setRobotLocks] = useState<AmrRobotLockRow[]>([])
  const [templateList, setTemplateList] = useState<AmrMissionTemplateListItem[]>([])
  const [templateLoadBusy, setTemplateLoadBusy] = useState(false)
  const [templateErr, setTemplateErr] = useState<string | null>(null)
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false)
  const [saveTemplateName, setSaveTemplateName] = useState('')
  const [saveTemplateBusy, setSaveTemplateBusy] = useState(false)
  const [templateSelectValue, setTemplateSelectValue] = useState('')
  const [templateEditorName, setTemplateEditorName] = useState('')

  const [standPresenceMap, setStandPresenceMap] = useState<Record<string, boolean | null>>({})
  const [standPresenceLoading, setStandPresenceLoading] = useState(false)
  const [standPresenceError, setStandPresenceError] = useState(false)
  const [standPresenceUnconfig, setStandPresenceUnconfig] = useState(false)

  const uniqueStandRefs = useMemo(() => {
    const s = new Set<string>()
    for (const l of legs) {
      const p = l.position.trim()
      if (p) s.add(p)
    }
    return [...s].sort()
  }, [legs])

  const loadPresenceForRefs = useCallback(async (refs: string[], opts?: { silent?: boolean }) => {
    if (refs.length === 0) return
    const silent = opts?.silent === true
    const skip = standRefsNonStandWaypoint(stands)
    const query = refs.map((r) => r.trim()).filter((r) => r && !skip.has(r))
    if (query.length === 0) {
      if (!silent) setStandPresenceLoading(false)
      return
    }
    if (!silent) {
      setStandPresenceLoading(true)
      setStandPresenceError(false)
      setStandPresenceUnconfig(false)
    }
    try {
      const map = await postStandPresence(query)
      setStandPresenceMap((prev) => {
        const next = { ...prev }
        for (const r of query) {
          next[r] = Object.prototype.hasOwnProperty.call(map, r) ? map[r] : null
        }
        return next
      })
      setStandPresenceError(false)
      setStandPresenceUnconfig(false)
    } catch (e: unknown) {
      if (silent) return
      const status = (e as { response?: { status?: number } })?.response?.status
      if (status === 503) setStandPresenceUnconfig(true)
      else setStandPresenceError(true)
    } finally {
      if (!silent) setStandPresenceLoading(false)
    }
  }, [stands])

  const uniqueStandKey = uniqueStandRefs.join('\0')
  const hasHyperionQueryableStands = useMemo(
    () => uniqueStandRefs.some((r) => !nonStandRefs.has(r)),
    [uniqueStandRefs, nonStandRefs]
  )
  useEffect(() => {
    if (uniqueStandRefs.length === 0) return
    const t = window.setTimeout(() => {
      void loadPresenceForRefs(uniqueStandRefs, { silent: true })
    }, 450)
    return () => clearTimeout(t)
  }, [uniqueStandKey, loadPresenceForRefs, uniqueStandRefs])

  useEffect(() => {
    if (uniqueStandRefs.length === 0) return
    const tid = window.setInterval(() => {
      void loadPresenceForRefs(uniqueStandRefs, { silent: true })
    }, pollMsContainers)
    return () => clearInterval(tid)
  }, [uniqueStandKey, loadPresenceForRefs, uniqueStandRefs, pollMsContainers])

  useEffect(() => {
    if (variant !== 'modal' || !onMissionStandsRefreshState) return
    onMissionStandsRefreshState({
      canRefresh: hasHyperionQueryableStands,
      loading: standPresenceLoading,
    })
  }, [variant, onMissionStandsRefreshState, uniqueStandKey, standPresenceLoading, hasHyperionQueryableStands])

  const containerInputRef = useRef<HTMLInputElement | null>(null)
  const legPositionInputRefs = useRef<(HTMLInputElement | null)[]>([])
  /** Composite location field (input + clear + stand-list chevron) — used to align the suggest popover. */
  const legLocationFieldWrapRefs = useRef<(HTMLDivElement | null)[]>([])
  const createMissionButtonRef = useRef<HTMLButtonElement | null>(null)
  const suggestCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const robotFleetMountedRef = useRef(true)

  const [openSuggestLegIdx, setOpenSuggestLegIdx] = useState<number | null>(null)
  const [suggestLayout, setSuggestLayout] = useState<AmrStandSuggestPopoverLayout | null>(null)

  const suggestedStands = useMemo(() => {
    if (openSuggestLegIdx === null) return []
    const q = legs[openSuggestLegIdx]?.position ?? ''
    let list = filterStandsForSuggest(stands, q)
    const n = legs.length
    const idx = openSuggestLegIdx
    if (n >= 1 && (idx === 0 || idx === n - 1)) {
      list = list.filter(
        (s) => normalizeAmrStandLocationType(s.location_type) !== AMR_STAND_LOCATION_TYPE_NON_STAND
      )
    }
    return list
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
          block_pickup: Number(r.block_pickup ?? 0),
          block_dropoff: Number(r.block_dropoff ?? 0),
          bypass_pallet_check: Number(r.bypass_pallet_check ?? 0),
          location_type: normalizeAmrStandLocationType((r as { location_type?: unknown }).location_type),
        }))
      )
    )
    void getAmrStandGroups()
      .then(setStandGroups)
      .catch(() => setStandGroups([]))
  }, [])

  useEffect(() => {
    robotFleetMountedRef.current = true
    return () => {
      robotFleetMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    void getAmrSettings().then((s) => {
      setPollMsRobots(Math.max(3000, s.pollMsRobots))
      setPollMsContainers(Math.max(3000, s.pollMsContainers))
      setMissionCreateStandPresenceSanityCheck(s.missionCreateStandPresenceSanityCheck !== false)
      setMissionQueueingEnabled(s.missionQueueingEnabled !== false)
      const qToast =
        typeof s.missionQueuedToastDismissMs === 'number' && Number.isFinite(s.missionQueuedToastDismissMs)
          ? s.missionQueuedToastDismissMs
          : 10000
      setMissionQueuedToastDismissMs(Math.max(2000, Math.min(120000, Math.floor(qToast))))
      setZoneCategories(Array.isArray(s.zoneCategories) ? s.zoneCategories : [])
    })
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

  const lockedRobotIds = useMemo(() => {
    const s = new Set<string>()
    for (const r of robotLocks) {
      if (r.locked) s.add(r.robotId)
    }
    return s
  }, [robotLocks])

  /**
   * When any robot is locked, eagerly load the fleet up-front (without opening the picker) so we can
   * detect the "every active robot is locked" stall and disable Create mission with a banner.
   */
  useEffect(() => {
    if (!canManage || lockedRobotIds.size === 0) return
    void loadRobotFleet()
  }, [canManage, lockedRobotIds, loadRobotFleet])

  /** Always reflect current locks on the form: drop locked robots from the selection if the operator locked them after picking. */
  useEffect(() => {
    if (lockedRobotIds.size === 0) return
    setSelectedRobotIds((prev) => {
      const next = prev.filter((id) => !lockedRobotIds.has(id))
      return next.length === prev.length ? prev : next
    })
  }, [lockedRobotIds])

  const refreshRobotLocks = useCallback(async () => {
    if (!canManage) return
    try {
      const rows = await listAmrRobotLocks()
      setRobotLocks(rows)
    } catch {
      /** Locks API is non-critical for picker UX — server still enforces. Silent fail. */
    }
  }, [canManage])

  /** Robot picker sits under the root New Mission dialog — must dismiss both before SPA navigation shows AMR › Robots. */
  const goToRobotsManagePage = useCallback(() => {
    setRobotSelectOpen(false)
    onRequestClose?.()
    navigate(amrPath('robots'))
  }, [navigate, onRequestClose])

  useEffect(() => {
    void refreshRobotLocks()
  }, [refreshRobotLocks])

  /** Refresh locks alongside the robot fleet refresh so the banner / picker stay in sync. */
  useEffect(() => {
    if (!canManage || !robotSelectOpen) return
    const t = window.setInterval(() => void refreshRobotLocks(), pollMsRobots)
    return () => window.clearInterval(t)
  }, [canManage, robotSelectOpen, pollMsRobots, refreshRobotLocks])

  const activeRobotsForPicker = useMemo((): AmrRobotPickRow[] => {
    const out: AmrRobotPickRow[] = []
    for (const r of robotFleetRows) {
      const st = r.status
      if (!isActiveRobotFleetStatus(st)) continue
      const id = String(r.robotId ?? r.robot_id ?? '').trim()
      if (!id) continue
      /** Locked robots are NOT shown in the picker — they cannot receive missions. */
      if (lockedRobotIds.has(id)) continue
      out.push({
        id,
        robotType: String(r.robotType ?? r.robot_type ?? '').trim(),
        status: st,
        batteryPct: batteryPctFromFleet(r.batteryLevel ?? r.battery_level),
      })
    }
    out.sort((a, b) => a.id.localeCompare(b.id))
    return out
  }, [robotFleetRows, lockedRobotIds])

  /**
   * `true` when any robot is locked AND every fleet-reported active robot is also locked. Disables
   * the **Create mission** button + shows a red banner so the operator unlocks before submitting.
   * Requires `robotFleetRows` to have loaded so we don't false-positive while the live fleet is unknown.
   */
  const noUnlockedActive =
    lockedRobotIds.size > 0 && robotFleetRows.length > 0 && activeRobotsForPicker.length === 0

  /** Deep-link from Containers → Move (`?container=` and optional `?from=` = current node / external ref for first stop). */
  const lockStartLocation = useMemo(() => {
    return new URLSearchParams(effectiveSearch).get('from')?.trim() ?? ''
  }, [effectiveSearch])

  useEffect(() => {
    setStartLockReleased(false)
  }, [lockStartLocation])

  useEffect(() => {
    const params = new URLSearchParams(effectiveSearch)
    const c = params.get('container')?.trim()
    const from = params.get('from')?.trim()
    if (c) setContainerCode(c)
    if (from && !startLockReleased) {
      setLegs((prev) => {
        if (!prev.length) return prev
        const next = [...prev]
        next[0] = { ...next[0], position: from }
        return finalizeMissionLegUi(next, stands)
      })
    }
  }, [effectiveSearch, startLockReleased, stands])

  /** Keep first stop aligned with `from` while that query param is present (locked start). */
  useEffect(() => {
    if (!lockStartLocation || startLockReleased) return
    setLegs((prev) => {
      if (!prev.length) return prev
      if (prev[0].position === lockStartLocation) return prev
      const next = [...prev]
      next[0] = { ...next[0], position: lockStartLocation }
      return finalizeMissionLegUi(next, stands)
    })
  }, [lockStartLocation, startLockReleased, stands])

  const updateStandSuggestLayout = useCallback(() => {
    const idx = openSuggestLegIdx
    if (idx === null) {
      setSuggestLayout(null)
      return
    }
    if (lockStartLocation && !startLockReleased && idx === 0) {
      setSuggestLayout(null)
      return
    }
    const wrap = legLocationFieldWrapRefs.current[idx]
    const el = legPositionInputRefs.current[idx]
    const measureEl = wrap ?? el
    if (!measureEl) {
      setSuggestLayout(null)
      return
    }
    const rect = measureEl.getBoundingClientRect()
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
  }, [openSuggestLegIdx, lockStartLocation, startLockReleased])

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
    setLegs((prev) => finalizeMissionLegUi(prev, stands))
  }, [legsOrderKey, legs.length, stands])

  useEffect(() => {
    if (!canManage || variant === 'templateEditor') return
    containerInputRef.current?.focus()
  }, [canManage, variant])

  useEffect(() => {
    if (!canAmrApiDebug) return
    void getAmrSettings().then(setRackMoveDebugFleetSettings)
  }, [canAmrApiDebug])

  useEffect(() => {
    if (!canAmrModule || variant !== 'page') return
    let cancelled = false
    void listAmrMissionTemplates()
      .then((rows) => {
        if (!cancelled) setTemplateList(rows)
      })
      .catch(() => {
        if (!cancelled) setTemplateList([])
      })
    return () => {
      cancelled = true
    }
  }, [canAmrModule, variant])

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
              0,
              Math.min(Math.floor(pickupLeg.autoContinueSeconds ?? 0), 86400)
            ),
          }
        : { continueMode: 'manual' }
    const destinations = destLegs.map((l, i) => {
      const isLast = i === destLegs.length - 1
      /** Row `legs[i+1]` matches this destination stop; release before the next segment uses that row. */
      const cm = legs[i + 1] ?? l
      const mode = isLast ? 'manual' : (cm.continueMode ?? 'manual')
      const gid = l.groupId?.trim()
      const base = gid
        ? {
            groupId: gid,
            position: l.position.trim(),
            passStrategy: 'AUTO' as const,
            waitingMillis: 0,
            continueMode: mode,
            putDown: l.putDown,
          }
        : {
            position: l.position.trim(),
            passStrategy: 'AUTO' as const,
            waitingMillis: 0,
            continueMode: mode,
            putDown: l.putDown,
          }
      if (mode === 'auto') {
        const sec = Math.max(0, Math.min(Math.floor(cm.autoContinueSeconds ?? 0), 86400))
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
    const ccTrim = containerCode.trim()
    if (ccTrim) payload.containerCode = ccTrim
    if (ccTrim && shouldSendFleetContainerAlreadyRegistered(effectiveSearch, ccTrim)) {
      payload.containerFleetAlreadyRegistered = true
    }
    if (selectedRobotIds.length > 0) payload.robotIds = selectedRobotIds
    if (overrideSpecialLocations) payload.override = true
    const segmentFirstNodePutDown = legs.slice(0, -1).map((l) => l.segmentStartPutDown === true)
    if (segmentFirstNodePutDown.length > 0) payload.segmentFirstNodePutDown = segmentFirstNodePutDown
    return payload
  }

  /** Two stops or more: DC creates a multistop session (containerIn then submitMission for segment 0). */
  const hasThreeOrMoreStops = legs.length > 2

  const liftSegmentMismatchBoundaries = useMemo(() => liftSegmentMismatchBoundaryIndices(legs), [legs])

  const rackMoveDebugRequest = useMemo(() => {
    const base = buildMultistopPayload()
    const p = legs[0]?.position.trim() ?? ''
    const d0 = legs[1]
    const md =
      p && (d0?.position.trim() || d0?.groupId?.trim())
        ? [
            {
              sequence: 1,
              position: p,
              type: 'NODE_POINT',
              passStrategy: 'AUTO',
              waitingMillis: 0,
              putDown: legs[0]?.segmentStartPutDown === true,
            },
            {
              sequence: 2,
              position: d0.groupId?.trim()
                ? `[group] ${standGroups.find((g) => g.id === d0.groupId)?.name ?? d0.groupId}`
                : d0.position.trim(),
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
  }, [generatedMissionCode, containerCode, persistent, legs, stands, selectedRobotIds, standGroups])

  const rackMoveDebugRequestUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${getBasePath()}/api${AMR_MULTISTOP_MISSION_PATH}`
      : `${getBasePath()}/api${AMR_MULTISTOP_MISSION_PATH}`

  /** Two-node preview for rack-move; first segment for multistop (same shape). */
  const fleetPreviewInput = useMemo((): Record<string, unknown> => {
    const p = legs[0]?.position.trim() ?? ''
    const d0 = legs[1]
    if (!p || (!d0?.position.trim() && !d0?.groupId?.trim())) return { missionData: [] }
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
          putDown: legs[0]?.segmentStartPutDown === true,
        },
        {
          sequence: 2,
          position: d0.groupId?.trim()
            ? `[group] ${standGroups.find((g) => g.id === d0.groupId)?.name ?? d0.groupId}`
            : d0.position.trim(),
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
    standGroups,
  ])

  const lockedIdsArray = useMemo(() => [...lockedRobotIds], [lockedRobotIds])

  const rackMoveFleetForwardPreview = useMemo(() => {
    if (!rackMoveDebugFleetSettings) return null
    return buildRackMoveFleetForwardPreview(
      rackMoveDebugFleetSettings,
      fleetPreviewInput,
      lockedIdsArray,
      robotFleetRows
    )
  }, [rackMoveDebugFleetSettings, fleetPreviewInput, lockedIdsArray, robotFleetRows])

  const multistopFleetTimeline = useMemo(() => {
    if (!rackMoveDebugFleetSettings) return null
    const pickupPosition = legs[0]?.position.trim() ?? ''
    const destinations = legs.slice(1).map((l) => ({
      position: l.groupId?.trim()
        ? `[group] ${standGroups.find((g) => g.id === l.groupId)?.name ?? l.groupId}`
        : l.position.trim(),
      passStrategy: 'AUTO' as const,
      waitingMillis: 0,
      putDown: l.putDown,
    }))
    const segmentFirstNodePutDown = legs.slice(0, -1).map((l) => l.segmentStartPutDown === true)
    return buildMultistopFleetTimeline(rackMoveDebugFleetSettings, {
      pickupPosition,
      destinations,
      segmentFirstNodePutDown,
      persistent,
      robotIds: selectedRobotIds.length > 0 ? selectedRobotIds : undefined,
      lockedIds: lockedIdsArray,
      fleetRobotSnapshot: robotFleetRows,
    })
  }, [rackMoveDebugFleetSettings, legs, persistent, selectedRobotIds, lockedIdsArray, robotFleetRows, standGroups])

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
    setFieldError(null)
    validationErrorActiveRef.current = false
    if (canAmrApiDebug) setRackMoveDebugLastErrorJson(null)

    if (noUnlockedActive) {
      validationErrorActiveRef.current = true
      setError(NO_UNLOCKED_ROBOTS_MESSAGE)
      return
    }

    const validation = validateNewMissionForm(legs)
    if (!validation.ok) {
      validationErrorActiveRef.current = true
      setError(validation.message)
      setFieldError(validation.fieldError)
      queueMicrotask(() => {
        if (validation.fieldError.kind === 'location') {
          const i = validation.fieldError.legIndices[0]
          legPositionInputRefs.current[i]?.focus()
          legPositionInputRefs.current[i]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        } else {
          document
            .getElementById(`amr-mission-leg-continue-secs-${validation.fieldError.legIndex}`)
            ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
          ;(
            document.getElementById(
              `amr-mission-leg-continue-secs-${validation.fieldError.legIndex}`
            ) as HTMLInputElement | null
          )?.focus()
        }
      })
      return
    }

    if (missionCreateStandPresenceSanityCheck) {
      const uniquePresenceRefs = [...new Set(legs.map((l) => l.position.trim()).filter(Boolean))].sort()
      if (uniquePresenceRefs.length > 0) {
        try {
          const presenceBatch = await postStandPresence(uniquePresenceRefs)
          const pickupWarn = shouldWarnFirstStopPickupAbsent(legs, presenceBatch, occupancySkipRefs)
          if (pickupWarn.shouldWarn) {
            const pr = pickupWarn.pickupRef.trim()
            const okPickup = await showConfirm(
              <AmrPickupAbsentConfirmBody pickupRef={pickupWarn.pickupRef} />,
              {
                title: pr ? `No pallet at pickup — ${pr}` : 'No pallet at pickup',
                confirmLabel: 'Create mission anyway',
                footerExtra: <AmrPickupAbsentConfirmFooterRetry />,
                omitFooterCancel: true,
              }
            )
            if (!okPickup) return
          }
          const { shouldWarn, destinationRef } = shouldWarnFirstSegmentDropOccupied(
            legs,
            presenceBatch,
            occupancySkipRefs
          )
          if (shouldWarn) {
            const destTitle = destinationRef.trim()
            const ok = await showConfirm(
              <AmrDestinationOccupiedConfirmBody destinationRef={destinationRef} />,
              {
                title: destTitle ? `Destination not empty — ${destTitle}` : 'Destination not empty',
                confirmLabel: 'Create mission anyway',
                footerExtra: <AmrDestinationOccupiedConfirmFooterRetry />,
                omitFooterCancel: true,
              }
            )
            if (!ok) return
          }
        } catch {
          /* Hyperion unset / network — do not block create */
        }
      }
    }

    setSaving(true)
    try {
      const data = (await createMultistopMission(buildMultistopPayload())) as {
        multistopSessionId?: unknown
        queued?: unknown
        destinationRef?: unknown
      }
      const sid =
        typeof data.multistopSessionId === 'string' ? data.multistopSessionId.trim() : ''
      const queuedInitial = data.queued === true
      const queuedDest =
        typeof data.destinationRef === 'string' ? data.destinationRef.trim() : ''
      if (openOverviewAfter && sid) {
        navigate(
          `${amrPath('missions')}?${new URLSearchParams({ multistopSummary: sid }).toString()}`
        )
      } else {
        navigate(amrPath('missions'))
      }
      onRequestClose?.()
      if (queuedInitial && sid) {
        const overviewUrl = `${amrPath('missions')}?${new URLSearchParams({ multistopSummary: sid }).toString()}`
        const queuedBody = queuedDest
          ? `The first segment is queued until ${queuedDest} clears; DC dispatches automatically when Hyperion reports the stand empty.`
          : 'The first segment is queued until the drop stand clears; DC dispatches automatically when Hyperion reports the stand empty.'
        pushToast({
          durationMs: missionQueuedToastDismissMs,
          render: ({ dismiss }) => (
            <div className="space-y-2">
              <p className="font-medium text-foreground">Mission queued</p>
              <p className="text-xs text-foreground/80">{queuedBody}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                {canForceRelease ? (
                  <button
                    type="button"
                    className="rounded-lg border border-destructive/50 bg-background px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
                    onClick={() => {
                      void (async () => {
                        try {
                          await continueAmrMultistopSession(sid, { forceRelease: true })
                          dismiss()
                        } catch (forceErr: unknown) {
                          showAlert(getApiErrorMessage(forceErr, 'Force dispatch failed'), 'Force dispatch')
                        }
                      })()
                    }}
                  >
                    Force dispatch
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded-lg border border-border bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                  onClick={() => {
                    navigate(overviewUrl)
                    dismiss()
                  }}
                >
                  Open mission
                </button>
              </div>
            </div>
          ),
        })
      }
    } catch (e: unknown) {
      const ax = e as { response?: { data?: unknown } }
      if (canAmrApiDebug) setRackMoveDebugLastErrorJson(ax?.response?.data ?? { message: String(e) })
      const data = ax?.response?.data as { error?: string; code?: string } | undefined
      const code = typeof data?.code === 'string' ? data.code : ''
      const serverMsg = typeof data?.error === 'string' ? data.error : ''
      const msg = code === 'NO_UNLOCKED_ROBOTS' ? NO_UNLOCKED_ROBOTS_MESSAGE : serverMsg || 'Mission create failed'
      validationErrorActiveRef.current = false
      setError(msg)
      if (code === 'NO_UNLOCKED_ROBOTS') {
        /** Server already validated — re-pull locks so the picker / banner reflect what the server rejected. */
        void refreshRobotLocks()
        void loadRobotFleet()
      }
    } finally {
      setSaving(false)
    }
  }

  const updateLeg = (idx: number, patch: Partial<Leg>) => {
    setLegs((prev) => {
      if (idx === 0 && lockStartLocation && !startLockReleased && 'position' in patch) return prev
      const n = prev.length
      if ('putDown' in patch && n >= 2 && (idx === 0 || idx === n - 1)) return prev
      return finalizeMissionLegUi(prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)), stands)
    })
  }

  /** Adds another stop; three or more stops use chained fleet missions and Continue on Missions. */
  const addLeg = () => {
    setLegs((prev) => finalizeMissionLegUi([...prev, newLeg()], stands))
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
        if (lockStartLocation && !startLockReleased && (oldIndex === 0 || newIndex === 0)) return prev
        return finalizeMissionLegUi(arrayMove(prev, oldIndex, newIndex), stands)
      })
    },
    [lockStartLocation, startLockReleased, stands]
  )

  const removeLeg = (idx: number) => {
    if (legs.length <= 2) return
    if (lockStartLocation && !startLockReleased && idx === 0) return
    setLegs((prev) => {
      if (prev.length <= 2) return prev
      if (lockStartLocation && !startLockReleased && idx === 0) return prev
      return finalizeMissionLegUi(prev.filter((_, i) => i !== idx), stands)
    })
  }

  const focusFirstEditableLegInput = () => {
    for (let i = 0; i < legs.length; i++) {
      if (i === 0 && lockStartLocation && !startLockReleased) continue
      legPositionInputRefs.current[i]?.focus()
      return
    }
    createMissionButtonRef.current?.focus()
  }

  const focusNextLegPositionInput = (currentIdx: number) => {
    for (let i = currentIdx + 1; i < legs.length; i++) {
      if (i === 0 && lockStartLocation && !startLockReleased) continue
      legPositionInputRefs.current[i]?.focus()
      return
    }
    createMissionButtonRef.current?.focus()
  }

  const hydrateFormFromMissionTemplatePayload = useCallback(
    (
      payload: AmrMissionTemplatePayloadV1 | AmrMissionReplayPayload,
      opts?: { preserveTemplateDropdown?: boolean }
    ) => {
      const mapped = finalizeMissionLegUi(
        payload.legs.map((leg) =>
          newLeg({
            position: leg.position,
            ...(leg.groupId?.trim() ? { groupId: leg.groupId.trim() } : {}),
            putDown: leg.putDown,
            ...(leg.segmentStartPutDown === true ? { segmentStartPutDown: true } : {}),
            continueMode: leg.continueMode ?? 'manual',
            autoContinueSeconds: leg.autoContinueSeconds ?? 0,
          })
        ),
        stands
      )
      const locked = lockStartLocation.trim()
      if (locked && !startLockReleased) {
        const copy = [...mapped]
        if (copy[0]) copy[0] = { ...copy[0], position: locked }
        setLegs(finalizeMissionLegUi(copy, stands))
      } else {
        setLegs(mapped)
      }
      setPersistent(Boolean(payload.persistentContainer))
      setSelectedRobotIds(Array.isArray(payload.robotIds) ? payload.robotIds : [])
      setContainerCode(payload.containerCode ?? '')
      if (opts?.preserveTemplateDropdown !== true) setTemplateSelectValue('')
    },
    [lockStartLocation, startLockReleased, stands]
  )

  const applyMissionTemplate = useCallback(async (templateId: string): Promise<boolean> => {
    if (!templateId.trim()) return false
    setTemplateErr(null)
    setTemplateLoadBusy(true)
    try {
      const t = await getAmrMissionTemplate(templateId)
      hydrateFormFromMissionTemplatePayload(t.payload)
      return true
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { error?: string } } }
      setTemplateErr(ax?.response?.data?.error ?? 'Could not load template')
      return false
    } finally {
      setTemplateLoadBusy(false)
    }
  }, [hydrateFormFromMissionTemplatePayload])

  const applyMissionReplayPayload = useCallback(
    async (missionRecordId: string): Promise<boolean> => {
      const id = missionRecordId.trim()
      if (!id) return false
      setTemplateErr(null)
      setTemplateLoadBusy(true)
      try {
        const p = await getAmrMissionReplayPayload(id)
        hydrateFormFromMissionTemplatePayload(p)
        return true
      } catch (e: unknown) {
        const ax = e as { response?: { data?: { error?: string } } }
        setTemplateErr(ax?.response?.data?.error ?? 'Could not load mission replay data')
        return false
      } finally {
        setTemplateLoadBusy(false)
      }
    },
    [hydrateFormFromMissionTemplatePayload]
  )

  const templateIdFromSearch = useMemo(() => {
    const raw = effectiveSearch.trim()
    if (!raw) return ''
    const params = new URLSearchParams(raw.startsWith('?') ? raw : `?${raw}`)
    return params.get('template')?.trim() ?? ''
  }, [effectiveSearch])

  const replayMissionIdFromSearch = useMemo(() => {
    const raw = effectiveSearch.trim()
    if (!raw) return ''
    const params = new URLSearchParams(raw.startsWith('?') ? raw : `?${raw}`)
    return params.get('replay')?.trim() ?? ''
  }, [effectiveSearch])

  const autoLoadedTemplateIdRef = useRef<string | null>(null)
  const autoLoadedReplayMissionIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (variant === 'templateEditor') return
    if (replayMissionIdFromSearch) {
      autoLoadedTemplateIdRef.current = null
      return
    }
    const tid = templateIdFromSearch
    if (!tid) {
      autoLoadedTemplateIdRef.current = null
      return
    }
    if (autoLoadedTemplateIdRef.current === tid) return
    let cancelled = false
    void applyMissionTemplate(tid).then((ok) => {
      if (!cancelled && ok) autoLoadedTemplateIdRef.current = tid
    })
    return () => {
      cancelled = true
    }
  }, [variant, templateIdFromSearch, replayMissionIdFromSearch, applyMissionTemplate])

  useEffect(() => {
    if (variant === 'templateEditor') return
    const rid = replayMissionIdFromSearch
    if (!rid) {
      autoLoadedReplayMissionIdRef.current = null
      return
    }
    if (autoLoadedReplayMissionIdRef.current === rid) return
    let cancelled = false
    void applyMissionReplayPayload(rid).then((ok) => {
      if (!cancelled && ok) autoLoadedReplayMissionIdRef.current = rid
    })
    return () => {
      cancelled = true
    }
  }, [variant, replayMissionIdFromSearch, applyMissionReplayPayload])

  useEffect(() => {
    if (variant !== 'templateEditor') return
    const id = templateEditorId?.trim()
    if (!id) {
      setTemplateEditorName('')
      setTemplateErr(null)
      setLegs([
        newLeg({ putDown: false, continueMode: 'auto', autoContinueSeconds: 0 }),
        newLeg(),
      ])
      setPersistent(false)
      setSelectedRobotIds([])
      setContainerCode('')
      setFieldError(null)
      setError('')
      return
    }
    let cancelled = false
    setTemplateErr(null)
    setTemplateLoadBusy(true)
    void getAmrMissionTemplate(id)
      .then((t) => {
        if (cancelled) return
        setTemplateEditorName(t.name)
        const mapped = finalizeMissionLegUi(
          t.payload.legs.map((leg) =>
            newLeg({
              position: leg.position,
              ...(leg.groupId?.trim() ? { groupId: leg.groupId.trim() } : {}),
              putDown: leg.putDown,
              ...(leg.segmentStartPutDown === true ? { segmentStartPutDown: true } : {}),
              continueMode: leg.continueMode ?? 'manual',
              autoContinueSeconds: leg.autoContinueSeconds ?? 0,
            })
          ),
          stands
        )
        setLegs(mapped)
        setPersistent(t.payload.persistentContainer)
        setSelectedRobotIds(t.payload.robotIds ?? [])
        setContainerCode(t.payload.containerCode ?? '')
        setFieldError(null)
        setError('')
      })
      .catch((e: unknown) => {
        const ax = e as { response?: { data?: { error?: string } } }
        if (!cancelled) setTemplateErr(ax?.response?.data?.error ?? 'Could not load template')
      })
      .finally(() => {
        if (!cancelled) setTemplateLoadBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [variant, templateEditorId, stands])

  const openSaveTemplateModal = useCallback(() => {
    setTemplateErr(null)
    const v = validateNewMissionForm(legs)
    if (!v.ok) {
      setError(v.message)
      setFieldError(v.fieldError)
      return
    }
    setSaveTemplateName('')
    setSaveTemplateOpen(true)
  }, [legs])

  useImperativeHandle(
    ref,
    () => ({
      openSaveTemplate: openSaveTemplateModal,
      openDebug: () => setDebugModalOpen(true),
      refreshStands: () => {
        if (uniqueStandRefs.length === 0) return
        void loadPresenceForRefs(uniqueStandRefs)
      },
    }),
    [openSaveTemplateModal, uniqueStandRefs, loadPresenceForRefs]
  )

  const submitSaveTemplate = async () => {
    const name = saveTemplateName.trim()
    if (!name) return
    setSaveTemplateBusy(true)
    setTemplateErr(null)
    try {
      await createAmrMissionTemplate({
        name,
        payload: missionFormToTemplatePayload(legs, persistent, selectedRobotIds, containerCode),
        ...(overrideSpecialLocations ? { override: true } : {}),
      })
      setSaveTemplateOpen(false)
      setSaveTemplateName('')
      const rows = await listAmrMissionTemplates()
      setTemplateList(rows)
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { error?: string } } }
      const msg = ax?.response?.data?.error ?? 'Could not save template'
      setTemplateErr(msg)
      if (variant === 'modal') setError(msg)
    } finally {
      setSaveTemplateBusy(false)
    }
  }

  const submitTemplateEditor = async () => {
    setError('')
    setFieldError(null)
    validationErrorActiveRef.current = false
    const name = templateEditorName.trim()
    if (!name) {
      setError('Enter a template name.')
      validationErrorActiveRef.current = true
      return
    }
    const v = validateNewMissionForm(legs)
    if (!v.ok) {
      validationErrorActiveRef.current = true
      setError(v.message)
      setFieldError(v.fieldError)
      queueMicrotask(() => {
        if (v.fieldError.kind === 'location') {
          const i = v.fieldError.legIndices[0]
          legPositionInputRefs.current[i]?.focus()
          legPositionInputRefs.current[i]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        } else {
          document
            .getElementById(`amr-mission-leg-continue-secs-${v.fieldError.legIndex}`)
            ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
          ;(
            document.getElementById(
              `amr-mission-leg-continue-secs-${v.fieldError.legIndex}`
            ) as HTMLInputElement | null
          )?.focus()
        }
      })
      return
    }
    setSaving(true)
    try {
      const payload = missionFormToTemplatePayload(legs, persistent, selectedRobotIds, containerCode)
      const editId = templateEditorId?.trim()
      const overrideField = overrideSpecialLocations ? { override: true } : {}
      if (editId) {
        await updateAmrMissionTemplate(editId, { name, payload, ...overrideField })
      } else {
        await createAmrMissionTemplate({ name, payload, ...overrideField })
      }
      onTemplateEditorSaved?.()
      onRequestClose?.()
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { error?: string } } }
      validationErrorActiveRef.current = false
      setError(ax?.response?.data?.error ?? 'Could not save template')
    } finally {
      setSaving(false)
    }
  }

  const templateEditorActionRow = (
    <div className="flex w-full flex-col gap-3 gap-y-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {templateEditorId?.trim() && onRequestDeleteTemplate && canManage ? (
          <button
            type="button"
            disabled={deleteTemplateBusy || saving || templateLoadBusy}
            className="inline-flex min-h-[44px] items-center rounded-lg border border-red-500/35 bg-red-500/[0.06] px-4 text-sm text-red-700 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-500/15"
            onClick={() => onRequestDeleteTemplate()}
          >
            {deleteTemplateBusy ? 'Deleting…' : 'Delete template'}
          </button>
        ) : null}
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
        <button
          type="button"
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg border border-border px-4 text-sm hover:bg-background sm:w-auto"
          onClick={() => onRequestClose?.()}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={saving || !canManage || templateLoadBusy}
          className="min-h-[44px] w-full rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 sm:w-auto"
          onClick={() => void submitTemplateEditor()}
        >
          {saving ? 'Saving…' : templateEditorId?.trim() ? 'Save changes' : 'Save template'}
        </button>
      </div>
    </div>
  )

  const missionActionRow = (
    <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
        {variant !== 'modal' ? (
          <Link
            to={amrPath('missions')}
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg border border-border px-4 text-sm sm:w-auto"
          >
            Cancel
          </Link>
        ) : null}
        {variant === 'modal' ? (
          <button
            type="button"
            disabled={saving || !canManage || noUnlockedActive}
            title={noUnlockedActive ? NO_UNLOCKED_ROBOTS_MESSAGE : undefined}
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-100 sm:w-auto"
            onClick={() => void submit(true)}
          >
            {saving ? 'Submitting…' : 'Create and show'}
          </button>
        ) : null}
        <button
          ref={createMissionButtonRef}
          type="button"
          disabled={saving || !canManage || noUnlockedActive}
          title={noUnlockedActive ? NO_UNLOCKED_ROBOTS_MESSAGE : undefined}
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 text-sm font-medium text-foreground hover:bg-amber-500/15 disabled:opacity-50 dark:border-amber-500/35 sm:w-auto"
          onClick={() => void submit()}
        >
          {saving ? 'Submitting…' : 'Create mission'}
        </button>
    </div>
  )

  const missionFields = (
    <>
      {canAmrModule && variant === 'page' ? (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-medium">Templates</h2>
          {templateErr ? <p className="text-sm text-red-600 dark:text-red-400">{templateErr}</p> : null}
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm sm:max-w-md">
              <span className="text-foreground/80">Load template</span>
              <select
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                disabled={templateLoadBusy}
                value={templateSelectValue}
                onChange={(e) => {
                  const id = e.target.value
                  setTemplateSelectValue('')
                  if (id) void applyMissionTemplate(id)
                }}
              >
                <option value="">
                  {templateLoadBusy ? 'Loading…' : templateList.length ? 'Choose a template…' : 'None saved yet'}
                </option>
                {templateList.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.stopCount} stops)
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap items-center gap-2 pb-0.5">
              {canManage ? (
                <button
                  type="button"
                  disabled={saveTemplateBusy}
                  className="inline-flex min-h-[44px] items-center rounded-lg border border-border px-4 text-sm hover:bg-background disabled:opacity-50"
                  onClick={() => openSaveTemplateModal()}
                >
                  Save as template…
                </button>
              ) : null}
              <Link
                to={amrPath('missions', 'templates')}
                className="inline-flex min-h-[44px] items-center rounded-lg border border-border px-4 text-sm hover:bg-background"
              >
                Manage templates
              </Link>
            </div>
          </div>
        </div>
      ) : null}
      <div className="space-y-4 rounded-xl border border-border bg-card p-4">
        {variant === 'templateEditor' ? (
          <>
            <label className="block text-sm">
              <span className="text-foreground/80">Template name</span>
              <input
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-base md:text-sm"
                value={templateEditorName}
                onChange={(e) => setTemplateEditorName(e.target.value)}
                placeholder="e.g. East dock loop"
                disabled={templateLoadBusy}
                autoComplete="off"
                enterKeyHint="next"
                autoFocus={!templateEditorId?.trim()}
              />
            </label>
            <p className="text-xs text-foreground/60">
              Shared with everyone who can open AMR. Names must be unique.
            </p>
          </>
        ) : (
          <div>
            <span className="text-sm text-foreground/80">Mission code</span>
            <p className="mt-1 break-all font-mono text-base font-semibold tracking-tight text-foreground">
              {generatedMissionCode}
            </p>
          </div>
        )}
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
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {variant !== 'modal' && hasHyperionQueryableStands ? (
              <button
                type="button"
                className="shrink-0 text-sm text-primary hover:underline disabled:opacity-50"
                disabled={standPresenceLoading}
                onClick={() => void loadPresenceForRefs(uniqueStandRefs)}
              >
                {standPresenceLoading ? 'Refreshing…' : 'Refresh stands'}
              </button>
            ) : null}
            <button
              type="button"
              className="shrink-0 text-sm text-primary hover:underline"
              onClick={addLeg}
            >
              Add Stop
            </button>
          </div>
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleLegDragEnd}>
          <SortableContext items={legs.map((l) => l.id)} strategy={verticalListSortingStrategy}>
            {legs.map((leg, idx) => {
              const startLocked = idx === 0 && Boolean(lockStartLocation) && !startLockReleased
              const dragLocked = Boolean(lockStartLocation && !startLockReleased && idx === 0)
              const canRemove = legs.length > 2 && !(lockStartLocation && !startLockReleased && idx === 0)
              const arriveLocked = idx === legs.length - 1
              const arrivalOn =
                idx === 0
                  ? leg.segmentStartPutDown === true
                  : arriveLocked
                    ? true
                    : leg.putDown === true
              const onArrivalChange = (on: boolean) => {
                if (idx === 0) updateLeg(0, { segmentStartPutDown: on })
                else updateLeg(idx, { putDown: on })
              }
              const showDepartInset = idx >= 2
              const prevLeg = showDepartInset ? legs[idx - 1] : undefined
              const prevPos = prevLeg?.position.trim() ?? ''
              const departOn = prevLeg?.segmentStartPutDown === true
              const locationInvalid =
                fieldError?.kind === 'location' && fieldError.legIndices.includes(idx)
              const autoSecondsInvalid =
                fieldError?.kind === 'autoSeconds' && fieldError.legIndex === idx
              return (
                <Fragment key={leg.id}>
                <SortableLegCard id={leg.id} disableDrag={dragLocked}>
                  {(grip) => (
                    <>
            <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
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
            <div className="min-w-0 w-full">
              <label
                htmlFor={`amr-mission-leg-pos-${idx}`}
                className="block text-sm text-foreground/80"
              >
                Location (External Ref)
                {startLocked ? (
                  <span className="ml-1.5 font-normal text-foreground/50">· locked (container position)</span>
                ) : null}
              </label>
              <div className="mt-1 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-x-4 md:gap-y-2">
                <div className="flex min-h-[40px] min-w-0 w-full items-stretch gap-2 md:col-start-1 md:row-start-1">
                  <div
                    ref={(el) => {
                      legLocationFieldWrapRefs.current[idx] = el
                    }}
                    className={`relative flex min-h-[40px] min-w-0 flex-1 items-stretch overflow-hidden rounded-lg bg-background focus-within:ring-2 focus-within:ring-ring ${
                      locationInvalid
                        ? 'border-2 border-red-500 ring-2 ring-red-500/25 focus-within:ring-red-500/40 dark:border-red-400'
                        : 'border border-border'
                    }`}
                  >
                    <input
                      ref={(el) => {
                        legPositionInputRefs.current[idx] = el
                      }}
                      id={`amr-mission-leg-pos-${idx}`}
                      autoComplete="off"
                      enterKeyHint={idx < legs.length - 1 ? 'next' : 'done'}
                      disabled={startLocked}
                      title={startLocked ? undefined : 'Scan or pick a stand External Ref (keyboard / barcode)'}
                      aria-invalid={locationInvalid || undefined}
                      className="min-h-[40px] min-w-0 flex-1 border-0 bg-transparent py-2 pl-3 font-mono text-base outline-none ring-0 transition-[color,box-shadow] placeholder:text-foreground/45 focus:ring-0 disabled:cursor-not-allowed disabled:opacity-70 md:text-sm"
                      readOnly={Boolean(leg.groupId?.trim() && idx > 0)}
                      value={
                        leg.groupId?.trim() && idx > 0
                          ? `Group: ${standGroups.find((g) => g.id === leg.groupId)?.name ?? leg.groupId}`
                          : leg.position
                      }
                      onChange={(e) => {
                        const v = e.target.value
                        if (leg.groupId?.trim() && idx > 0) {
                          updateLeg(idx, { groupId: undefined, position: v })
                        } else {
                          updateLeg(idx, { position: v })
                        }
                        if (startLocked) return
                        cancelSuggestClose()
                        if (v.length > 0) {
                          setOpenSuggestLegIdx(idx)
                        } else {
                          setOpenSuggestLegIdx(null)
                        }
                      }}
                      onBlur={() => {
                        if (startLocked) return
                        if (leg.groupId?.trim() && idx > 0) return
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
                    {leg.position.trim() && !leg.groupId?.trim() ? (
                      <span className="flex shrink-0 items-center gap-1 bg-muted/15 px-1.5 py-1 sm:px-2">
                        <PalletPresenceGlyph
                          kind={palletPresenceKindFromState({
                            nonStandWaypoint: nonStandRefs.has(leg.position.trim()),
                            present: Object.prototype.hasOwnProperty.call(
                              standPresenceMap,
                              leg.position.trim()
                            )
                              ? standPresenceMap[leg.position.trim()]
                              : null,
                            loading: standPresenceLoading,
                            error: standPresenceError,
                            unconfigured: standPresenceUnconfig,
                          })}
                          showLabel
                          labelClassName="hidden sm:inline"
                          className="h-3.5 w-3.5"
                        />
                      </span>
                    ) : null}
                    {!startLocked && (leg.position.trim() || leg.groupId?.trim()) ? (
                      <button
                        type="button"
                        tabIndex={-1}
                        className="relative z-[15] flex shrink-0 items-center justify-center self-stretch px-1 text-foreground/55 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label="Clear location"
                        title="Clear"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          updateLeg(idx, { position: '', groupId: undefined })
                          setOpenSuggestLegIdx(null)
                        }}
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={startLocked}
                      className="flex min-h-[40px] w-10 shrink-0 items-center justify-center border-l border-border/70 bg-muted/20 text-foreground/85 hover:bg-muted hover:text-foreground focus-visible:relative focus-visible:z-[15] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={`Show stand list for stop ${idx + 1}`}
                      aria-expanded={openSuggestLegIdx === idx}
                      title={startLocked ? undefined : 'Show stand list'}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        if (startLocked) return
                        cancelSuggestClose()
                        setOpenSuggestLegIdx((cur) => (cur === idx ? null : idx))
                      }}
                    >
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                  <button
                    type="button"
                    className="flex h-10 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-foreground/80 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Choose location on map for stop ${idx + 1}`}
                    title={
                      startLocked
                        ? 'Choose location — unlocks start so you can pick a restricted stand with override'
                        : 'Choose location'
                    }
                    onClick={() => {
                      if (idx === 0 && lockStartLocation && !startLockReleased) setStartLockReleased(true)
                      setOpenSuggestLegIdx(null)
                      setPickerLegIdx(idx)
                    }}
                  >
                    <LocationPinIcon className="h-5 w-5" />
                  </button>
                </div>
                <div className="flex flex-col gap-2 md:col-start-2 md:row-start-1 md:max-w-[min(100%,20rem)] md:shrink-0">
                  {showDepartInset ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-3">
                        <ToggleSwitch
                          checked={departOn}
                          onCheckedChange={(on) =>
                            updateLeg(idx - 1, { segmentStartPutDown: on })
                          }
                          aria-label={
                            departOn
                              ? 'Depart: lower forks (putDown true)'
                              : 'Depart: lift forks (putDown false)'
                          }
                          title="Fleet putDown at the previous stop at the start of the next sub-mission: true lowers, false lifts."
                          size="sm"
                          className="shrink-0"
                        />
                        <span className="min-w-0 flex-1 text-sm">
                          Depart: {departOn ? 'Lower' : 'Lift'}
                        </span>
                      </div>
                      <div
                        className={`flex items-center gap-3 ${arriveLocked ? 'text-foreground/70' : ''}`}
                      >
                        <ToggleSwitch
                          checked={arrivalOn}
                          disabled={arriveLocked}
                          onCheckedChange={onArrivalChange}
                          aria-label={
                            arrivalOn
                              ? 'Arrival: lower forks (putDown true)'
                              : 'Arrival: lift forks (putDown false)'
                          }
                          title={
                            arriveLocked
                              ? 'Final stop: putDown is always true (lower on arrival)'
                              : 'Fleet putDown when the AMR reaches this stand: true lowers, false lifts'
                          }
                          size="sm"
                          className="shrink-0"
                        />
                        <span className="min-w-0 flex-1 text-sm">
                          Arrival: {arrivalOn ? 'Lower' : 'Lift'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className={`flex items-center gap-3 ${arriveLocked ? 'text-foreground/70' : ''}`}>
                      <ToggleSwitch
                        checked={arrivalOn}
                        disabled={arriveLocked}
                        onCheckedChange={onArrivalChange}
                        aria-label={
                          arrivalOn
                            ? 'Arrival: lower forks (putDown true)'
                            : 'Arrival: lift forks (putDown false)'
                        }
                        title={
                          arriveLocked
                            ? 'Final stop: putDown is always true (lower on arrival)'
                            : 'Fleet putDown when the AMR reaches this stand: true lowers, false lifts'
                        }
                        size="sm"
                        className="shrink-0"
                      />
                      <span className="min-w-0 flex-1 text-sm">
                        Arrival: {arrivalOn ? 'Lower' : 'Lift'}
                      </span>
                    </div>
                  )}
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
                    className="flex flex-wrap items-center gap-2 pl-1 text-sm text-foreground/85 md:col-start-2 md:row-start-2 md:max-w-[min(100%,20rem)]"
                  >
                    <span className="text-foreground/70">After</span>
                    <input
                      id={`amr-mission-leg-continue-secs-${idx}`}
                      type="number"
                      min={0}
                      max={86400}
                      inputMode="numeric"
                      aria-invalid={autoSecondsInvalid || undefined}
                      className={`w-[5.5rem] rounded-md bg-background px-2 py-1 font-mono text-sm ${
                        autoSecondsInvalid
                          ? 'border-2 border-red-500 ring-2 ring-red-500/25 dark:border-red-400'
                          : 'border border-border'
                      }`}
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
              {(() => {
                const pos = leg.position.trim()
                const stDepart =
                  showDepartInset && prevPos
                    ? legRestrictionStatus(stands, prevPos, departOn)
                    : { violated: false, message: '' }
                const stArrive = pos
                  ? legRestrictionStatus(stands, pos, arrivalOn)
                  : { violated: false, message: '' }
                if (!stDepart.violated && !stArrive.violated) return null
                return (
                  <div className="mt-2 flex flex-col gap-2">
                    {stDepart.violated ? (
                      <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-900 sm:flex-row sm:items-center sm:gap-3 dark:text-amber-200">
                        <span className="min-w-0 flex-1 leading-snug">
                          <span className="font-medium">Depart: </span>
                          {stDepart.message}
                        </span>
                        {canOverrideSpecial ? (
                          <label className="flex cursor-pointer select-none items-center gap-1.5 sm:ml-auto sm:shrink-0">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-border"
                              checked={overrideSpecialLocations}
                              onChange={(e) => setOverrideSpecialLocations(e.target.checked)}
                            />
                            <span>Override restriction</span>
                          </label>
                        ) : null}
                      </div>
                    ) : null}
                    {stArrive.violated ? (
                      <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-900 sm:flex-row sm:items-center sm:gap-3 dark:text-amber-200">
                        <span className="min-w-0 flex-1 leading-snug">
                          <span className="font-medium">Arrival: </span>
                          {stArrive.message}
                        </span>
                        {canOverrideSpecial ? (
                          <label className="flex cursor-pointer select-none items-center gap-1.5 sm:ml-auto sm:shrink-0">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-border"
                              checked={overrideSpecialLocations}
                              onChange={(e) => setOverrideSpecialLocations(e.target.checked)}
                            />
                            <span>Override restriction</span>
                          </label>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )
              })()}
            </div>
                    </>
                  )}
                </SortableLegCard>
                {idx < legs.length - 1 && liftSegmentMismatchBoundaries.includes(idx) ? (
                  <div
                    role="status"
                    className="my-1 rounded-md border border-amber-500/45 bg-amber-500/10 px-2.5 py-1.5 text-xs leading-snug text-amber-950 dark:text-amber-100"
                  >
                    Lift state between stops {idx + 1} and {idx + 2} is out of the normal range for these stops.
                  </div>
                ) : null}
                </Fragment>
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
              {variant === 'templateEditor'
                ? selectedRobotIds.length > 0
                  ? `${selectedRobotIds.length} robot(s) saved when missions are started from this template.`
                  : 'Optional — AMR settings defaults apply when none selected.'
                : selectedRobotIds.length > 0
                  ? `${selectedRobotIds.length} robot(s) included on submitMission.`
                  : 'Optional — AMR settings defaults apply when none selected.'}
            </p>
          </div>
          {noUnlockedActive ? (
            <p
              className="rounded-md border border-red-500/45 bg-red-500/10 px-2.5 py-1.5 text-xs leading-snug text-red-950 dark:text-red-100"
              role="alert"
            >
              <span className="font-medium">All active robots are locked.</span> Unlock at least one on the{' '}
              <Link to={amrPath('robots')} className="underline hover:text-red-700 dark:hover:text-red-200">
                Robots page
              </Link>{' '}
              before creating a mission.
            </p>
          ) : null}
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
      !(lockStartLocation && !startLockReleased && openSuggestLegIdx === 0) &&
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
                        updateLeg(i, {
                          position: s.external_ref,
                        })
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
      {variant === 'templateEditor' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto space-y-6">
            {!canManage ? (
              <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground/80">
                You do not have permission to edit mission templates. Close this dialog or contact an administrator.
              </p>
            ) : null}
            {templateErr ? (
              <p className="rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                {templateErr}
              </p>
            ) : null}
            {canManage && error && !onMissionErrorChange ? (
              <MissionErrorBanner
                message={error}
                onDismiss={() => {
                  setError('')
                  setFieldError(null)
                }}
              />
            ) : null}
            {canManage ? missionFields : null}
          </div>
          <div className="shrink-0 border-t border-border bg-card pt-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] -mx-4 px-4 sm:-mx-5 sm:px-5">
            {templateEditorActionRow}
          </div>
        </div>
      ) : variant === 'modal' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto space-y-6">
            {!canManage ? (
              <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground/80">
                You do not have permission to create missions. Use Cancel to return to Missions or close this dialog.
              </p>
            ) : null}
            {canManage && error && !onMissionErrorChange ? (
              <MissionErrorBanner
                message={error}
                onDismiss={() => {
                  setError('')
                  setFieldError(null)
                }}
              />
            ) : null}
            {canManage ? missionFields : null}
          </div>
          <div className="shrink-0 border-t border-border bg-card pt-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] -mx-4 px-4 sm:-mx-5 sm:px-5">
            {missionActionRow}
          </div>
        </div>
      ) : (
        <div className="mx-auto w-full min-w-0 max-w-3xl space-y-6 px-0 pb-[max(6rem,env(safe-area-inset-bottom))]">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-nowrap items-start justify-between gap-2">
              <h1 className="min-w-0 flex-1 truncate pr-1 text-xl font-semibold tracking-tight">New Mission</h1>
              <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                {canAmrApiDebug ? (
                  <button
                    type="button"
                    className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-red-500/45 bg-red-500/[0.06] px-2.5 text-xs text-red-700 hover:bg-red-500/10 sm:min-h-[44px] sm:px-3 sm:text-sm dark:border-red-500/35 dark:bg-red-500/[0.08] dark:text-red-300 dark:hover:bg-red-500/15 md:px-4"
                    onClick={() => setDebugModalOpen(true)}
                  >
                    Debug…
                  </button>
                ) : null}
                {canManage && canAmrModule ? (
                  <button
                    type="button"
                    disabled={saveTemplateBusy}
                    className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50 sm:min-h-[44px] sm:px-3 sm:text-sm md:px-4"
                    onClick={() => openSaveTemplateModal()}
                  >
                    <span className="hidden sm:inline">Save template</span>
                    <span className="inline sm:hidden">Save…</span>
                  </button>
                ) : null}
              </div>
            </div>
            <p className="text-sm text-foreground/70">
              Create uses <span className="font-medium text-foreground">containerIn</span> then{' '}
              <span className="font-medium text-foreground">submitMission</span> for the first stop (same order for two or
              more stops). Positions must match fleet external codes (stands). Use{' '}
              <span className="font-medium text-foreground">Add Stop</span> for extra destinations; then{' '}
              <span className="font-medium text-foreground">Continue</span> on Missions for each following stop.
            </p>
          </div>
          {error ? (
            <MissionErrorBanner
              message={error}
              onDismiss={() => {
                setError('')
                setFieldError(null)
              }}
            />
          ) : null}
          {missionFields}
          {missionActionRow}
        </div>
      )}

      {(variant === 'modal' || variant === 'templateEditor' || canAmrApiDebug) && (
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

      {pickerLegIdx !== null ? (
        (() => {
          const idx = pickerLegIdx
          const total = legs.length
          const pl = legs[idx]
          const departDrop = idx < total - 1 && pl?.segmentStartPutDown === true
          const arriveDrop =
            idx === 0 ? false : idx === total - 1 ? true : pl?.putDown === true
          const pickerMode: 'pickup' | 'dropoff' | 'any' =
            idx === 0
              ? 'pickup'
              : idx === total - 1
                ? 'dropoff'
                : departDrop === arriveDrop
                  ? departDrop
                    ? 'dropoff'
                    : 'pickup'
                  : 'any'
          return (
            <AmrStandPickerModal
              stackOrder={variant === 'modal' || variant === 'templateEditor' ? 'aboveDialogs' : 'base'}
              stands={stands}
              mode={pickerMode}
              zoneCategories={zoneCategories}
              canOverride={canOverrideSpecial}
              allowGroups={idx > 0}
              omitNonStandWaypoints={idx === 0 || idx === total - 1}
              onClose={() => setPickerLegIdx(null)}
              onSelect={(externalRef, opts) => {
                if (idx === null) return
                if (opts.override) setOverrideSpecialLocations(true)
                const gid = opts.groupId?.trim()
                if (gid) {
                  updateLeg(idx, { position: '', groupId: gid })
                } else {
                  updateLeg(idx, {
                    position: externalRef,
                    groupId: undefined,
                  })
                }
                setPickerLegIdx(null)
              }}
            />
          )
        })()
      ) : null}

      <AmrRobotSelectModal
        open={robotSelectOpen}
        onClose={() => setRobotSelectOpen(false)}
        rows={activeRobotsForPicker}
        selectedIds={selectedRobotIds}
        onConfirm={(ids) => setSelectedRobotIds(ids)}
        loading={robotFleetLoading}
        error={robotFleetErr}
        onRefresh={() => {
          void loadRobotFleet({ showSpinner: true })
          void refreshRobotLocks()
        }}
        lockedIds={lockedRobotIds}
        onGoToRobotsManage={goToRobotsManagePage}
      />

      {saveTemplateOpen && variant !== 'templateEditor' ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="save-template-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !saveTemplateBusy) setSaveTemplateOpen(false)
          }}
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="save-template-title" className="text-lg font-semibold text-foreground">
              Save as template
            </h2>
            <p className="mt-1 text-sm text-foreground/70">
              Shared with everyone who can open AMR. Template names must be unique.
            </p>
            <input
              className="mt-4 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={saveTemplateName}
              onChange={(e) => setSaveTemplateName(e.target.value)}
              placeholder="Template name"
              autoFocus
              disabled={saveTemplateBusy}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitSaveTemplate()
              }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="min-h-[44px] rounded-lg border border-border px-4 text-sm hover:bg-muted disabled:opacity-50"
                disabled={saveTemplateBusy}
                onClick={() => setSaveTemplateOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="min-h-[44px] rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                disabled={saveTemplateBusy || !saveTemplateName.trim()}
                onClick={() => void submitSaveTemplate()}
              >
                {saveTemplateBusy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
})

AmrMissionNewForm.displayName = 'AmrMissionNewForm'

/** Full-page route — prefer opening {@link AmrMissionNewForm} in the modal from layout. */
export function AmrMissionNew() {
  return <AmrMissionNewForm variant="page" />
}

export default AmrMissionNew
