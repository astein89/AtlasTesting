import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'
import type { Test } from '../types'

export function TestsList() {
  const [tests, setTests] = useState<Test[]>([])
  const [loading, setLoading] = useState(true)
  const isAdmin = useAuthStore((s) => s.isAdmin())

  useEffect(() => {
    api
      .get<Test[]>('/tests')
      .then((r) => setTests(r.data))
      .catch(() => setTests([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Tests</h1>
        {isAdmin && (
          <Link
            to="/tests/new"
            className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
          >
            New Test
          </Link>
        )}
      </div>
      {loading ? (
        <p className="text-foreground/60">Loading...</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tests.map((t) => (
            <div
              key={t.id}
              className="rounded-lg border border-border bg-card p-4"
            >
              <h2 className="font-medium text-foreground">{t.name}</h2>
              {t.description && (
                <p className="mt-1 text-sm text-foreground/70">{t.description}</p>
              )}
              <div className="mt-4 flex gap-2">
                {isAdmin && (
                  <Link
                    to={`/tests/${t.id}`}
                    className="rounded border border-border px-3 py-1 text-sm text-foreground hover:bg-background"
                  >
                    Edit
                  </Link>
                )}
                <Link
                  to={`/tests/${t.id}/data`}
                  className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground hover:opacity-90"
                >
                  Data
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
