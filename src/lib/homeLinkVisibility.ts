import type { CSSProperties } from 'react'
import type { HomeCustomLink, HomeLinkCategory } from '@/types/homePage'

export function customLinkVisible(
  link: HomeCustomLink,
  hasPermission: (k: string) => boolean,
  roleSlugs: string[]
): boolean {
  if (link.allowedRoleSlugs && link.allowedRoleSlugs.length > 0) {
    const set = new Set(roleSlugs)
    return link.allowedRoleSlugs.some((s) => set.has(s))
  }
  if (link.requiredPermission?.trim()) {
    return hasPermission(link.requiredPermission.trim())
  }
  return true
}

/** Hub cards: omit links explicitly turned off for home. */
export function linkShowsOnHomeHub(link: HomeCustomLink): boolean {
  return link.showOnHome !== false
}

export function filterVisibleCustomLinks(
  links: HomeCustomLink[],
  hasPermission: (k: string) => boolean,
  roleSlugs: string[]
): HomeCustomLink[] {
  return links.filter((link) => customLinkVisible(link, hasPermission, roleSlugs))
}

/** Shown on `/links` for links without a matching category (not in a named category bucket). */
export const OTHER_LINKS_SECTION_HEADING = 'OTHER'

/** Global link order is preserved; sections follow category sort order; OTHER (uncategorized) last. */
export function groupVisibleLinksForDisplay(
  linksInGlobalOrder: HomeCustomLink[],
  categories: HomeLinkCategory[]
): Array<{ heading: string | null; links: HomeCustomLink[] }> {
  type HC = HomeCustomLink
  const catById = new Map<string, HomeLinkCategory>(categories.map((c) => [c.id, c]))
  const sortedCats = [...categories].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))

  const buckets = new Map<string | null, HC[]>()
  for (const c of sortedCats) {
    buckets.set(c.id, [])
  }
  buckets.set(null, [])

  for (const link of linksInGlobalOrder) {
    const cid = link.categoryId?.trim()
    const key = cid && catById.has(cid) ? cid : null
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(link)
  }

  const out: Array<{ heading: string | null; links: HC[] }> = []
  for (const c of sortedCats) {
    const list = buckets.get(c.id) ?? []
    if (list.length > 0) out.push({ heading: c.title, links: list })
  }
  const uncat = buckets.get(null) ?? []
  if (uncat.length > 0) out.push({ heading: OTHER_LINKS_SECTION_HEADING, links: uncat })
  return out
}

export const DEFAULT_CUSTOM_LINKS_VISIBLE_COUNT = 8

/** Allowed range for “max links on home” (mirrors server + manage links UI). */
export const MIN_CUSTOM_LINKS_ON_HOME = 1
export const MAX_CUSTOM_LINKS_ON_HOME = 40

/** Home hub link card grid (1 = single column). */
export const MIN_HOME_HUB_LINK_COLUMNS = 1
export const MAX_HOME_HUB_LINK_COLUMNS = 6
export const DEFAULT_HOME_HUB_LINK_COLUMNS = 1

export function clampHomeHubLinkColumns(
  raw: unknown,
  fallback = DEFAULT_HOME_HUB_LINK_COLUMNS
): number {
  let n: number
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    n = Math.floor(raw)
  } else if (typeof raw === 'string' && raw.trim() !== '') {
    const p = parseInt(raw, 10)
    n = Number.isFinite(p) ? p : fallback
  } else {
    n = fallback
  }
  return Math.min(MAX_HOME_HUB_LINK_COLUMNS, Math.max(MIN_HOME_HUB_LINK_COLUMNS, n))
}

