import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { format } from 'date-fns'

interface Record {
  id: string
  testName: string
  recordedAt: string
  status: string
}

export function Dashboard() {
  const [records, setRecords] = useState<Record[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .get<Record[]>('/records', { params: { limit: 10 } })
      .then((r) => setRecords(r.data))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-foreground">Dashboard</h1>
      <div className="mb-6 flex gap-4">
        <Link
          to="/test-plans"
          className="rounded-lg border border-border bg-card px-4 py-2 text-foreground hover:bg-background"
        >
          View Test Plans
        </Link>
        <Link
          to="/results"
          className="rounded-lg border border-border bg-card px-4 py-2 text-foreground hover:bg-background"
        >
          View Results
        </Link>
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-4 text-lg font-medium text-foreground">Recent records</h2>
        {loading ? (
          <p className="text-foreground/60">Loading...</p>
        ) : records.length === 0 ? (
          <p className="text-foreground/60">No records yet.</p>
        ) : (
          <ul className="space-y-2">
            {records.map((r) => (
              <li key={r.id} className="flex items-center justify-between">
                <Link
                  to={`/results/${r.id}`}
                  className="text-foreground hover:underline"
                >
                  {r.testName} - {format(new Date(r.recordedAt), 'PPp')}
                </Link>
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
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
