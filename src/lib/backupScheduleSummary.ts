const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Plain-language line for built-in (non-cron) frequencies — complements cronstrue on cron. */
export function getBuiltInScheduleSummary(block: {
  enabled: boolean
  frequency: 'hourly' | 'everyNHours' | 'daily' | 'weekly' | 'cron'
  everyNHours: number
  timeLocal: string
  weekday: number
  minuteOffset: number
}): string | null {
  if (!block.enabled || block.frequency === 'cron') return null
  switch (block.frequency) {
    case 'hourly':
      return `Every hour at minute ${block.minuteOffset}.`
    case 'everyNHours':
      return `Every ${block.everyNHours} hour(s) at minute ${block.minuteOffset}.`
    case 'daily':
      return `Every day at ${block.timeLocal.trim() || '—'} (server local time).`
    case 'weekly': {
      const d = WEEKDAYS[block.weekday % 7] ?? '—'
      return `Every ${d} at ${block.timeLocal.trim() || '—'} (server local time).`
    }
    default:
      return null
  }
}
