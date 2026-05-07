import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  cancelAmrMultistopSession,
  continueAmrMultistopSession,
  getAmrMultistopSession,
  getAmrMissionAttention,
  getAmrSettings,
  getAmrStands,
  postStandPresence,
  terminateStuckAmrMultistopSession,
  type AmrMissionAttentionItem,
} from '@/api/amr'
import { AmrAutoContinueCountdown } from '@/components/amr/AmrAutoContinueCountdown'
import { amrPath } from '@/lib/appPaths'
import { useAuthStore } from '@/store/authStore'
import {
  getApiErrorMessage,
  isAbortLikeError,
  parseMultistopContinueStandOccupied,
} from '@/api/client'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import {
  multistopContinueOccupiedDestinationRef,
  multistopStandOccupiedContinueMessage,
  parseMultistopReleasePlanDestinations,
  refBypassesPalletCheck,
  sessionNextSegmentIndex,
} from '@/utils/amrPalletPresenceSanity'
import { standRefsNonStandWaypoint, standRefsSkippingHyperionOccupancy } from '@/utils/amrStandLocationType'

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
  const canForceRelease = useAuthStore((s) => s.hasPermission('amr.missions.force_release'))
  const [attention, setAttention] = useState<{ count: number; items: AmrMissionAttentionItem[] }>({
    count: 0,
    items: [],
  })
  const [releaseBusy, setReleaseBusy] = useState(false)
  const [releaseErr, setReleaseErr] = useState<string | null>(null)
  const [releaseOccupiedStandRef, setReleaseOccupiedStandRef] = useState<string | null>(null)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [terminateStuckConfirmOpen, setTerminateStuckConfirmOpen] = useState(false)
  const [terminateStuckBusy, setTerminateStuckBusy] = useState(false)
  const [forceReleaseConfirmOpen, setForceReleaseConfirmOpen] = useState(false)
  const [palletPresenceBypassRefs, setPalletPresenceBypassRefs] = useState(() => new Set<string>())
  const [nonStandWaypointRefs, setNonStandWaypointRefs] = useState(() => new Set<string>())
  /** Hyperion must report empty (`false`) before Release is enabled — mirrors mission modals. */
  const [releaseDisabledUntilStandEmpty, setReleaseDisabledUntilStandEmpty] = useState(false)
  useEffect(() => {
    if (!canAmr) return
    void getAmrStands().then((rows) => {
      setPalletPresenceBypassRefs(standRefsSkippingHyperionOccupancy(rows))
      setNonStandWaypointRefs(standRefsNonStandWaypoint(rows))
    })
  }, [canAmr])

  useEffect(() => {
    if (!canAmr) return
    const ac = new AbortController()
    const tick = () => {
      void getAmrMissionAttention({ signal: ac.signal })
        .then((d) => {
          setAttention({ count: d.count, items: d.items })
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
  const soleNextSegmentIndex = count === 1 ? Number(manualItems[0]?.nextSegmentIndex) : NaN
  const soleNextSegOk = Number.isFinite(soleNextSegmentIndex) && soleNextSegmentIndex === 0
  const releaseEnabled =
    Boolean(soleSessionId) &&
    soleStatus === 'awaiting_continue' &&
    canManage &&
    !releaseBusy &&
    !cancelBusy &&
    !terminateStuckBusy &&
    !releaseDisabledUntilStandEmpty
  const cancelBannerEnabled =
    Boolean(soleSessionId) &&
    soleStatus === 'awaiting_continue' &&
    soleNextSegOk &&
    canManage &&
    !cancelBusy &&
    !releaseBusy &&
    !terminateStuckBusy
  const terminateBannerEnabled =
    Boolean(soleSessionId) && soleStatus === 'failed' && canManage && !terminateStuckBusy && !releaseBusy && !cancelBusy

  const releaseTitle = (() => {
    if (!soleSessionId) return undefined
    if (!canManage) return 'Mission management permission required'
    if (soleStatus !== 'awaiting_continue') return 'Release is only available when waiting to continue'
    if (releaseDisabledUntilStandEmpty)
      return 'Release stays off until Hyperion reports the next drop stand as empty'
    return undefined
  })()

  useEffect(() => {
    if (!soleSessionId || soleStatus !== 'awaiting_continue') {
      setReleaseDisabledUntilStandEmpty(false)
      return
    }
    let cancelled = false
    const tick = async () => {
      if (cancelled) return
      try {
        const settings = await getAmrSettings()
        if (cancelled) return
        if (settings.missionCreateStandPresenceSanityCheck === false || settings.missionQueueingEnabled !== false) {
          setReleaseDisabledUntilStandEmpty(false)
          return
        }
        const ms = await getAmrMultistopSession(soleSessionId)
        if (cancelled) return
        const session = (ms.session ?? {}) as Record<string, unknown>
        const nextSeg = sessionNextSegmentIndex(session)
        const planRaw = session.plan_json ?? session.planJson
        const plan = parseMultistopReleasePlanDestinations(planRaw)
        const ref =
          Number.isFinite(nextSeg) && plan
            ? multistopContinueOccupiedDestinationRef(plan, nextSeg, nonStandWaypointRefs)
            : null
        if (!ref || refBypassesPalletCheck(ref, palletPresenceBypassRefs)) {
          setReleaseDisabledUntilStandEmpty(false)
          return
        }
        const presence = await postStandPresence([ref])
        if (cancelled) return
        const v = presence[ref]
        setReleaseDisabledUntilStandEmpty(v !== false)
      } catch {
        if (!cancelled) setReleaseDisabledUntilStandEmpty(false)
      }
    }
    void tick()
    const t = setInterval(tick, POLL_MS)
    const onVis = () => {
      if (document.visibilityState === 'visible') void tick()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [soleSessionId, soleStatus, palletPresenceBypassRefs, nonStandWaypointRefs])

  useEffect(() => {
    setReleaseErr(null)
    setReleaseOccupiedStandRef(null)
  }, [soleSessionId])

  if (!canAmr || count === 0) return null

  const missionsLink = soleSessionId
    ? `${amrPath('missions')}?multistopSummary=${encodeURIComponent(soleSessionId)}`
    : `${amrPath('missions')}?attention=1`

  const onRelease = async () => {
    if (!soleSessionId || !releaseEnabled) return
    setReleaseBusy(true)
    setReleaseErr(null)
    setReleaseOccupiedStandRef(null)
    try {
      const settings = await getAmrSettings()
      if (settings.missionCreateStandPresenceSanityCheck !== false && settings.missionQueueingEnabled === false) {
        const ms = await getAmrMultistopSession(soleSessionId)
        const session = (ms.session ?? {}) as Record<string, unknown>
        const nextSeg = sessionNextSegmentIndex(session)
        const planRaw = session.plan_json ?? session.planJson
        const plan = parseMultistopReleasePlanDestinations(planRaw)
        const ref =
          Number.isFinite(nextSeg) && plan
            ? multistopContinueOccupiedDestinationRef(plan, nextSeg, nonStandWaypointRefs)
            : null
        if (ref && !refBypassesPalletCheck(ref, palletPresenceBypassRefs)) {
          const presence = await postStandPresence([ref])
          if (presence[ref] === true) {
            setReleaseErr(multistopStandOccupiedContinueMessage(ref))
            setReleaseOccupiedStandRef(ref)
            return
          }
        }
      }
      await continueAmrMultistopSession(soleSessionId)
      setReleaseErr(null)
      setReleaseOccupiedStandRef(null)
      const d = await getAmrMissionAttention()
      setAttention({ count: d.count, items: d.items })
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { queued?: boolean; standOccupiedRef?: string } } })?.response?.data
      if (d?.queued) {
        const ref = typeof d.standOccupiedRef === 'string' ? d.standOccupiedRef.trim() : ''
        setReleaseErr(ref ? `Queued — waiting for destination ${ref} to clear.` : 'Queued — waiting for destination to clear.')
        setReleaseOccupiedStandRef(null)
      } else {
        setReleaseErr(getApiErrorMessage(e, 'Release failed'))
        setReleaseOccupiedStandRef(parseMultistopContinueStandOccupied(e))
      }
    } finally {
      setReleaseBusy(false)
    }
  }

  const onConfirmForceRelease = async () => {
    if (!soleSessionId || !releaseOccupiedStandRef) return
    setForceReleaseConfirmOpen(false)
    setReleaseBusy(true)
    setReleaseErr(null)
    try {
      await continueAmrMultistopSession(soleSessionId, { forceRelease: true })
      setReleaseOccupiedStandRef(null)
      const d = await getAmrMissionAttention()
      setAttention({ count: d.count, items: d.items })
    } catch (e: unknown) {
      setReleaseErr(getApiErrorMessage(e, 'Force release failed'))
      setReleaseOccupiedStandRef(parseMultistopContinueStandOccupied(e))
    } finally {
      setReleaseBusy(false)
    }
  }

  const onCancelMission = async () => {
    if (!soleSessionId || !cancelBannerEnabled) return
    setCancelBusy(true)
    setReleaseErr(null)
    try {
      await cancelAmrMultistopSession(soleSessionId)
      setCancelConfirmOpen(false)
      const d = await getAmrMissionAttention()
      setAttention({ count: d.count, items: d.items })
    } catch (e: unknown) {
      setReleaseErr(getApiErrorMessage(e, 'Cancel failed'))
    } finally {
      setCancelBusy(false)
    }
  }

  const onTerminateStuckSession = async () => {
    if (!soleSessionId || !terminateBannerEnabled) return
    setTerminateStuckBusy(true)
    setReleaseErr(null)
    try {
      await terminateStuckAmrMultistopSession(soleSessionId)
      setTerminateStuckConfirmOpen(false)
      const d = await getAmrMissionAttention()
      setAttention({ count: d.count, items: d.items })
    } catch (e: unknown) {
      setReleaseErr(getApiErrorMessage(e, 'Could not end failed session'))
    } finally {
      setTerminateStuckBusy(false)
    }
  }

  return (
    <div
      role="status"
      className="shrink-0 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground sm:px-6"
    >
      <ConfirmModal
        open={forceReleaseConfirmOpen}
        title="Force release"
        variant="amber"
        message={
          releaseOccupiedStandRef ? (
            <span>
              Hyperion still reports a pallet at stand{' '}
              <span className="font-mono">{releaseOccupiedStandRef}</span>. Force only if the stand is actually clear or
              you accept the risk of a fleet conflict.
            </span>
          ) : (
            'Force dispatch without a stand-empty check? Only continue if the stand is clear or you accept the risk.'
          )
        }
        confirmLabel={releaseBusy ? 'Releasing…' : 'Force release'}
        cancelLabel="Cancel"
        onCancel={() => {
          if (!releaseBusy) setForceReleaseConfirmOpen(false)
        }}
        onConfirm={() => void onConfirmForceRelease()}
      />
      <ConfirmModal
        open={cancelConfirmOpen}
        title="Cancel mission"
        message={
          <span>
            Remove the container from the pickup stand on the fleet and abandon this session. Only available before the
            first leg is submitted.
          </span>
        }
        confirmLabel={cancelBusy ? 'Cancelling…' : 'Cancel mission'}
        variant="danger"
        onCancel={() => {
          if (!cancelBusy) setCancelConfirmOpen(false)
        }}
        onConfirm={() => void onCancelMission()}
      />
      <ConfirmModal
        open={terminateStuckConfirmOpen}
        title="End failed session"
        message={
          <span>
            This session is marked <strong className="font-medium">failed</strong>. DC will stop tracking it, close
            related mission rows, and call fleet <strong className="font-medium">missionCancel</strong> for each leg
            (best effort). Confirm only when robots are safe.
          </span>
        }
        confirmLabel={terminateStuckBusy ? 'Ending…' : 'End session'}
        variant="danger"
        onCancel={() => {
          if (!terminateStuckBusy) setTerminateStuckConfirmOpen(false)
        }}
        onConfirm={() => void onTerminateStuckSession()}
      />
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
            <div
              role="alert"
              aria-live="assertive"
              className="max-w-md min-w-0 shrink rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-right text-xs font-medium leading-snug text-red-600 dark:border-red-500/35 dark:bg-red-950/40 dark:text-red-400"
            >
              <p className="text-pretty">{releaseErr}</p>
              {canForceRelease && releaseOccupiedStandRef ? (
                <button
                  type="button"
                  disabled={releaseBusy || cancelBusy || terminateStuckBusy}
                  className="mt-1.5 w-full rounded border border-red-600/45 bg-background px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-300"
                  onClick={() => setForceReleaseConfirmOpen(true)}
                >
                  Force release anyway
                </button>
              ) : null}
            </div>
          ) : null}
          {soleSessionId && cancelBannerEnabled ? (
            <button
              type="button"
              disabled={terminateStuckBusy}
              className="rounded-md border border-red-500/45 bg-background px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
              onClick={() => setCancelConfirmOpen(true)}
            >
              Cancel mission
            </button>
          ) : null}
          {soleSessionId && terminateBannerEnabled ? (
            <button
              type="button"
              disabled={terminateStuckBusy}
              className="rounded-md border border-red-600/50 bg-background px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-300"
              onClick={() => setTerminateStuckConfirmOpen(true)}
            >
              {terminateStuckBusy ? 'Ending…' : 'End failed session'}
            </button>
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
