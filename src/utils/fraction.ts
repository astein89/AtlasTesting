/** Available fraction scales (128ths finest, 2 = halves coarsest) */
export const FRACTION_SCALES = [128, 64, 32, 16, 8, 4, 2] as const
export type FractionScale = (typeof FRACTION_SCALES)[number]

export function parseFractionScale(val: unknown): FractionScale {
  if (typeof val === 'number' && FRACTION_SCALES.includes(val as FractionScale)) {
    return val as FractionScale
  }
  return 16
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

function simplifyLabel(num: number, denom: number): string {
  const d = gcd(num, denom)
  const n = num / d
  const dn = denom / d
  if (dn === 1) return String(n)
  return `${n}/${dn}`
}

export function fractionToDecimal(num: number, denom: number): number {
  return num / denom
}

export function getFractionOptions(
  scale: FractionScale
): { num: number; denom: number; label: string }[] {
  const options: { num: number; denom: number; label: string }[] = []
  for (let num = 1; num <= scale; num++) {
    const label = num === scale ? '-' : simplifyLabel(num, scale)
    options.push({ num, denom: scale, label })
  }
  return options
}

/** Convert decimal to fraction display string using best-fit scale (2–128) */
export function formatDecimalAsFraction(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (value === 0) return '0'

  const sign = value < 0 ? -1 : 1
  const abs = Math.abs(value)
  const whole = Math.floor(abs)
  const remainder = abs - whole
  if (remainder === 0) return String(whole)
  for (const scale of FRACTION_SCALES) {
    const parts = remainder * scale
    if (Math.abs(parts - Math.round(parts)) < 1e-10) {
      const num = Math.round(parts)
      const label = simplifyLabel(num, scale)
      const core = whole > 0 ? `${whole}-${label}` : label
      return sign < 0 ? `-${core}` : core
    }
  }
  return String(value)
}

/**
 * Round a decimal to the nearest fraction with the given scale (e.g. 16 → nearest 1/16).
 */
export function roundToFractionScale(value: number, scale: FractionScale): number {
  if (!Number.isFinite(value)) return value
  return Math.round(value * scale) / scale
}

/**
 * Format a numeric value as a fraction, rounding to the nearest fraction with the given scale.
 * Use for formula fields when "format as fraction" with a specific denominator is set.
 */
export function formatDecimalAsFractionWithScale(value: number, scale: FractionScale): string {
  if (!Number.isFinite(value)) return '—'
  const rounded = roundToFractionScale(value, scale)
  return formatDecimalAsFraction(rounded)
}

/**
 * Parse a formatted fraction string (from formatDecimalAsFraction) back to a number.
 * Handles "0", integers, "num/denom", "whole-num/denom", "whole-n". Returns NaN for unparseable.
 */
export function parseFormattedFraction(s: string): number {
  const t = String(s).trim()
  if (t === '' || t === '—') return Number.NaN
  const sign = t.startsWith('-') ? -1 : 1
  const u = t.startsWith('-') ? t.slice(1) : t
  const intOnly = /^\d+$/
  const fracOnly = /^(\d+)\/(\d+)$/
  const mixed = /^(\d+)-(\d+)\/(\d+)$/
  const mixedWhole = /^(\d+)-(\d+)$/
  if (intOnly.test(u)) return sign * parseInt(u, 10)
  const fracMatch = t.match(fracOnly)
  if (fracMatch) return sign * (parseInt(fracMatch[1], 10) / parseInt(fracMatch[2], 10))
  const mixedMatch = u.match(mixed)
  if (mixedMatch) {
    const whole = parseInt(mixedMatch[1], 10)
    const num = parseInt(mixedMatch[2], 10)
    const denom = parseInt(mixedMatch[3], 10)
    return sign * (whole + num / denom)
  }
  const wholeMatch = u.match(mixedWhole)
  if (wholeMatch) {
    const whole = parseInt(wholeMatch[1], 10)
    const n = parseInt(wholeMatch[2], 10)
    return sign * (whole + n)
  }
  const n = parseFloat(t)
  return Number.isFinite(n) ? sign * Math.abs(n) : Number.NaN
}
