import { PalletPresenceGlyph, palletPresenceKindFromState } from '@/components/amr/PalletPresenceGlyph'

/**
 * One labelled row in a route leg card (`From` / `To`): stand reference + a {@link PalletPresenceGlyph} from a shared
 * presence map. Bypass-listed stands render as `unconfigured` (Hyperion sanity-skipped).
 */
export function AmrStandPresenceRow({
  label,
  standRef,
  presenceMap,
  loading,
  error,
  unconfigured,
  bypassRefs,
  /** Fleet fork at this NODE: `lower` = putDown true, `lift` = false. Shown as `> LOWER >` / `> LIFT >` before presence. */
  forkAction,
}: {
  label: 'From' | 'To'
  standRef: string
  presenceMap: Record<string, boolean | null>
  loading: boolean
  error: boolean
  unconfigured: boolean
  bypassRefs: Set<string>
  forkAction?: 'lift' | 'lower'
}) {
  const ref = (standRef ?? '').trim()
  const hasRef = Boolean(ref) && ref !== '—'
  const bypassed = hasRef && bypassRefs.has(ref)
  const present = hasRef ? presenceMap[ref] ?? null : null
  const kind = palletPresenceKindFromState({
    present,
    loading: hasRef ? loading : false,
    error: hasRef ? error : false,
    unconfigured: !hasRef || bypassed || unconfigured,
  })
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="w-9 shrink-0 text-[10px] font-medium uppercase tracking-wide text-foreground/50">
        {label}
      </span>
      <span className="min-w-0 break-all font-mono text-xs leading-snug text-foreground/85">
        {hasRef ? ref : '—'}
      </span>
      {hasRef && forkAction ? (
        <>
          <span className="shrink-0 text-foreground/35" aria-hidden>
            {' '}
            &gt;{' '}
          </span>
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-foreground/75">
            {forkAction === 'lower' ? 'LOWER' : 'LIFT'}
          </span>
          <span className="shrink-0 text-foreground/35" aria-hidden>
            {' '}
            &gt;{' '}
          </span>
        </>
      ) : null}
      {hasRef ? (
        <PalletPresenceGlyph kind={kind} className="h-3.5 w-3.5 shrink-0" showLabel labelClassName="text-[10px]" />
      ) : null}
    </div>
  )
}
