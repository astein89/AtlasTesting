/**
 * Writes build-version.json at repo root from the current git checkout.
 * Run before production builds so deployed servers report the exact commit deployed.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outPath = path.join(root, 'build-version.json')

function runGit(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

const commit = runGit(['rev-parse', 'HEAD'])
const commitShort = commit ? runGit(['rev-parse', '--short', 'HEAD']) : ''
const branch = commit ? runGit(['rev-parse', '--abbrev-ref', 'HEAD']) : ''
const committedAt = commit ? runGit(['log', '-1', '--format=%cI']) : ''
const commitSubject = commit ? runGit(['log', '-1', '--format=%s']) : ''

const payload = {
  commit: commit || null,
  commitShort: commitShort || null,
  branch: branch || null,
  committedAt: committedAt || null,
  commitSubject: commitSubject || null,
  generatedAt: new Date().toISOString(),
}

fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
process.stdout.write(
  commit
    ? `Wrote ${outPath} (${commitShort ?? commit.slice(0, 7)})\n`
    : `Wrote ${outPath} (no git commit — not a git repo or git unavailable)\n`
)
