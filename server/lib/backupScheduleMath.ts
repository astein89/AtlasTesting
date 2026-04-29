import type { BackupScheduleBlock } from './backupSettings.js'
import { getNextCronRun } from './cronExpression.js'

/** Next fire time after `now`, or null if schedule disabled. */
export function getNextScheduleRun(now: Date, block: BackupScheduleBlock): Date | null {
  if (!block.enabled) return null

  const mo = block.minuteOffset
  const [th, tm] = parseTimeLocal(block.timeLocal)

  switch (block.frequency) {
    case 'cron':
      return getNextCronRun(now, block.cronExpression)
    case 'hourly': {
      const t = new Date(now)
      t.setSeconds(0, 0)
      t.setMilliseconds(0)
      t.setMinutes(mo)
      if (t <= now) {
        t.setHours(t.getHours() + 1)
        t.setMinutes(mo)
      }
      return t
    }
    case 'everyNHours': {
      const n = Math.max(1, block.everyNHours)
      const t = new Date(now)
      t.setSeconds(0, 0)
      t.setMilliseconds(0)
      t.setMinutes(mo)
      while (t <= now) {
        t.setHours(t.getHours() + n)
      }
      return t
    }
    case 'daily': {
      const t = new Date(now)
      t.setHours(th, tm, 0, 0)
      if (t <= now) t.setDate(t.getDate() + 1)
      return t
    }
    case 'weekly': {
      const targetDow = block.weekday % 7
      const t = new Date(now)
      t.setHours(th, tm, 0, 0)
      const nowDow = t.getDay()
      let daysAhead = (targetDow - nowDow + 7) % 7
      if (daysAhead === 0 && t <= now) daysAhead = 7
      t.setDate(t.getDate() + daysAhead)
      return t
    }
    default:
      return null
  }
}

function parseTimeLocal(s: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return [2, 0]
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)))
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)))
  return [h, min]
}

export function msUntilNextRun(now: Date, block: BackupScheduleBlock): number | null {
  const next = getNextScheduleRun(now, block)
  if (!next) return null
  return Math.max(0, next.getTime() - now.getTime())
}
