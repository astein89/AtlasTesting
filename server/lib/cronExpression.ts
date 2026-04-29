import { CronExpressionParser } from 'cron-parser'
import { getHostTimeZone } from './hostTimeZone.js'

const MAX_LEN = 200

function parseOpts(now: Date) {
  return { currentDate: now, tz: getHostTimeZone() }
}

/** Standard crontab: 5 fields (minute hour day month weekday) or 6 with seconds (library supports both). */
export function validateCronExpression(expression: string): { ok: true } | { ok: false; message: string } {
  const t = expression.trim()
  if (!t) return { ok: false, message: 'Cron expression cannot be empty' }
  if (t.length > MAX_LEN) return { ok: false, message: `Cron expression is too long (max ${MAX_LEN} characters)` }
  try {
    CronExpressionParser.parse(t, parseOpts(new Date()))
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid cron expression'
    return { ok: false, message: msg }
  }
}

export function isValidCronExpression(expression: string): boolean {
  return validateCronExpression(expression).ok
}

/** Next fire time strictly after `now`, or null if the expression is invalid. */
export function getNextCronRun(now: Date, expression: string): Date | null {
  const t = expression.trim()
  if (!t || t.length > MAX_LEN) return null
  try {
    const interval = CronExpressionParser.parse(t, parseOpts(now))
    return interval.next().toDate()
  } catch {
    return null
  }
}
