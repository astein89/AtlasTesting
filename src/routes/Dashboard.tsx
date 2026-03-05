import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { format } from 'date-fns'

interface PlanStats {
  id: string
  name: string
  total: number
  pass: number
  fail: number
  partial: number
}

interface Record {
  id: string
  planName: string
  recordedAt: string
  status: string
}

export function Dashboard() {
  const [planStats, setPlanStats] = useState<PlanStats[]>([])
  const [recentRecords, setRecentRecords] = useState<Record[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get<PlanStats[]>('/test-plans/stats'),
      api.get<Record[]>('/records', { params: { limit: 10 } }),
    ])
      .then(([statsRes, recordsRes]) => {
        setPlanStats(statsRes.data)
        setRecentRecords(recordsRes.data)
      })
      .catch(() => {
        setPlanStats([])
        setRecentRecords([])
      })
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

      {loading ? (
        <p className="text-foreground/60">Loading...</p>
      ) : (
        <div className="space-y-6">
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-4 text-lg font-medium text-foreground">Test plans</h2>
            {planStats.length === 0 ? (
              <p className="text-foreground/60">No test plans yet.</p>
            ) : (
              <div className="space-y-3">
                {planStats.map((plan) => (
                  <Link
                    key={plan.id}
                    to={`/test-plans/${plan.id}/data`}
                    className="flex items-center justify-between rounded-lg border border-border bg-background p-4 transition-colors hover:bg-card"
                  >
                    <span className="font-medium text-foreground">{plan.name}</span>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-foreground/70">
                        {plan.total} record{plan.total !== 1 ? 's' : ''} total
                      </span>
                      {plan.total === 0 && (
                        <span className="text-foreground/50">No data yet</span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-4 text-lg font-medium text-foreground">Recent records</h2>
            {recentRecords.length === 0 ? (
              <p className="text-foreground/60">No records yet.</p>
            ) : (
              <ul className="space-y-2">
                {recentRecords.map((r) => (
                  <li key={r.id} className="flex items-center justify-between">
                    <Link
                      to={`/results/${r.id}`}
                      className="text-foreground hover:underline"
                    >
                      {r.planName} - {format(new Date(r.recordedAt), 'PPp')}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
