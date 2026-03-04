import { useState } from 'react'

interface SelectInputProps {
  value: string
  onChange: (value: string) => void
  options: string[]
  className?: string
  placeholder?: string
}

export function SelectInput({
  value,
  onChange,
  options,
  className = '',
  placeholder = 'Click to select',
}: SelectInputProps) {
  const [open, setOpen] = useState(false)

  const select = (opt: string) => {
    onChange(opt)
    setOpen(false)
  }

  const displayValue = value ? value : placeholder

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[44px] w-full rounded border border-border bg-background px-3 py-2 text-left text-foreground hover:bg-card"
      >
        <span className={!value ? 'text-foreground/60' : ''}>
          {value ? value : placeholder}
        </span>
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
                {value ? value : placeholder}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded px-2 py-1 text-sm text-foreground/70 hover:bg-background"
              >
                Cancel
              </button>
            </div>

            <div className="max-h-64 overflow-y-auto rounded-lg border border-border bg-background">
              {options.length === 0 ? (
                <p className="p-4 text-center text-sm text-foreground/60">No options</p>
              ) : (
                <div className="divide-y divide-border">
                  <button
                    type="button"
                    onClick={() => select('')}
                    className={`block w-full px-4 py-3 text-left text-foreground/70 hover:bg-card ${
                      !value ? 'bg-primary/10 font-medium' : ''
                    }`}
                  >
                    —
                  </button>
                  {options.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => select(opt)}
                      className={`block w-full px-4 py-3 text-left text-foreground hover:bg-card ${
                        value === opt ? 'bg-primary/10 font-medium' : ''
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
