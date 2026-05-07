import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  AMR_STAND_GROUP_PREFIX,
  getAmrSettings,
  getAmrStandGroups,
  postStandPresence,
  type ZoneCategory,
  type AmrStandPickerMode,
} from '@/api/amr'
import {
  AMR_STAND_LOCATION_TYPE_NON_STAND,
  normalizeAmrStandLocationType,
} from '@/utils/amrStandLocationType'
import { PalletPresenceGlyph, palletPresenceKindFromState, type PalletPresenceKind } from '@/components/amr/PalletPresenceGlyph'
import { ToggleSwitch } from '@/components/ui/ToggleSwitch'

export type AmrStandPickerRow = {
  id: string
  external_ref: string
  zone: string
  location_label: string
  /** Degrees / fleet string from stands — used for containerIn enter orientation from start location. */
  orientation: string
  /** Special-location flag: 1 = no pallet pickup at this stand (no lift). Optional for backward compat. */
  block_pickup?: number
  /** When 1, pallet presence sanity checks do not block this stand. */
  bypass_pallet_check?: number
  /** Special-location flag: 1 = no pallet dropoff at this stand (no lower). Optional for backward compat. */
  block_dropoff?: number
  /** `non_stand` = waypoint — typically no Hyperion pallet presence UI; lift/lower allowed unless blocked. */
  location_type?: string
}

/** Orientation string to send with containerIn / first mission stop from a stand external ref. */
export function enterOrientationForStandRef(stands: AmrStandPickerRow[], externalRef: string): string {
  const p = externalRef.trim()
  if (!p) return '0'
  const stand = stands.find((s) => s.external_ref.trim() === p)
  const o = stand?.orientation?.trim()
  return o !== undefined && o !== '' ? o : '0'
}

type Step = { kind: 'zones' } | { kind: 'stands'; zone: string }

function isStandRestricted(s: AmrStandPickerRow, mode: AmrStandPickerMode): boolean {
  if (mode === 'pickup') return Number(s.block_pickup ?? 0) === 1
  if (mode === 'dropoff') return Number(s.block_dropoff ?? 0) === 1
  return false
}

function visibleStandsForMode(
  stands: AmrStandPickerRow[],
  mode: AmrStandPickerMode,
  showRestricted: boolean
): AmrStandPickerRow[] {
  if (mode === 'any' || showRestricted) return stands
  return stands.filter((s) => !isStandRestricted(s, mode))
}

function standsInZone(stands: AmrStandPickerRow[], zone: string): AmrStandPickerRow[] {
  return stands
    .filter((s) => (s.zone ?? '').trim() === zone)
    .slice()
    .sort((a, b) => a.external_ref.localeCompare(b.external_ref))
}

function zoneLabel(zone: string): string {
  const t = zone.trim()
  return t === '' ? 'No zone' : t
}

function parseStandGroupZoneKey(zone: string): string | null {
  const t = zone.trim()
  if (!t.startsWith(AMR_STAND_GROUP_PREFIX)) return null
  const id = t.slice(AMR_STAND_GROUP_PREFIX.length).trim()
  return id || null
}

/** Single-stand zone row: prefer friendly location label, else external ref. */
function soleStandZoneButtonLabel(s: AmrStandPickerRow): string {
  const ref = s.external_ref.trim()
  const lab = s.location_label.trim()
  return lab || ref || '—'
}

/**
 * Multi-card stand grid on zone step 1. Legacy: only when the zone has exactly 2 stands.
 * Explicit (`zonePickerInlineZones` in settings): listed zone keys use the grid for any stand count (including 1 or many).
 */
function zoneShowsExpandedStandGridOnZonesStep(
  zoneKey: string,
  standsInZoneCount: number,
  explicitInlineSet: Set<string> | null
): boolean {
  if (standsInZoneCount <= 0) return false
  const z = zoneKey.trim()
  if (!z) return false
  if (explicitInlineSet === null) {
    return standsInZoneCount === 2
  }
  return explicitInlineSet.has(z)
}

