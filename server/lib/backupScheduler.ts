import { getBackupSettings } from './backupSettings.js'
import { msUntilNextRun } from './backupScheduleMath.js'
import { runDatabaseBackup, runDatabaseFullBackup, runMirrorBackup } from './backupJob.js'

let dbTimer: ReturnType<typeof setTimeout> | undefined
let dbFullTimer: ReturnType<typeof setTimeout> | undefined
let mirrorTimer: ReturnType<typeof setTimeout> | undefined

function clearTimers() {
  if (dbTimer !== undefined) {
    clearTimeout(dbTimer)
    dbTimer = undefined
  }
  if (dbFullTimer !== undefined) {
    clearTimeout(dbFullTimer)
    dbFullTimer = undefined
  }
  if (mirrorTimer !== undefined) {
    clearTimeout(mirrorTimer)
    mirrorTimer = undefined
  }
}

function armDatabase() {
  void (async () => {
    const s = await getBackupSettings()
    const ms = msUntilNextRun(new Date(), s.databaseSchedule)
    if (ms == null) return
    dbTimer = setTimeout(() => {
      void (async () => {
        try {
          await runDatabaseBackup()
        } finally {
          armDatabase()
        }
      })()
    }, ms)
  })()
}

function armDatabaseFull() {
  void (async () => {
    const s = await getBackupSettings()
    const ms = msUntilNextRun(new Date(), s.databaseFullSchedule)
    if (ms == null) return
    dbFullTimer = setTimeout(() => {
      void (async () => {
        try {
          await runDatabaseFullBackup()
        } finally {
          armDatabaseFull()
        }
      })()
    }, ms)
  })()
}

function armMirror() {
  void (async () => {
    const s = await getBackupSettings()
    const ms = msUntilNextRun(new Date(), s.mirrorSchedule)
    if (ms == null) return
    mirrorTimer = setTimeout(() => {
      void (async () => {
        try {
          await runMirrorBackup()
        } finally {
          armMirror()
        }
      })()
    }, ms)
  })()
}

/** Clears existing timers and arms the next database, full database, and mirror runs from current KV settings. */
export function scheduleBackupTimers(): void {
  clearTimers()
  armDatabase()
  armDatabaseFull()
  armMirror()
}
