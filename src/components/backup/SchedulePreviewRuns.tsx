import { useEffect, useMemo, useState } from 'react'
import { api, isAbortLikeError } from '@/api/client'

type ScheduleBlockPayload = Record<string, unknown>

export function SchedulePreviewRuns({
  block,
  serverTimeZone,
  idPrefix,
}: {
  block: ScheduleBlockPayload
  serverTimeZone: string | null
  idPrefix: string
}) {
  const [runsIso, setRunsIso] = useState<string[] | null>(null)
  const scheduleKey = useMemo(() => JSON.stringify(block), [block])

  useEffect(() => {
    const enabled = typeof block.enabled === 'boolean' ? block.enabled : false
    if (!enabled) {
      setRunsIso(null)
      return
    }

    const ac = new AbortController()
    const t = window.setTimeout(() => {
      void api
        .post<{ runs: string[] }>('/backup/preview-runs', { schedule: block }, { signal: ac.signal })
        .then((r) => setRunsIso(r.data.runs ?? []))
        .catch((e) => {
          if (!isAbortLikeError(e)) setRunsIso(null)
        })
    }, 280)

    return () => {
      ac.abort()
      window.clearTimeout(t)
    }
  }, [scheduleKey])

  if (!runsIso?.length) return null

  return (
    <div className="mt-2 max-w-xl" id={`${idPrefix}-schedule-preview`}>
      <p className="text-xs font-medium text-foreground/75">Next 5 execution times</p>
      <ol className="mt-1.5 list-inside list-decimal space-y-0.5 font-mono text-xs text-foreground/85">
        {runsIso.map((iso, i) => {
          const d = new Date(iso)
          return (
            <li key={`${iso}-${i}`}>
              {d.toLocaleString(undefined, {
                ...(serverTimeZone ? { timeZone: serverTimeZone } : {}),
                dateStyle: 'medium',
                timeStyle: 'medium',
              })}
            </li>
          )
        })}
      </ol>
      <p className="mt-1.5 text-[11px] text-foreground/55">
        {serverTimeZone
          ? `Shown in the app server timezone (${serverTimeZone}).`
          : 'Connect to the server to show times in the host timezone.'}
      </p>
    </div>
  )
}
