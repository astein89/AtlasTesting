import { autoMapImportFieldsToColumns, normalizeImportHeaderLoose } from './importColumnAutoMap'
import type { ParsedImportFile } from './parseImportFile'

export const STAND_IMPORT_FIELDS = [
  { key: 'external_ref', label: 'Location (External Ref)' },
  { key: 'zone', label: 'Zone' },
  { key: 'location_label', label: 'Location label' },
  { key: 'dwg_ref', label: 'DWG ref' },
  { key: 'orientation', label: 'Orientation' },
  { key: 'x', label: 'X (m)' },
  { key: 'y', label: 'Y (m)' },
  { key: 'enabled', label: 'Enabled' },
] as const

export type StandImportFieldKey = (typeof STAND_IMPORT_FIELDS)[number]['key']

const CANONICAL_HEADERS: StandImportFieldKey[] = [
  'external_ref',
  'zone',
  'location_label',
  'dwg_ref',
  'orientation',
  'x',
  'y',
  'enabled',
]

function supplementStandMapping(headers: string[], base: Record<string, string>): Record<string, string> {
  const used = new Set(Object.values(base).filter(Boolean))

  const claim = (key: StandImportFieldKey, looseCandidates: string[]) => {
    if (base[key]) return
    for (const h of headers) {
      if (used.has(h)) continue
      const loose = normalizeImportHeaderLoose(h)
      if (looseCandidates.includes(loose)) {
        base[key] = h
        used.add(h)
        return
      }
    }
  }

  claim('external_ref', ['externalreference', 'location', 'externalref'])
  claim('dwg_ref', ['dwg'])
  claim('zone', ['zone'])
  claim('orientation', ['orientation'])
  claim('enabled', ['enabled'])

  return base
}

/**
 * Guess CSV column → stand field mappings (same idea as test plan import auto-map).
 */
export function autoMapStandImportFields(headers: string[]): Record<string, string> {
  const fields = STAND_IMPORT_FIELDS.map((f) => ({ key: f.key, label: f.label }))
  const base = autoMapImportFieldsToColumns(headers, fields)
  return supplementStandMapping(headers, { ...base })
}

function escapeCsvCell(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

/** Build CSV text for POST /amr/dc/stands/import from parsed rows + column mapping. */
export function buildStandImportCsv(
  parsed: ParsedImportFile,
  fieldToColumn: Record<string, string>
): string {
  const lines: string[] = [CANONICAL_HEADERS.join(',')]
  for (const row of parsed.rows) {
    const cells = CANONICAL_HEADERS.map((key) => {
      const col = fieldToColumn[key]
      let v = col ? String(row[col] ?? '').trim() : ''
      if (key === 'enabled') {
        const lower = v.toLowerCase()
        if (lower === 'false' || lower === '0' || lower === 'no') v = 'false'
        else if (v === '') v = 'true'
        else if (lower === 'true' || lower === '1' || lower === 'yes') v = 'true'
        else v = 'true'
      }
      return escapeCsvCell(v)
    })
    lines.push(cells.join(','))
  }
  return lines.join('\n')
}
