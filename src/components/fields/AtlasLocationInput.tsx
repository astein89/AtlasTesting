import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { ModalNestedHistoryContext } from '../../contexts/ModalNestedHistoryContext'
import { createPortal } from 'react-dom'
import {
  parseAtlasLocation,
  formatAtlasLocation,
  LEVELS,
  AISLES,
  POSITIONS,
  type AtlasLocationParts,
} from '../../utils/atlasLocation'

interface AtlasLocationInputProps {
  value: string
  onChange: (value: string) => void
  className?: string
  /** When true, show Clear beside the field outside the picker (e.g. Edit record modal only). */
  showClear?: boolean
}

const STEPS = [
  { key: 'level', label: 'Level', options: LEVELS, fmt: (n: number) => String(n).padStart(2, '0') },
  { key: 'aisle', label: 'Aisle', options: AISLES, fmt: (a: string) => a },
  { key: 'lane', label: 'Lane', isNumberInput: true },
  { key: 'side', label: 'Side', options: ['L', 'R'] as const, fmt: (s: string) => s },
  { key: 'position', label: 'Position', options: POSITIONS, fmt: (n: number) => String(n).padStart(2, '0') },
] as const

/** Grid option buttons: same size, radius, and bold text for every step */
const PICKER_OPTION_BTN =
  'min-h-[44px] rounded-lg border border-border bg-background px-2 py-2 text-base font-bold tabular-nums tracking-tight text-foreground hover:bg-card'

const FIELD_ORDER: (keyof AtlasLocationParts)[] = ['level', 'aisle', 'lane', 'side', 'position']

function isFullAtlasParts(p: Partial<AtlasLocationParts>): p is AtlasLocationParts {
  return FIELD_ORDER.every((k) => p[k] !== undefined && p[k] !== null)
}

function segmentLabel(key: keyof AtlasLocationParts, parts: Partial<AtlasLocationParts>): string {
  const v = parts[key]
  if (v === undefined || v === null) return ''
  if (key === 'level' || key === 'lane' || key === 'position') return String(v).padStart(2, '0')
  return String(v)
}