/** CSS grid for N columns of link cards (home hub, /links). */
export function hubLinkCardsGridStyle(columnCount: number): CSSProperties | undefined {
  const n = clampHomeHubLinkColumns(columnCount)
  if (n <= 1) return undefined
  return {
    display: 'grid',
    gap: '0.75rem',
    gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`,
    minWidth: 0,
  }
}

/** Sentinel: column shows links not placed in another column’s category (and uncategorized links). */
export const HUB_COLUMN_OTHER = '__hub_other__'

/** Normalize per-column assignment to length `columnCount` (pads with null, trims). */
export function normalizeHomeHubColumnCategoryIds(
  raw: (string | null | undefined)[] | undefined,
  columnCount: number
): (string | null)[] {
  const n = clampHomeHubLinkColumns(columnCount, DEFAULT_HOME_HUB_LINK_COLUMNS)
  const out: (string | null)[] = []
  for (let i = 0; i < n; i++) {
    const v = raw?.[i]
    if (v === HUB_COLUMN_OTHER) out.push(HUB_COLUMN_OTHER)
    else if (v == null || (typeof v === 'string' && v.trim() === '')) out.push(null)
    else if (typeof v === 'string') out.push(v.trim())
    else out.push(null)
  }
  return out
}

/** True when assignments drive column buckets (not the default single flowing grid). */
export function isHomeHubColumnAssignmentActive(assignment: (string | null)[] | undefined): boolean {
  return Boolean(assignment && assignment.length > 0 && assignment.some((x) => x != null))
}

/** Split hub links into column buckets using category ids + optional “other” column. Order within each bucket follows `links`. */
export function partitionHubLinksIntoColumns(
  links: HomeCustomLink[],
  columnCount: number,
  assignment: (string | null)[]
): HomeCustomLink[][] {
  const assign = normalizeHomeHubColumnCategoryIds(assignment, columnCount)
  const buckets: HomeCustomLink[][] = Array.from({ length: assign.length }, () => [])
  if (buckets.length === 0) return buckets
  const categoryToCol = new Map<string, number>()
  let otherCol = -1
  for (let i = 0; i < assign.length; i++) {
    const a = assign[i]
    if (a === HUB_COLUMN_OTHER) otherCol = i
    else if (a) categoryToCol.set(a, i)
  }
  for (const link of links) {
    const cid = link.categoryId?.trim() ?? ''
    let col = -1
    if (cid && categoryToCol.has(cid)) col = categoryToCol.get(cid)!
    else if (otherCol >= 0) col = otherCol
    else {
      const loose = assign.findIndex((a) => a === null)
      col = loose >= 0 ? loose : 0
    }
    if (col >= 0 && col < buckets.length) buckets[col].push(link)
  }
  return buckets
}

/** Hub layout from per-category column picks + optional “other” column. */
export function partitionHubLinksIntoColumnsFromMap(
  links: HomeCustomLink[],
  columnCount: number,
  categoryColumnMap: Record<string, number>,
  otherLinksColumn: number | null | undefined
): HomeCustomLink[][] {
  const n = clampHomeHubLinkColumns(columnCount, DEFAULT_HOME_HUB_LINK_COLUMNS)
  const buckets: HomeCustomLink[][] = Array.from({ length: n }, () => [])
  if (n === 0) return buckets
  let otherCol = -1
  if (
    typeof otherLinksColumn === 'number' &&
    Number.isFinite(otherLinksColumn) &&
    otherLinksColumn >= 0 &&
    otherLinksColumn < n
  ) {
    otherCol = Math.floor(otherLinksColumn)
  }
  const catCol = new Map<string, number>()
  for (const [catId, colRaw] of Object.entries(categoryColumnMap)) {
    const id = catId.trim()
    if (!id) continue
    const col =
      typeof colRaw === 'number' && Number.isFinite(colRaw)
        ? Math.floor(colRaw)
        : typeof colRaw === 'string' && colRaw.trim() !== ''
          ? parseInt(colRaw.trim(), 10)
          : NaN
    if (!Number.isFinite(col)) continue
    const c = Math.min(n - 1, Math.max(0, col))
    catCol.set(id, c)
  }
  for (const link of links) {
    const cid = link.categoryId?.trim() ?? ''
    let col = -1
    if (cid && catCol.has(cid)) col = catCol.get(cid)!
    else if (otherCol >= 0) col = otherCol
    else col = 0
    if (col >= 0 && col < buckets.length) buckets[col].push(link)
  }
  return buckets
}

/** Build map + other index from legacy per-column category array. */
export function migrateLegacyHubAssignmentToMap(
  assignment: (string | null)[],
  columnCount: number
): { map: Record<string, number>; otherColumn: number | null } {
  const assign = normalizeHomeHubColumnCategoryIds(assignment, columnCount)
  const map: Record<string, number> = {}
  let otherColumn: number | null = null
  assign.forEach((slot, i) => {
    if (slot === HUB_COLUMN_OTHER) otherColumn = i
    else if (slot) map[slot] = i
  })
  return { map, otherColumn }
}

/** True when per-category/per-“other” bucket layout should replace the plain multi-column link grid. */
export function isHomeHubCategoryColumnMapActive(
  map: Record<string, number> | undefined,
  otherColumn: number | null | undefined
): boolean {
  if (map && Object.keys(map).length > 0) return true
  /** Index 0 is the implicit default column for uncategorized links; honoring it alone was enabling bucket layout and pinning every card to column 1 (empty sibling columns looked like “columns don’t work”). */
  return (
    typeof otherColumn === 'number' &&
    Number.isFinite(otherColumn) &&
    otherColumn !== 0
  )
}

export function clampHubCategoryColumnMap(
  map: Record<string, number>,
  columnCount: number
): Record<string, number> {
  const n = clampHomeHubLinkColumns(columnCount, DEFAULT_HOME_HUB_LINK_COLUMNS)
  if (n <= 0) return {}
  const out: Record<string, number> = {}
  for (const [id, colRaw] of Object.entries(map)) {
    const col =
      typeof colRaw === 'number' && Number.isFinite(colRaw)
        ? Math.floor(colRaw)
        : typeof colRaw === 'string' && colRaw.trim() !== ''
          ? parseInt(colRaw.trim(), 10)
          : NaN
    if (!Number.isFinite(col)) continue
    out[id] = Math.min(n - 1, Math.max(0, col))
  }
  return out
}

export function clampCustomLinksOnHomeMax(
  raw: unknown,
  fallback = DEFAULT_CUSTOM_LINKS_VISIBLE_COUNT
): number {
  let n: number
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    n = Math.floor(raw)
  } else if (typeof raw === 'string' && raw.trim() !== '') {
    const p = parseInt(raw, 10)
    n = Number.isFinite(p) ? p : fallback
  } else {
    n = fallback
  }
  return Math.min(MAX_CUSTOM_LINKS_ON_HOME, Math.max(MIN_CUSTOM_LINKS_ON_HOME, n))
}

/** Renumber `homeSortOrder` to 0..n-1 for links that are on the home hub. */
export function renumberHomeHubSortOrders(links: HomeCustomLink[]): HomeCustomLink[] {
  const onHome = links.filter((l) => l.showOnHome !== false)
  const sorted = [...onHome].sort(
    (a, b) =>
      (a.homeSortOrder ?? 0) - (b.homeSortOrder ?? 0) || a.id.localeCompare(b.id)
  )
  const rank = new Map(sorted.map((l, i) => [l.id, i]))
  return links.map((l) =>
    l.showOnHome !== false ? { ...l, homeSortOrder: rank.get(l.id)! } : l
  )
}

/**
 * Keeps at most `maxOnHome` links with “show on home”; extras are turned off from the **end**
 * of home hub order (`homeSortOrder`), not master list order.
 */
export function clampLinksShowOnHomeToMax(
  links: HomeCustomLink[],
  maxOnHome: number
): HomeCustomLink[] {
  const m = clampCustomLinksOnHomeMax(maxOnHome)
  const wanting = links.filter((l) => l.showOnHome !== false)
  const sortedWanting = [...wanting].sort(
    (a, b) =>
      (a.homeSortOrder ?? 0) - (b.homeSortOrder ?? 0) || a.id.localeCompare(b.id)
  )
  const keepIds = new Set(sortedWanting.slice(0, m).map((l) => l.id))
  const clamped = links.map((link) => {
    if (link.showOnHome === false) return link
    if (keepIds.has(link.id)) return { ...link, showOnHome: true }
    return { ...link, showOnHome: false }
  })
  return renumberHomeHubSortOrders(clamped)
}
