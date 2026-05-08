/** Maps zones to ordered categories used for grouping zones in the stand picker (persisted in `amr_stand_categories`). */
export type ZoneCategory = {
  /** Trimmed, non-empty, unique (case-insensitive) within the array. */
  name: string
  /** Zones assigned to this category, in display order. Each zone belongs to at most one category. */
  zones: string[]
}

/**
 * Normalize a `zoneCategories` array from arbitrary JSON: trim names, drop empty/duplicate names,
 * trim zones, and ensure each zone appears at most once across the entire array (last write wins).
 */
export function normalizeZoneCategories(raw: unknown): ZoneCategory[] {
  if (!Array.isArray(raw)) return []
  const out: ZoneCategory[] = []
  const seenNames = new Set<string>()
  const claimedZones = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name.trim() : ''
    if (!name) continue
    const key = name.toLowerCase()
    if (seenNames.has(key)) continue
    seenNames.add(key)
    const zonesIn = Array.isArray(o.zones) ? o.zones : []
    const zones: string[] = []
    const localZones = new Set<string>()
    for (const z of zonesIn) {
      if (typeof z !== 'string') continue
      const t = z.trim()
      if (!t) continue
      if (localZones.has(t)) continue
      if (claimedZones.has(t)) continue
      localZones.add(t)
      claimedZones.add(t)
      zones.push(t)
    }
    out.push({ name, zones })
  }
  return out
}
