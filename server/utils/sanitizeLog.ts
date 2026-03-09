/**
 * Redact /api/uploads/ paths from strings before logging, to avoid leaking upload paths in logs.
 */
const UPLOADS_PATH = '/api/uploads/'
const REDACTED = '[upload]'

export function sanitizeForLog(value: unknown): string {
  if (value == null) return String(value)
  const s = typeof value === 'string' ? value : String(value)
  if (!s.includes(UPLOADS_PATH)) return s
  return s.replace(new RegExp(UPLOADS_PATH + '[^\\s\'"]*', 'g'), REDACTED)
}
