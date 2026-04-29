import type { BackupScheduleBlock } from './backupSettings.js'
import { getNextScheduleRun } from './backupScheduleMath.js'

/** Next fire times using the same logic as `scheduleBackupTimers` (for Admin UI preview). */
export function computeSchedulePreviewRuns(block: BackupScheduleBlock, count: number): Date[] {
  if (!block.enabled) return []
  const runs: Date[] = []
  let cur = new Date()
  for (let i = 0; i < count; i++) {
    const next = getNextScheduleRun(cur, block)
    if (!next) break
    runs.push(next)
    cur = new Date(next.getTime() + 1000)
  }
  return runs
}
