import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { runsToCsv } from '../utils/csvExport'
import { useAuthStore } from '../store/authStore'
import type { TestPlan } from '../types'

interface Run {
  id: string
  testName: string
  runAt: string
  enteredBy?: string
  enteredByName?: string
  status: string
  data: Record<string, string | number | boolean>
}

export function TestPlansList() {
  const [plans, setPlans] = useState<TestPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [exportingId, setExportingId] = useState<string | null>(null)
  const isAdmin = useAuthStore((s) => s.isAdmin())

  const exportPlan = async (plan: TestPlan) => {
    setExportingId(plan.id)
    try {
      const { data: runs } = await api.get<Run[]>('/runs', {
        params: { testPlanId: plan.id, limit: '5000' },
      })
      if (runs.length === 0) {
        alert('No data to export')
        return
      }
      const csv = runsToCsv(runs)
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${plan.name.replace(/[^a-z0-9]/gi, '-')}-export-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('Failed to export')
    } finally {
      setExportingId(null)
    }
  }

  useEffect(() => {
    api
      .get<TestPlan[]>('/test-plans')
      .then((r) => setPlans(r.data))
      .catch(() => setPlans([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Test Plans</h1>
        {isAdmin && (
          <Link
            to="/test-plans/new"
            className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
          >
            New Test Plan
          </Link>
        )}
      </div>
      {loading ? (
        <p className="text-foreground/60">Loading...</p>
      ) : (
        <div className="space-y-4">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <Link
                    to={`/test-plans/${plan.id}/data`}
                    className="font-medium text-foreground hover:underline"
                  >
                    {plan.name}
                  </Link>
                  {plan.description && (
                    <p className="mt-1 text-sm text-foreground/70">
                      {plan.description}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => exportPlan(plan)}
                    disabled={exportingId === plan.id}
                    className="rounded border border-border px-3 py-1 text-sm text-foreground hover:bg-background disabled:opacity-50"
                  >
                    {exportingId === plan.id ? 'Exporting...' : 'Export'}
                  </button>
                  {isAdmin && (
                    <Link
                      to={`/test-plans/${plan.id}/edit`}
                      className="rounded border border-border px-3 py-1 text-sm text-foreground hover:bg-background"
                    >
                      Edit plan
                    </Link>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
