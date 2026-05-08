import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  getAmrSettings,
  getAmrStandHolds,
  getAmrStands,
  pollMsAmrNotificationUi as effectivePollMsAmrNotificationUi,
  postStandPresence,
  type AmrStandHold,
  type ZoneCategory,
} from '@/api/amr'
import {
  PalletPresenceGlyph,
  palletPresenceKindFromState,
} from '@/components/amr/PalletPresenceGlyph'
import {
  AMR_STAND_LOCATION_TYPE_NON_STAND,
  normalizeAmrStandLocationType,
} from '@/utils/amrStandLocationType'

/** Default until AMR settings load. */
const FALLBACK_POLL_MS = 5000

/** Fixed track width for stand cards (rem). Same for all zones — no shrinking for “many” stands. */
const CARD_CELL_FIXED_REM = 8.5

/** Matches `gap-2` between stand cards inside a zone grid. */
const CARD_GRID_GAP_REM = 0.5

/** Matches `gap-x-4` between adjacent zones on the same zone-row. */
const ZONE_ROW_GAP_REM = 1

function zoneMinWidthRemOneCardRow(standCount: number): number {
  if (standCount <= 0) return 2
  return (
    standCount * CARD_CELL_FIXED_REM + Math.max(0, standCount - 1) * CARD_GRID_GAP_REM
  )
}

function packZonesIntoRows<T extends { stands: { length: number } }>(
  zones: T[],
  containerWidthRem: number,
): T[][] {
  if (zones.length === 0) return []
  if (!Number.isFinite(containerWidthRem) || containerWidthRem <= 0) {
    return zones.map((z) => [z])
  }

  const halfW = containerWidthRem * 0.5
  const rows: T[][] = []
  let cur: T[] = []
  let usedRem = 0

  for (const z of zones) {
    const zw = zoneMinWidthRemOneCardRow(z.stands.length)
    const gap = cur.length === 0 ? 0 : ZONE_ROW_GAP_REM

    if (cur.length === 0) {
      cur.push(z)
      usedRem = zw
      continue
    }

    const prev = cur[cur.length - 1]
    const prevW = zoneMinWidthRemOneCardRow(prev.stands.length)
    /** Zone minimum width > 50% container → don’t pair another zone on the same row. */
    if (prevW > halfW + 1e-6) {
      rows.push(cur)
      cur = [z]
      usedRem = zw
      continue
    }

    if (usedRem + gap + zw <= containerWidthRem + 1e-4) {
      cur.push(z)
      usedRem += gap + zw
    } else {
      rows.push(cur)
      cur = [z]
      usedRem = zw
    }
  }
  if (cur.length) rows.push(cur)
  return rows
}

function readRootFontSizePx(): number {
  const fs = getComputedStyle(document.documentElement).fontSize
  const n = parseFloat(fs)
  return Number.isFinite(n) && n > 0 ? n : 16
}

type StandRowMap = Record<string, unknown>

type DerivedRow = {
  row: StandRowMap
  id: string
  externalRef: string
  zone: string
  isWaypoint: boolean
  hold: AmrStandHold | undefined
}

type HoldKind = 'held' | 'queued' | 'warning' | null

function holdKind(hold: AmrStandHold | undefined): HoldKind {
  if (!hold) return null
  if (hold.reservations.length > 0) return 'held'
  if (hold.queuedMissions.length > 0) return 'queued'
  if (hold.presenceWarningMissionId) return 'warning'
  return null
}

/** Resolve holds map entry — tolerates case / stray-whitespace mismatch vs stand.external_ref. */
function lookupStandHold(
  holds: Record<string, AmrStandHold>,
  externalRef: string,
): AmrStandHold | undefined {
  const k = externalRef.trim()
  if (!k) return undefined
  const direct = holds[k]
  if (direct) return direct
  const lower = k.toLowerCase()
  for (const key of Object.keys(holds)) {
    if (key.trim().toLowerCase() === lower) return holds[key]
  }
  return undefined
}

function holdOutlineClass(hk: HoldKind): string {
  if (hk === 'held') {
    return 'border-2 border-amber-500/70 ring-1 ring-amber-400/35 dark:border-amber-400/55 dark:ring-amber-400/25'
  }
  if (hk === 'queued') {
    return 'border-2 border-sky-500/70 ring-1 ring-sky-400/35 dark:border-sky-400/55 dark:ring-sky-400/25'
  }
  if (hk === 'warning') {
    return 'border-2 border-red-500/70 ring-1 ring-red-400/35 dark:border-red-400/55 dark:ring-red-400/25'
  }
  return 'border border-border/80'
}