export function AtlasLocationInput({ value, onChange, className = '', showClear = false }: AtlasLocationInputProps) {
  const registerAtlasPickerHistory = useContext(ModalNestedHistoryContext)

  const [open, setOpen] = useState(false)
  const [building, setBuilding] = useState<Partial<AtlasLocationParts>>({})
  /** Values after the segment being edited; merged back when that field is re-selected. */
  const [pendingTail, setPendingTail] = useState<Partial<AtlasLocationParts>>({})
  const editFocusFieldRef = useRef<keyof AtlasLocationParts | null>(null)

  const stepIndex = STEPS.findIndex((s) => building[s.key as keyof AtlasLocationParts] == null)
  const isComplete = stepIndex < 0
  const hasValue = Object.keys(building).length === 5

  const [laneTens, setLaneTens] = useState<number | null>(null)

  const openBuilder = () => {
    const p = parseAtlasLocation(value)
    setBuilding(p ? { level: p.level, aisle: p.aisle, lane: p.lane, side: p.side, position: p.position } : {})
    setPendingTail({})
    editFocusFieldRef.current = null
    setLaneTens(null)
    setOpen(true)
  }

  const closePicker = useCallback(() => {
    setOpen(false)
    setBuilding({})
    setPendingTail({})
    editFocusFieldRef.current = null
    setLaneTens(null)
  }, [])

  useEffect(() => {
    if (!open || !registerAtlasPickerHistory) return
    return registerAtlasPickerHistory(closePicker)
  }, [open, registerAtlasPickerHistory, closePicker])

  const select = (key: keyof AtlasLocationParts, val: number | string) => {
    const jumpedToEditPosition = editFocusFieldRef.current === 'position'
    let next: Partial<AtlasLocationParts> = { ...building, [key]: val }
    if (editFocusFieldRef.current === key && Object.keys(pendingTail).length > 0) {
      next = { ...next, ...pendingTail }
      setPendingTail({})
      editFocusFieldRef.current = null
    }
    setBuilding(next)
    // Commit whenever we have a full location — not only on `position`, so jump-to-edit
    // (e.g. re-pick lane and merge tail) still updates the parent.
    if (isFullAtlasParts(next)) {
      onChange(formatAtlasLocation(next))
      const keepOpen = key === 'position' && jumpedToEditPosition
      if (!keepOpen) setOpen(false)
      setPendingTail({})
      editFocusFieldRef.current = null
    }
  }

  const LANE_TENS_OPTIONS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90] as const
  const getLaneSubOptions = (tens: number): number[] => {
    if (tens === 0) return [1, 2, 3, 4, 5, 6, 7, 8, 9]
    if (tens === 90) return [90]
    return Array.from({ length: 10 }, (_, i) => tens + i)
  }

  const cancel = () => closePicker()

  const clearValue = () => {
    onChange('')
    closePicker()
  }

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      closePicker()
    }
    // Capture so parent modals (Add/Edit row) don’t also handle Escape and close.
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [open, closePicker])

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
    setPendingTail({})
    editFocusFieldRef.current = null
  }

  /**
   * Edit one segment: keep fields before it, drop that field, stash fields after it
   * and restore them when this field is chosen again.
   */
  const jumpToField = (field: keyof AtlasLocationParts) => {
    const full: Partial<AtlasLocationParts> = { ...building, ...pendingTail }
    const next: Partial<AtlasLocationParts> = {}
    const tail: Partial<AtlasLocationParts> = {}
    const fi = FIELD_ORDER.indexOf(field)
    for (const k of FIELD_ORDER) {
      const v = full[k]
      if (v === undefined || v === null) continue
      const ki = FIELD_ORDER.indexOf(k)
      if (ki < fi) {
        if (k === 'level') next.level = v as number
        else if (k === 'aisle') next.aisle = v as string
        else if (k === 'lane') next.lane = v as number
        else if (k === 'side') next.side = v as 'L' | 'R'
        else if (k === 'position') next.position = v as number
      } else if (ki > fi) {
        if (k === 'level') tail.level = v as number
        else if (k === 'aisle') tail.aisle = v as string
        else if (k === 'lane') tail.lane = v as number
        else if (k === 'side') tail.side = v as 'L' | 'R'
        else if (k === 'position') tail.position = v as number
      }
    }
    editFocusFieldRef.current = field
    setPendingTail(tail)
    setBuilding(next)
    setLaneTens(null)
  }

  const canGoBack = stepIndex > 0 || (stepIndex === 2 && laneTens != null)
  const displayValue = value || 'Click to set location'
  const hasStoredValue = value.trim() !== ''

  return (
    <div className={className}>
      <div className="flex min-w-0 gap-2">
        <button
          type="button"
          onClick={openBuilder}
          className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-left text-base font-bold text-foreground hover:bg-card"
        >
          {displayValue}
        </button>
        {showClear && hasStoredValue && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              clearValue()
            }}
            className="shrink-0 rounded-lg border border-border bg-background px-3 py-2 text-sm font-bold text-foreground/80 hover:bg-card hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[200] bg-black/50"
              onClick={cancel}
              aria-hidden
            />
            <div
              className="fixed left-1/2 top-1/2 z-[201] flex max-h-[calc(100dvh-2rem)] w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Atlas location"
            >
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div className="min-w-0 flex flex-wrap items-baseline font-mono text-sm font-medium leading-snug text-foreground">
                  <span className="shrink-0 text-foreground/70">S-</span>
                  {FIELD_ORDER.map((key, i) => {
                    const v = building[key]
                    if (v === undefined || v === null) return null
                    const prevOk = FIELD_ORDER.slice(0, i).every((pk) => building[pk] != null)
                    if (!prevOk) return null
                    const label = segmentLabel(key, building)
                    return (
                      <span key={key} className="inline-flex items-baseline">
                        {i > 0 ? <span className="text-foreground/40">-</span> : null}
                        <button
                          type="button"
                          onClick={() => jumpToField(key)}
                          className="max-w-full truncate rounded px-0.5 font-bold text-foreground underline decoration-foreground/35 underline-offset-2 hover:bg-background hover:decoration-foreground"
                          title={`Edit ${STEPS.find((s) => s.key === key)?.label ?? key}`}
                        >
                          {label}
                        </button>
                      </span>
                    )
                  })}
                </div>
                <div className="flex items-center gap-2">
                  {canGoBack && (
                    <button
                      type="button"
                      onClick={goBack}
                      className="rounded-lg px-2 py-1.5 text-sm font-bold text-foreground/70 hover:bg-background"
                    >
                      ← Back
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={cancel}
                    className="rounded-lg px-2 py-1.5 text-sm font-bold text-foreground/70 hover:bg-background"
                  >
                    Cancel
                  </button>
                </div>
              </div>

              <div className="max-h-[calc(100dvh-7rem)] min-h-0 overflow-y-auto overscroll-contain px-4 py-3 [scrollbar-gutter:stable]">
              {!isComplete && (
                <div>
                  <p className="mb-3 text-sm text-foreground/70">
                    {stepIndex === 2 ? 'Select Lane' : `Select ${STEPS[stepIndex].label}`}
                  </p>
                  {stepIndex === 2 ? (
                    <div>
                      {laneTens == null ? (
                        <div className="grid grid-cols-5 gap-2">
                          {LANE_TENS_OPTIONS.map((tens) => (
                            <button
                              key={tens}
                              type="button"
                              onClick={() => setLaneTens(tens)}
                              className={PICKER_OPTION_BTN}
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
                                className={PICKER_OPTION_BTN}
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
                          className={PICKER_OPTION_BTN}
                        >
                          {STEPS[stepIndex].fmt(opt)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {isComplete && hasValue && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setBuilding({})
                      setPendingTail({})
                      editFocusFieldRef.current = null
                      setLaneTens(null)
                    }}
                    className="rounded-lg border border-border px-3 py-2 text-sm font-bold text-foreground hover:bg-background"
                  >
                    Change
                  </button>
                  <button
                    type="button"
                    onClick={clearValue}
                    className="rounded-lg border border-destructive/40 px-3 py-2 text-sm font-bold text-destructive hover:bg-destructive/10"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={cancel}
                    className="rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground"
                  >
                    Done
                  </button>
                </div>
              )}
              </div>
            </div>
          </>,
          document.body
        )}
    </div>
  )
}
