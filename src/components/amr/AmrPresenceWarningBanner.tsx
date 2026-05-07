import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ackPresenceWarning, getAmrMissionRecords } from '@/api/amr'
import { amrPath } from '@/lib/appPaths'
import { formatDateTime } from '@/lib/dateTimeConfig'
import { useAuthStore } from '@/store/authStore'
import { getApiErrorMessage, isAbortLikeError } from '@/api/client'

/** Match mission list / attention bar cadence. */
const POLL_MS = 5000

type PresenceWarningRow = {
  id: string
  jobCode: string
  standRef: string
  warnedAt: string
}

function presenceWarningsFromRecords(records: unknown[] | null | undefined): PresenceWarningRow[] {
  const out: PresenceWarningRow[] = []
  for (const r of records ?? []) {
    const row = r as Record<string, unknown>
    const raw = row.presence_warning_at
    if (typeof raw !== 'string' || !raw.trim()) continue
    const id = String(row.id ?? '').trim()
    if (!id) continue
    out.push({
      id,
      jobCode: String(row.job_code ?? row.mission_code ?? '').trim(),
      standRef: String(row.presence_dest_ref ?? row.final_position ?? '').trim(),
      warnedAt: raw.trim(),
    })
  }
  return out
}

export function AmrPresenceWarningBanner() {
  const location = useLocation()
  const canAmr = useAuthStore((s) => s.hasPermission('module.amr'))
  const canAck = useAuthStore((s) => s.canAmrAttention())
  const [warnings, setWarnings] = useState<PresenceWarningRow[]>([])
  const [ackBusyId, setAckBusyId] = useState<string | null>(null)
  const [ackErr, setAckErr] = useState<string | null>(null)

  useEffect(() => {
    if (!canAmr) return
    const ac = new AbortController()
    const tick = () => {
      void getAmrMissionRecords({ signal: ac.signal })
        .then((records) => {
          setWarnings(presenceWarningsFromRecords(records ?? []))
        })
        .catch((e) => {
          if (isAbortLikeError(e)) return
          setWarnings([])
        })
    }
    tick()
    const t = setInterval(tick, POLL_MS)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick()
    }
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      ac.abort()
      clearInterval(t)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [canAmr, location.pathname, location.search])

  if (!canAmr || warnings.length === 0) return null

  const onAcknowledge = async (missionRecordId: string) => {
    setAckErr(null)
    setAckBusyId(missionRecordId)
    try {
      await ackPresenceWarning(missionRecordId)
      const records = await getAmrMissionRecords()
      setWarnings(presenceWarningsFromRecords(records ?? []))
    } catch (e: unknown) {
      setAckErr(getApiErrorMessage(e, 'Could not acknowledge presence warning'))
    } finally {
      setAckBusyId(null)
    }
  }

  return (
    <div
      role="status"
      className="shrink-0 border-b border-red-500/35 bg-red-500/10 px-3 py-2.5 text-sm text-foreground dark:border-red-500/28 dark:bg-red-950/35"
    >
      <div className="mx-auto flex max-w-[100%] flex-wrap items-start justify-between gap-3 sm:items-center">
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-red-800 dark:text-red-200">
            Presence warning
          </p>
          {warnings.map((w) => (
            <p key={w.id} className="text-xs leading-snug text-red-950 dark:text-red-100">
              <span className="font-medium">
                {w.jobCode || 'Mission'}{' '}
              </span>
              did not see a pallet at{' '}
              <span className="font-mono">{w.standRef || 'the drop stand'}</span>
              {' '}within the confirmation window (warned {formatDateTime(w.warnedAt)}).
            </p>
          ))}
          {ackErr ? (
            <p className="text-xs font-medium text-red-700 dark:text-red-300" role="alert">
              {ackErr}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          {canAck ? (
            <>
              {warnings.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  disabled={ackBusyId === w.id}
                  className="rounded-md border border-red-600/40 bg-background px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-500/10 disabled:opacity-50 dark:border-red-500/35 dark:text-red-100"
                  onClick={() => void onAcknowledge(w.id)}
                >
                  {ackBusyId === w.id
                    ? 'Releasing…'
                    : warnings.length > 1
                      ? `Acknowledge ${w.jobCode || w.id.slice(0, 8)}…`
                      : 'Acknowledge & release hold'}
                </button>
              ))}
            </>
          ) : (
            <p className="max-w-xs text-right text-[11px] text-red-900/80 dark:text-red-200/90 sm:text-end">
              Acknowledging requires mission force-release permission.
            </p>
          )}
          <Link
            to={amrPath('missions')}
            className="shrink-0 rounded-md border border-red-700/35 bg-background/90 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted dark:border-red-500/30"
          >
            Open missions
          </Link>
        </div>
      </div>
    </div>
  )
}
