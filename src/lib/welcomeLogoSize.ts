export const WELCOME_LOGO_MIN_REM = 8
export const WELCOME_LOGO_MAX_REM = 28
export const WELCOME_LOGO_DEFAULT_REM = 16

/** Keep bounds aligned with `coerceWelcomeLogoMaxRem` in `server/routes/home.ts`. */
export function clampWelcomeLogoMaxRem(value: unknown): number {
  let n: number
  if (typeof value === 'number' && Number.isFinite(value)) {
    n = value
  } else if (typeof value === 'string' && value.trim() !== '') {
    const p = parseFloat(value)
    n = Number.isFinite(p) ? p : WELCOME_LOGO_DEFAULT_REM
  } else {
    return WELCOME_LOGO_DEFAULT_REM
  }
  const stepped = Math.round(n * 2) / 2
  return Math.min(WELCOME_LOGO_MAX_REM, Math.max(WELCOME_LOGO_MIN_REM, stepped))
}
