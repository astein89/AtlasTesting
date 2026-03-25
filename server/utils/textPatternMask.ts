/** Same rules as src/utils/textPatternMask.ts (@/a letter, #/0 digit, * alnum, else literal). */

export function isValidTextPatternValue(value: string, pattern: string): boolean {
  if (value.length !== pattern.length) return false
  for (let i = 0; i < pattern.length; i++) {
    const m = pattern[i]!
    const v = value[i]!
    if (m === '@' || m === 'a') {
      if (!/[A-Za-z]/.test(v)) return false
    } else if (m === '#' || m === '0') {
      if (!/[0-9]/.test(v)) return false
    } else if (m === '*') {
      if (!/[A-Za-z0-9]/.test(v)) return false
    } else if (v !== m) {
      return false
    }
  }
  return true
}

export function normalizeTextPatternValue(value: string, pattern: string): string {
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const m = pattern[i]!
    let v = value[i]!
    if (m === '@' || m === 'a') {
      v = v.toUpperCase()
    } else if (m === '*') {
      if (/[a-z]/.test(v)) v = v.toUpperCase()
    }
    out += v
  }
  return out
}

export function countTextPatternSlots(pattern: string): number {
  return pattern.split('').filter((ch) => ch === '@' || ch === '#' || ch === '*' || ch === '0' || ch === 'a').length
}

/** Map slot-only input onto the mask; literals come from the pattern (same as client). */
export function applyTextPatternMask(raw: string, pattern: string): string {
  const maskChars = pattern.split('')
  const slotsOnly = raw.replace(/[^A-Za-z0-9]/g, '')
  const out: string[] = []
  let slotIndex = 0

  const takeNextMatching = (predicate: (ch: string) => boolean): string | null => {
    while (slotIndex < slotsOnly.length) {
      const ch = slotsOnly[slotIndex++]
      if (predicate(ch)) return ch
    }
    return null
  }

  for (const m of maskChars) {
    if (m === '@' || m === 'a') {
      const ch = takeNextMatching((c) => /[A-Za-z]/.test(c))
      if (ch == null) break
      out.push(ch)
    } else if (m === '#' || m === '0') {
      const ch = takeNextMatching((c) => /[0-9]/.test(c))
      if (ch == null) break
      out.push(ch)
    } else if (m === '*') {
      const ch = takeNextMatching((c) => /[A-Za-z0-9]/.test(c))
      if (ch == null) break
      out.push(ch)
    } else {
      out.push(m)
    }
  }

  return out.join('')
}

/** Parse one full code against the mask; return normalized storage or null. */
export function normalizeMixedPatternInputOrNull(part: string, pattern: string): string | null {
  if (part.length !== pattern.length) return null
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const m = pattern[i]!
    const v = part[i]!
    if (m === '@' || m === 'a') {
      if (!/[A-Za-z]/.test(v)) return null
      out += v.toUpperCase()
    } else if (m === '#' || m === '0') {
      if (!/[0-9]/.test(v)) return null
      out += v
    } else if (m === '*') {
      if (!/[A-Za-z0-9]/.test(v)) return null
      out += /[a-z]/.test(v) ? v.toUpperCase() : v
    } else {
      if (v !== m) return null
      out += v
    }
  }
  return out
}

/** Same as client: full code or slot-only with literals filled from the pattern. */
export function normalizeMixedGeneratePartOrNull(part: string, pattern: string): string | null {
  const t = part.trim()
  if (!t) return null
  const direct = normalizeMixedPatternInputOrNull(t, pattern)
  if (direct != null) return direct
  const filled = applyTextPatternMask(t, pattern)
  return normalizeMixedPatternInputOrNull(filled, pattern)
}
