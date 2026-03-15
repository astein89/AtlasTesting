import { useEffect, useState } from 'react'
import {
  formatDecimalAsFraction,
  formatDecimalAsFractionWithScale,
  fractionToDecimal,
  getFractionOptions,
  roundToFractionScale,
  type FractionScale,
} from '../../utils/fraction'

interface FractionInputProps {
  value: number
  onChange: (value: number) => void
  className?: string
  /** Default scale from field config (2, 4, 8, 16, 32, 64, 128) */
  defaultScale?: FractionScale
  /** Base storage unit for this field: 'in' for inches, 'mm' for millimetres. Defaults to 'in'. */
  storageUnit?: 'in' | 'mm'
  /** Default unit when opening the keypad. If not set, uses storageUnit. */
  entryUnit?: 'in' | 'mm'
}

export function FractionInput({
  value,
  onChange,
  className = '',
  defaultScale = 16,
  storageUnit = 'in',
  entryUnit,
}: FractionInputProps) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'in' | 'mm'>((entryUnit ?? storageUnit) === 'mm' ? 'mm' : 'in')
  const [wholePart, setWholePart] = useState('')
  const [fracPart, setFracPart] = useState<{ num: number; denom: number } | null>(null)
  const [scale, setScale] = useState<FractionScale>(defaultScale)
  /** When set, use this exact remainder (in inches) for getCurrentValue() in 'in' mode so unit switch preserves value. */
  const [exactRemainder, setExactRemainder] = useState<number | null>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  // Initialize keypad from a storage value (used when opening the modal or switching unit).
  const syncInputsFromStorage = (nextMode: 'in' | 'mm', storage: number) => {
    if (nextMode === 'mm') {
      const mmValue = storageUnit === 'in' ? storage * 25.4 : storage
      const rounded = Number.isFinite(mmValue) ? mmValue : 0
      setWholePart(rounded ? String(rounded) : '')
      setFracPart(null)
      setExactRemainder(null)
    } else {
      const baseInches = storageUnit === 'mm' ? storage / 25.4 : storage
      const whole = Math.floor(baseInches)
      const remainder = baseInches - whole
      setScale(defaultScale)
      const parts = Math.round(remainder * defaultScale)
      setWholePart(whole > 0 ? String(whole) : '')
      setFracPart(parts > 0 ? { num: parts, denom: defaultScale } : null)
      setExactRemainder(remainder)
    }
  }

  const openKeypad = () => {
    const initialMode: 'in' | 'mm' = (entryUnit ?? storageUnit) === 'mm' ? 'mm' : 'in'
    setMode(initialMode)
    const storage = Number.isFinite(value) ? value : 0
    syncInputsFromStorage(initialMode, storage)
    setOpen(true)
  }

  const getCurrentValue = () => {
    if (mode === 'mm') {
      const mm = parseFloat(wholePart || '0') || 0
      if (!Number.isFinite(mm)) return 0
      return storageUnit === 'in' ? mm / 25.4 : mm
    }
    const whole = parseFloat(wholePart || '0') || 0
    const frac =
      exactRemainder !== null ? exactRemainder : fracPart ? fractionToDecimal(fracPart.num, fracPart.denom) : 0
    const inches = whole + frac
    if (storageUnit === 'mm') {
      return inches * 25.4
    }
    return inches
  }

  const applyValue = () => {
    onChange(getCurrentValue())
  }

  const handleDigit = (d: string) => {
    setExactRemainder(null)
    setWholePart((p) => (p === '0' && d === '0' ? '0' : p + d))
  }

  const handleDot = () => {
    setExactRemainder(null)
    setWholePart((p) => {
      const current = p || '0'
      return current.includes('.') ? current : current + '.'
    })
  }

  const handleBackspace = () => {
    setExactRemainder(null)
    setWholePart((p) => p.slice(0, -1))
  }

  const handleClear = () => {
    setWholePart('')
    setFracPart(null)
    setExactRemainder(null)
  }

  const handleFraction = (num: number, denom: number) => {
    setFracPart(num === denom ? null : { num, denom })
    setExactRemainder(null)
  }

  const handleDone = () => {
    applyValue()
    setOpen(false)
  }

  const storageVal = Number.isFinite(value) ? value : 0
  const inchesVal = storageUnit === 'in' ? storageVal : storageVal / 25.4
  const mmVal = storageUnit === 'mm' ? storageVal : storageVal * 25.4

  // Only show "~" when we display inches and the value is rounded to the field's fraction scale.
  // Never show "~" when storage is mm or when the modal is displaying in mm.
  const isRoundedInInches =
    storageUnit === 'in' &&
    Math.abs(inchesVal - roundToFractionScale(inchesVal, defaultScale)) > 1e-10
  const isRounded = isRoundedInInches
  const isRoundedInModal = isRoundedInInches && (mode === 'in' || !open)
  const exactTooltip = isRounded
    ? `Exact: ${Number(storageVal.toFixed(10))} ${storageUnit === 'mm' ? 'mm' : 'in'}`
    : ''

  const formatMm = (n: number) => {
    if (!Number.isFinite(n)) return ''
    if (Math.abs(n) >= 1000) return n.toFixed(0)
    if (Math.abs(n) >= 100) return n.toFixed(1)
    return n.toFixed(2)
  }

  // Outside the popup, always show the value in the field's storage unit (no conversion UI).
  const displayValueStorage =
    storageUnit === 'mm'
      ? formatMm(mmVal)
      : formatDecimalAsFractionWithScale(inchesVal, scale)

  // Inside the selector modal, show the live value based on the current keypad state and mode.
  const displayValueModal = (() => {
    if (!open) {
      return storageUnit === 'mm'
        ? formatMm(mmVal)
        : formatDecimalAsFractionWithScale(inchesVal, scale)
    }
    if (mode === 'mm') {
      const curStorage = getCurrentValue()
      const curMm = storageUnit === 'mm' ? curStorage : curStorage * 25.4
      return formatMm(curMm)
    }
    // mode === 'in'
    const curStorage = getCurrentValue()
    const curInches = storageUnit === 'in' ? curStorage : curStorage / 25.4
    return formatDecimalAsFractionWithScale(curInches, scale)
  })()

  const storageUnitLabel = storageUnit === 'mm' ? ' mm' : ' in'

  return (
    <div className={className}>
      <button
        type="button"
        onClick={openKeypad}
        className="min-h-[44px] w-full min-w-0 rounded border border-border bg-background px-3 py-2 text-left text-foreground hover:bg-card"
        title={exactTooltip || undefined}
      >
        <span className="inline-block max-w-full truncate align-middle">
          {isRounded && value !== 0 && '~ '}{!open && value === 0 ? 'Click to enter' : (displayValueStorage || '0')}
          {value === 0 && !open ? '' : storageUnitLabel}
        </span>
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
              <span
                className="text-lg font-medium text-foreground"
                title={exactTooltip || undefined}
              >
                {isRoundedInModal ? '~ ' : ''}{displayValueModal || '0'} {mode === 'mm' ? 'mm' : 'in'}
              </span>
              <div className="flex items-center gap-1 rounded-full border border-border bg-background px-1 py-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    // Preserve current unsaved value when toggling modes.
                    const curStorage = getCurrentValue()
                    syncInputsFromStorage('in', curStorage)
                    setMode('in')
                  }}
                  className={`rounded-full px-2 py-0.5 ${mode === 'in' ? 'bg-primary text-primary-foreground' : 'text-foreground/70 hover:bg-muted'}`}
                >
                  in
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const curStorage = getCurrentValue()
                    syncInputsFromStorage('mm', curStorage)
                    setMode('mm')
                  }}
                  className={`rounded-full px-2 py-0.5 ${mode === 'mm' ? 'bg-primary text-primary-foreground' : 'text-foreground/70 hover:bg-muted'}`}
                >
                  mm
                </button>
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
              {mode === 'mm' ? (
                <>
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
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => handleDigit('0')}
                    className="col-span-2 min-h-[40px] rounded-lg border border-border bg-background text-lg text-foreground hover:bg-card sm:min-h-[48px]"
                  >
                    0
                  </button>
                  <button
                    type="button"
                    onClick={handleDone}
                    className="col-span-2 min-h-[40px] rounded-lg bg-primary text-primary-foreground hover:opacity-90 sm:min-h-[48px]"
                  >
                    Done
                  </button>
                </>
              )}
            </div>

            {mode === 'in' && (
              <div
                className={`shrink-0 rounded-lg border border-border bg-background p-2 ${
                  scale < 16
                    ? 'overflow-hidden'
                    : scale === 16
                      ? 'min-h-[10rem] overflow-hidden sm:min-h-[13.5rem]'
                      : 'max-h-36 overflow-y-auto sm:max-h-48'
                }`}
              >
                <div className="grid grid-cols-4 gap-1 sm:gap-1.5">
                  {getFractionOptions(scale).map((opt) => (
                    <button
                      key={`${opt.num}/${opt.denom}`}
                      type="button"
                      onClick={() => handleFraction(opt.num, opt.denom)}
                      className="min-h-[36px] rounded border border-border px-1.5 py-1.5 text-xs text-foreground hover:bg-card sm:min-h-[44px] sm:px-2 sm:py-2 sm:text-sm"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

