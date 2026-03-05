import { useState } from 'react'
import {
  parseAtlasLocation,
  formatAtlasLocation,
  formatPartialAtlasLocation,
  LEVELS,
  AISLES,
  POSITIONS,
  type AtlasLocationParts,
} from '../../utils/atlasLocation'

interface AtlasLocationInputProps {
  value: string
  onChange: (value: string) => void
  className?: string
}

const STEPS = [
  { key: 'level', label: 'Level', options: LEVELS, fmt: (n: number) => String(n).padStart(2, '0') },
  { key: 'aisle', label: 'Aisle', options: AISLES, fmt: (a: string) => a },
  { key: 'lane', label: 'Lane', isNumberInput: true },
  { key: 'side', label: 'Side', options: ['L', 'R'] as const, fmt: (s: string) => s },
  { key: 'position', label: 'Position', options: POSITIONS, fmt: (n: number) => String(n).padStart(2, '0') },
] as const

export function AtlasLocationInput({ value, onChange, className = '' }: AtlasLocationInputProps) {
  const [open, setOpen] = useState(false)
  const [building, setBuilding] = useState<Partial<AtlasLocationParts>>({})

  const stepIndex = STEPS.findIndex((s) => building[s.key as keyof AtlasLocationParts] == null)
  const isComplete = stepIndex < 0
  const hasValue = Object.keys(building).length === 5

  const [laneTens, setLaneTens] = useState<number | null>(null)

  const openBuilder = () => {
    const p = parseAtlasLocation(value)
    setBuilding(p ? { level: p.level, aisle: p.aisle, lane: p.lane, side: p.side, position: p.position } : {})
    setLaneTens(null)
    setOpen(true)
  }

  const select = (key: keyof AtlasLocationParts, val: number | string) => {
    const next = { ...building, [key]: val }
    setBuilding(next)
    if (key === 'position') {
      onChange(formatAtlasLocation(next as AtlasLocationParts))
      setOpen(false)
    }
  }

  const LANE_TENS_OPTIONS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90] as const
  const getLaneSubOptions = (tens: number): number[] => {
    if (tens === 0) return [1, 2, 3, 4, 5, 6, 7, 8, 9]
    if (tens === 90) return [90]
    return Array.from({ length: 10 }, (_, i) => tens + i)
  }

  const cancel = () => {
    setOpen(false)
    setBuilding({})
  }

  const goBack = () => {
    if (stepIndex === 2 && laneTens != null) {
      setLaneTens(null)
      return
    }
    if (stepIndex <= 0) return
    const keyToClear = STEPS[stepIndex - 1].key as keyof AtlasLocationParts
    const next = { ...building }
    delete next[keyToClear]
    setBuilding(next)
    if (keyToClear === 'lane') setLaneTens(null)
  }

  const canGoBack = stepIndex > 0 || (stepIndex === 2 && laneTens != null)
  const displayValue = value || 'Click to set location'

  return (
    <div className={className}>
      <button
        type="button"
        onClick={openBuilder}
        className="min-h-[44px] w-full rounded border border-border bg-background px-3 py-2 text-left text-foreground hover:bg-card"
      >
        {displayValue}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={cancel}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-border bg-card p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="font-medium text-foreground">
                {formatPartialAtlasLocation(building) || 'S-'}
              </span>
              <div className="flex items-center gap-2">
                {canGoBack && (
                  <button
                    type="button"
                    onClick={goBack}
                    className="rounded px-2 py-1 text-sm text-foreground/70 hover:bg-background"
                  >
                    ← Back
                  </button>
                )}
                <button
                  type="button"
                  onClick={cancel}
                  className="rounded px-2 py-1 text-sm text-foreground/70 hover:bg-background"
                >
                  Cancel
                </button>
              </div>
            </div>

            {!isComplete && (
              <div>
                <p className="mb-3 text-sm text-foreground/70">
                  {stepIndex === 2 ? 'Select Lane' : `Select ${STEPS[stepIndex].label}`}
                </p>
                {stepIndex === 2 ? (
                  <div>
                    <p className="mb-2 text-xs text-foreground/60">
                      {laneTens == null ? 'Select lane range' : laneTens === 90 ? 'Lane 90' : `Lanes ${String(laneTens).padStart(2, '0')}–${String(laneTens + 9).padStart(2, '0')}`}
                    </p>
                    {laneTens == null ? (
                      <div className="grid grid-cols-5 gap-2">
                        {LANE_TENS_OPTIONS.map((tens) => (
                          <button
                            key={tens}
                            type="button"
                            onClick={() => setLaneTens(tens)}
                            className="min-h-[44px] rounded-lg border border-border bg-background px-2 py-2 text-lg font-medium text-foreground hover:bg-card"
                          >
                            {String(tens).padStart(2, '0')}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="grid grid-cols-5 gap-2">
                          {getLaneSubOptions(laneTens).map((lane) => (
                            <button
                              key={lane}
                              type="button"
                              onClick={() => {
                                select('lane', lane)
                                setLaneTens(null)
                              }}
                              className="min-h-[44px] rounded-lg border border-border bg-background px-2 py-2 text-foreground hover:bg-card"
                            >
                              {String(lane).padStart(2, '0')}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-5 gap-2">
                    {(STEPS[stepIndex].options as (number | string)[]).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => select(STEPS[stepIndex].key as keyof AtlasLocationParts, opt)}
                        className="min-h-[44px] rounded border border-border bg-background px-2 py-2 text-foreground hover:bg-card"
                      >
                        {STEPS[stepIndex].fmt(opt)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {isComplete && hasValue && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setBuilding({}); setLaneTens(null) }}
                  className="rounded border border-border px-3 py-2 text-sm text-foreground hover:bg-background"
                >
                  Change
                </button>
                <button
                  type="button"
                  onClick={cancel}
                  className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
