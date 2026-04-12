import { db } from '../db/index.js'

export const WIKI_RECYCLE_RETENTION_DAYS_KEY = 'wiki_recycle_retention_days'
export const DEFAULT_WIKI_RECYCLE_RETENTION_DAYS = 30
export const MIN_WIKI_RECYCLE_RETENTION_DAYS = 1
export const MAX_WIKI_RECYCLE_RETENTION_DAYS = 3650

export async function getWikiRecycleRetentionDays(): Promise<number> {
  const row = (await db
    .prepare('SELECT value FROM app_kv WHERE key = ?')
    .get(WIKI_RECYCLE_RETENTION_DAYS_KEY)) as { value: string } | undefined
  if (!row?.value?.trim()) return DEFAULT_WIKI_RECYCLE_RETENTION_DAYS
  try {
    const n = typeof row.value === 'string' ? JSON.parse(row.value) : row.value
    const days = typeof n === 'number' ? n : parseInt(String(n), 10)
    if (
      Number.isFinite(days) &&
      days >= MIN_WIKI_RECYCLE_RETENTION_DAYS &&
      days <= MAX_WIKI_RECYCLE_RETENTION_DAYS
    ) {
      return Math.trunc(days)
    }
  } catch {
    /* fall through */
  }
  return DEFAULT_WIKI_RECYCLE_RETENTION_DAYS
}

export function normalizeWikiRecycleRetentionDaysBody(
  body: unknown
): { ok: true; days: number } | { ok: false; error: string } {
  const raw = (body as { retentionDays?: unknown })?.retentionDays
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseInt(raw, 10) : NaN
  if (!Number.isFinite(n) || Math.trunc(n) !== n) {
    return { ok: false, error: 'retentionDays must be an integer' }
  }
  const days = Math.trunc(n)
  if (days < MIN_WIKI_RECYCLE_RETENTION_DAYS || days > MAX_WIKI_RECYCLE_RETENTION_DAYS) {
    return {
      ok: false,
      error: `retentionDays must be between ${MIN_WIKI_RECYCLE_RETENTION_DAYS} and ${MAX_WIKI_RECYCLE_RETENTION_DAYS}`,
    }
  }
  return { ok: true, days }
}

export async function setWikiRecycleRetentionDays(days: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_kv (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`
    )
    .run(WIKI_RECYCLE_RETENTION_DAYS_KEY, JSON.stringify(days))
}