/** Native tooltip text for hold state (reservation / queue / presence warning). */
function standHoldHoverTitle(hold: AmrStandHold | undefined, hk: HoldKind): string | undefined {
  if (!hold || !hk) return undefined
  if (hk === 'held') {
    const parts = hold.reservations.map((r) => {
      const job = r.jobCode?.trim()
      const id = r.missionRecordId?.trim()
      if (job && id) return `${job} (mission ${id.slice(0, 8)}…)`
      return job || (id ? `Mission ${id.slice(0, 8)}…` : '?')
    })
    return `Active reservation${hold.reservations.length > 1 ? 's' : ''}: ${parts.join(' · ')}`
  }
  if (hk === 'queued') {
    const parts = hold.queuedMissions.map((q) => {
      const job = q.jobCode?.trim()
      const id = q.missionRecordId?.trim()
      if (job && id) return `${job} (mission ${id.slice(0, 8)}…)`
      return job || (id ? `Mission ${id.slice(0, 8)}…` : '?')
    })
    return `Queued mission${hold.queuedMissions.length > 1 ? 's' : ''}: ${parts.join(' · ')}`
  }
  const mid = hold.presenceWarningMissionId?.trim()
  return mid ? `Presence warning · mission ${mid.slice(0, 8)}…` : 'Presence warning'
}

type GroupedSection = {
  categoryTitle: string
  zones: Array<{ zone: string; stands: DerivedRow[] }>
}

function buildGroupedSections(stands: DerivedRow[], zoneCategories: ZoneCategory[]): GroupedSection[] {
  const byZone = new Map<string, DerivedRow[]>()
  for (const d of stands) {
    const z = d.zone.trim() || '(no zone)'
    if (!byZone.has(z)) byZone.set(z, [])
    byZone.get(z)!.push(d)
  }
  for (const arr of byZone.values()) {
    arr.sort((a, b) =>
      a.externalRef.localeCompare(b.externalRef, undefined, { sensitivity: 'base', numeric: true })
    )
  }

  const emittedZones = new Set<string>()
  const sections: GroupedSection[] = []

  for (const cat of zoneCategories) {
    const catName = (cat.name ?? '').trim() || '(unnamed)'
    const zoneBlocks: Array<{ zone: string; stands: DerivedRow[] }> = []
    for (const z of cat.zones ?? []) {
      const zk = String(z ?? '').trim()
      if (!zk) continue
      const stands = byZone.get(zk)
      if (!stands?.length) continue
      zoneBlocks.push({ zone: zk, stands })
      emittedZones.add(zk)
    }
    if (zoneBlocks.length > 0) {
      sections.push({ categoryTitle: catName, zones: zoneBlocks })
    }
  }

  const leftoverZones = [...byZone.keys()].filter((z) => !emittedZones.has(z)).sort((a, b) => a.localeCompare(b))
  if (leftoverZones.length > 0) {
    sections.push({
      categoryTitle: 'Uncategorized',
      zones: leftoverZones.map((zone) => ({
        zone,
        stands: byZone.get(zone)!,
      })),
    })
  }

  return sections
}

function StandBrowserCard({
  d,
  presenceFor,
  presenceLoading,
  presenceError,
  presenceUnconfigured,
}: {
  d: DerivedRow
  presenceFor: (d: DerivedRow) => boolean | null
  presenceLoading: boolean
  presenceError: boolean
  presenceUnconfigured: boolean
}) {
  const p = presenceFor(d)
  const presenceKind = palletPresenceKindFromState({
    nonStandWaypoint: d.isWaypoint,
    present: p,
    loading: !d.isWaypoint && presenceLoading && p == null,
    error: !d.isWaypoint && presenceError,
    unconfigured: !d.isWaypoint && presenceUnconfigured,
  })

  const hk = holdKind(d.hold)
  const ref = d.externalRef
  const locLabel = String(d.row.location_label ?? '').trim()
  const displaySubtitle =
    locLabel.length > 0 && locLabel.toLowerCase() !== ref.toLowerCase() ? locLabel : null

  const holdLines = standHoldHoverTitle(d.hold, hk)
  const cardTooltip = [
    ref ? `Location (external ref): ${ref}` : '',
    displaySubtitle ? `Display name: ${displaySubtitle}` : '',
    holdLines ?? '',
  ]
    .filter((s) => s.length > 0)
    .join('\n')

  return (
    <div
      className={`flex min-h-0 flex-col justify-center rounded-md bg-card p-4 shadow-sm ${holdOutlineClass(hk)} ${
        cardTooltip ? 'cursor-help' : ''
      }`}
      title={cardTooltip || undefined}
    >
      <div className="flex min-w-0 w-full flex-1 flex-col items-center text-center">
        <p className="w-full max-w-full truncate font-mono text-lg font-semibold leading-snug text-foreground">
          {ref || '—'}
        </p>
        <p className="mt-0.5 min-h-[1.25rem] w-full max-w-full truncate text-base leading-tight text-foreground/70">
          {displaySubtitle ?? '\u00a0'}
        </p>
        <div className="mt-1.5 flex w-full flex-wrap items-center justify-center gap-x-2 gap-y-1">
          <PalletPresenceGlyph
            kind={presenceKind}
            className="h-5 w-5 shrink-0"
            showLabel
            labelClassName="text-base"
          />
        </div>
      </div>
    </div>
  )
}

