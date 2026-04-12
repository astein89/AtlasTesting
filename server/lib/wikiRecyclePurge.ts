import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getWikiRecycleRetentionDays } from './wikiRecycleSettings.js'
import { readWikiRecycleManifest, removeWikiRecycleManifestEntry, writeWikiRecycleManifest } from './wikiRecycleManifest.js'

function wikiRootDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const levelsUp = here.includes(`${path.sep}dist${path.sep}`) ? 3 : 2
  const root = path.resolve(here, ...Array(levelsUp).fill('..'))
  return path.join(root, 'content', 'wiki')
}

export function listDeletedWikiMarkdownFiles(wikiRoot: string): { abs: string; rel: string }[] {
  const wikiRootResolved = path.resolve(wikiRoot)
  const deletedRoot = path.join(wikiRootResolved, '_deleted')
  if (!fs.existsSync(deletedRoot)) return []
  const out: { abs: string; rel: string }[] = []
  collectMdFiles(deletedRoot, wikiRootResolved, out)
  return out
}

function collectMdFiles(dir: string, wikiRootResolved: string, out: { abs: string; rel: string }[]): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      collectMdFiles(full, wikiRootResolved, out)
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      const rel = path.relative(wikiRootResolved, full).replace(/\\/g, '/')
      out.push({ abs: full, rel })
    }
  }
}

function pruneEmptyDirs(dir: string, stopAt: string): void {
  if (path.resolve(dir) === path.resolve(stopAt)) return
  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return
  }
  if (entries.length > 0) return
  try {
    fs.rmdirSync(dir)
  } catch {
    return
  }
  const parent = path.dirname(dir)
  pruneEmptyDirs(parent, stopAt)
}

/**
 * Permanently removes markdown files under `content/wiki/_deleted/` older than the retention window.
 */
export async function purgeExpiredWikiRecycle(): Promise<{ purged: number }> {
  const retentionDays = await getWikiRecycleRetentionDays()
  const cutoff = new Date()
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setDate(cutoff.getDate() - retentionDays)

  const wikiRoot = wikiRootDir()
  const wikiRootResolved = path.resolve(wikiRoot)
  const deletedRoot = path.join(wikiRootResolved, '_deleted')
  if (!fs.existsSync(deletedRoot)) {
    return { purged: 0 }
  }

  const files = listDeletedWikiMarkdownFiles(wikiRoot)

  let purged = 0
  for (const { abs, rel } of files) {
    let st: fs.Stats
    try {
      st = fs.statSync(abs)
    } catch {
      continue
    }
    if (st.mtime >= cutoff) continue
    try {
      fs.unlinkSync(abs)
      removeWikiRecycleManifestEntry(wikiRoot, rel)
      purged++
      pruneEmptyDirs(path.dirname(abs), deletedRoot)
    } catch {
      /* */
    }
  }

  const manifest = readWikiRecycleManifest(wikiRoot)
  let changed = false
  for (const key of Object.keys(manifest)) {
    const abs = path.resolve(wikiRoot, ...key.split('/'))
    if (!fs.existsSync(abs)) {
      delete manifest[key]
      changed = true
    }
  }
  if (changed) {
    writeWikiRecycleManifest(wikiRoot, manifest)
  }

  if (purged > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[wiki recycle] Purged ${purged} expired page(s) (retention ${retentionDays} days, cutoff ${cutoff.toISOString()})`
    )
  }
  return { purged }
}

export function scheduleWikiRecyclePurgeAtMidnight(): void {
  function msUntilNextMidnight(): number {
    const now = new Date()
    const next = new Date(now)
    next.setDate(next.getDate() + 1)
    next.setHours(0, 0, 0, 0)
    return next.getTime() - now.getTime()
  }
  const delay = msUntilNextMidnight()
  setTimeout(() => {
    void purgeExpiredWikiRecycle().catch((e) => console.error('[wiki recycle purge]', e))
    setInterval(
      () => {
        void purgeExpiredWikiRecycle().catch((e) => console.error('[wiki recycle purge]', e))
      },
      24 * 60 * 60 * 1000
    )
  }, delay)
  // eslint-disable-next-line no-console
  console.log(`[wiki recycle] Scheduled daily purge in ${Math.round(delay / 60000)} min (next local midnight)`)
}
