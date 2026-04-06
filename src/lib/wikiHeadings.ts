/** Parse markdown lines for ## headings (levels 1–3) in document order, with GitHub-style slug ids. */

export type WikiHeading = {
  level: 1 | 2 | 3
  text: string
  id: string
}

function slugify(text: string): string {
  const s = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return s || 'heading'
}

function uniqueSlug(base: string, used: Map<string, number>): string {
  const n = (used.get(base) ?? 0) + 1
  used.set(base, n)
  return n === 1 ? base : `${base}-${n}`
}

export function parseWikiHeadings(md: string): WikiHeading[] {
  const lines = md.split(/\r?\n/)
  const out: WikiHeading[] = []
  const used = new Map<string, number>()
  for (const line of lines) {
    const m = /^(#{1,3})\s+(.+)$/.exec(line.trimEnd())
    if (!m) continue
    const level = m[1].length as 1 | 2 | 3
    let text = m[2].trim().replace(/\s+#+\s*$/, '').trim()
    if (!text) continue
    const base = slugify(text)
    const id = uniqueSlug(base, used)
    out.push({ level, text, id })
  }
  return out
}
