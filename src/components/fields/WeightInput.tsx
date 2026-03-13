import { useEffect, useState } from 'react'

interface WeightInputProps {
  value: number
  onChange: (value: number) => void
  className?: string
  /** Base storage unit for this field: default 'lb'. Supports kg, g, lb, oz. */
  storageUnit?: 'kg' | 'g' | 'lb' | 'oz'
}

const LB_TO_KG = 0.45359237

type WeightMode = 'kg' | 'g' | 'lb'

export function WeightInput({ value, onChange, className = '', storageUnit = 'lb' }: WeightInputProps) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<WeightMode>(
    storageUnit === 'kg' ? 'kg' : storageUnit === 'g' ? 'g' : 'lb'
  )
  const [text, setText] = useState('')
  // Live numeric value in the configured storage unit (kg/g/lb/oz), kept at full precision.
  const [currentStorage, setCurrentStorage] = useState<number | null>(null)

  const storageVal = Number.isFinite(value) ? value : 0
  // Convert from storage unit → a given display/edit mode.
  const storageToModeValue = (s: number, m: WeightMode): number => {
    if (!Number.isFinite(s)) return 0
    if (m === 'kg') {
      if (storageUnit === 'kg') return s
      if (storageUnit === 'g') return s / 1000
      if (storageUnit === 'lb') return s * LB_TO_KG
      if (storageUnit === 'oz') return (s / 16) * LB_TO_KG
      return s
    }
    if (m === 'g') {
      if (storageUnit === 'g') return s
      if (storageUnit === 'kg') return s * 1000
      if (storageUnit === 'lb') return s * LB_TO_KG * 1000
      if (storageUnit === 'oz') return (s / 16) * LB_TO_KG * 1000
      return s
    }
    // m === 'lb'
    if (storageUnit === 'lb') return s
    if (storageUnit === 'oz') return s / 16
    if (storageUnit === 'kg') return s / LB_TO_KG
    if (storageUnit === 'g') return (s / 1000) / LB_TO_KG
    return s
  }

  // Precomputed display values for the current stored value.
  const asKg = storageToModeValue(storageVal, 'kg')
  const asG = storageToModeValue(storageVal, 'g')
  const asLb = storageToModeValue(storageVal, 'lb')

  const formatVal = (n: number) => {
    if (!Number.isFinite(n)) return ''
    if (Math.abs(n) >= 1000) return n.toFixed(0)
    if (Math.abs(n) >= 100) return n.toFixed(1)
    return n.toFixed(2)
  }

  const displayStorage = (() => {
    if (storageUnit === 'kg') return formatVal(asKg)
    if (storageUnit === 'g') return formatVal(asG)
    if (storageUnit === 'lb') return formatVal(asLb)
    if (storageUnit === 'oz') return formatVal(storageVal)
    return formatVal(storageVal)
  })()

  const displayModal = () => {
    const base = currentStorage ?? storageVal
    return formatVal(storageToModeValue(base, mode))
  }

  const syncFromStorage = (storageValue: number, nextMode: WeightMode) => {
    const v = storageToModeValue(storageValue, nextMode)
    // For editing, use the raw numeric string (no fixed padding),
    // and leave empty when the value is exactly zero.
    if (!Number.isFinite(v) || v === 0) {
      setText('')
    } else {
      setText(String(v))
    }
  }

  // Convert a entered value in the current mode into the storage unit, without rounding.
  const modeToStorageValue = (entered: number, m: WeightMode): number => {
    if (!Number.isFinite(entered)) return 0
    if (storageUnit === 'kg') {
      if (m === 'kg') return entered
      if (m === 'g') return entered / 1000
      // lb → kg
      return entered * LB_TO_KG
    }
    if (storageUnit === 'lb') {
      if (m === 'lb') return entered
      if (m === 'kg') return entered / LB_TO_KG
      // g → kg → lb
      const kgVal = entered / 1000
      return kgVal / LB_TO_KG
    }
    if (storageUnit === 'g') {
      if (m === 'g') return entered
      if (m === 'kg') return entered * 1000
      // lb → kg → g
      const kgVal = entered * LB_TO_KG
      return kgVal * 1000
    }
    if (storageUnit === 'oz') {
      // First normalize from mode to lb, then to oz.
      let lbVal: number
      if (m === 'lb') lbVal = entered
      else if (m === 'kg') lbVal = entered / LB_TO_KG
      else {
        // g → kg → lb
        const kgVal = entered / 1000
        lbVal = kgVal / LB_TO_KG
      }
      return lbVal * 16
    }
    return entered
  }

  const getCurrentStorage = () => {
    // Always prefer the live, unrounded storage value if present.
    return currentStorage ?? storageVal
  }

  const openModal = () => {
    const initialMode: WeightMode =
      storageUnit === 'kg' ? 'kg' : storageUnit === 'g' ? 'g' : 'lb'
    setMode(initialMode)
    setCurrentStorage(storageVal)
    syncFromStorage(storageVal, initialMode)
    setOpen(true)
  }

  const applyValue = () => {
    onChange(getCurrentStorage())
  }

  const updateFromText = (nextText: string) => {
    setText(nextText)
    const entered = parseFloat(nextText || '0')
    const storageValue = modeToStorageValue(entered, mode)
    setCurrentStorage(storageValue)
  }

  const handleDigit = (d: string) => {
    setText((prev) => {
      const next = prev === '0' && d === '0' ? '0' : prev + d
      // use a callback to ensure mode is up to date
      const entered = parseFloat(next || '0')
      const storageValue = modeToStorageValue(entered, mode)
      setCurrentStorage(storageValue)
      return next
    })
  }

  const handleDot = () => {
    setText((prev) => {
      const cur = prev || '0'
      if (cur.includes('.')) return cur
      const next = cur + '.'
      // dot alone doesn't change numeric value meaningfully; leave currentStorage as-is
      return next
    })
  }

  const handleBackspace = () => {
    setText((prev) => {
      const next = prev.slice(0, -1)
      const entered = parseFloat(next || '0')
      const storageValue = modeToStorageValue(entered, mode)
      setCurrentStorage(storageValue)
      return next
    })
  }

  const handleClear = () => {
    setText('')
    setCurrentStorage(0)
  }

  const handleDone = () => {
    applyValue()
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  const storageUnitLabel =
    storageUnit === 'kg'
      ? ' kg'
      : storageUnit === 'g'
      ? ' g'
      : storageUnit === 'oz'
      ? ' oz'
      : ' lb'

  return (
    <div className={className}>
      <button
        type="button"
        onClick={openModal}
        className="min-h-[44px] w-full rounded border border-border bg-background px-3 py-2 text-left text-foreground hover:bg-card"
      >
        {value === 0 && !open ? 'Click to enter' : (displayStorage || '0')}
        {value === 0 && !open ? '' : storageUnitLabel}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-2 sm:p-4"
          style={{
            paddingLeft: 'max(0.5rem, env(safe-area-inset-left))',
            paddingRight: 'max(0.5rem, env(safe-area-inset-right))',
            paddingTop: 'max(0.5rem, env(safe-area-inset-top))',
            paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))',
          }}
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[90dvh] w-full max-w-sm flex-col overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <span className="text-lg font-medium text-foreground">
                {displayModal()} {mode}
              </span>
              <div className="flex items-center gap-1 rounded-full border border-border bg-background px-1 py-0.5 text-xs">
                {(['kg', 'g', 'lb'] as WeightMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      const storageValue = getCurrentStorage()
                      setMode(m)
                      syncFromStorage(storageValue, m)
                    }}
                    className={`rounded-full px-2 py-0.5 ${
                      mode === m ? 'bg-primary text-primary-foreground' : 'text-foreground/70 hover:bg-muted'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded px-2 py-1 text-sm text-foreground/70 hover:bg-background"
              >
                Cancel
              </button>
            </div>

            <div className="mb-4 grid grid-cols-4 grid-rows-4 gap-1.5 sm:gap-2">
              {['7', '8', '9', '⌫', '4', '5', '6'].map((d) =>
                d === '⌫' ? (
                  <button
                    key={d}
                    type="button"
                    onClick={handleBackspace}
                    className="min-h-[40px] rounded-lg border border-border bg-background text-foreground hover:bg-card sm:min-h-[48px]"
                  >
                    ⌫
                  </button>
                ) : (
                  <button
                    key={d}
                    type="button"
                    onClick={() => handleDigit(d)}
                    className="min-h-[40px] rounded-lg border border-border bg-background text-lg text-foreground hover:bg-card sm:min-h-[48px]"
                  >
                    {d}
                  </button>
                )
              )}
              <button
                type="button"
                onClick={handleClear}
                className="row-span-2 min-h-0 rounded-lg border border-border bg-background text-foreground hover:bg-card"
              >
                C
              </button>
              {['1', '2', '3'].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => handleDigit(d)}
                  className="min-h-[40px] rounded-lg border border-border bg-background text-lg text-foreground hover:bg-card sm:min-h-[48px]"
                >
                  {d}
                </button>
              ))}
              <button
                type="button"
                onClick={() => handleDigit('0')}
                className="min-h-[40px] rounded-lg border border-border bg-background text-lg text-foreground hover:bg-card sm:min-h-[48px]"
              >
                0
              </button>
              <button
                type="button"
                onClick={handleDot}
                className="min-h-[40px] rounded-lg border border-border bg-background text-lg text-foreground hover:bg-card sm:min-h-[48px]"
              >
                .
              </button>
              <button
                type="button"
                onClick={handleDone}
                className="col-span-2 min-h-[40px] rounded-lg bg-primary text-primary-foreground hover:opacity-90 sm:min-h-[48px]"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