/** Sole-stand shortcut on zone step 1 uses Hyperion presence polling (compact tile, not expanded grid). */
function zoneEligibleForZonesStepSoleChip(
  zoneKey: string,
  standsInZoneCount: number,
  explicitInlineSet: Set<string> | null
): boolean {
  if (standsInZoneCount !== 1) return false
  const z = zoneKey.trim()
  if (!z) return false
  if (explicitInlineSet !== null && explicitInlineSet.has(z)) {
    return false
  }
  return true
}

type ZoneGroup = { categoryName: string | null; categoryKey: string; zones: string[] }

type StandGroupOrderRow = { zone: string }

/**
 * Align synthetic `__group:` zone chips with `GET /stand-groups` order (`sort_order`), matching Stand groups page +
 * `buildGroupsCategoryZones`: live groups in API order, then stale group keys, then non-group keys (relative order kept
 * for the last two buckets).
 */
function reorderZonesUsingStandGroupApiOrder(zones: string[], standGroupsOrdered: StandGroupOrderRow[]): string[] {
  if (standGroupsOrdered.length === 0) return zones
  const liveOrder = standGroupsOrdered.map((g) => g.zone.trim()).filter(Boolean)
  const liveSet = new Set(liveOrder)
  const inCat = new Set(zones.map((z) => z.trim()))
  const live = liveOrder.filter((k) => inCat.has(k))
  const stale: string[] = []
  const rest: string[] = []
  for (const z of zones) {
    const t = z.trim()
    if (!t.startsWith(AMR_STAND_GROUP_PREFIX)) {
      rest.push(z)
      continue
    }
    if (liveSet.has(t)) continue
    stale.push(z)
  }
  return [...live, ...stale, ...rest]
}

/** Uncategorized bucket: stand-group tiles first (API order), then other zones alphabetically (empty zone last). */
function sortUncategorizedZoneKeysForPicker(
  keys: string[],
  standGroupsOrdered: StandGroupOrderRow[]
): string[] {
  if (standGroupsOrdered.length === 0) {
    const copy = [...keys]
    copy.sort((a, b) => {
      if (a === '' && b !== '') return 1
      if (b === '' && a !== '') return -1
      return a.localeCompare(b)
    })
    return copy
  }
  const keySet = new Set(keys)
  const liveOrder = standGroupsOrdered.map((g) => g.zone.trim()).filter(Boolean)
  const liveSet = new Set(liveOrder)
  const live = liveOrder.filter((k) => keySet.has(k))
  const staleGroups: string[] = []
  const normal: string[] = []
  for (const z of keys) {
    const t = z.trim()
    if (t.startsWith(AMR_STAND_GROUP_PREFIX)) {
      if (liveSet.has(t)) continue
      staleGroups.push(z)
    } else {
      normal.push(z)
    }
  }
  staleGroups.sort((a, b) => {
    if (a === '' && b !== '') return 1
    if (b === '' && a !== '') return -1
    return a.localeCompare(b)
  })
  normal.sort((a, b) => {
    if (a === '' && b !== '') return 1
    if (b === '' && a !== '') return -1
    return a.localeCompare(b)
  })
  return [...live, ...staleGroups, ...normal]
}

/**
 * Build the step-1 zone list grouped under category headers from `zoneCategories`. Zones not listed in any category
 * (or with no current stand) flow into the synthetic "Uncategorized" group rendered last. Within each group, zones are
 * shown in the user-configured order; the Uncategorized group sorts alphabetically. Stand-group entries follow API
 * `sort_order` when `standGroupsOrdered` is passed (same order as the Stand groups page).
 */
