import { slugifyTitleToWikiSegment } from './wikiSlug.js'
import type { AsyncDbWrapper } from '../db/schema.js'

/** One URL segment; aligned with wiki segment rules. */
export const TESTING_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** Path segment after `/testing/test-plans/` that would clash with static routes. */
export const RESERVED_PLAN_SLUGS = new Set([
  'new',
  'stats',
  'data',
  'edit',
  'tests',
  'export',
])

export function isUuidParam(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s.trim())
}

export function slugifyTestingName(name: string): string {
  return slugifyTitleToWikiSegment(name)
}

/** Escape reserved or empty slugs for generated values. */
export function ensureNonReservedPlanSlug(base: string): string {
  let s = base || 'plan'
  if (RESERVED_PLAN_SLUGS.has(s)) s = `${s}-plan`
  return s
}

export function validatePlanSlugFormat(slug: string): string | null {
  const t = slug.trim().toLowerCase()
  if (!t) return 'Slug is required'
  if (t.length > 120) return 'Slug is too long'
  if (!TESTING_SLUG_RE.test(t)) {
    return 'Use lowercase letters, digits, and hyphens only (e.g. my-plan-name)'
  }
  if (RESERVED_PLAN_SLUGS.has(t)) return 'This slug is reserved for app routes'
  return null
}

export function validateTestSlugFormat(slug: string): string | null {
  const t = slug.trim().toLowerCase()
  if (!t) return 'Slug is required'
  if (t.length > 120) return 'Slug is too long'
  if (!TESTING_SLUG_RE.test(t)) {
    return 'Use lowercase letters, digits, and hyphens only (e.g. sprint-1)'
  }
  return null
}

export async function resolvePlanId(db: AsyncDbWrapper, param: string): Promise<string | null> {
  const p = param.trim()
  if (!p) return null
  if (isUuidParam(p)) {
    const row = (await db.prepare('SELECT id FROM test_plans WHERE id = ?').get(p)) as { id: string } | undefined
    return row?.id ?? null
  }
  const row = (await db.prepare('SELECT id FROM test_plans WHERE lower(slug) = lower(?)').get(p)) as
    | { id: string }
    | undefined
  return row?.id ?? null
}

export async function resolveTestId(
  db: AsyncDbWrapper,
  planId: string,
  param: string
): Promise<string | null> {
  const p = param.trim()
  if (!p) return null
  if (isUuidParam(p)) {
    const row = (await db
      .prepare('SELECT id FROM tests WHERE id = ? AND test_plan_id = ?')
      .get(p, planId)) as { id: string } | undefined
    return row?.id ?? null
  }
  const row = (await db
    .prepare('SELECT id FROM tests WHERE test_plan_id = ? AND lower(slug) = lower(?)')
    .get(planId, p)) as { id: string } | undefined
  return row?.id ?? null
}

/** Next unique plan slug from base (dedupe with -2, -3, …). Caller ensures base is non-reserved when possible. */
export async function allocateUniquePlanSlug(db: AsyncDbWrapper, baseRaw: string): Promise<string> {
  let base = ensureNonReservedPlanSlug(slugifyTestingName(baseRaw))
  if (!TESTING_SLUG_RE.test(base)) base = 'plan'
  let candidate = base
  let n = 2
  for (;;) {
    const hit = (await db.prepare('SELECT id FROM test_plans WHERE lower(slug) = lower(?)').get(candidate)) as
      | { id: string }
      | undefined
    if (!hit) return candidate
    candidate = `${base}-${n}`
    n += 1
    if (n > 100000) {
      candidate = `${base}-${Date.now()}`
      const hit2 = (await db.prepare('SELECT id FROM test_plans WHERE lower(slug) = lower(?)').get(candidate)) as
        | { id: string }
        | undefined
      if (!hit2) return candidate
    }
  }
}

export async function allocateUniqueTestSlug(
  db: AsyncDbWrapper,
  planId: string,
  baseRaw: string
): Promise<string> {
  let base = slugifyTestingName(baseRaw)
  if (!base || !TESTING_SLUG_RE.test(base)) base = 'test'
  let candidate = base
  let n = 2
  for (;;) {
    const hit = (await db
      .prepare('SELECT id FROM tests WHERE test_plan_id = ? AND lower(slug) = lower(?)')
      .get(planId, candidate)) as { id: string } | undefined
    if (!hit) return candidate
    candidate = `${base}-${n}`
    n += 1
    if (n > 100000) {
      candidate = `${base}-${Date.now()}`
      const hit2 = (await db
        .prepare('SELECT id FROM tests WHERE test_plan_id = ? AND lower(slug) = lower(?)')
        .get(planId, candidate)) as { id: string } | undefined
      if (!hit2) return candidate
    }
  }
}

