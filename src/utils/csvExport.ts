import { format } from 'date-fns'

interface Run {
  id: string
  testName: string
  runAt: string
  enteredBy?: string
  enteredByName?: string
  status: string
  data: Record<string, string | number | boolean>
}

export function runsToCsv(runs: Run[]): string {
  if (runs.length === 0) return ''

  const allKeys = new Set<string>(['runId', 'testName', 'runAt', 'User', 'status'])
  runs.forEach((r) => Object.keys(r.data).forEach((k) => allKeys.add(k)))
  const headers = Array.from(allKeys)

  const rows = runs.map((r) => {
    const row: string[] = []
    headers.forEach((h) => {
      if (h === 'runId') row.push(r.id)
      else if (h === 'testName') row.push(escapeCsv(r.testName))
      else if (h === 'runAt') row.push(escapeCsv(format(new Date(r.runAt), 'yyyy-MM-dd HH:mm:ss')))
      else if (h === 'User') row.push(escapeCsv(r.enteredByName ?? r.enteredBy ?? ''))
      else if (h === 'status') row.push(escapeCsv(r.status))
      else row.push(escapeCsv(String(r.data[h] ?? '')))
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
