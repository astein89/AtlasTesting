import { type ReactNode, useState } from 'react'
import { api, isAbortLikeError } from '../api/client'
import { useAbortableEffect } from '../hooks/useAbortableEffect'

type GitBuildMeta = {
  commit: string | null
  commitShort: string | null
  branch: string | null
  committedAt: string | null
  commitSubject: string | null
  generatedAt: string | null
  source: 'env' | 'file' | 'runtime' | 'none'
}

type AdminStatusResponse = {
  ok: boolean
  version: string
  git?: GitBuildMeta
  nodeVersion: string
  uptimeSeconds: number
  environment: string
  database: {
    ok: boolean
    backend: 'sqlite' | 'postgres'
    error?: string
  }
}

function formatUptime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0 || d > 0) parts.push(`${h}h`)
  if (m > 0 || h > 0 || d > 0) parts.push(`${m}m`)
  parts.push(`${sec}s`)
  return parts.join(' ')
}

export function AdminStatusPage() {
  const [data, setData] = useState<AdminStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshSeq, setRefreshSeq] = useState(0)

  const refresh = () => setRefreshSeq((n) => n + 1)

  useAbortableEffect(
    (signal) => {
      setLoading(true)
      setError('')
      void api
        .get<AdminStatusResponse>('/admin/status', { signal })
        .then((r) => {
          setData(r.data)
          setError('')
        })
        .catch((e) => {
          if (isAbortLikeError(e)) return
          setData(null)
          setError(e?.response?.data?.error ?? 'Failed to load status')
        })
        .finally(() => setLoading(false))
    },
    [refreshSeq]
  )

  const rows: Array<{ label: string; value: ReactNode }> = data
    ? [
        { label: 'App version', value: <code className="text-sm">{data.version}</code> },
        ...(data.git?.commit
          ? [
              {
                label: 'Git commit',
                value: (
                  <code className="break-all text-sm" title={data.git.commit}>
                    {data.git.commitShort ?? data.git.commit.slice(0, 7)}
                  </code>
                ),
              },
              ...(data.git.branch
                ? [{ label: 'Git branch', value: <code className="text-sm">{data.git.branch}</code> }]
                : []),
              ...(data.git.committedAt
                ? [
                    {
                      label: 'Commit time',
                      value: <span className="text-sm">{data.git.committedAt}</span>,
                    },
                  ]
                : []),
              ...(data.git.commitSubject
                ? [
                    {
                      label: 'Commit subject',
                      value: <span className="text-sm">{data.git.commitSubject}</span>,
                    },
                  ]
                : []),
            ]
          : [
              {
                label: 'Git commit',
                value: (
                  <span className="text-foreground/60">
                    Not available (build from a git checkout, or set APP_GIT_COMMIT)
                  </span>
                ),
              },
            ]),
        { label: 'Node', value: <code className="text-sm">{data.nodeVersion}</code> },
        {
          label: 'Uptime',
          value: (
            <span>
              {formatUptime(data.uptimeSeconds)}{' '}
              <span className="text-foreground/50">({data.uptimeSeconds}s)</span>
            </span>
          ),
        },
        { label: 'Environment', value: <code className="text-sm">{data.environment}</code> },
        {
          label: 'Database',
          value: (
            <span className="flex flex-wrap items-center gap-2">
              <span
                className={
                  data.database.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'
                }
              >
                {data.database.ok ? 'OK' : 'Error'}
              </span>
              <code className="text-sm text-foreground/80">{data.database.backend}</code>
              {data.database.error ? (
                <span className="text-sm text-destructive">{data.database.error}</span>
              ) : null}
            </span>
          ),
        },
      ]
    : []

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-foreground">System status</h1>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-card disabled:opacity-50"
        >
          Refresh
        </button>
      </div>
      {loading && !data ? (
        <p className="text-foreground/60">Loading...</p>
      ) : error ? (
        <p className="text-destructive">{error}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-border last:border-b-0">
                  <th
                    scope="row"
                    className="w-[10rem] max-w-[40%] whitespace-normal bg-card px-4 py-3 text-left font-medium text-foreground/80 align-top"
                  >
                    {row.label}
                  </th>
                  <td className="px-4 py-3 text-foreground">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
