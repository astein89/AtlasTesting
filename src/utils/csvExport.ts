import { formatDateTime } from '../lib/dateTimeConfig'
import { getBasePath } from '../lib/basePath'
import type { DataField, TimerValue } from '../types'
import { stripStatusAutomationMetaFromData } from './planConditionalStatus'
import { formatFieldValue } from './formatFieldValue'
import { getElapsedMs, formatTimerMs, parseTimerValue } from './timer'

interface Record {
  id: string
  planName: string
  recordedAt: string
  enteredBy?: string
  enteredByName?: string
  status: string
  data: Record<string, string | number | boolean | string[] | TimerValue>
  /** When present (e.g. from API with test_id joined), used for "Test" column in export */
  testName?: string
}

export function recordsToCsv(
  records: Record[],
  options?: {
    /** Optional explicit order for data keys (field keys); any remaining keys are appended alphabetically. */
    fieldOrder?: string[]
    /** When provided (e.g. export from a test's data view), add a "Test" column with this value. */
    testName?: string
    /**
     * Field key → definition. When set, **datetime** columns use the same display format as the UI
     * (`dateTimeDisplay` / app date-time settings) instead of raw ISO strings.
     */
    fieldsByKey?: Map<string, DataField>
  }
): string {
  if (records.length === 0) return ''

  const includeTestColumn = Boolean(options?.testName) || records.some((r) => r.testName)
  const fixedPrefix = includeTestColumn
    ? ['recordId', 'planName', 'Test', 'recordedAt', 'User']
    : ['recordId', 'planName', 'recordedAt', 'User']
  const fieldOrder = options?.fieldOrder ?? []

  // When fieldOrder is provided, use it as the exclusive list of data columns (plan fields only).
  // Otherwise collect all keys present in records and sort alphabetically.
  const orderedDataKeys: string[] =
    fieldOrder.length > 0
      ? fieldOrder
      : (() => {
          const dataKeys = new Set<string>()
          records.forEach((r) =>
            Object.keys(r.data).forEach((k) => {
              if (!k.startsWith('__')) dataKeys.add(k)
            })
          )
          return Array.from(dataKeys).sort((a, b) => a.localeCompare(b))
        })()

  const headers = [...fixedPrefix, ...orderedDataKeys]
  const singleTestName = options?.testName ?? ''

  const rows = records.map((r) => {
    const row: string[] = []
    const rowTestName = singleTestName || r.testName || ''
    const dataForExport = stripStatusAutomationMetaFromData(r.data as Record<string, unknown>) as Record<
      string,
      string | number | boolean | string[] | TimerValue
    >
    headers.forEach((h) => {
      if (h === 'recordId') row.push(escapeCsv(r.id))
      else if (h === 'planName') row.push(escapeCsv(r.planName))
      else if (h === 'Test') row.push(escapeCsv(rowTestName))
      else if (h === 'recordedAt') row.push(escapeCsv(formatDateTime(r.recordedAt)))
      else if (h === 'User') row.push(escapeCsv(r.enteredByName ?? r.enteredBy ?? ''))
      else {
        const val = dataForExport[h]
        if (isBlank(val)) {
          row.push('')
          return
        }
        const field = options?.fieldsByKey?.get(h)
        if (field?.type === 'datetime') {
          const formatted = formatFieldValue(field, val)
          row.push(escapeCsv(formatted === '—' ? '' : formatted))
          return
        }
        if (typeof val === 'object' && val !== null && 'totalElapsedMs' in val) {
          const t = parseTimerValue(val)
          row.push(escapeCsv(formatTimerMs(getElapsedMs(t))))
          return
        }
        const parts = Array.isArray(val) ? val : [val]
        const uploadsPrefix = getBasePath() + '/api/uploads/'
        const str = parts
          .map((v) => {
            const s = String(v)
            if (s.includes(uploadsPrefix)) return s.replace(uploadsPrefix, '')
            if (s.includes('/api/uploads/')) return s.replace(/^.*\/api\/uploads\//, '')
            return s
          })
          .join('; ')
        row.push(escapeCsv(str.trim()))
      }
    })
    return row.join(',')
  })

  /** UTF-8 BOM + CRLF: Excel on Windows opens encoding and row breaks correctly. */
  const CSV_UTF8_BOM = '\uFEFF'
  const headerLine = headers.map((h) => escapeCsv(h)).join(',')
  return `${CSV_UTF8_BOM}${[headerLine, ...rows].join('\r\n')}`
}

function isBlank(val: unknown): boolean {
  if (val == null) return true
  if (val === '') return true
  if (Array.isArray(val) && val.length === 0) return true
  return false
}

function escapeCsv(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}
