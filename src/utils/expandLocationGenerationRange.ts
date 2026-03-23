/**
 * Expand generate-range expressions with strict width rules.
 * Numeric: short numbers zero-pad (width 2: 1-4 → 01..04).
 * Alpha width 1: single-letter ranges/values (A-C, Z).
 * Alpha width ≥2: every group must be full width (AA-BB ok; A-B and AA-PP,H invalid).
 * Kept in sync with server/routes/locations.ts expandRange.
 */
export function expandLocationGenerationRange(
  expr: string,
  type: 'alpha' | 'numeric',
  width: number
): { values: string[]; error?: string } {
  const trimmed = expr.trim()
  if (!trimmed) return { values: [] }

  const parts = trimmed
    .split(/[;,]+/g)
    .map((p) => p.trim())
    .filter(Boolean)
  const out: string[] = []

  const upperLetters = (s: string) => s.replace(/[a-z]/g, (c) => c.toUpperCase())

  /** Column-wise letter ranges combined (e.g. tt–uu → TT, TU, UT, UU for width 2). */
  function alphaRangeCartesian(startRaw: string, endRaw: string): { values: string[]; error?: string } {
    const start = startRaw.toUpperCase()
    const end = endRaw.toUpperCase()
    if (start.length !== end.length) {
      return { values: [], error: `Range ends must match length (${startRaw}–${endRaw})` }
    }
    if (start.length !== width) {
      return { values: [], error: `Range must be exactly ${width} letter(s) for this part` }
    }
    const cols: string[][] = []
    for (let i = 0; i < start.length; i++) {
      const a = start.charCodeAt(i)
      const b = end.charCodeAt(i)
      if (a < 65 || a > 90 || b < 65 || b > 90) {
        return { values: [], error: `Use letters A–Z at each position` }
      }
      const lo = Math.min(a, b)
      const hi = Math.max(a, b)
      const col: string[] = []
      for (let c = lo; c <= hi; c++) {
        col.push(String.fromCharCode(c))
      }
      cols.push(col)
    }
    function cartesian(c: string[][]): string[] {
      if (c.length === 0) return ['']
      const [head, ...tail] = c
      const rest = cartesian(tail)
      const acc: string[] = []
      for (const ch of head) {
        for (const s of rest) {
          acc.push(ch + s)
        }
      }
      return acc
    }
    return { values: cartesian(cols) }
  }

  for (const part of parts) {
    const m = part.match(/^([A-Za-z0-9]+)\s*-\s*([A-Za-z0-9]+)$/)
    if (m) {
      const start = m[1]
      const end = m[2]
      if (type === 'numeric') {
        const a = parseInt(start, 10)
        const b = parseInt(end, 10)
        if (Number.isNaN(a) || Number.isNaN(b)) {
          return { values: [], error: `Invalid numeric range: ${part}` }
        }
        const lo = Math.min(a, b)
        const hi = Math.max(a, b)
        for (let n = lo; n <= hi; n++) {
          if (!Number.isInteger(n) || n < 0) {
            return { values: [], error: `Invalid number in range: ${n}` }
          }
          const padded = String(n).padStart(width, '0')
          if (padded.length !== width) {
            return { values: [], error: `Value ${n} does not fit in ${width} digit(s)` }
          }
          out.push(padded)
        }
      } else {
        if (width >= 2 && start.length === 1 && end.length === 1) {
          return {
            values: [],
            error: `Use ${width} letters on each side (e.g. AA–BB), not single letters like ${part}`,
          }
        }
        if (start.length === 1 && end.length === 1) {
          const a = start.toUpperCase().charCodeAt(0)
          const b = end.toUpperCase().charCodeAt(0)
          if (a < 65 || a > 90 || b < 65 || b > 90) {
            return { values: [], error: `Use letters A–Z in range: ${part}` }
          }
          const lo = Math.min(a, b)
          const hi = Math.max(a, b)
          for (let c = lo; c <= hi; c++) {
            const ch = String.fromCharCode(c)
            out.push(ch.padStart(width, 'A'))
          }
        } else {
          const expanded = alphaRangeCartesian(start, end)
          if (expanded.error) {
            return { values: [], error: expanded.error }
          }
          out.push(...expanded.values)
        }
      }
      continue
    }

    if (type === 'numeric') {
      const n = parseInt(part, 10)
      if (Number.isNaN(n)) {
        return { values: [], error: `Invalid number: ${part}` }
      }
      if (!Number.isInteger(n) || n < 0) {
        return { values: [], error: `Invalid number: ${part}` }
      }
      const padded = String(n).padStart(width, '0')
      if (padded.length !== width) {
        return { values: [], error: `Value ${n} does not fit in ${width} digit(s)` }
      }
      out.push(padded)
    } else {
      const letters = upperLetters(part).replace(/[^A-Za-z]/g, '')
      if (!letters) {
        return { values: [], error: `Invalid letters: ${part}` }
      }
      if (letters.length > width) {
        return { values: [], error: `Use at most ${width} letter(s) in ${part}` }
      }
      if (!/^[A-Z]+$/.test(letters)) {
        return { values: [], error: `Use letters A–Z only: ${part}` }
      }
      if (width >= 2 && letters.length < width) {
        return {
          values: [],
          error: `Each value must be exactly ${width} letters (e.g. HH not H): ${part}`,
        }
      }
      out.push(letters.padStart(width, 'A'))
    }
  }

  return { values: Array.from(new Set(out)) }
}

/** Strip disallowed characters while typing; keeps , ; - and spaces for range syntax. */
export function sanitizeGenerateRangeInput(raw: string, type: 'alpha' | 'numeric'): string {
  if (type === 'numeric') {
    return raw.replace(/[^\d\s,;-]/g, '')
  }
  return raw
    .replace(/[^A-Za-z\s,;-]/g, '')
    .replace(/[a-z]/g, (c) => c.toUpperCase())
}
