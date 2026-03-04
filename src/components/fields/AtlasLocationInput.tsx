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

  const parts = parseAtlasLocation(value)
  const stepIndex = STEPS.findIndex((s) => building[s.key as keyof AtlasLocationParts] == null)
  const isComplete = stepIndex < 0
  const hasValue = Object.keys(building).length === 5

  const openBuilder = () => {
    const p = parseAtlasLocation(value)
    setBuilding(p ? { level: p.level, aisle: p.aisle, lane: p.lane, side: p.side, position: p.position } : {})
    setLaneInput('')
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

  const [laneInput, setLaneInput] = useState('')
  const laneDisplay = building.lane != null ? String(building.lane) : laneInput || ''
  const setLaneAndAdvance = () => {
    const n = Math.min(90, Math.max(1, parseInt(laneDisplay, 10) || 1))
    setLaneInput('')
    select('lane', n)
  }
  const handleLaneDigit = (d: string) => {
    const next = laneDisplay + d
    const num = parseInt(next, 10)
    if (num <= 90) setLaneInput(next)
  }
  const handleLaneBackspace = () => setLaneInput((s) => s.slice(0, -1))
  const handleLaneClear = () => setLaneInput('')

  const cancel = () => {
    setOpen(false)
    setBuilding({})
  }

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
              <button
                type="button"
                onClick={cancel}
                className="rounded px-2 py-1 text-sm text-foreground/70 hover:bg-background"
              >
                Cancel
              </button>
            </div>

            {!isComplete && (
              <div>
                <p className="mb-3 text-sm text-foreground/70">
                  {stepIndex === 2 ? 'Enter Lane (01–90)' : `Select ${STEPS[stepIndex].label}`}
                </p>
                {stepIndex === 2 ? (
                  <div>
                    <div className="mb-3 rounded border border-border bg-background px-3 py-2">
                      <span className="text-lg font-medium text-foreground">
                        {laneDisplay || '—'}
                      </span>
                    </div>
                    <div className="mb-3 grid grid-cols-4 grid-rows-4 gap-2">
                      <button
                        type="button"
                        onClick={() => handleLaneDigit('7')}
                        className="min-h-[48px] rounded-lg border border-border bg-background text-lg text-foreground hover:bg-card"
                      >
                        7
                      </button>
                      <button
                        type="button"
                        onClick={() => handleLaneDigit('8')}
                        className="min-h-[48px] rounded-lg border border-border bg-background text-lg text-foreground hover:bg-card"
                      >
                        8
                      </button>
                      <button
                        type="button"
                        onClick={() => handleLaneDigit('9')}
                        className="min-h-[48px] rounded-lg border border-border bg-background text-lg text-foreground hover:bg-card"
                      >
                        9
                      </button>
                      <button
                        type="button"
                        onClick={handleLaneBackspace}
                        className="min-h-[48px] rounded-lg border border-border bg-background text-foreground hover:bg-card"
                      >
                        ⌫
                      </button>
                      <button
                        type="button"
                        onClick={() => handleLaneDigit('4')}
                        className="min-h-[48px] rounded-lg border border-border bg-background text-lg text-foreground hover:bg-card"
                      >
                        4
                      </button>
                      <button
                        type="button"
                        onClick={() => handleLaneDigit('5')}
                        className="min-h-[48px] rounded-lg border border-border bg-background text-lg text-foreground hover:bg-card"
                      >
                        5
                      </button>
                      <button
                        type="button"
                        onClick={() => handleLaneDigit('6')}
                        className="min-h-[48px] rounded-lg border border-border bg-background text-lg text-foreground hover:bg-card"
                      >
                        6
                      </button>
                      <button
                        type="button"
                        onClick={handleLaneClear}
                        className="row-span-2 min-h-0 rounded-lg border border-border bg-background text-foreground hover:bg-card"
                      >
                        C
                      </button>
                      <button
                        type="button"
                        onClick={() => handleLaneDigit('1')}
                        className="min-h-[48px] rounded-lg border border-border bg-background text-lg text-foreground hover:bg-card"
                      >
                        1
                      </button>
                      <button
                        type="button"
                        onClick={() => handleLaneDigit('2')}
                        className="min-h-[48px] rounded-lg border border-border bg-background text-lg text-foreground hover:bg-card"
                      >
                        2
                      </button>
                      <button
                        type="button"
                        onClick={() => handleLaneDigit('3')}
                        className="min-h-[48px] rounded-lg border border-border bg-background text-lg text-foreground hover:bg-card"
                      >
                        3
                      </button>
                      <button
                        type="button"
                        onClick={() => handleLaneDigit('0')}
                        className="col-span-2 min-h-[48px] rounded-lg border border-border bg-background text-lg text-foreground hover:bg-card"
                      >
                        0
                      </button>
                      <button
                        type="button"
                        onClick={setLaneAndAdvance}
                        className="col-span-2 min-h-[48px] rounded-lg bg-primary text-primary-foreground hover:opacity-90"
                      >
                        Next
                      </button>
                    </div>
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
                  onClick={() => setBuilding({})}
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
