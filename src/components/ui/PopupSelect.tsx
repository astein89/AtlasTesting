import { useState } from 'react'

export interface PopupSelectOption {
  value: string
  label: string
}

interface PopupSelectProps {
  value: string
  onChange: (value: string) => void
  options: PopupSelectOption[] | string[]
  placeholder?: string
  label?: string
  emptyOption?: string
  className?: string
  id?: string
}

function toOptions(opts: PopupSelectOption[] | string[]): PopupSelectOption[] {
  return opts.map((o) =>
    typeof o === 'string' ? { value: o, label: o } : o
  )
}

export function PopupSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  label,
  emptyOption,
  className = '',
  id,
}: PopupSelectProps) {
  const [open, setOpen] = useState(false)
  const opts = toOptions(options)

  const select = (opt: string) => {
    onChange(opt)
    setOpen(false)
  }

  const displayLabel =
    opts.find((o) => o.value === value)?.label ?? (value || placeholder)

  return (
    <div className={className}>
      {label && (
        <label
          htmlFor={id}
          className="mb-1 block text-sm font-medium text-foreground"
        >
          {label}
        </label>
      )}
      <button
        type="button"
        id={id}
        onClick={() => setOpen(true)}
        className="min-h-[44px] w-full rounded-lg border border-border bg-background px-3 py-2 text-left text-foreground hover:bg-card"
      >
        <span className={!value ? 'text-foreground/60' : ''}>
          {displayLabel}
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-h-[85dvh] max-w-sm overflow-hidden rounded-t-xl border border-border bg-card shadow-lg sm:max-h-[85vh] sm:rounded-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border p-4">
              <span className="text-lg font-medium text-foreground">
                {label || placeholder}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="min-h-[44px] min-w-[44px] rounded px-2 py-1 text-sm text-foreground/70 hover:bg-background"
              >
                Cancel
              </button>
            </div>

            <div className="max-h-[60dvh] overflow-y-auto sm:max-h-[60vh]">
              {opts.length === 0 ? (
                <p className="p-4 text-center text-sm text-foreground/60">
                  No options
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {emptyOption !== undefined && (
                    <button
                      type="button"
                      onClick={() => select('')}
                      className={`flex min-h-[44px] w-full items-center px-4 py-3 text-left text-foreground hover:bg-card ${
                        !value ? 'bg-primary/10 font-medium' : ''
                      }`}
                    >
                      {emptyOption}
                    </button>
                  )}
                  {opts.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => select(opt.value)}
                      className={`flex min-h-[44px] w-full items-center px-4 py-3 text-left text-foreground hover:bg-card ${
                        value === opt.value ? 'bg-primary/10 font-medium' : ''
                      }`}
                    >
                      {opt.label}
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
