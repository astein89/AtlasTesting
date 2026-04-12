import { db } from '../db/index.js'

export const ADMINER_URL_KV_KEY = 'adminer_url'

export async function getAdminerUrl(): Promise<string | null> {
  const row = (await db.prepare('SELECT value FROM app_kv WHERE key = ?').get(ADMINER_URL_KV_KEY)) as
    | { value: string }
    | undefined
  if (!row?.value?.trim()) return null
  try {
    const v = JSON.parse(row.value) as unknown
    if (typeof v !== 'string') return null
    const t = v.trim()
    return t === '' ? null : t
  } catch {
    return null
  }
}

export function normalizeAdminerUrlBody(
  body: unknown
): { ok: true; url: string | null } | { ok: false; error: string } {
  const raw = (body as { url?: unknown })?.url
  if (raw === null || raw === undefined) return { ok: true, url: null }
  if (typeof raw !== 'string') return { ok: false, error: 'url must be a string or null' }
  const s = raw.trim()
  if (s === '') return { ok: true, url: null }
  if (s.length > 2048) return { ok: false, error: 'URL is too long' }

  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return { ok: false, error: 'Only http(s) URLs are allowed' }
      }
      return { ok: true, url: s }
    } catch {
      return { ok: false, error: 'Invalid URL' }
    }
  }

  if (s.startsWith('/') && !s.startsWith('//')) {
    return { ok: true, url: s }
  }

  return { ok: false, error: 'Use a path starting with / (e.g. /adminer) or an http(s):// URL' }
}

export async function setAdminerUrl(url: string | null): Promise<void> {
  if (url == null || url === '') {
    await db.prepare('DELETE FROM app_kv WHERE key = ?').run(ADMINER_URL_KV_KEY)
    return
  }
  await db
    .prepare(
      `INSERT INTO app_kv (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`
    )
    .run(ADMINER_URL_KV_KEY, JSON.stringify(url))
}
