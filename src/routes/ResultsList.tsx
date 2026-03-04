import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { format } from 'date-fns'

interface Record {
  id: string
  testId: string
  testName: string
  recordedAt: string
  enteredBy: string
  status: string
}

export function ResultsList() {
  const [records, setRecords] = useState<Record[]>([])
  const [loading, setLoading] = useState(true)
  const [testId, setTestId] = useState('')
  const [tests, setTests] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    api.get('/tests').then((r) => setTests(r.data))
  }, [])

  useEffect(() => {
    const params: Record<string, string> = { limit: '100' }
    if (testId) params.testId = testId
    api
      .get<Record[]>('/records', { params })
      .then((r) => setRecords(r.data))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false))
  }, [testId])

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-foreground">Results</h1>
      <div className="mb-4">
        <label className="mr-2 text-sm text-foreground">Filter by test:</label>
        <select
          value={testId}
          onChange={(e) => setTestId(e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-foreground"
        >
          <option value="">All</option>
          {tests.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      {loading ? (
        <p className="text-foreground/60">Loading...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full">
            <thead className="bg-card">
              <tr>
                <th className="px-4 py-2 text-left text-sm font-medium text-foreground">
                  Test
                </th>
                <th className="px-4 py-2 text-left text-sm font-medium text-foreground">
                  Run At
                </th>
                <th className="px-4 py-2 text-left text-sm font-medium text-foreground">
                  Status
                </th>
                <th className="px-4 py-2 text-right text-sm font-medium text-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {records.map((r) => (
                <tr key={r.id} className="bg-background">
                  <td className="px-4 py-2 text-foreground">{r.testName}</td>
                  <td className="px-4 py-2 text-foreground">
                    {format(new Date(r.recordedAt), 'PPp')}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        r.status === 'pass'
                          ? 'bg-green-500/20 text-green-600 dark:text-green-400'
                          : r.status === 'fail'
                            ? 'bg-red-500/20 text-red-600 dark:text-red-400'
                            : 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400'
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      to={`/results/${r.id}`}
                      className="text-primary hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
