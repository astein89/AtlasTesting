import fs from 'node:fs'
import path from 'node:path'
import { db } from '../db/index.js'
import { getFilesRecycleRetentionDays } from './filesRecycleSettings.js'

function filesUploadDir(): string {
  return path.join(process.cwd(), 'uploads', 'files')
}

/**
 * Permanently removes recycled files whose `deleted_at` is older than the configured retention window.
 * Safe to call from a daily scheduler.
 */
export async function purgeExpiredRecycledFiles(): Promise<{ purged: number }> {
  const retentionDays = await getFilesRecycleRetentionDays()
  const cutoff = new Date()
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setDate(cutoff.getDate() - retentionDays)
  const cutoffIso = cutoff.toISOString()

  const rows = (await db
    .prepare(
      `SELECT id, storage_filename FROM stored_files
       WHERE deleted_at IS NOT NULL AND deleted_at != ''
         AND deleted_at < ?`
    )
    .all(cutoffIso)) as { id: string; storage_filename: string }[]

  const dir = path.resolve(filesUploadDir())
  let purged = 0
  for (const r of rows) {
    const diskPath = path.resolve(path.join(dir, r.storage_filename))
    if (diskPath.startsWith(dir) && fs.existsSync(diskPath)) {
      try {
        fs.unlinkSync(diskPath)
      } catch {
        /* */
      }
    }
    await db.prepare('DELETE FROM stored_files WHERE id = ?').run(r.id)
    purged++
  }
  if (purged > 0) {
    // eslint-disable-next-line no-console
    console.log(`[files recycle] Purged ${purged} expired file(s) (retention ${retentionDays} days, cutoff ${cutoffIso})`)
  }
  return { purged }
}

export function scheduleRecyclePurgeAtMidnight(): void {
  /** Next local midnight (server timezone). */
  function msUntilNextMidnight(): number {
    const now = new Date()
    const next = new Date(now)
    next.setDate(next.getDate() + 1)
    next.setHours(0, 0, 0, 0)
    return next.getTime() - now.getTime()
  }
  const delay = msUntilNextMidnight()
  setTimeout(() => {
    void purgeExpiredRecycledFiles().catch((e) => console.error('[files recycle purge]', e))
    setInterval(
      () => {
        void purgeExpiredRecycledFiles().catch((e) => console.error('[files recycle purge]', e))
      },
      24 * 60 * 60 * 1000
    )
  }, delay)
  // eslint-disable-next-line no-console
  console.log(`[files recycle] Scheduled daily purge in ${Math.round(delay / 60000)} min (next local midnight)`)
}
