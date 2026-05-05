import { useEffect, useMemo, useState } from 'react'

export type AmrStandPickerRow = {
  id: string
  external_ref: string
  zone: string
  location_label: string
  /** Degrees / fleet string from stands — used for containerIn enter orientation from start location. */
  orientation: string
}

/** Orientation string to send with containerIn / first mission stop from a stand external ref. */
export function enterOrientationForStandRef(stands: AmrStandPickerRow[], externalRef: string): string {
  const p = externalRef.trim()
  if (!p) return '0'
  const stand = stands.find((s) => s.external_ref.trim() === p)
  const o = stand?.orientation?.trim()
  return o !== undefined && o !== '' ? o : '0'
}

type Step = { kind: 'zones' } | { kind: 'stands'; zone: string }

function sortedZones(stands: AmrStandPickerRow[]): string[] {
  const set = new Set<string>()
  for (const s of stands) {
    set.add((s.zone ?? '').trim())
  }
  const arr = [...set]
  arr.sort((a, b) => {
    if (a === '' && b !== '') return 1
    if (b === '' && a !== '') return -1
    return a.localeCompare(b)
  })
  return arr
}

function standsInZone(stands: AmrStandPickerRow[], zone: string): AmrStandPickerRow[] {
  return stands
    .filter((s) => (s.zone ?? '').trim() === zone)
    .slice()
    .sort((a, b) => a.external_ref.localeCompare(b.external_ref))
}

function zoneLabel(zone: string): string {
  const t = zone.trim()
  return t === '' ? 'No zone' : t
}

export function AmrStandPickerModal({
  stands,
  onClose,
  onSelect,
  stackOrder = 'base',
}: {
  stands: AmrStandPickerRow[]
  onClose: () => void
  onSelect: (externalRef: string) => void
  /** Use `aboveDialogs` when opening over another full-screen modal (e.g. Add container). */
  stackOrder?: 'base' | 'aboveDialogs'
}) {
  const [step, setStep] = useState<Step>({ kind: 'zones' })
  const zClass = stackOrder === 'aboveDialogs' ? 'z-[80]' : 'z-50'

  const zones = useMemo(() => sortedZones(stands), [stands])

  const standsForStep = useMemo(() => {
    if (step.kind !== 'stands') return []
    return standsInZone(stands, step.zone)
  }, [stands, step])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={`fixed inset-0 ${zClass} flex items-end justify-center p-0 sm:items-center sm:p-4`}>
      <div className="absolute inset-0 bg-black/50" aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="stand-picker-title"
        className="relative z-10 flex max-h-[min(92vh,540px)] w-full max-w-lg flex-col overflow-hidden rounded-t-xl border border-border bg-card shadow-lg sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            {step.kind === 'stands' ? (
              <button
                type="button"
                className="mb-1 text-xs font-medium text-primary hover:underline"
                onClick={() => setStep({ kind: 'zones' })}
              >
                ← All zones
              </button>
            ) : null}
            <h2 id="stand-picker-title" className="text-base font-semibold text-foreground">
              {step.kind === 'zones' ? 'Choose zone' : `Stands — ${zoneLabel(step.zone)}`}
            </h2>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-lg p-2 text-foreground/70 hover:bg-muted hover:text-foreground"
            aria-label="Close"
            onClick={onClose}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {stands.length === 0 ? (
            <p className="text-sm text-foreground/60">No stands configured. Add stands under Positions / stands.</p>
          ) : step.kind === 'zones' ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {zones.map((z) => (
                <button
                  key={z === '' ? '__no_zone__' : z}
                  type="button"
                  className="rounded-lg border border-border bg-background px-4 py-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setStep({ kind: 'stands', zone: z })}
                >
                  {zoneLabel(z)}
                </button>
              ))}
            </div>
          ) : standsForStep.length === 0 ? (
            <p className="text-sm text-foreground/60">No stands in this zone.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {standsForStep.map((s) => {
                const ref = s.external_ref.trim()
                const label = s.location_label.trim()
                const sub = label && label !== ref ? label : ''
                return (
                  <button
                    key={s.id}
                    type="button"
                    className="flex flex-col items-start rounded-lg border border-border bg-background px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => onSelect(ref)}
                  >
                    <span className="break-all font-mono text-sm font-semibold text-foreground">{ref}</span>
                    {sub ? (
                      <span className="mt-0.5 line-clamp-2 text-xs text-foreground/60">{sub}</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Map pin / teardrop icon for location picker triggers */
export function LocationPinIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"
      />
    </svg>
  )
}
