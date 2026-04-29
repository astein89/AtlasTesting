import { CronExpressionParser } from 'cron-parser'

const MAX_LEN = 200

/** Keep validation rules in sync with `server/lib/cronExpression.ts` (`validateCronExpression`). Pass `serverTimeZone` from GET `/backup` so parsing matches the host. */
export function validateBackupCronExpression(
  expression: string,
  serverTimeZone?: string | null
): { ok: true } | { ok: false; message: string } {
  const t = expression.trim()
  if (!t) return { ok: false, message: 'Cron expression cannot be empty' }
  if (t.length > MAX_LEN) return { ok: false, message: `Cron expression is too long (max ${MAX_LEN} characters)` }
  try {
    const tz = serverTimeZone?.trim()
    CronExpressionParser.parse(t, {
      currentDate: new Date(),
      ...(tz ? { tz } : {}),
    })
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid cron expression'
    return { ok: false, message: msg }
  }
}
