import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAmrSettings, postStandPresence, type ZoneCategory, type AmrStandPickerMode } from '@/api/amr'
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
  /** Special-location flag: 1 = no pallet dropoff at this stand (no lower). Optional for backward compat. */
  block_dropoff?: number
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

/** Single-stand zone row: prefer friendly location label, else external ref. */
function soleStandZoneButtonLabel(s: AmrStandPickerRow): string {
  const ref = s.external_ref.trim()
  const lab = s.location_label.trim()
  return lab || ref || '—'
}

type ZoneGroup = { categoryName: string | null; categoryKey: string; zones: string[] }

/**
 * Build the step-1 zone list grouped under category headers from `zoneCategories`. Zones not listed in any category
 * (or with no current stand) flow into the synthetic "Uncategorized" group rendered last. Within each group, zones are
 * shown in the user-configured order; the Uncategorized group sorts alphabetically.
 */
function buildZoneGroups(
  visibleStands: AmrStandPickerRow[],
  zoneCategories: ZoneCategory[]
): ZoneGroup[] {
  const visibleZoneSet = new Set<string>()
  for (const s of visibleStands) visibleZoneSet.add((s.zone ?? '').trim())
  const groups: ZoneGroup[] = []
  const claimed = new Set<string>()
  for (const cat of zoneCategories) {
    const zones = cat.zones.filter((z) => visibleZoneSet.has(z))
    for (const z of zones) claimed.add(z)
    if (zones.length === 0) continue
    groups.push({ categoryName: cat.name, categoryKey: `cat:${cat.name}`, zones })
  }
  const remaining = [...visibleZoneSet].filter((z) => !claimed.has(z))
  remaining.sort((a, b) => {
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
  ctx: {
    presence: Record<string, boolean | null>
    presLoading: boolean
    presError: boolean
    presUnconfig: boolean
  }
): PalletPresenceKind {
  const { presence, presLoading, presError, presUnconfig } = ctx
  const present = Object.prototype.hasOwnProperty.call(presence, ref) ? presence[ref] : null
  return palletPresenceKindFromState({
    present,
    loading: presLoading,
    error: presError,
    unconfigured: presUnconfig,
  })
}

export function AmrStandPickerModal({
  stands,
  onClose,
  onSelect,
  stackOrder = 'base',
  mode = 'any',
  zoneCategories,
  canOverride = false,
}: {
  stands: AmrStandPickerRow[]
  onClose: () => void
  onSelect: (externalRef: string, opts: { override?: boolean }) => void
  /** Use `aboveDialogs` when opening over another full-screen modal (e.g. Add container). */
  stackOrder?: 'base' | 'aboveDialogs'
  /** When set, hides stands whose `block_pickup` (mode=pickup) / `block_dropoff` (mode=dropoff) flag is set. */
  mode?: AmrStandPickerMode
  /** Ordered zone categories from settings — drives step-1 grouping. Reads from settings if omitted. */
  zoneCategories?: ZoneCategory[]
  /** When true, render the "Show restricted stands" toggle so authorized users can pick a blocked stand with override. */
  canOverride?: boolean
}) {
  const [step, setStep] = useState<Step>({ kind: 'zones' })
  const [showRestricted, setShowRestricted] = useState(false)
  const [resolvedCategories, setResolvedCategories] = useState<ZoneCategory[]>(zoneCategories ?? [])
  const zClass = stackOrder === 'aboveDialogs' ? 'z-[80]' : 'z-50'

  /** Pickers may show restricted stands only when authorized; the toggle never appears for `any` mode. */
  const restrictionToggleVisible = canOverride && mode !== 'any'

  const visibleStands = useMemo(() => {
    return visibleStandsForMode(stands, mode, restrictionToggleVisible && showRestricted)
  }, [stands, mode, restrictionToggleVisible, showRestricted])

  const zoneGroups = useMemo(() => buildZoneGroups(visibleStands, resolvedCategories), [
    visibleStands,
    resolvedCategories,
  ])

  const standsForStep = useMemo(() => {
    if (step.kind !== 'stands') return []
    return standsInZone(visibleStands, step.zone)
  }, [visibleStands, step])

  const standIdsForZone = useMemo(() => {
    if (step.kind !== 'stands') return [] as string[]
    return standsForStep.map((s) => s.external_ref.trim()).filter(Boolean)
  }, [standsForStep, step.kind])

  /** Zones that show a single location inline — fetch presence here too (same as stands step). */
  const zonesStepSolePresenceIds = useMemo(() => {
    const ids: string[] = []
    const seen = new Set<string>()
    for (const g of zoneGroups) {
      for (const z of g.zones) {
        const inZone = standsInZone(visibleStands, z)
        if (inZone.length !== 1) continue
        const ref = inZone[0]!.external_ref.trim()
        if (ref && !seen.has(ref)) {
          seen.add(ref)
          ids.push(ref)
        }
      }
    }
    return ids
  }, [zoneGroups, visibleStands])

  const standIdsForPresence = useMemo(() => {
    if (step.kind === 'stands') return standIdsForZone
    if (step.kind === 'zones') return zonesStepSolePresenceIds
    return []
  }, [step.kind, standIdsForZone, zonesStepSolePresenceIds])

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

  const idsKey = standIdsForPresence.join('\0')

  useEffect(() => {
    let cancelled = false
    void getAmrSettings().then((s) => {
      if (cancelled) return
      setPollMsContainers(Math.max(3000, s.pollMsContainers))
      if (zoneCategories === undefined && Array.isArray(s.zoneCategories)) {
        setResolvedCategories(s.zoneCategories)
      }
    })
    return () => {
      cancelled = true
    }
  }, [zoneCategories])

  useEffect(() => {
    if (zoneCategories !== undefined) setResolvedCategories(zoneCategories)
  }, [zoneCategories])

  useEffect(() => {
    if (standIdsForPresence.length === 0) return
    void loadPresence(standIdsForPresence, { silent: true })
  }, [step.kind, idsKey, loadPresence, standIdsForPresence])

  useEffect(() => {
    if (standIdsForPresence.length === 0) return
    const tid = window.setInterval(() => {
      void loadPresence(standIdsForPresence, { silent: true })
    }, pollMsContainers)
    return () => clearInterval(tid)
  }, [step.kind, idsKey, loadPresence, pollMsContainers, standIdsForPresence])

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
            {standIdsForPresence.length > 0 ? (
              <button
                type="button"
                disabled={presLoading}
                className="rounded-lg px-2 py-1.5 text-xs font-medium text-primary hover:bg-muted disabled:opacity-50"
                title="Refresh pallet status"
                aria-label="Refresh pallet status"
                onClick={() => void loadPresence(standIdsForPresence)}
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

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {stands.length === 0 ? (
            <p className="text-sm text-foreground/60">No stands configured. Add stands under Positions / stands.</p>
          ) : step.kind === 'zones' ? (
            zoneGroups.length === 0 ? (
              <p className="text-sm text-foreground/60">
                {mode === 'pickup'
                  ? 'No stands allow pallet pickup.'
                  : mode === 'dropoff'
                  ? 'No stands allow pallet dropoff.'
                  : 'No stands available.'}
                {restrictionToggleVisible && !showRestricted ? ' Toggle "Show restricted" below to include them.' : ''}
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
                        const inZone = standsInZone(visibleStands, z)
                        const sole = inZone.length === 1 ? inZone[0] : null
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
                              if (sole) {
                                const ref = sole.external_ref.trim()
                                onSelect(ref, restricted ? { override: true } : {})
                              } else {
                                setStep({ kind: 'stands', zone: z })
                              }
                            }}
                          >
                            {sole ? (
                              <span className="flex w-full items-start justify-between gap-2">
                                <span className="min-w-0 break-all text-sm font-medium text-foreground">
                                  {soleStandZoneButtonLabel(sole)}
                                </span>
                                <PalletPresenceGlyph
                                  kind={rowPresenceKind(sole.external_ref.trim(), {
                                    presence,
                                    presLoading,
                                    presError,
                                    presUnconfig,
                                  })}
                                  className="h-4 w-4 shrink-0"
                                  showLabel
                                />
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
                const pk = rowPresenceKind(ref, {
                  presence,
                  presLoading,
                  presError,
                  presUnconfig,
                })
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`flex w-full flex-col items-stretch rounded-lg border bg-background px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      restricted
                        ? 'border-amber-500 ring-1 ring-amber-500/35 dark:border-amber-400 dark:ring-amber-400/30'
                        : 'border-border'
                    }`}
                    onClick={() => onSelect(ref, restricted ? { override: true } : {})}
                  >
                    <div className="flex items-start justify-between gap-2">
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
                ({mode === 'pickup' ? 'no-lift' : 'no-lower'})
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
