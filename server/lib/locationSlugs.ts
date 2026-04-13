import { slugifyTitleToWikiSegment } from './wikiSlug.js'
import type { AsyncDbWrapper } from '../db/schema.js'
import { isUuidParam } from './testingSlugs.js'

/** One URL segment; aligned with wiki / testing slug rules. */
export const LOCATION_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** Path segments under `/locations/schemas/*` that would clash with static app routes. */
export const RESERVED_LOCATION_SCHEMA_SLUGS = new Set(['new'])

/** Path segments under `/locations/zones/*` that would clash with static app routes. */
export const RESERVED_ZONE_SLUGS = new Set(['new'])

export function slugifyLocationName(name: string): string {
  return slugifyTitleToWikiSegment(name)
}

function ensureNonReservedSchemaSlug(base: string): string {
  let s = base || 'schema'
  if (RESERVED_LOCATION_SCHEMA_SLUGS.has(s)) s = `${s}-schema`
  return s
}

function ensureNonReservedZoneSlug(base: string): string {
  let s = base || 'zone'
  if (RESERVED_ZONE_SLUGS.has(s)) s = `${s}-zone`
  return s
}

export function validateLocationSchemaSlugFormat(slug: string): string | null {
  const t = slug.trim().toLowerCase()
  if (!t) return 'Slug is required'
  if (t.length > 120) return 'Slug is too long'
  if (!LOCATION_SLUG_RE.test(t)) {
    return 'Use lowercase letters, digits, and hyphens only (e.g. my-schema-name)'
  }
  if (RESERVED_LOCATION_SCHEMA_SLUGS.has(t)) return 'This slug is reserved for app routes'
  return null
}

export function validateZoneSlugFormat(slug: string): string | null {
  const t = slug.trim().toLowerCase()
  if (!t) return 'Slug is required'
  if (t.length > 120) return 'Slug is too long'
  if (!LOCATION_SLUG_RE.test(t)) {
    return 'Use lowercase letters, digits, and hyphens only (e.g. warehouse-a)'
  }
  if (RESERVED_ZONE_SLUGS.has(t)) return 'This slug is reserved for app routes'
  return null
}

export async function resolveLocationSchemaId(db: AsyncDbWrapper, param: string): Promise<string | null> {
  const p = param.trim()
  if (!p) return null
  if (isUuidParam(p)) {
    const row = (await db.prepare('SELECT id FROM location_schemas WHERE id = ?').get(p)) as
      | { id: string }
      | undefined
    return row?.id ?? null
  }
  const row = (await db
    .prepare('SELECT id FROM location_schemas WHERE lower(slug) = lower(?)')
    .get(p)) as { id: string } | undefined
  return row?.id ?? null
}

/** Zones use a single global slug namespace (same as schema slugs — must not collide across tables). */
export async function resolveZoneId(db: AsyncDbWrapper, param: string): Promise<string | null> {
  const p = param.trim()
  if (!p) return null
  if (isUuidParam(p)) {
    const row = (await db.prepare('SELECT id FROM zones WHERE id = ?').get(p)) as { id: string } | undefined
    return row?.id ?? null
  }
  const row = (await db.prepare('SELECT id FROM zones WHERE lower(slug) = lower(?)').get(p)) as
    | { id: string }
    | undefined
  return row?.id ?? null
}

async function isGlobalLocationSlugTaken(db: AsyncDbWrapper, candidate: string): Promise<boolean> {
  const s = (await db
    .prepare('SELECT id FROM location_schemas WHERE lower(slug) = lower(?)')
    .get(candidate)) as { id: string } | undefined
  if (s) return true
  const z = (await db.prepare('SELECT id FROM zones WHERE lower(slug) = lower(?)').get(candidate)) as
    | { id: string }
    | undefined
  return !!z
}

export async function allocateUniqueLocationSchemaSlug(db: AsyncDbWrapper, baseRaw: string): Promise<string> {
  let base = ensureNonReservedSchemaSlug(slugifyLocationName(baseRaw))
  if (!LOCATION_SLUG_RE.test(base)) base = 'schema'
  let candidate = base
  let n = 2
  for (;;) {
    const hit = await isGlobalLocationSlugTaken(db, candidate)
    if (!hit) return candidate
    candidate = `${base}-${n}`
    n += 1
    if (n > 100000) {
      candidate = `${base}-${Date.now()}`
      const hit2 = await isGlobalLocationSlugTaken(db, candidate)
      if (!hit2) return candidate
    }
  }
}

export async function allocateUniqueZoneSlug(db: AsyncDbWrapper, baseRaw: string): Promise<string> {
  let base = ensureNonReservedZoneSlug(slugifyLocationName(baseRaw))
  if (!LOCATION_SLUG_RE.test(base)) base = 'zone'
  let candidate = base
  let n = 2
  for (;;) {
    const hit = await isGlobalLocationSlugTaken(db, candidate)
    if (!hit) return candidate
    candidate = `${base}-${n}`
    n += 1
    if (n > 100000) {
      candidate = `${base}-${Date.now()}`
      const hit2 = await isGlobalLocationSlugTaken(db, candidate)
      if (!hit2) return candidate
    }
  }
}

