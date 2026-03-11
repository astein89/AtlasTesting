import { formatDateTime } from '../lib/dateTimeConfig'
import { getBasePath } from '../lib/basePath'
import { getElapsedMs, formatTimerMs, parseTimerValue } from './timer'
import type { TimerValue } from '../types'

interface Record {
  id: string
  planName: string
  recordedAt: string
  enteredBy?: string
  enteredByName?: string
  status: string
  data: Record<string, string | number | boolean | string[] | TimerValue>
}

export function recordsToCsv(records: Record[]): string {
  if (records.length === 0) return ''

  const allKeys = new Set<string>(['recordId', 'planName', 'recordedAt', 'User'])
  records.forEach((r) => Object.keys(r.data).forEach((k) => allKeys.add(k)))
  const headers = Array.from(allKeys)

  const rows = records.map((r) => {
    const row: string[] = []
    headers.forEach((h) => {
      if (h === 'recordId') row.push(r.id)
      else if (h === 'planName') row.push(escapeCsv(r.planName))
      else if (h === 'recordedAt') row.push(escapeCsv(formatDateTime(r.recordedAt)))
      else if (h === 'User') row.push(escapeCsv(r.enteredByName ?? r.enteredBy ?? ''))
      else {
        const val = r.data[h]
        if (isBlank(val)) {
          row.push('')
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

  return [headers.join(','), ...rows].join('\n')
}

function isBlank(val: unknown): boolean {
  if (val == null) return true
  if (val === '') return true
  if (Array.isArray(val) && val.length === 0) return true
  return false
}

function escapeCsv(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}