function CategoryZonesGrid({
  categoryTitle,
  zones,
  presenceFor,
  presenceLoading,
  presenceError,
  presenceUnconfigured,
}: {
  categoryTitle: string
  zones: GroupedSection['zones']
  presenceFor: (d: DerivedRow) => boolean | null
  presenceLoading: boolean
  presenceError: boolean
  presenceUnconfigured: boolean
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [containerWidthRem, setContainerWidthRem] = useState(0)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return

    const measure = () => {
      const px = el.getBoundingClientRect().width
      setContainerWidthRem(px / readRootFontSizePx())
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const zoneRows = useMemo(() => {
    if (zones.length === 0) return []
    return packZonesIntoRows(zones, containerWidthRem)
  }, [zones, containerWidthRem])

  if (zones.length === 0) return null

  return (
    <div ref={wrapRef} className="mt-5 flex min-w-0 flex-col gap-2">
      {zoneRows.map((row, ri) => (
        <div
          key={ri}
          className="flex min-w-0 flex-nowrap gap-x-4 overflow-x-auto"
        >
          {row.map(({ zone, stands }) => {
            const nStands = stands.length
            const oneRowW = zoneMinWidthRemOneCardRow(nStands)
            const useOneCardRow = nStands > 0 && oneRowW <= containerWidthRem
            const packedWithOthers = row.length > 1

            const gridTemplateColumns =
              nStands > 0 && useOneCardRow
                ? `repeat(${nStands}, minmax(${CARD_CELL_FIXED_REM}rem, ${CARD_CELL_FIXED_REM}rem))`
                : `repeat(auto-fill, minmax(${CARD_CELL_FIXED_REM}rem, 1fr))`

            return (
              <div
                key={`${categoryTitle}:${zone}`}
                className={
                  packedWithOthers
                    ? 'min-w-0 shrink-0'
                    : 'min-w-0 w-full flex-1'
                }
                style={
                  packedWithOthers && nStands > 0 && useOneCardRow
                    ? { width: `${oneRowW}rem` }
                    : undefined
                }
              >
                <h3 className="mb-4 font-mono text-xl font-semibold tracking-tight text-foreground/85">
                  {zone}
                </h3>
                <div
                  className="grid auto-rows-min gap-2"
                  style={{
                    gridAutoFlow: 'row',
                    gridTemplateColumns,
                  }}
                >
                  {stands.map((d) => (
                    <StandBrowserCard
                      key={d.id}
                      d={d}
                      presenceFor={presenceFor}
                      presenceLoading={presenceLoading}
                      presenceError={presenceError}
                      presenceUnconfigured={presenceUnconfigured}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

export function AmrStandBrowser() {
  const [rows, setRows] = useState<StandRowMap[]>([])
  const [zoneCategories, setZoneCategories] = useState<ZoneCategory[]>([])
  const [holds, setHolds] = useState<Record<string, AmrStandHold>>({})
  const [presence, setPresence] = useState<Record<string, boolean | null>>({})
  const [presenceUnconfigured, setPresenceUnconfigured] = useState(false)
  const [presenceError, setPresenceError] = useState(false)
  const [presenceLoading, setPresenceLoading] = useState(true)
  const [pollMs, setPollMs] = useState(FALLBACK_POLL_MS)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const loadAll = useCallback(async (kind: 'initial' | 'refresh' = 'initial') => {
    if (kind === 'refresh') setRefreshing(true)
    else setLoading(true)
    try {
      const [stands, settings, holdsRes] = await Promise.all([
        getAmrStands(),
        getAmrSettings().catch(() => null),
        getAmrStandHolds().catch(() => ({} as Record<string, AmrStandHold>)),
      ])
      setRows(stands)
      if (settings) {
        setZoneCategories(Array.isArray(settings.zoneCategories) ? settings.zoneCategories : [])
        setPollMs(effectivePollMsAmrNotificationUi(settings))
      }
      setHolds(holdsRes)
    } finally {
      if (kind === 'refresh') setRefreshing(false)
      else setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAll('initial')
  }, [loadAll])

  const loadHolds = useCallback(async () => {
    try {
      const h = await getAmrStandHolds()
      setHolds(h)
    } catch {
      // Keep stale; next tick will retry.
    }
  }, [])

  useEffect(() => {
    const tid = window.setInterval(() => {
      void loadHolds()
    }, pollMs)
    const onVis = () => {
      if (document.visibilityState === 'visible') void loadHolds()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(tid)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [loadHolds, pollMs])

  const refsForPresence = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) {
      const lt = normalizeAmrStandLocationType((r as { location_type?: unknown }).location_type)
      if (lt === AMR_STAND_LOCATION_TYPE_NON_STAND) continue
      const ref = String(r.external_ref ?? '').trim()
      if (ref) set.add(ref)
    }
    return [...set].sort()
  }, [rows])

  const refsKey = refsForPresence.join('\0')

  const loadPresence = useCallback(
    async (refs: string[], opts?: { silent?: boolean }) => {
      if (refs.length === 0) {
        setPresence({})
        setPresenceLoading(false)
        return
      }
      const silent = opts?.silent === true
      if (!silent) setPresenceLoading(true)
      try {
        const map = await postStandPresence(refs)
        setPresence((prev) => {
          const next: Record<string, boolean | null> = { ...prev }
          for (const r of refs) {
            next[r] = Object.prototype.hasOwnProperty.call(map, r) ? map[r] : null
          }
          return next
        })
        setPresenceError(false)
        setPresenceUnconfigured(false)
      } catch (e: unknown) {
        if (silent) return
        const status = (e as { response?: { status?: number } })?.response?.status
        if (status === 503) setPresenceUnconfigured(true)
        else setPresenceError(true)
      } finally {
        if (!silent) setPresenceLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    void loadPresence(refsForPresence)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsKey])

  useEffect(() => {
    if (refsForPresence.length === 0) return
    const tid = window.setInterval(() => {
      void loadPresence(refsForPresence, { silent: true })
    }, pollMs)
    const onVis = () => {
      if (document.visibilityState === 'visible')
        void loadPresence(refsForPresence, { silent: true })
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(tid)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [refsKey, pollMs, loadPresence, refsForPresence])

  const derivedRows = useMemo<DerivedRow[]>(() => {
    return rows.map((row) => {
      const id = String(row.id ?? '')
      const externalRef = String(row.external_ref ?? '').trim()
      const zone = String(row.zone ?? '').trim()
      const lt = normalizeAmrStandLocationType((row as { location_type?: unknown }).location_type)
      const isWaypoint = lt === AMR_STAND_LOCATION_TYPE_NON_STAND
      return {
        row,
        id,
        externalRef,
        zone,
        isWaypoint,
        hold: lookupStandHold(holds, externalRef),
      }
    })
  }, [rows, holds])

  const presenceFor = useCallback(
    (d: DerivedRow): boolean | null => {
      if (d.isWaypoint || !d.externalRef) return null
      const v = presence[d.externalRef]
      return v === undefined ? null : v
    },
    [presence]
  )

  const groupedSections = useMemo(
    () => buildGroupedSections(derivedRows, zoneCategories),
    [derivedRows, zoneCategories]
  )

  return (
    <div className="-mx-3 w-full min-w-0 max-w-full sm:-mx-6">
      <header className="sticky top-0 z-30 -mb-px isolate flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-3 py-3 shadow-sm sm:px-6 sm:py-4">
        <h1 className="text-3xl font-semibold tracking-tight">Stands</h1>
        <button
          type="button"
          disabled={loading || refreshing}
          className="ml-auto shrink-0 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void loadAll('refresh')}
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      <div className="relative z-0 mt-6 px-3 sm:px-6">
        <div className="w-full min-w-0 rounded-xl border border-border bg-muted/15 p-5 sm:p-6">
        {loading ? (
          <p className="py-12 text-center text-base text-foreground/60">Loading…</p>
        ) : derivedRows.length === 0 ? (
          <p className="py-12 text-center text-base text-foreground/60">No stands configured.</p>
        ) : groupedSections.length === 0 ? (
          <p className="py-12 text-center text-base text-foreground/60">No stands to show.</p>
        ) : (
          <div className="space-y-10">
            {groupedSections.map((section) => (
              <section key={section.categoryTitle} className="scroll-mt-4">
                <h2 className="border-b border-border/70 pb-2 text-2xl font-semibold tracking-tight text-foreground">
                  {section.categoryTitle}
                </h2>
                <CategoryZonesGrid
                  categoryTitle={section.categoryTitle}
                  zones={section.zones}
                  presenceFor={presenceFor}
                  presenceLoading={presenceLoading}
                  presenceError={presenceError}
                  presenceUnconfigured={presenceUnconfigured}
                />
              </section>
            ))}
          </div>
        )}
        </div>
      </div>
    </div>
  )
}

export default AmrStandBrowser
