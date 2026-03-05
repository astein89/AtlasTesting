import { format } from 'date-fns'

interface Record {
  id: string
  planName: string
  recordedAt: string
  enteredBy?: string
  enteredByName?: string
  status: string
  data: Record<string, string | number | boolean | string[]>
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
      else if (h === 'recordedAt') row.push(escapeCsv(format(new Date(r.recordedAt), 'yyyy-MM-dd HH:mm:ss')))
      else if (h === 'User') row.push(escapeCsv(r.enteredByName ?? r.enteredBy ?? ''))
      else {
        const val = r.data[h]
        const parts = Array.isArray(val) ? val : val != null ? [val] : []
        const str = parts
          .map((v) => {
            const s = String(v)
            return s.includes('/api/uploads/') ? s.replace(/^.*\/api\/uploads\//, '') : s
          })
          .join('; ')
        row.push(escapeCsv(str))
      }
    })
    return row.join(',')
  })

  return [headers.join(','), ...rows].join('\n')
}

function escapeCsv(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}
