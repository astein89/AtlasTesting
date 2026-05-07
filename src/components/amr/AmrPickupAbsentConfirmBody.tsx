import { useCallback, useEffect, useState } from 'react'
import { postStandPresence } from '@/api/amr'
import { PalletPresenceGlyph, palletPresenceKindFromState } from '@/components/amr/PalletPresenceGlyph'
import { useConfirmModalActions } from '@/contexts/ConfirmModalContext'

/** Footer control for `showConfirm` + `footerExtra`: same action as “Create mission anyway”. */
export function AmrPickupAbsentConfirmFooterRetry() {
  const modalActions = useConfirmModalActions()
  return (
    <button
      type="button"
      disabled={!modalActions}
      className="min-h-[36px] shrink-0 rounded-lg border border-primary/40 bg-primary/10 px-2 py-1.5 text-xs font-medium text-foreground hover:bg-primary/15 disabled:opacity-50"
      onClick={() => modalActions?.confirm()}
    >
      Retry
    </button>
  )
}

/** Rich `showConfirm` body when pickup (stop 1) should hold a pallet but Hyperion reports none. */
export function AmrPickupAbsentConfirmBody({ pickupRef }: { pickupRef: string }) {
  const ref = pickupRef.trim()
  const [present, setPresent] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [unconfig, setUnconfig] = useState(false)
  const [presentNotice, setPresentNotice] = useState(false)

  const refresh = useCallback(async () => {
    if (!ref) return
    setLoading(true)
    setError(false)
    setUnconfig(false)
    setPresentNotice(false)
    try {
      const p = await postStandPresence([ref])
      const v = p[ref]
      const next = typeof v === 'boolean' ? v : null
      setPresent(next)
      if (next === true) setPresentNotice(true)
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status
      if (status === 503) setUnconfig(true)
      else setError(true)
      setPresent(null)
    } finally {
      setLoading(false)
    }
  }, [ref])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="space-y-4">
      <p>
        First stop pickup (<span className="font-mono">{ref || '—'}</span>) should have a pallet, but Hyperion reports
        no pallet detected. Create this mission anyway?
      </p>
      {presentNotice ? (
        <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-900 dark:text-emerald-100">
          Latest check reports a pallet on this stand. Cancel and submit again to skip this warning, or use Retry or
          Create mission anyway below to start now.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-3">
        <span className="text-xs text-foreground/80">
          Current stand status <span className="font-mono text-foreground">{ref || '—'}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-background px-2 py-1">
          <PalletPresenceGlyph
            kind={palletPresenceKindFromState({
              present,
              loading,
              error,
              unconfigured: unconfig,
            })}
            showLabel
            className="h-4 w-4"
          />
        </span>
        <button
          type="button"
          disabled={loading}
          className="text-xs font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
          onClick={() => void refresh()}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    </div>
  )
}
