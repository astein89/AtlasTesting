import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { runsToCsv } from '../utils/csvExport'

interface Run {
  id: string
  testName: string
  runAt: string
  enteredBy?: string
  enteredByName?: string
  status: string
  data: Record<string, string | number | boolean>
}

interface Test {
  id: string
  name: string
  testPlanId: string
}

export function Export() {
  const [searchParams] = useSearchParams()
  const planIdFromUrl = searchParams.get('planId')
  const [runs, setRuns] = useState<Run[]>([])
  const [loading, setLoading] = useState(true)
  const [testId, setTestId] = useState('')
  const [planId, setPlanId] = useState(planIdFromUrl || '')
  const [tests, setTests] = useState<Test[]>([])
  const [plans, setPlans] = useState<{ id: string; name: string }[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  useEffect(() => {
    if (planIdFromUrl) setPlanId(planIdFromUrl)
  }, [planIdFromUrl])

  useEffect(() => {
    Promise.all([
      api.get<Test[]>('/tests').then((r) => r.data),
      api.get<{ id: string; name: string }[]>('/test-plans').then((r) => r.data),
    ]).then(([testsData, plansData]) => {
      setTests(testsData)
      setPlans(plansData)
    })
  }, [])

  useEffect(() => {
    const params: Record<string, string> = { limit: '500' }
    if (testId) params.testId = testId
    else if (planId) params.testPlanId = planId
    if (from) params.from = from
    if (to) params.to = to
    api
      .get<Run[]>('/runs', { params })
      .then((r) => setRuns(r.data))
      .catch(() => setRuns([]))
      .finally(() => setLoading(false))
  }, [testId, planId, from, to])

  const download = () => {
    const csv = runsToCsv(runs)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `atlas-export-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-foreground">Export CSV</h1>
      <div className="mb-6 flex flex-wrap gap-4 rounded-lg border border-border bg-card p-4">
        <div>
          <label className="block text-sm text-foreground">Test plan</label>
          <select
            value={planId}
            onChange={(e) => {
              setPlanId(e.target.value)
              setTestId('')
            }}
            className="mt-1 rounded-lg border border-border bg-background px-3 py-2 text-foreground"
          >
            <option value="">All</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-foreground">Test</label>
          <select
            value={testId}
            onChange={(e) => setTestId(e.target.value)}
            className="mt-1 rounded-lg border border-border bg-background px-3 py-2 text-foreground"
          >
            <option value="">All</option>
            {tests
              .filter((t) => !planId || t.testPlanId === planId)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-foreground">From date</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 rounded-lg border border-border bg-background px-3 py-2 text-foreground"
          />
        </div>
        <div>
          <label className="block text-sm text-foreground">To date</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 rounded-lg border border-border bg-background px-3 py-2 text-foreground"
          />
        </div>
      </div>
      {loading ? (
        <p className="text-foreground/60">Loading...</p>
      ) : (
        <>
          <p className="mb-4 text-foreground/80">
            {runs.length} run(s) will be exported.
          </p>
          <button
            type="button"
            onClick={download}
            disabled={runs.length === 0}
            className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            Download CSV
          </button>
        </>
      )}
    </div>
  )
}
