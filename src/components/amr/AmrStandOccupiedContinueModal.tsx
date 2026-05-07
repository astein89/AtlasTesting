import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { PalletPresenceGlyph, palletPresenceKindFromState } from '@/components/amr/PalletPresenceGlyph'

export type BlockedStandPresenceProps = {
  present: boolean | null
  loading: boolean
  error: boolean
  unconfigured: boolean
}

export type AmrStandOccupiedContinueModalProps = {
  open: boolean
  standRef: string
  /** Full error text (API message or stand-occupied helper copy). */
  message: string
  presence: BlockedStandPresenceProps
  canForceRelease: boolean
  continueBusy: boolean
  /** Extra gates for the primary action (e.g. plan patch or cancel in flight). */
  confirmDisabled?: boolean
  /** Label when not busy — typically “Release Mission” or “Release now”. */
  retryLabel: string
  retryBusyLabel?: string
  onDismiss: () => void
  onRetry: () => void
  onRefreshPresence: () => void
  onRequestForceRelease: () => void
}

/**
 * High-visibility dialog when the next stop’s destination stand still shows a pallet (Hyperion),
 * so Continue / Release cannot proceed until the stand clears or an operator forces release.
 */
export function AmrStandOccupiedContinueModal({
  open,
  standRef,
  message,
  presence,
  canForceRelease,
  continueBusy,
  confirmDisabled = false,
  retryLabel,
  retryBusyLabel = 'Releasing…',
  onDismiss,
  onRetry,
  onRefreshPresence,
  onRequestForceRelease,
}: AmrStandOccupiedContinueModalProps) {
  const compactBtn =
    'min-h-[36px] shrink-0 rounded-lg px-2 py-1.5 text-xs font-medium leading-snug'
  const forceClass = `${compactBtn} border border-red-600/50 bg-background text-red-700 hover:bg-red-500/15 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950/50`

  return (
    <ConfirmModal
      open={open}
      title="Stand occupied — cannot release"
      variant="amber"
      confirmLabel={continueBusy ? retryBusyLabel : retryLabel}
      confirmDisabled={confirmDisabled || continueBusy}
      cancelLabel="Dismiss"
      message={
        <div className="space-y-4">
          <p className="text-base font-semibold leading-snug text-red-600 dark:text-red-400">{message}</p>
          <div className="rounded-lg border border-red-500/45 bg-red-500/10 px-3 py-3 dark:bg-red-950/40">
            <p className="text-xs font-medium text-foreground/80">
              Hyperion — stand <span className="font-mono text-foreground">{standRef}</span>
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-background/80 px-2 py-1">
                <PalletPresenceGlyph
                  kind={palletPresenceKindFromState({
                    present: presence.present,
                    loading: presence.loading,
                    error: presence.error,
                    unconfigured: presence.unconfigured,
                  })}
                  showLabel
                  className="h-4 w-4"
                />
              </span>
              <button
                type="button"
                disabled={presence.loading || continueBusy || confirmDisabled}
                className="text-xs font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
                onClick={() => void onRefreshPresence()}
              >
                {presence.loading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          </div>
          <p className="text-xs leading-snug text-foreground/70">
            Clear the stand or use force release only if you accept the risk of a fleet conflict.
          </p>
        </div>
      }
      footerExtra={
        canForceRelease ? (
          <button
            type="button"
            disabled={continueBusy || confirmDisabled}
            className={forceClass}
            onClick={onRequestForceRelease}
          >
            Force release…
          </button>
        ) : undefined
      }
      onCancel={onDismiss}
      onConfirm={() => void onRetry()}
    />
  )
}
