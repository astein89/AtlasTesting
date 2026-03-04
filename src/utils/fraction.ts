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
  if (value === 0 || !Number.isFinite(value)) return '0'
  const whole = Math.floor(value)
  const remainder = value - whole
  if (remainder === 0) return String(whole)
  for (const scale of FRACTION_SCALES) {
    const parts = remainder * scale
    if (Math.abs(parts - Math.round(parts)) < 1e-10) {
      const num = Math.round(parts)
      const label = simplifyLabel(num, scale)
      return whole > 0 ? `${whole}-${label}` : label
    }
  }
  return String(value)
}
