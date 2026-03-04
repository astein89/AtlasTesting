import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api/client'
import { format } from 'date-fns'

interface Record {
  id: string
  testId: string
  testName: string
  recordedAt: string
  enteredBy: string
  status: string
  data: Record<string, string | number | boolean>
}

export function ResultDetail() {
  const { id } = useParams<{ id: string }>()
  const [record, setRecord] = useState<Record | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (id) {
      api
        .get<Record>(`/records/${id}`)
        .then((r) => setRecord(r.data))
        .catch(() => setRecord(null))
        .finally(() => setLoading(false))
    }
  }, [id])

  if (loading || !record) return <p className="text-foreground/60">Loading...</p>

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">
          {record.testName} - {format(new Date(record.recordedAt), 'PPp')}
        </h1>
        <Link
          to="/results"
          className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
        >
          Back to Results
        </Link>
      </div>
      <div className="space-y-4 rounded-lg border border-border bg-card p-6">
        <div className="flex gap-4">
          <span
            className={`rounded px-2 py-1 text-sm ${
              record.status === 'pass'
                ? 'bg-green-500/20 text-green-600 dark:text-green-400'
                : record.status === 'fail'
                  ? 'bg-red-500/20 text-red-600 dark:text-red-400'
                  : 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400'
            }`}
          >
            {record.status}
          </span>
          <span className="text-foreground/60">Entered by: {record.enteredBy}</span>
        </div>
        <div>
          <h2 className="mb-2 font-medium text-foreground">Data</h2>
          <dl className="grid gap-2 sm:grid-cols-2">
            {Object.entries(record.data).map(([key, val]) => (
              <div key={key} className="rounded bg-background p-2">
                <dt className="text-xs text-foreground/60">{key}</dt>
                <dd className="font-medium text-foreground">
                  {typeof val === 'boolean' ? (val ? 'Yes' : 'No') : String(val)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  )
}