function buildZoneGroups(
  visibleStands: AmrStandPickerRow[],
  zoneCategories: ZoneCategory[],
  extraZoneKeys: string[] = [],
  standGroupsOrdered?: StandGroupOrderRow[]
): ZoneGroup[] {
  const visibleZoneSet = new Set<string>()
  for (const s of visibleStands) visibleZoneSet.add((s.zone ?? '').trim())
  for (const k of extraZoneKeys) {
    const t = k.trim()
    if (t) visibleZoneSet.add(t)
  }
  const groups: ZoneGroup[] = []
  const claimed = new Set<string>()
  const applyGroupOrder =
    standGroupsOrdered !== undefined && standGroupsOrdered.length > 0 ? standGroupsOrdered : null
  for (const cat of zoneCategories) {
    let zones = cat.zones.filter((z) => visibleZoneSet.has(z))
    if (applyGroupOrder) zones = reorderZonesUsingStandGroupApiOrder(zones, applyGroupOrder)
    for (const z of zones) claimed.add(z)
    if (zones.length === 0) continue
    groups.push({ categoryName: cat.name, categoryKey: `cat:${cat.name}`, zones })
  }
  let remaining = [...visibleZoneSet].filter((z) => !claimed.has(z))
  remaining =
    applyGroupOrder != null ? sortUncategorizedZoneKeysForPicker(remaining, applyGroupOrder) : [...remaining].sort((a, b) => {
        if (a === '' && b !== '') return 1
        if (b === '' && a !== '') return -1
        return a.localeCompare(b)
      })
  if (remaining.length > 0) {
    groups.push({ categoryName: null, categoryKey: 'uncategorized', zones: remaining })
  }
  return groups
}

function rowPresenceKind(
  ref: string,
  stand: AmrStandPickerRow | undefined,
  ctx: {
    presence: Record<string, boolean | null>
    presLoading: boolean
    presError: boolean
    presUnconfig: boolean
  }
): PalletPresenceKind {
  const { presence, presLoading, presError, presUnconfig } = ctx
  const present = Object.prototype.hasOwnProperty.call(presence, ref) ? presence[ref] : null
  const nonStandWaypoint =
    !!stand &&
    normalizeAmrStandLocationType(stand.location_type) === AMR_STAND_LOCATION_TYPE_NON_STAND
  return palletPresenceKindFromState({
    nonStandWaypoint,
    present,
    loading: presLoading,
    error: presError,
    unconfigured: presUnconfig,
  })
}

export type AmrStandPickerMultiSelect = {
  /** External refs already selected — initial state for the multi-select set. */
  initialSelectedRefs: string[]
  /** Called with the chosen external refs (in zone-group iteration + zone alphabetical order). */
  onConfirm: (externalRefs: string[]) => void
}

