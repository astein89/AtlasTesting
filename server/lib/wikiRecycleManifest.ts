import fs from 'node:fs'
import path from 'node:path'

const MANIFEST_NAME = '.wiki-recycle-manifest.json'

export type WikiRecycleManifestEntry = {
  wikiPath: string
  deletedAt: string
  viewRoleSlugs?: string[]
  title?: string
  /** Section index pages only. */
  showSectionPages?: boolean
}

export type WikiRecycleManifest = Record<string, WikiRecycleManifestEntry>

function manifestPath(wikiRoot: string): string {
  return path.join(wikiRoot, '_deleted', MANIFEST_NAME)
}

export function readWikiRecycleManifest(wikiRoot: string): WikiRecycleManifest {
  const fp = manifestPath(wikiRoot)
  try {
    const raw = fs.readFileSync(fp, 'utf8')
    const data = JSON.parse(raw) as unknown
    if (!data || typeof data !== 'object') return {}
    const out: WikiRecycleManifest = {}
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (typeof k !== 'string' || !k.startsWith('_deleted/')) continue
      if (!v || typeof v !== 'object') continue
      const o = v as Record<string, unknown>
      const wp = typeof o.wikiPath === 'string' ? o.wikiPath : ''
      const del = typeof o.deletedAt === 'string' ? o.deletedAt : ''
      if (!wp || !del) continue
      const entry: WikiRecycleManifestEntry = { wikiPath: wp, deletedAt: del }
      if (Array.isArray(o.viewRoleSlugs)) {
        const slugs = o.viewRoleSlugs.filter((x): x is string => typeof x === 'string')
        if (slugs.length) entry.viewRoleSlugs = slugs
      }
      if (typeof o.title === 'string' && o.title.trim()) entry.title = o.title.trim()
      if (o.showSectionPages === false) entry.showSectionPages = false
      out[k.replace(/\\/g, '/')] = entry
    }
    return out
  } catch {
    return {}
  }
}

export function writeWikiRecycleManifest(wikiRoot: string, manifest: WikiRecycleManifest): void {
  const fp = manifestPath(wikiRoot)
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true })
  } catch {
    /* */
  }
  fs.writeFileSync(fp, JSON.stringify(manifest, null, 2), 'utf8')
}

export function upsertWikiRecycleManifestEntry(
  wikiRoot: string,
  storageRel: string,
  entry: WikiRecycleManifestEntry
): void {
  const key = storageRel.replace(/\\/g, '/')
  const m = readWikiRecycleManifest(wikiRoot)
  m[key] = entry
  writeWikiRecycleManifest(wikiRoot, m)
}

export function removeWikiRecycleManifestEntry(wikiRoot: string, storageRel: string): void {
  const key = storageRel.replace(/\\/g, '/')
  const m = readWikiRecycleManifest(wikiRoot)
  if (m[key]) {
    delete m[key]
    writeWikiRecycleManifest(wikiRoot, m)
  }
}
