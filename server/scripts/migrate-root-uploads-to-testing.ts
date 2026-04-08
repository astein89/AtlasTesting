/**
 * One-time: move loose files from uploads/ into uploads/testing/ and rewrite
 * /api/uploads/<file> → /api/uploads/testing/<file> in test_runs.data and record_history.
 *
 * Run: npx tsx server/scripts/migrate-root-uploads-to-testing.ts
 * Dry run: npx tsx server/scripts/migrate-root-uploads-to-testing.ts --dry-run
 */
import fs from 'fs'
import path from 'path'
import { db } from '../db/index.js'

const cwd = process.cwd()
const uploadsRoot = path.join(cwd, 'uploads')
const testingDir = path.join(uploadsRoot, 'testing')
const dryRun = process.argv.includes('--dry-run')

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Replace old /api/uploads/ path with new testing path in a JSON blob. */
function rewriteUploadPaths(
  json: string | null,
  /** basename before -> basename after (may differ if rename on collision) */
  moves: Map<string, string>
): string | null {
  if (json == null || json === '') return json
  let s = json
  for (const [fromBase, toBase] of moves) {
    const fromEsc = escapeRe(fromBase)
    const re = new RegExp(`(/api/uploads/)(?!testing/)${fromEsc}(?=["',\\]}\\s]|$)`, 'g')
    s = s.replace(re, (_m, p1: string) => `${p1}testing/${toBase}`)
  }
  return s
}

function listRootFiles(): string[] {
  if (!fs.existsSync(uploadsRoot)) return []
  const skip = new Set(['.', '..'])
  return fs
    .readdirSync(uploadsRoot, { withFileTypes: true })
    .filter((d) => d.isFile() && !skip.has(d.name))
    .map((d) => d.name)
}

function moveRootFilesToTesting(): Map<string, string> {
  const moves = new Map<string, string>()
  if (!fs.existsSync(uploadsRoot)) {
    // eslint-disable-next-line no-console
    console.log('[migrate-uploads] No uploads/ directory; nothing to move.')
    return moves
  }

  const names = listRootFiles()
  if (names.length === 0) {
    // eslint-disable-next-line no-console
    console.log('[migrate-uploads] No files at uploads/ root; nothing to move.')
    return moves
  }

  if (!dryRun) {
    fs.mkdirSync(testingDir, { recursive: true })
  }

  for (const name of names) {
    const src = path.join(uploadsRoot, name)
    let dest = path.join(testingDir, name)

    if (fs.existsSync(dest)) {
      const ext = path.extname(name)
      const stem = path.basename(name, ext)
      let alt = path.join(testingDir, `${stem}_from_root${ext}`)
      let n = 0
      while (fs.existsSync(alt)) {
        n += 1
        alt = path.join(testingDir, `${stem}_from_root_${n}${ext}`)
      }
      dest = alt
    }

    const finalBase = path.basename(dest)
    moves.set(name, finalBase)

    if (dryRun) {
      // eslint-disable-next-line no-console
      console.log(`[dry-run] would move uploads/${name} -> uploads/testing/${finalBase}`)
    } else {
      fs.renameSync(src, dest)
      // eslint-disable-next-line no-console
      console.log(`[migrate-uploads] moved ${name} -> testing/${finalBase}`)
    }
  }

  return moves
}

async function migrateDatabase(moves: Map<string, string>): Promise<void> {
  if (moves.size === 0) return

  const runs = (await db.prepare('SELECT id, data FROM test_runs').all()) as Array<{
    id: string
    data: string | null
  }>
  let runUpdates = 0
  for (const row of runs) {
    const next = rewriteUploadPaths(row.data, moves)
    if (next !== row.data && next != null) {
      if (!dryRun) {
        await db.prepare('UPDATE test_runs SET data = ? WHERE id = ?').run(next, row.id)
      }
      runUpdates += 1
    }
  }

  const hist = (await db.prepare('SELECT id, old_data, new_data FROM record_history').all()) as Array<{
    id: string
    old_data: string | null
    new_data: string | null
  }>
  let histUpdates = 0
  for (const row of hist) {
    const oldD = rewriteUploadPaths(row.old_data, moves)
    const newD = rewriteUploadPaths(row.new_data, moves)
    if (oldD !== row.old_data || newD !== row.new_data) {
      if (!dryRun) {
        await db.prepare('UPDATE record_history SET old_data = ?, new_data = ? WHERE id = ?').run(
          oldD,
          newD,
          row.id
        )
      }
      histUpdates += 1
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `[migrate-uploads] test_runs rows updated: ${runUpdates}; record_history rows updated: ${histUpdates}${dryRun ? ' (dry-run)' : ''}`
  )
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`[migrate-uploads] cwd=${cwd} dryRun=${dryRun}`)
  const moves = moveRootFilesToTesting()
  await migrateDatabase(moves)
  // eslint-disable-next-line no-console
  console.log('[migrate-uploads] done.')
}

void main()
