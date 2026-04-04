/**
 * RFC 4122–style random id. Prefer `crypto.randomUUID` when available; on plain HTTP (e.g. LAN IP)
 * some browsers omit `randomUUID`, so we fall back to a v4-like string from `Math.random`.
 */
export function randomUuid(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID()
    } catch {
      /* continue to fallback */
    }
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    const v = ch === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
