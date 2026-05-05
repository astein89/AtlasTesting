import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  continueAmrMultistopSession,
  getAmrMissionAttention,
  type AmrMissionAttentionItem,
} from '@/api/amr'
import { AmrAutoContinueCountdown } from '@/components/amr/AmrAutoContinueCountdown'
import { amrPath } from '@/lib/appPaths'
import { useAuthStore } from '@/store/authStore'
import { isAbortLikeError } from '@/api/client'

/** Align with mission list polling so the bar clears soon after status changes (~5s max lag vs ~22s). */
const POLL_MS = 5000

/** Hide the bar when the session will auto-continue; show only when manual action (or failure) is needed. */
function missionNeedsManualAttention(item: AmrMissionAttentionItem): boolean {
  if (String(item.status ?? '').trim() === 'failed') return true
  const autoIso = item.continueNotBefore?.trim()
  if (autoIso) return false
  return true
}

export function AmrAttentionBanner() {
  const location = useLocation()
  const canAmr = useAuthStore((s) => s.hasPermission('module.amr'))
  const canManage = useAuthStore((s) => s.hasPermission('amr.missions.manage'))
  const [attention, setAttention] = useState<{ count: number; items: AmrMissionAttentionItem[] }>({
    count: 0,
    items: [],
  })
  const [releaseBusy, setReleaseBusy] = useState(false)
  const [releaseErr, setReleaseErr] = useState<string | null>(null)

  useEffect(() => {
    if (!canAmr) return
    const ac = new AbortController()
    const tick = () => {
      void getAmrMissionAttention({ signal: ac.signal })
        .then((d) => {
          setAttention({ count: d.count, items: d.items })
          setReleaseErr(null)
        })
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

  const manualItems = attention.items.filter(missionNeedsManualAttention)
  const count = manualItems.length
  const soleSessionId =
    count === 1 && manualItems[0]?.sessionId ? manualItems[0].sessionId.trim() : ''
  const soleMissionCode =
    count === 1 && manualItems[0]?.missionCode ? manualItems[0].missionCode.trim() : ''
  const soleAutoIso =
    count === 1 ? manualItems[0]?.continueNotBefore?.trim() || null : null
  const soleStatus = count === 1 ? String(manualItems[0]?.status ?? '').trim() : ''
  const releaseEnabled =
    Boolean(soleSessionId) && soleStatus === 'awaiting_continue' && canManage && !releaseBusy

  const releaseTitle = (() => {
    if (!soleSessionId) return undefined
    if (!canManage) return 'Mission management permission required'
    if (soleStatus !== 'awaiting_continue') return 'Release is only available when waiting to continue'
    return undefined
  })()

  if (!canAmr || count === 0) return null

  const missionsLink = soleSessionId
    ? `${amrPath('missions')}?multistopSummary=${encodeURIComponent(soleSessionId)}`
    : `${amrPath('missions')}?attention=1`

  const onRelease = async () => {
    if (!soleSessionId || !releaseEnabled) return
    setReleaseBusy(true)
    setReleaseErr(null)
    try {
      await continueAmrMultistopSession(soleSessionId)
      const d = await getAmrMissionAttention()
      setAttention({ count: d.count, items: d.items })
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { error?: string } } }
      setReleaseErr(ax?.response?.data?.error ?? 'Release failed')
    } finally {
      setReleaseBusy(false)
    }
  }

  return (
    <div
      role="status"
      className="shrink-0 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground sm:px-6"
    >
      <div className="mx-auto flex max-w-[100%] flex-wrap items-center justify-between gap-2">
        <p className="min-w-0">
          <span className="font-medium">
            {count === 1
              ? soleMissionCode
                ? `Mission: ${soleMissionCode} requires attention`
                : soleSessionId
                  ? `Mission: ${soleSessionId} requires attention`
                  : 'Mission requires attention'
              : `${count} missions require attention`}
          </span>
          {soleAutoIso ? (
            <span className="mt-1 block text-xs">
              <AmrAutoContinueCountdown continueNotBeforeIso={soleAutoIso} className="text-foreground/80" />
            </span>
          ) : null}
        </p>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {releaseErr ? (
            <span className="max-w-[14rem] text-right text-xs text-destructive">{releaseErr}</span>
          ) : null}
          {soleSessionId ? (
            <button
              type="button"
              disabled={!releaseEnabled}
              title={releaseTitle}
              className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-amber-500/15 disabled:opacity-50 dark:border-amber-500/35"
              onClick={() => void onRelease()}
            >
              {releaseBusy ? 'Releasing…' : soleAutoIso ? 'Release now' : 'Release'}
            </button>
          ) : null}
          <Link
            to={missionsLink}
            className="shrink-0 rounded-md border border-amber-600/50 bg-background/80 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            {soleSessionId ? 'Open mission' : 'Open missions'}
          </Link>
        </div>
      </div>
    </div>
  )
}
