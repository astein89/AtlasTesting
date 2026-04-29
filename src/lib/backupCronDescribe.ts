import cronstrue from 'cronstrue'

/**
 * Human-readable schedule text via [cronstrue](https://www.npmjs.com/package/cronstrue).
 * Returns null if empty or if cronstrue cannot describe the expression.
 */
export function cronExpressionToHuman(expression: string): string | null {
  const t = expression.trim()
  if (!t) return null
  try {
    return cronstrue.toString(t, {
      throwExceptionOnParseError: true,
      verbose: true,
      use24HourTimeFormat: false,
    })
  } catch {
    return null
  }
}