export async function isLocationSchemaSlugAvailable(
  db: AsyncDbWrapper,
  slug: string,
  excludeSchemaId?: string
): Promise<boolean> {
  const t = slug.trim().toLowerCase()
  const err = validateLocationSchemaSlugFormat(t)
  if (err) return false
  const zoneHit = (await db.prepare('SELECT id FROM zones WHERE lower(slug) = lower(?)').get(t)) as
    | { id: string }
    | undefined
  if (zoneHit) return false
  if (excludeSchemaId) {
    const row = (await db
      .prepare('SELECT id FROM location_schemas WHERE lower(slug) = lower(?) AND id != ?')
      .get(t, excludeSchemaId)) as { id: string } | undefined
    return !row
  }
  const row = (await db.prepare('SELECT id FROM location_schemas WHERE lower(slug) = lower(?)').get(t)) as
    | { id: string }
    | undefined
  return !row
}

export async function isZoneSlugAvailable(
  db: AsyncDbWrapper,
  slug: string,
  excludeZoneId?: string
): Promise<boolean> {
  const t = slug.trim().toLowerCase()
  const err = validateZoneSlugFormat(t)
  if (err) return false
  const schemaHit = (await db
    .prepare('SELECT id FROM location_schemas WHERE lower(slug) = lower(?)')
    .get(t)) as { id: string } | undefined
  if (schemaHit) return false
  if (excludeZoneId) {
    const row = (await db
      .prepare('SELECT id FROM zones WHERE lower(slug) = lower(?) AND id != ?')
      .get(t, excludeZoneId)) as { id: string } | undefined
    return !row
  }
  const row = (await db.prepare('SELECT id FROM zones WHERE lower(slug) = lower(?)').get(t)) as
    | { id: string }
    | undefined
  return !row
}

/**
 * Backfill missing slugs and create unique indexes. Safe to call on every startup.
 * Schema and zone slugs share one global namespace so `/locations/schemas/:x` and `/locations/zones/:x` never collide.
 */
export async function ensureLocationSlugsBackfilled(db: AsyncDbWrapper): Promise<void> {
  const usedGlobal = new Set<string>(
    (
      (await db
        .prepare(
          "SELECT slug FROM location_schemas WHERE slug IS NOT NULL AND trim(slug) != ''"
        )
        .all()) as Array<{ slug: string }>
    )
      .map((r) => r.slug.toLowerCase())
      .concat(
        (
          (await db.prepare("SELECT slug FROM zones WHERE slug IS NOT NULL AND trim(slug) != ''").all()) as Array<{
            slug: string
          }>
        ).map((r) => r.slug.toLowerCase())
      )
  )

  const schemas = (await db
    .prepare('SELECT id, name FROM location_schemas ORDER BY name, id')
    .all()) as Array<{ id: string; name: string }>

  const updSchema = db.prepare('UPDATE location_schemas SET slug = ? WHERE id = ?')
  for (const s of schemas) {
    const cur = (await db.prepare('SELECT slug FROM location_schemas WHERE id = ?').get(s.id)) as
      | { slug: string | null }
      | undefined
    if (cur?.slug && cur.slug.trim()) continue

    let base = ensureNonReservedSchemaSlug(slugifyLocationName(s.name))
    if (!LOCATION_SLUG_RE.test(base)) base = 'schema'
    let candidate = base
    let n = 2
    while (usedGlobal.has(candidate)) {
      candidate = `${base}-${n}`
      n += 1
    }
    usedGlobal.add(candidate)
    await updSchema.run(candidate, s.id)
  }

  const zones = (await db.prepare('SELECT id, name FROM zones ORDER BY name, id').all()) as Array<{
    id: string
    name: string
  }>

  const updZone = db.prepare('UPDATE zones SET slug = ? WHERE id = ?')
  for (const z of zones) {
    const cur = (await db.prepare('SELECT slug FROM zones WHERE id = ?').get(z.id)) as
      | { slug: string | null }
      | undefined
    if (cur?.slug && cur.slug.trim()) continue

    let base = ensureNonReservedZoneSlug(slugifyLocationName(z.name))
    if (!LOCATION_SLUG_RE.test(base)) base = 'zone'
    let candidate = base
    let n = 2
    while (usedGlobal.has(candidate)) {
      candidate = `${base}-${n}`
      n += 1
    }
    usedGlobal.add(candidate)
    await updZone.run(candidate, z.id)
  }

  await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_location_schemas_slug ON location_schemas(slug)')
  await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_zones_slug ON zones(slug)')
}
