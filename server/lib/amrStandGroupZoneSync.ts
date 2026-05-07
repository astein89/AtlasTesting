import type { AsyncDbWrapper } from '../db/schema.js'
import { getAmrFleetConfig, normalizeZoneCategories, saveAmrFleetConfig } from './amrConfig.js'
import { standGroupZoneKey } from './amrStandGroups.js'

export async function syncStandGroupIntoZoneCategories(db: AsyncDbWrapper, groupId: string): Promise<void> {
  const key = standGroupZoneKey(groupId)
  if (!key) return
  const cfg = await getAmrFleetConfig(db)
  const cats = [...(cfg.zoneCategories ?? [])]
  const idx = cats.findIndex((c) => c.name.trim().toLowerCase() === 'groups')
  if (idx < 0) {
    cats.push({ name: 'Groups', zones: [key] })
  } else {
    const z = [...(cats[idx].zones ?? [])]
    if (!z.includes(key)) z.push(key)
    cats[idx] = { ...cats[idx], zones: z }
  }
  await saveAmrFleetConfig(db, { ...cfg, zoneCategories: normalizeZoneCategories(cats) })
}

export async function removeStandGroupFromZoneCategories(db: AsyncDbWrapper, groupId: string): Promise<void> {
  const key = standGroupZoneKey(groupId)
  if (!key) return
  const cfg = await getAmrFleetConfig(db)
  const cats = (cfg.zoneCategories ?? []).map((c) => ({
    ...c,
    zones: (c.zones ?? []).filter((z) => z !== key),
  }))
  await saveAmrFleetConfig(db, { ...cfg, zoneCategories: normalizeZoneCategories(cats) })
}
