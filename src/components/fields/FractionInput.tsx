import { useEffect, useState } from 'react'
import {
  formatDecimalAsFraction,
  fractionToDecimal,
  getFractionOptions,
  FRACTION_SCALES,
  type FractionScale,
} from '../../utils/fraction'

interface FractionInputProps {
  value: number
  onChange: (value: number) => void
  className?: string
  /** Default scale from field config (2, 4, 8, 16, 32, 64, 128) */
  defaultScale?: FractionScale
}

function inferScale(value: number, defaultScale: FractionScale): FractionScale {
  const remainder = value - Math.floor(value)
  if (remainder === 0) return defaultScale
  // Prefer defaultScale if the value can be represented in it
  const defaultParts = remainder * defaultScale
  if (Math.abs(defaultParts - Math.round(defaultParts)) < 1e-10) return defaultScale
  // Otherwise find the coarsest scale that fits (prefer simpler denominators)
  for (const scale of [...FRACTION_SCALES].reverse()) {
    const parts = remainder * scale
    if (Math.abs(parts - Math.round(parts)) < 1e-10) return scale
  }
  return 128
}

export function FractionInput({ value, onChange, className = '', defaultScale = 16 }: FractionInputProps) {
  const [open, setOpen] = useState(false)
  const [wholePart, setWholePart] = useState('')
  const [fracPart, setFracPart] = useState<{ num: number; denom: number } | null>(null)
  const [scale, setScale] = useState<FractionScale>(defaultScale)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  const openKeypad = () => {
    const whole = Math.floor(value)
    const remainder = value - whole
    const inferredScale = remainder > 0 ? inferScale(value, defaultScale) : defaultScale
    setScale(inferredScale)
    const parts = Math.round(remainder * inferredScale)
    setWholePart(whole > 0 ? String(whole) : '')
    setFracPart(parts > 0 ? { num: parts, denom: inferredScale } : null)
    setOpen(true)
  }

  const getCurrentValue = () => {
    const whole = parseFloat(wholePart || '0') || 0
    const frac = fracPart ? fractionToDecimal(fracPart.num, fracPart.denom) : 0
    return whole + frac
  }

  const applyValue = () => {
    onChange(getCurrentValue())
  }

  const handleDigit = (d: string) => {
    setWholePart((p) => (p === '0' && d === '0' ? '0' : p + d))
  }

  const handleBackspace = () => {
    setWholePart((p) => p.slice(0, -1))
  }

  const handleClear = () => {
    setWholePart('')
    setFracPart(null)
  }

  const handleFraction = (num: number, denom: number) => {
    setFracPart(num === denom ? null : { num, denom })
  }

  const handleDone = () => {
    applyValue()
    setOpen(false)
  }

  const displayValue = open ? formatDecimalAsFraction(getCurrentValue()) : formatDecimalAsFraction(value)

  return (
    <div className={className}>
      <button
        type="button"
        onClick={openKeypad}
        className="min-h-[44px] w-full rounded border border-border bg-background px-3 py-2 text-left text-foreground hover:bg-card"
      >
        {value === 0 && !open ? 'Click to enter' : (displayValue || '0')}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-border bg-card p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="text-lg font-medium text-foreground">
                {displayValue || '0'}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded px-2 py-1 text-sm text-foreground/70 hover:bg-background"
              >
                Cancel
              </button>
            </div>

            <div className="mb-4 grid grid-cols-4 grid-rows-4 gap-2">
              {['7', '8', '9', '⌫', '4', '5', '6'].map((d) =>
                d === '⌫' ? (
                  <button
                    key={d}
                    type="button"
                    onClick={handleBackspace}
                    className="min-h-[48px] rounded-lg border border-border bg-background text-foreground hover:bg-card"
                  >
                    ⌫
                  </button>
                ) : (
                  <button
                    key={d}
                    type="button"
                    onClick={() => handleDigit(d)}
                    className="min-h-[48px] rounded-lg border border-border bg-background text-lg text-foreground hover:bg-card"
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
                  className="min-h-[48px] rounded-lg border border-border bg-background text-lg text-foreground hover:bg-card"
                >
                  {d}
                </button>
              ))}
              <button
                type="button"
                onClick={() => handleDigit('0')}
                className="col-span-2 min-h-[48px] rounded-lg border border-border bg-background text-lg text-foreground hover:bg-card"
              >
                0
              </button>
              <button
                type="button"
                onClick={handleDone}
                className="col-span-2 min-h-[48px] rounded-lg bg-primary text-primary-foreground hover:opacity-90"
              >
                Done
              </button>
            </div>

            <div
              className={`rounded-lg border border-border bg-background p-2 ${
                scale < 16
                  ? 'overflow-hidden'
                  : scale === 16
                    ? 'min-h-[13.5rem] overflow-hidden'
                    : 'max-h-48 overflow-y-auto'
              }`}
            >
              <div className="grid grid-cols-4 gap-1.5">
                {getFractionOptions(scale).map((opt) => (
                  <button
                    key={`${opt.num}/${opt.denom}`}
                    type="button"
                    onClick={() => handleFraction(opt.num, opt.denom)}
                    className="min-h-[44px] rounded border border-border px-2 py-2 text-sm text-foreground hover:bg-card"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