export async function isPlanSlugAvailable(
  db: AsyncDbWrapper,
  slug: string,
  excludePlanId?: string
): Promise<boolean> {
  const t = slug.trim().toLowerCase()
  const err = validatePlanSlugFormat(t)
  if (err) return false
  if (excludePlanId) {
    const row = (await db
      .prepare('SELECT id FROM test_plans WHERE lower(slug) = lower(?) AND id != ?')
      .get(t, excludePlanId)) as { id: string } | undefined
    return !row
  }
  const row = (await db.prepare('SELECT id FROM test_plans WHERE lower(slug) = lower(?)').get(t)) as
    | { id: string }
    | undefined
  return !row
}

export async function isTestSlugAvailable(
  db: AsyncDbWrapper,
  planId: string,
  slug: string,
  excludeTestId?: string
): Promise<boolean> {
  const t = slug.trim().toLowerCase()
  const err = validateTestSlugFormat(t)
  if (err) return false
  if (excludeTestId) {
    const row = (await db
      .prepare(
        'SELECT id FROM tests WHERE test_plan_id = ? AND lower(slug) = lower(?) AND id != ?'
      )
      .get(planId, t, excludeTestId)) as { id: string } | undefined
    return !row
  }
  const row = (await db
    .prepare('SELECT id FROM tests WHERE test_plan_id = ? AND lower(slug) = lower(?)')
    .get(planId, t)) as { id: string } | undefined
  return !row
}

/**
 * Backfill missing slugs and create unique indexes. Safe to call on every startup.
 */
export async function ensureTestingSlugsBackfilled(db: AsyncDbWrapper): Promise<void> {
  const usedPlanSlugs = new Set(
    (
      (await db
        .prepare(
          "SELECT slug FROM test_plans WHERE slug IS NOT NULL AND trim(slug) != ''"
        )
        .all()) as Array<{ slug: string }>
    ).map((r) => r.slug.toLowerCase())
  )

  const plans = (await db
    .prepare('SELECT id, name FROM test_plans ORDER BY name, id')
    .all()) as Array<{ id: string; name: string }>

  const updPlan = db.prepare('UPDATE test_plans SET slug = ? WHERE id = ?')
  for (const p of plans) {
    const cur = (await db.prepare('SELECT slug FROM test_plans WHERE id = ?').get(p.id)) as
      | { slug: string | null }
      | undefined
    if (cur?.slug && cur.slug.trim()) continue

    let base = ensureNonReservedPlanSlug(slugifyTestingName(p.name))
    if (!TESTING_SLUG_RE.test(base)) base = 'plan'
    let candidate = base
    let n = 2
    while (usedPlanSlugs.has(candidate)) {
      candidate = `${base}-${n}`
      n += 1
    }
    usedPlanSlugs.add(candidate)
    await updPlan.run(candidate, p.id)
  }

  const usedTestByPlan = new Map<string, Set<string>>()
  const existingTestSlugs = (await db
    .prepare("SELECT test_plan_id, slug FROM tests WHERE slug IS NOT NULL AND trim(slug) != ''")
    .all()) as Array<{ test_plan_id: string; slug: string }>
  for (const r of existingTestSlugs) {
    if (!usedTestByPlan.has(r.test_plan_id)) usedTestByPlan.set(r.test_plan_id, new Set())
    usedTestByPlan.get(r.test_plan_id)!.add(r.slug.toLowerCase())
  }

  const tests = (await db
    .prepare('SELECT id, test_plan_id, name FROM tests ORDER BY created_at, id')
    .all()) as Array<{ id: string; test_plan_id: string; name: string }>

  const updTest = db.prepare('UPDATE tests SET slug = ? WHERE id = ?')
  for (const t of tests) {
    const cur = (await db.prepare('SELECT slug FROM tests WHERE id = ?').get(t.id)) as
      | { slug: string | null }
      | undefined
    if (cur?.slug && cur.slug.trim()) continue

    if (!usedTestByPlan.has(t.test_plan_id)) usedTestByPlan.set(t.test_plan_id, new Set())
    const used = usedTestByPlan.get(t.test_plan_id)!

    let base = slugifyTestingName(t.name)
    if (!base || !TESTING_SLUG_RE.test(base)) base = 'test'
    let candidate = base
    let n = 2
    while (used.has(candidate)) {
      candidate = `${base}-${n}`
      n += 1
    }
    used.add(candidate)
    await updTest.run(candidate, t.id)
  }

  await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_test_plans_slug ON test_plans(slug)')
  await db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_tests_plan_slug ON tests(test_plan_id, slug)'
  )
}
