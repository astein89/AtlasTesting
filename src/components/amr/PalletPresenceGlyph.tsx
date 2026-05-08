export type PalletPresenceKind =
  | 'empty'
  | 'full'
  | 'loading'
  | 'unknown'
  | 'error'
  | 'unconfigured'
  | 'non_stand'

/** Octagon “stop” style — non-rack waypoint (no pallet presence check). */
function NonStandWaypointGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        fill="currentColor"
        d="M10.2 2.5h3.6L21 7.7v8.6l-7.2 5.2h-3.6L3 16.3V7.7L10.2 2.5z"
        opacity="0.92"
      />
      <path
        fill="white"
        d="M7.2 9.2h9.6v1.7H7.2V9.2zm0 3.4h9.6v1.7H7.2v-1.7z"
        opacity="0.95"
      />
    </svg>
  )
}

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
  non_stand: 'text-red-600 dark:text-red-400',
}

const kindAria: Record<PalletPresenceKind, string> = {
  empty: 'Stand empty, no pallet',
  full: 'Pallet present',
  loading: 'Loading stand status',
  unknown: 'Stand status unknown',
  error: 'Could not load stand status',
  unconfigured: 'Hyperion stand presence not configured',
  non_stand: 'Non-stand stop — no rack pallet presence',
}

const kindLabel: Record<PalletPresenceKind, string> = {
  empty: 'Empty',
  full: 'Pallet',
  loading: '…',
  unknown: '—',
  error: 'Error',
  unconfigured: 'N/A',
  non_stand: 'Stop',
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
      {kind === 'loading' ? (
        <LoadingSpinner className={className} />
      ) : kind === 'non_stand' ? (
        <NonStandWaypointGlyph className={className} />
      ) : (
        <CubeGlyph className={className} />
      )}
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
  /** Fleet node is a non-rack waypoint — no Hyperion pallet presence. */
  nonStandWaypoint?: boolean
}): PalletPresenceKind {
  if (opts.nonStandWaypoint) return 'non_stand'
  if (opts.unconfigured) return 'unconfigured'
  if (opts.loading) return 'loading'
  if (opts.error) return 'error'
  if (opts.present === null) return 'unknown'
  return opts.present ? 'full' : 'empty'
}