export function AmrStandPickerModal({
  stands,
  onClose,
  onSelect,
  stackOrder = 'base',
  mode = 'any',
  zoneCategories,
  canOverride = false,
  allowGroups = false,
  /** When true, hide non-stand waypoints until the user enables "Show restricted" (needs canOverride + pickup/dropoff). */
  omitNonStandWaypoints = false,
  multiSelect,
}: {
  stands: AmrStandPickerRow[]
  onClose: () => void
  onSelect: (externalRef: string, opts: { override?: boolean; groupId?: string }) => void
  /** Use `aboveDialogs` when opening over another full-screen modal (e.g. Add container). */
  stackOrder?: 'base' | 'aboveDialogs'
  /** When set, hides stands whose `block_pickup` (mode=pickup) / `block_dropoff` (mode=dropoff) flag is set. */
  mode?: AmrStandPickerMode
  /** Ordered zone categories from settings — drives step-1 grouping. Reads from settings if omitted. */
  zoneCategories?: ZoneCategory[]
  /** When true, render the "Show restricted stands" toggle so authorized users can pick a blocked stand with override. */
  canOverride?: boolean
  /** When true (stop 2+), load stand groups and allow picking a group pool from the zone list. */
  allowGroups?: boolean
  /** When true, hide non-stand waypoints until "Show restricted" (needs canOverride + pickup/dropoff). */
  omitNonStandWaypoints?: boolean
  /**
   * When set, switches the picker into multi-select mode: zones step still drills into a zone, but the stands
   * step renders checkboxes and a Done footer. Stand-group entries are hidden (groups can't be members of groups).
   */
  multiSelect?: AmrStandPickerMultiSelect
}) {
  const [step, setStep] = useState<Step>({ kind: 'zones' })
  const [showRestricted, setShowRestricted] = useState(false)
  const [resolvedCategories, setResolvedCategories] = useState<ZoneCategory[]>(zoneCategories ?? [])
  /** `null` = legacy inline for zones with only 1–2 stands; else only those zone keys expand on step 1. */
  const [pickerInlineZonesExplicit, setPickerInlineZonesExplicit] = useState<Set<string> | null>(null)
  const [standGroups, setStandGroups] = useState<Array<{ id: string; name: string; zone: string }>>([])
  const bodyScrollRef = useRef<HTMLDivElement>(null)
  const zClass = stackOrder === 'aboveDialogs' ? 'z-[80]' : 'z-50'

  /** Multi-select mode: keep selection across zone navigation. */
  const isMultiSelect = multiSelect != null
  const [pendingRefs, setPendingRefs] = useState<Set<string>>(
    () => new Set(multiSelect?.initialSelectedRefs ?? [])
  )

  /** Pickers may show restricted stands only when authorized; the toggle never appears for `any` mode. */
  const restrictionToggleVisible = canOverride && mode !== 'any'

  const visibleStands = useMemo(() => {
    let v = visibleStandsForMode(stands, mode, restrictionToggleVisible && showRestricted)
    const hideNonStandWaypoints =
      omitNonStandWaypoints && !(restrictionToggleVisible && showRestricted)
    if (hideNonStandWaypoints) {
      v = v.filter((s) => normalizeAmrStandLocationType(s.location_type) !== AMR_STAND_LOCATION_TYPE_NON_STAND)
    }
    return v
  }, [stands, mode, restrictionToggleVisible, showRestricted, omitNonStandWaypoints])

  /** Stand groups are not nestable — hide the synthetic group entries when picking members for a group. */
  const extraGroupZones = useMemo(
    () => (allowGroups && !isMultiSelect ? standGroups.map((g) => g.zone).filter(Boolean) : []),
    [allowGroups, isMultiSelect, standGroups]
  )

  const zoneGroups = useMemo(
    () =>
      buildZoneGroups(
        visibleStands,
        resolvedCategories,
        extraGroupZones,
        allowGroups && !isMultiSelect && standGroups.length > 0 ? standGroups : undefined
      ),
    [visibleStands, resolvedCategories, extraGroupZones, allowGroups, isMultiSelect, standGroups]
  )

  const standsForStep = useMemo(() => {
    if (step.kind !== 'stands') return []
    return standsInZone(visibleStands, step.zone)
  }, [visibleStands, step])

  const standIdsForZone = useMemo(() => {
    if (step.kind !== 'stands') return [] as string[]
    return standsForStep.map((s) => s.external_ref.trim()).filter(Boolean)
  }, [standsForStep, step.kind])

  /**
   * Stand refs that appear on the zones step itself (expanded grid, or sole-stand compact tile with presence).
   * Group synthetic zones excluded — they never list member stands here.
   */
  const zonesStepInlinePresenceIds = useMemo(() => {
    const ids: string[] = []
    const seen = new Set<string>()
    for (const g of zoneGroups) {
      for (const z of g.zones) {
        if (parseStandGroupZoneKey(z)) continue
        const inZone = standsInZone(visibleStands, z)
        if (
          !zoneShowsExpandedStandGridOnZonesStep(z, inZone.length, pickerInlineZonesExplicit) &&
          !zoneEligibleForZonesStepSoleChip(z, inZone.length, pickerInlineZonesExplicit)
        ) {
          continue
        }
        if (zoneShowsExpandedStandGridOnZonesStep(z, inZone.length, pickerInlineZonesExplicit)) {
          for (const s of inZone) {
            const ref = s.external_ref.trim()
            if (ref && !seen.has(ref)) {
              seen.add(ref)
              ids.push(ref)
            }
          }
          continue
        }
        for (const s of inZone) {
          const ref = s.external_ref.trim()
          if (ref && !seen.has(ref)) {
            seen.add(ref)
            ids.push(ref)
          }
        }
      }
    }
    return ids
  }, [zoneGroups, visibleStands, pickerInlineZonesExplicit])

  const standIdsForPresence = useMemo(() => {
    if (step.kind === 'stands') return standIdsForZone
    if (step.kind === 'zones') return zonesStepInlinePresenceIds
    return []
  }, [step.kind, standIdsForZone, zonesStepInlinePresenceIds])

  const standsByExternalRef = useMemo(
    () => new Map(stands.map((s) => [s.external_ref.trim(), s])),
    [stands]
  )

  const standIdsForPresenceQuery = useMemo(
    () =>
      standIdsForPresence.filter((id) => {
        const row = standsByExternalRef.get(id.trim())
        return (
          !row || normalizeAmrStandLocationType(row.location_type) !== AMR_STAND_LOCATION_TYPE_NON_STAND
        )
      }),
    [standIdsForPresence, standsByExternalRef]
  )

  const [presence, setPresence] = useState<Record<string, boolean | null>>({})
  const [presLoading, setPresLoading] = useState(false)
  const [presError, setPresError] = useState(false)
  const [presUnconfig, setPresUnconfig] = useState(false)
  /** Matches Containers page poll interval from AMR settings. */
  const [pollMsContainers, setPollMsContainers] = useState(5000)

  const loadPresence = useCallback(async (ids: string[], opts?: { silent?: boolean }) => {
    if (ids.length === 0) return
    const silent = opts?.silent === true
    if (!silent) {
      setPresLoading(true)
      setPresError(false)
      setPresUnconfig(false)
    }
    try {
      const map = await postStandPresence(ids)
      setPresence((prev) => {
        const next = { ...prev }
        for (const id of ids) {
          next[id] = Object.prototype.hasOwnProperty.call(map, id) ? map[id] : null
        }
        return next
      })
      setPresError(false)
      setPresUnconfig(false)
    } catch (e: unknown) {
      if (silent) return
      const status = (e as { response?: { status?: number } })?.response?.status
      if (status === 503) setPresUnconfig(true)
      else setPresError(true)
    } finally {
      if (!silent) setPresLoading(false)
    }
  }, [])

  const idsKey = standIdsForPresenceQuery.join('\0')

  useEffect(() => {
    let cancelled = false
    void getAmrSettings().then((s) => {
      if (cancelled) return
      setPollMsContainers(Math.max(3000, s.pollMsContainers))
      if (zoneCategories === undefined && Array.isArray(s.zoneCategories)) {
        setResolvedCategories(s.zoneCategories)
      }
      if (s.zonePickerInlineZones !== undefined) {
        setPickerInlineZonesExplicit(
          new Set(s.zonePickerInlineZones.map((x) => String(x).trim()).filter(Boolean))
        )
      } else {
        setPickerInlineZonesExplicit(null)
      }
    })
    return () => {
      cancelled = true
    }
  }, [zoneCategories])

  useEffect(() => {
    if (!allowGroups) {
      setStandGroups([])
      return
    }
    let cancelled = false
    void getAmrStandGroups()
      .then((rows) => {
        if (cancelled) return
        setStandGroups(
          rows
            .filter((g) => Number(g.enabled ?? 1) === 1)
            .map((g) => ({
              id: g.id,
              name: g.name,
              zone: g.zone,
              sort_order: Number(g.sort_order ?? 0),
            }))
            .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
            .map(({ id, name, zone }) => ({ id, name, zone }))
        )
      })
      .catch(() => {
        if (!cancelled) setStandGroups([])
      })
    return () => {
      cancelled = true
    }
  }, [allowGroups])

  useEffect(() => {
    if (zoneCategories !== undefined) setResolvedCategories(zoneCategories)
  }, [zoneCategories])

  /**
   * Keep the picker body scrolled to top whenever the step changes:
   * - zones list ↔ stands list (“← All zones” / tapping a zone)
   * - switching to a different zone’s stand list
   * useLayoutEffect runs before paint so the stale position doesn’t flash.
   */
  useLayoutEffect(() => {
    const el = bodyScrollRef.current
    if (!el) return
    el.scrollTop = 0
    requestAnimationFrame(() => {
      el.scrollTop = 0
    })
  }, [step])

  useEffect(() => {
    if (standIdsForPresenceQuery.length === 0) return
    void loadPresence(standIdsForPresenceQuery, { silent: true })
  }, [step.kind, idsKey, loadPresence, standIdsForPresenceQuery])

  useEffect(() => {
    if (standIdsForPresenceQuery.length === 0) return
    const tid = window.setInterval(() => {
      void loadPresence(standIdsForPresenceQuery, { silent: true })
    }, pollMsContainers)
    return () => clearInterval(tid)
  }, [step.kind, idsKey, loadPresence, pollMsContainers, standIdsForPresenceQuery])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={`fixed inset-0 ${zClass} flex items-end justify-center p-0 sm:items-center sm:p-4`}>
      <div className="absolute inset-0 bg-black/50" aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="stand-picker-title"
        className="relative z-10 flex max-h-[min(92vh,540px)] w-full max-w-lg flex-col overflow-hidden rounded-t-xl border border-border bg-card shadow-lg sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            {step.kind === 'stands' ? (
              <button
                type="button"
                className="mb-1 text-xs font-medium text-primary hover:underline"
                onClick={() => setStep({ kind: 'zones' })}
              >
                ← All zones
              </button>
            ) : null}
            <h2 id="stand-picker-title" className="text-base font-semibold text-foreground">
              {step.kind === 'zones' ? 'Choose zone' : `Stands — ${zoneLabel(step.zone)}`}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {standIdsForPresenceQuery.length > 0 ? (
              <button
                type="button"
                disabled={presLoading}
                className="rounded-lg px-2 py-1.5 text-xs font-medium text-primary hover:bg-muted disabled:opacity-50"
                title="Refresh pallet status"
                aria-label="Refresh pallet status"
                onClick={() => void loadPresence(standIdsForPresenceQuery)}
              >
                {presLoading ? '…' : 'Refresh'}
              </button>
            ) : null}
            <button
              type="button"
              className="shrink-0 rounded-lg p-2 text-foreground/70 hover:bg-muted hover:text-foreground"
              aria-label="Close"
              onClick={onClose}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div ref={bodyScrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
          {stands.length === 0 && !(allowGroups && standGroups.length > 0) ? (
            <p className="text-sm text-foreground/60">No stands configured. Add stands under Positions / stands.</p>
          ) : step.kind === 'zones' ? (
            zoneGroups.length === 0 ? (
              <p className="text-sm text-foreground/60">
                {mode === 'pickup'
                  ? 'No stands allow pallet pickup.'
                  : mode === 'dropoff'
                  ? 'No stands allow pallet dropoff.'
                  : 'No stands available.'}
                {restrictionToggleVisible && !showRestricted
                  ? ` Toggle "Show restricted" below to include them.${
                      omitNonStandWaypoints ? ' Non-stand waypoints for this stop also require Restricted on.' : ''
                    }`
                  : ''}
              </p>
            ) : (
              <div className="space-y-3">
                {zoneGroups.map((g) => (
                  <div key={g.categoryKey} className="space-y-2">
                    <h3 className="text-[10px] font-semibold uppercase tracking-wider text-foreground/55">
                      {g.categoryName ?? 'Uncategorized'}
                    </h3>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {g.zones.map((z) => {
                        const groupPickId = parseStandGroupZoneKey(z)
                        const inZone = standsInZone(visibleStands, z)
                        const groupTitle = groupPickId
                          ? standGroups.find((sg) => sg.id === groupPickId)?.name ?? 'Stand group'
                          : null

                        const expandGrid =
                          !groupPickId &&
                          zoneShowsExpandedStandGridOnZonesStep(z, inZone.length, pickerInlineZonesExplicit)
                        if (expandGrid && inZone.length > 0) {
                          const zn = zoneLabel(z)
                          return (
                            <Fragment key={z === '' ? '__no_zone__' : z}>
                              {inZone.map((s) => {
                                const ref = s.external_ref.trim()
                                const lab = s.location_label.trim()
                                const sub = lab && lab !== ref ? lab : ''
                                const restrictedRow = isStandRestricted(s, mode)
                                const pk = rowPresenceKind(ref, s, {
                                  presence,
                                  presLoading,
                                  presError,
                                  presUnconfig,
                                })
                                const checked = isMultiSelect && pendingRefs.has(ref)
                                return (
                                  <button
                                    key={s.id}
                                    type="button"
                                    title={`Zone: ${zn}`}
                                    className={`flex w-full flex-col items-stretch rounded-lg border bg-background px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                                      checked
                                        ? 'border-primary ring-1 ring-primary/35'
                                        : restrictedRow
                                          ? 'border-amber-500 ring-1 ring-amber-500/35 dark:border-amber-400 dark:ring-amber-400/30'
                                          : 'border-border'
                                    }`}
                                    onClick={() => {
                                      if (isMultiSelect) {
                                        if (!ref) return
                                        setPendingRefs((prev) => {
                                          const next = new Set(prev)
                                          if (next.has(ref)) next.delete(ref)
                                          else next.add(ref)
                                          return next
                                        })
                                        return
                                      }
                                      onSelect(ref, restrictedRow ? { override: true } : {})
                                    }}
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      {isMultiSelect ? (
                                        <input
                                          type="checkbox"
                                          className="mt-0.5 h-4 w-4 shrink-0 rounded border-border"
                                          checked={checked}
                                          readOnly
                                          aria-label={`Toggle ${ref}`}
                                        />
                                      ) : null}
                                      <span className="min-w-0 break-all font-mono text-sm font-semibold text-foreground">
                                        {ref}
                                      </span>
                                      <PalletPresenceGlyph kind={pk} className="h-4 w-4 shrink-0" showLabel />
                                    </div>
                                    {sub ? (
                                      <span className="mt-0.5 line-clamp-2 text-xs text-foreground/60">{sub}</span>
                                    ) : null}
                                  </button>
                                )
                              })}
                            </Fragment>
                          )
                        }

                        const sole =
                          !groupPickId && zoneEligibleForZonesStepSoleChip(z, inZone.length, pickerInlineZonesExplicit)
                            ? inZone[0]
                            : null
                        const restricted = sole ? isStandRestricted(sole, mode) : false
                        return (
                          <button
                            key={z === '' ? '__no_zone__' : z}
                            type="button"
                            className={`rounded-lg border bg-background px-4 py-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                              sole && restricted
                                ? 'border-amber-500 ring-1 ring-amber-500/35 dark:border-amber-400 dark:ring-amber-400/30'
                                : 'border-border'
                            }`}
                            onClick={() => {
                              if (groupPickId && allowGroups && !isMultiSelect) {
                                onSelect('', { groupId: groupPickId })
                                onClose()
                                return
                              }
                              if (sole && !isMultiSelect) {
                                const ref = sole.external_ref.trim()
                                onSelect(ref, restricted ? { override: true } : {})
                                return
                              }
                              if (sole && isMultiSelect) {
                                const ref = sole.external_ref.trim()
                                if (!ref) return
                                setPendingRefs((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(ref)) next.delete(ref)
                                  else next.add(ref)
                                  return next
                                })
                                return
                              }
                              setStep({ kind: 'stands', zone: z })
                            }}
                          >
                            {sole ? (
                              <span className="flex w-full items-start justify-between gap-2">
                                {isMultiSelect ? (
                                  <input
                                    type="checkbox"
                                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-border"
                                    checked={pendingRefs.has(sole.external_ref.trim())}
                                    readOnly
                                    aria-label={`Toggle ${sole.external_ref.trim()}`}
                                  />
                                ) : null}
                                <span className="min-w-0 break-all text-sm font-medium text-foreground">
                                  {soleStandZoneButtonLabel(sole)}
                                </span>
                                <PalletPresenceGlyph
                                  kind={rowPresenceKind(sole.external_ref.trim(), sole, {
                                    presence,
                                    presLoading,
                                    presError,
                                    presUnconfig,
                                  })}
                                  className="h-4 w-4 shrink-0"
                                  showLabel
                                />
                              </span>
                            ) : groupTitle ? (
                              <span className="flex flex-col gap-0.5">
                                <span className="text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                                  Group
                                </span>
                                <span className="break-words">{groupTitle}</span>
                              </span>
                            ) : (
                              zoneLabel(z)
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : standsForStep.length === 0 ? (
            <p className="text-sm text-foreground/60">No stands in this zone.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {standsForStep.map((s) => {
                const ref = s.external_ref.trim()
                const label = s.location_label.trim()
                const sub = label && label !== ref ? label : ''
                const restricted = isStandRestricted(s, mode)
                const pk = rowPresenceKind(ref, s, {
                  presence,
                  presLoading,
                  presError,
                  presUnconfig,
                })
                const checked = isMultiSelect && pendingRefs.has(ref)
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`flex w-full flex-col items-stretch rounded-lg border bg-background px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      checked
                        ? 'border-primary ring-1 ring-primary/35'
                        : restricted
                          ? 'border-amber-500 ring-1 ring-amber-500/35 dark:border-amber-400 dark:ring-amber-400/30'
                          : 'border-border'
                    }`}
                    onClick={() => {
                      if (isMultiSelect) {
                        if (!ref) return
                        setPendingRefs((prev) => {
                          const next = new Set(prev)
                          if (next.has(ref)) next.delete(ref)
                          else next.add(ref)
                          return next
                        })
                        return
                      }
                      onSelect(ref, restricted ? { override: true } : {})
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      {isMultiSelect ? (
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 shrink-0 rounded border-border"
                          checked={checked}
                          readOnly
                          aria-label={`Toggle ${ref}`}
                        />
                      ) : null}
                      <span className="min-w-0 break-all font-mono text-sm font-semibold text-foreground">{ref}</span>
                      <PalletPresenceGlyph kind={pk} className="h-4 w-4 shrink-0" showLabel />
                    </div>
                    {sub ? (
                      <span className="mt-0.5 line-clamp-2 text-xs text-foreground/60">{sub}</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {isMultiSelect ? (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/30 px-4 py-2.5">
            <span className="text-xs font-medium text-foreground/75">
              Selected {pendingRefs.size}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="min-h-[40px] rounded-lg border border-border bg-background px-3 text-sm hover:bg-muted"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="button"
                className="min-h-[40px] rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
                onClick={() => {
                  multiSelect?.onConfirm([...pendingRefs])
                  onClose()
                }}
              >
                Done
              </button>
            </div>
          </div>
        ) : null}

        {restrictionToggleVisible ? (
          <div
            className={`flex shrink-0 items-center gap-3 border-t px-4 py-2.5 ${
              showRestricted
                ? 'border-amber-500/40 bg-amber-500/15 dark:border-amber-500/35 dark:bg-amber-950/40'
                : 'border-border bg-muted/30'
            }`}
          >
            <ToggleSwitch
              size="sm"
              checked={showRestricted}
              onCheckedChange={setShowRestricted}
              className={
                showRestricted
                  ? '!border-amber-600 !bg-amber-600 hover:!brightness-110 dark:!border-amber-500 dark:!bg-amber-600'
                  : undefined
              }
              aria-label={
                showRestricted
                  ? 'Showing Restricted stands; switch to hide them'
                  : 'Hiding Restricted stands; switch to show them'
              }
            />
            <span
              className={`min-w-0 flex-1 text-xs font-medium ${
                showRestricted
                  ? 'text-amber-950 dark:text-amber-100'
                  : 'text-foreground/80'
              }`}
            >
              {showRestricted ? 'Showing Restricted' : 'Hiding Restricted'}
              <span
                className={
                  showRestricted
                    ? 'font-normal text-amber-800/80 dark:text-amber-300/90'
                    : 'text-foreground/50'
                }
              >
                {' '}
                ({mode === 'pickup' ? 'no-lift' : 'no-lower'}
                {omitNonStandWaypoints ? '; non-stand waypoints when on' : ''})
              </span>
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Map pin / teardrop icon for location picker triggers */
export function LocationPinIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"
      />
    </svg>
  )
}
