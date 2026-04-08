/**
 * Guess CSV column → plan field / metadata mappings from header names (export re-import, manual templates).
 */

export function stripExcelCsvBom(cell: string): string {
  return cell.replace(/^\uFEFF/, '').trim()
}

/** Lowercase, trim, collapse whitespace and underscores for fuzzy compare. */
export function normalizeImportHeaderLoose(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '')
}

function scoreHeaderMatch(header: string, fieldKey: string, fieldLabel: string): number {
  const t = header.trim()
  const tLower = t.toLowerCase()
  const tLoose = normalizeImportHeaderLoose(t)
  const keyLower = fieldKey.trim().toLowerCase()
  const keyLoose = normalizeImportHeaderLoose(fieldKey)
  const labelTrim = fieldLabel.trim()
  const labelLoose = labelTrim ? normalizeImportHeaderLoose(fieldLabel) : ''

  if (t === fieldKey) return 100
  if (tLower === keyLower) return 95
  if (tLoose === keyLoose) return 90
  if (labelLoose && tLoose === labelLoose) return 85
  if (labelTrim && tLower === labelTrim.toLowerCase()) return 82
  return 0
}

/**
 * Pick one unused CSV header per field (highest match score wins per field).
 */
export function autoMapImportFieldsToColumns(
  headers: string[],
  fields: Array<{ key: string; label?: string | null }>
): Record<string, string> {
  const used = new Set<string>()
  const out: Record<string, string> = {}

  for (const f of fields) {
    const label = f.label ?? ''
    let best: { h: string; score: number } | undefined
    for (const h of headers) {
      if (used.has(h)) continue
      const score = scoreHeaderMatch(h, f.key, label)
      if (score > 0 && (!best || score > best.score)) {
        best = { h, score }
      }
    }
    if (best && best.score >= 82) {
      out[f.key] = best.h
      used.add(best.h)
    }
  }

  return out
}

const RECORDED_AT_LOOSE = new Set([
  'recordedat',
  'recorded_at',
  'recordeddate',
  'recordtimestamp',
  'submissiondate',
])

/**
 * Map a CSV header to **Recorded at** (row metadata), only among headers not already used by fields.
 */
export function autoMapRecordedAtColumn(headers: string[], usedHeaders: Set<string>): string {
  for (const h of headers) {
    if (usedHeaders.has(h)) continue
    const t = h.trim()
    if (t === 'recordedAt') return h
    const loose = normalizeImportHeaderLoose(t)
    if (RECORDED_AT_LOOSE.has(loose)) return h
    if (normalizeImportHeaderLoose(t.replace(/[\s-]/g, '')) === 'recordedat') return h
  }
  return ''
}
