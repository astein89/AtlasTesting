/**
 * Location schema component pattern masks: only @ (letter) and # (digit) are slots;
 * any other character is a literal. Data-field text masks still use textPatternMask.ts.
 */

export function countLocationPatternSlots(pattern: string): number {
  return pattern.split('').filter((c) => c === '@' || c === '#').length
}

/** Non-null error message if invalid; null if ok. Expects non-empty trimmed pattern. */
export function validateLocationPatternMask(raw: string): string | null {
  const p = raw.trim()
  if (!p) return 'Pattern mask cannot be empty'
  if (p.length > 64) return 'Pattern mask at most 64 characters'
  if (/[\r\n]/.test(p)) return 'Pattern mask cannot contain line breaks'
  if (p.includes('*')) {
    return 'Pattern mask cannot contain *; use @ for letters and # for digits'
  }
  if (countLocationPatternSlots(p) === 0) {
    return 'Pattern mask must include at least one @ (letter) or # (digit)'
  }
  return null
}

/**
 * Map typed alphanumerics onto @ / # slots in order. Does not skip chars: the next slot must
 * accept the next character or mapping stops (wrong-type characters are not entered).
 */
export function applyLocationPatternMask(raw: string, pattern: string): string {
  const slotsOnly = raw.replace(/[^A-Za-z0-9]/g, '')
  let i = 0
  const out: string[] = []

  for (const m of pattern.split('')) {
    if (m === '@') {
      if (i >= slotsOnly.length) break
      const ch = slotsOnly[i]!
      if (!/[A-Za-z]/.test(ch)) break
      i++
      out.push(ch.toUpperCase())
    } else if (m === '#') {
      if (i >= slotsOnly.length) break
      const ch = slotsOnly[i]!
      if (!/[0-9]/.test(ch)) break
      i++
      out.push(ch)
    } else {
      out.push(m)
    }
  }

  return out.join('')
}

export function normalizeLocationMixedPatternInputOrNull(part: string, pattern: string): string | null {
  if (part.length !== pattern.length) return null
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const m = pattern[i]!
    const v = part[i]!
    if (m === '@') {
      if (!/[A-Za-z]/.test(v)) return null
      out += v.toUpperCase()
    } else if (m === '#') {
      if (!/[0-9]/.test(v)) return null
      out += v
    } else {
      if (v !== m) return null
      out += v
    }
  }
  return out
}

export function normalizeLocationMixedGeneratePartOrNull(part: string, pattern: string): string | null {
  const t = part.trim()
  if (!t) return null
  const direct = normalizeLocationMixedPatternInputOrNull(t, pattern)
  if (direct != null) return direct
  const filled = applyLocationPatternMask(t, pattern)
  return normalizeLocationMixedPatternInputOrNull(filled, pattern)
}
