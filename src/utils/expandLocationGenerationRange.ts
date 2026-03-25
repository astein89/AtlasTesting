import {
  normalizeLocationMixedGeneratePartOrNull,
  normalizeLocationMixedPatternInputOrNull,
} from './locationPatternMask'

/**
 * Expand generate-range expressions with strict width rules.
 * Numeric: short numbers zero-pad (width 2: 1-4 → 01..04).
 * Alpha width 1: single-letter ranges/values (A-C, Z).
 * Alpha width ≥2: every group must be full width (AA-BB ok; A-B and AA-PP,H invalid).
 * Mixed: each position is a letter range or digit range; e.g. A1-C3 (letters then digits).
 * Mixed + pattern mask: comma-separated full codes; location masks use only @ and # as slots (see locationPatternMask).
 * Kept in sync with server/routes/locations.ts expandRange.
 */

export function expandLocationGenerationRange(
  expr: string,
  type: 'alpha' | 'numeric' | 'mixed' | 'fixed',
  width: number,
  patternMask?: string | null,
  fixedLiteral?: string | null
): { values: string[]; error?: string } {
  if (type === 'fixed') {
    const lit = (fixedLiteral ?? '').trim()
    if (!lit) return { values: [], error: 'Fixed value is empty' }
    return { values: [lit] }
  }
  const pm = patternMask?.trim()
  if (type === 'mixed' && pm) {
    const t = expr.trim()
    if (!t) return { values: [] }
    const parts = t
      .split(/[;,]+/g)
      .map((p) => p.trim())
      .filter(Boolean)
    const acc: string[] = []
    for (const part of parts) {
      const n = normalizeLocationMixedGeneratePartOrNull(part, pm)
      if (n == null) {
        return {
          values: [],
          error: `Invalid value for pattern "${pm}": ${part.trim() || part}`,
        }
      }
      acc.push(n)
    }
    return { values: Array.from(new Set(acc)) }
  }

  const trimmed = expr.trim()
  if (!trimmed) return { values: [] }

  const parts = trimmed
    .split(/[;,]+/g)
    .map((p) => p.trim())
    .filter(Boolean)
  const out: string[] = []

  const upperLetters = (s: string) => s.replace(/[a-z]/g, (c) => c.toUpperCase())

  /** Per-position letter or digit ranges; cartesian product. */
  function mixedRangeCartesian(
    startRaw: string,
    endRaw: string,
    w: number
  ): { values: string[]; error?: string } {
    const start = startRaw.toUpperCase()
    const end = endRaw.toUpperCase()
    if (start.length !== end.length || start.length !== w) {
      return { values: [], error: `Mixed range ends must each be exactly ${w} character(s)` }
    }
    const cols: string[][] = []
    for (let i = 0; i < w; i++) {
      const a = start[i]!
      const b = end[i]!
      const da = /\d/.test(a)
      const db = /\d/.test(b)
      if (da !== db) {
        return {
          values: [],
          error: `Position ${i + 1}: range ends must both be digits or both letters (got ${a} and ${b})`,
        }
      }
      if (da) {
        const na = parseInt(a, 10)
        const nb = parseInt(b, 10)
        if (Number.isNaN(na) || Number.isNaN(nb)) {
          return { values: [], error: `Invalid digit at position ${i + 1}` }
        }
        const lo = Math.min(na, nb)
        const hi = Math.max(na, nb)
        const col: string[] = []
        for (let n = lo; n <= hi; n++) {
          if (n < 0 || n > 9) {
            return { values: [], error: `Digit out of 0–9 at position ${i + 1}` }
          }
          col.push(String(n))
        }
        cols.push(col)
      } else {
        const ca = a.charCodeAt(0)
        const cb = b.charCodeAt(0)
        if (ca < 65 || ca > 90 || cb < 65 || cb > 90) {
          return { values: [], error: `Use letters A–Z at position ${i + 1}` }
        }
        const lo = Math.min(ca, cb)
        const hi = Math.max(ca, cb)
        const col: string[] = []
        for (let c = lo; c <= hi; c++) {
          col.push(String.fromCharCode(c))
        }
        cols.push(col)
      }
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
      } else if (type === 'mixed') {
        const expanded = mixedRangeCartesian(start, end, width)
        if (expanded.error) {
          return { values: [], error: expanded.error }
        }
        out.push(...expanded.values)
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
    } else if (type === 'mixed') {
      const t = part
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
      if (!t) {
        return { values: [], error: `Invalid mixed value: ${part}` }
      }
      if (t.length !== width) {
        return {
          values: [],
          error: `Mixed value must be exactly ${width} character(s) (A–Z or 0–9): ${part}`,
        }
      }
      if (!/^[A-Z0-9]+$/.test(t)) {
        return { values: [], error: `Use only A–Z and 0–9: ${part}` }
      }
      out.push(t)
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
export function sanitizeGenerateRangeInput(
  raw: string,
  type: 'alpha' | 'numeric' | 'mixed' | 'fixed',
  patternMask?: string | null
): string {
  if (type === 'fixed') {
    return ''
  }
  if (type === 'numeric') {
    return raw.replace(/[^\d\s,;-]/g, '')
  }
  if (type === 'mixed' && patternMask?.trim()) {
    const pm = patternMask.trim()
    return raw
      .replace(/\r/g, '')
      .split(/([,;]+)/)
      .map((seg, i) => {
        if (i % 2 === 1) return seg
        const t = seg.trim()
        if (!t) return seg
        if (t.length === pm.length) {
          const n = normalizeLocationMixedPatternInputOrNull(t, pm)
          if (n != null) {
            const lead = seg.match(/^\s*/)?.[0] ?? ''
            const trail = seg.match(/\s*$/)?.[0] ?? ''
            return lead + n + trail
          }
        }
        return seg
      })
      .join('')
  }
  if (type === 'mixed') {
    return raw
      .replace(/[^A-Za-z0-9\s,;-]/g, '')
      .replace(/[a-z]/g, (c) => c.toUpperCase())
  }
  return raw
    .replace(/[^A-Za-z\s,;-]/g, '')
    .replace(/[a-z]/g, (c) => c.toUpperCase())
}
