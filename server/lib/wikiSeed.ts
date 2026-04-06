import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Tracks seed keys (paths relative to wiki-seed) already applied; survives renames/deletes of the .md file. */
const SEED_STATE_FILENAME = '.wiki-seed-applied.json'

/** Same project root resolution as `wikiRootDir` in `server/routes/wiki.ts`. */
function projectRootFromServerLib(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const levelsUp = here.includes(`${path.sep}dist${path.sep}`) ? 3 : 2
  return path.resolve(here, ...Array(levelsUp).fill('..'))
}

function wikiSeedSourceDir(): string {
  return path.join(projectRootFromServerLib(), 'content', 'wiki-seed')
}

function wikiDataDir(): string {
  return path.join(projectRootFromServerLib(), 'content', 'wiki')
}

function seedStatePath(wikiRoot: string): string {
  return path.join(wikiRoot, SEED_STATE_FILENAME)
}

function readApplied(wikiRoot: string): Set<string> {
  try {
    const raw = fs.readFileSync(seedStatePath(wikiRoot), 'utf8')
    const data = JSON.parse(raw) as { applied?: unknown }
    if (!Array.isArray(data.applied)) return new Set()
    return new Set(data.applied.filter((x): x is string => typeof x === 'string' && x.length > 0))
  } catch {
    return new Set()
  }
}

function writeApplied(wikiRoot: string, applied: Set<string>): void {
  try {
    fs.mkdirSync(wikiRoot, { recursive: true })
  } catch {
    /* exists */
  }
  const list = [...applied].sort()
  fs.writeFileSync(seedStatePath(wikiRoot), JSON.stringify({ applied: list }, null, 2), 'utf8')
}

function collectMdRelPaths(dir: string, base: string, out: string[]): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      collectMdRelPaths(full, base, out)
    } else if (ent.isFile() && ent.name.endsWith('.md')) {
      out.push(path.relative(base, full).replace(/\\/g, '/'))
    }
  }
}

/**
 * Copy Markdown from `content/wiki-seed/` into `content/wiki/` for each seed key
 * at most once. Tracks applied keys in `.wiki-seed-applied.json` so a rename or
 * delete of the `.md` file does not cause the same seed to be copied again.
 * Existing files at the seed path are left unchanged and marked applied without overwrite.
 */
export function seedWikiDefaults(): void {
  const seedRoot = wikiSeedSourceDir()
  const wikiRoot = wikiDataDir()
  if (!fs.existsSync(seedRoot)) return

  const rels: string[] = []
  collectMdRelPaths(seedRoot, seedRoot, rels)
  if (rels.length === 0) return

  const applied = readApplied(wikiRoot)
  let copied = 0
  let changed = false

  for (const rel of rels) {
    if (applied.has(rel)) continue

    const src = path.join(seedRoot, rel)
    const dst = path.join(wikiRoot, rel)

    if (fs.existsSync(dst)) {
      applied.add(rel)
      changed = true
      continue
    }

    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(src, dst)
    applied.add(rel)
    changed = true
    copied += 1
  }

  if (changed) writeApplied(wikiRoot, applied)

  if (copied > 0) {
    console.log(
      `[wiki] Seeded ${copied} default page(s) from content/wiki-seed (existing paths and prior seed keys left unchanged).`
    )
  }
}
