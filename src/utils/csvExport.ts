import { format } from 'date-fns'

interface Record {
  id: string
  testName: string
  recordedAt: string
  enteredBy?: string
  enteredByName?: string
  status: string
  data: Record<string, string | number | boolean | string[]>
}

export function recordsToCsv(records: Record[]): string {
  if (records.length === 0) return ''

  const allKeys = new Set<string>(['recordId', 'testName', 'recordedAt', 'User', 'status'])
  records.forEach((r) => Object.keys(r.data).forEach((k) => allKeys.add(k)))
  const headers = Array.from(allKeys)

  const rows = records.map((r) => {
    const row: string[] = []
    headers.forEach((h) => {
      if (h === 'recordId') row.push(r.id)
      else if (h === 'testName') row.push(escapeCsv(r.testName))
      else if (h === 'recordedAt') row.push(escapeCsv(format(new Date(r.recordedAt), 'yyyy-MM-dd HH:mm:ss')))
      else if (h === 'User') row.push(escapeCsv(r.enteredByName ?? r.enteredBy ?? ''))
      else if (h === 'status') row.push(escapeCsv(r.status))
      else {
        const val = r.data[h]
        const str = Array.isArray(val) ? val.join('; ') : String(val ?? '')
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
