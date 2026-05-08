import { randomUUID } from 'node:crypto'
import type { AsyncDbWrapper } from '../db/schema.js'
import { normalizeZoneCategories, type ZoneCategory } from './amrZoneCategories.js'

/** Must match `AMR_FLEET_KV_KEY` in amrConfig (this module cannot import amrConfig — circular). */
const FLEET_KV_KEY = 'amr.fleet.config'

export async function listAmrStandCategories(db: AsyncDbWrapper): Promise<ZoneCategory[]> {
  const rows = (await db
    .prepare(`SELECT name, zones_json FROM amr_stand_categories ORDER BY sort_order ASC, name ASC`)
    .all()) as Array<{ name: string; zones_json: string }>
  const out: ZoneCategory[] = []
  for (const r of rows) {
    let zones: string[] = []
    try {
      const parsed = JSON.parse(r.zones_json || '[]')
      if (Array.isArray(parsed))
        zones = parsed.filter((x): x is string => typeof x === 'string').map((z) => z.trim()).filter(Boolean)
    } catch {
      zones = []
    }
    out.push({ name: r.name, zones })
  }
  return normalizeZoneCategories(out)
}

/** Full replace of rows (transaction not required; rare admin writes). */
export async function replaceAmrStandCategories(db: AsyncDbWrapper, cats: ZoneCategory[]): Promise<void> {
  const normalized = normalizeZoneCategories(cats)
  await db.prepare('DELETE FROM amr_stand_categories').run()
  let order = 0
  for (const c of normalized) {
    await db
      .prepare(
        `INSERT INTO amr_stand_categories (id, name, sort_order, zones_json) VALUES (?, ?, ?, ?)`
      )
      .run(randomUUID(), c.name, order++, JSON.stringify(c.zones))
  }
}

/**
 * One-time / idempotent: copy legacy `zoneCategories` from `app_kv` fleet JSON into `amr_stand_categories`,
 * then remove that key from stored fleet JSON so categories live only in the table.
 */
export async function migrateAmrStandCategoriesFromKvIfNeeded(db: AsyncDbWrapper): Promise<void> {
  const cntRow = (await db.prepare('SELECT COUNT(*) AS n FROM amr_stand_categories').get()) as
    | { n?: number | string }
    | undefined
  const existingRows = Number(cntRow?.n ?? 0)

  const kvRow = (await db.prepare('SELECT value FROM app_kv WHERE key = ?').get(FLEET_KV_KEY)) as
    | { value?: string }
    | undefined
  if (!kvRow?.value) return

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(kvRow.value) as Record<string, unknown>
  } catch {
    return
  }
  if (!parsed || typeof parsed !== 'object') return

  const hadZoneCategoriesKey = 'zoneCategories' in parsed
  const rawZc = parsed.zoneCategories

  if (existingRows === 0 && Array.isArray(rawZc) && rawZc.length > 0) {
    const cats = normalizeZoneCategories(rawZc)
    await replaceAmrStandCategories(db, cats)
  }

  if (hadZoneCategoriesKey) {
    delete parsed.zoneCategories
    await db
      .prepare(
        `INSERT INTO app_kv (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`
      )
      .run(FLEET_KV_KEY, JSON.stringify(parsed))
  }
}
