import { useEffect, useRef, useState } from 'react'
import { getContrastTextColor } from '../../utils/colorContrast'

interface SelectInputProps {
  value: string
  onChange: (value: string) => void
  options: string[]
  className?: string
  placeholder?: string
  /** Optional background color for the selected value (e.g. status colors) */
  valueColor?: string
  /** Optional map of option value -> hex color to show in the dropdown list */
  optionColors?: Record<string, string>
}

export function SelectInput({
  value,
  onChange,
  options,
  className = '',
  placeholder = '(Select)',
  valueColor,
  optionColors,
}: SelectInputProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const select = (opt: string) => {
    onChange(opt)
    setOpen(false)
  }

  const hasColor = value && valueColor
  const triggerStyle = hasColor
    ? { backgroundColor: valueColor, color: getContrastTextColor(valueColor), borderColor: valueColor }
    : undefined

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="min-h-[44px] w-full rounded border border-border bg-background px-3 py-2 text-left text-foreground hover:bg-card"
        style={triggerStyle}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className={!value ? (hasColor ? '' : 'text-foreground/60') : ''}>
          {value ? value : placeholder}
        </span>
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 top-full z-[60] mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-card shadow-lg"
          role="listbox"
        >
          {options.length === 0 ? (
            <p className="p-3 text-center text-sm text-foreground/60">No options</p>
          ) : (
            <div className="divide-y divide-border py-1">
              <button
                type="button"
                onClick={() => select('')}
                className={`block w-full px-3 py-2 text-left text-sm text-foreground/70 hover:bg-background ${
                  !value ? 'bg-primary/10 font-medium' : ''
                }`}
                role="option"
                aria-selected={!value}
              >
                —
              </button>
              {options.map((opt) => {
                const optColor = optionColors?.[opt]
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => select(opt)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-background ${
                      value === opt ? 'bg-primary/10 font-medium' : ''
                    }`}
                    role="option"
                    aria-selected={value === opt}
                  >
                    {optColor ? (
                      <span
                        className="h-3 w-3 shrink-0 rounded-full border border-black/10"
                        style={{ backgroundColor: optColor }}
                        aria-hidden
                      />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">{opt}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
