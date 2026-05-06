export type PalletPresenceKind = 'empty' | 'full' | 'loading' | 'unknown' | 'error' | 'unconfigured'

/** Heroicons outline cube — cargo / pallet metaphor; stroke uses currentColor. */
export function CubeGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M21 16.5V8.25a2.25 2.25 0 00-1.136-1.952l-7.5-4.125a2.25 2.25 0 00-2.228 0l-7.5 4.125A2.25 2.25 0 003 8.25v8.25a2.25 2.25 0 001.136 1.952l7.5 4.125a2.25 2.25 0 002.228 0l7.5-4.125A2.25 2.25 0 0021 16.5z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 12L3.75 7.5M12 12l8.25-4.5M12 12v9" />
    </svg>
  )
}

const kindClasses: Record<PalletPresenceKind, string> = {
  empty: 'text-emerald-600 dark:text-emerald-400',
  full: 'text-red-600 dark:text-red-400',
  loading: 'text-foreground/45',
  unknown: 'text-foreground/45',
  error: 'text-amber-600 dark:text-amber-400',
  unconfigured: 'text-amber-600 dark:text-amber-400',
}

const kindAria: Record<PalletPresenceKind, string> = {
  empty: 'Stand empty, no pallet',
  full: 'Pallet present',
  loading: 'Loading stand status',
  unknown: 'Stand status unknown',
  error: 'Could not load stand status',
  unconfigured: 'Hyperion stand presence not configured',
}

const kindLabel: Record<PalletPresenceKind, string> = {
  empty: 'Empty',
  full: 'Pallet',
  loading: '…',
  unknown: '—',
  error: 'Error',
  unconfigured: 'N/A',
}

function LoadingSpinner({ className }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className ?? ''}`} fill="none" viewBox="0 0 24 24" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}

export function PalletPresenceGlyph({
  kind,
  className = 'h-4 w-4 shrink-0',
  showLabel = false,
  labelClassName,
}: {
  kind: PalletPresenceKind
  className?: string
  /** Short visible text next to icon (dense rows can omit). */
  showLabel?: boolean
  /** Applied to the label span when `showLabel` is true (e.g. `hidden sm:inline` on narrow viewports). */
  labelClassName?: string
}) {
  const aria = kindAria[kind]
  const label = kindLabel[kind]
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${kindClasses[kind]}`}
      title={aria}
      aria-label={aria}
    >
      {kind === 'loading' ? <LoadingSpinner className={className} /> : <CubeGlyph className={className} />}
      {showLabel ? (
        <span className={['text-xs font-medium', labelClassName].filter(Boolean).join(' ')}>{label}</span>
      ) : null}
    </span>
  )
}

export function palletPresenceKindFromState(opts: {
  present: boolean | null
  loading: boolean
  error: boolean
  unconfigured: boolean
}): PalletPresenceKind {
  if (opts.unconfigured) return 'unconfigured'
  if (opts.loading) return 'loading'
  if (opts.error) return 'error'
  if (opts.present === null) return 'unknown'
  return opts.present ? 'full' : 'empty'
}
