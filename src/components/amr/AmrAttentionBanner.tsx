import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { getAmrMissionAttention, type AmrMissionAttentionItem } from '@/api/amr'
import { AmrAutoContinueCountdown } from '@/components/amr/AmrAutoContinueCountdown'
import { amrPath } from '@/lib/appPaths'
import { useAuthStore } from '@/store/authStore'
import { isAbortLikeError } from '@/api/client'

/** Align with mission list polling so the bar clears soon after status changes (~5s max lag vs ~22s). */
const POLL_MS = 5000

export function AmrAttentionBanner() {
  const location = useLocation()
  const canAmr = useAuthStore((s) => s.hasPermission('module.amr'))
  const [attention, setAttention] = useState<{ count: number; items: AmrMissionAttentionItem[] }>({
    count: 0,
    items: [],
  })

  useEffect(() => {
    if (!canAmr) return
    const ac = new AbortController()
    const tick = () => {
      void getAmrMissionAttention({ signal: ac.signal })
        .then((d) => setAttention({ count: d.count, items: d.items }))
        .catch((e) => {
          if (isAbortLikeError(e)) return
          setAttention({ count: 0, items: [] })
        })
    }
    tick()
    const t = setInterval(tick, POLL_MS)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick()
    }
    const onFocus = () => {
      tick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    return () => {
      ac.abort()
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
    }
  }, [canAmr, location.pathname, location.search])

  const count = attention.count
  const soleSessionId =
    count === 1 && attention.items[0]?.sessionId ? attention.items[0].sessionId.trim() : ''
  const soleAutoIso =
    count === 1 ? attention.items[0]?.continueNotBefore?.trim() || null : null

  if (!canAmr || count === 0) return null

  const missionsLink = soleSessionId
    ? `${amrPath('missions')}?multistopSummary=${encodeURIComponent(soleSessionId)}`
    : `${amrPath('missions')}?attention=1`

  return (
    <div
      role="status"
      className="shrink-0 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground sm:px-6"
    >
      <div className="mx-auto flex max-w-[100%] flex-wrap items-center justify-between gap-2">
        <p className="min-w-0">
          <span className="font-medium">
            {count === 1
              ? '1 multi-stop mission needs your attention'
              : `${count} multi-stop missions need your attention`}
          </span>
          <span className="text-foreground/75"> — open the overview on Missions to continue or edit the plan.</span>
          {soleAutoIso ? (
            <span className="mt-1 block text-xs">
              <AmrAutoContinueCountdown continueNotBeforeIso={soleAutoIso} className="text-foreground/80" />
            </span>
          ) : null}
        </p>
        <Link
          to={missionsLink}
          className="shrink-0 rounded-md border border-amber-600/50 bg-background/80 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
        >
          {soleSessionId ? 'Open overview' : 'Open missions'}
        </Link>
      </div>
    </div>
  )
}
