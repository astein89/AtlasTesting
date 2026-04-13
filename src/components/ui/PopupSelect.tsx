import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

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
  /** Render dropdown in a portal so it is not clipped by overflow (e.g. inside tables). */
  usePortal?: boolean
  disabled?: boolean
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
  usePortal = false,
  disabled = false,
}: PopupSelectProps) {
  const DROPDOWN_MAX_HEIGHT = 256
  const GAP = 8

  const [open, setOpen] = useState(false)
  const [portalRect, setPortalRect] = useState<{
    top: number
    left: number
    width: number
    openUpward?: boolean
  } | null>(null)
  const [openUpward, setOpenUpward] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const opts = toOptions(options)

  const updatePortalRect = () => {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom - GAP
    const openUp = spaceBelow < DROPDOWN_MAX_HEIGHT
    let top = openUp ? rect.top - DROPDOWN_MAX_HEIGHT - GAP : rect.bottom + GAP
    if (openUp && top < 0) top = 0
    let left = rect.left
    if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width
    if (left < 0) left = 0
    const width = Math.min(rect.width, window.innerWidth - left)
    setPortalRect((prev) => {
      if (
        prev &&
        prev.top === top &&
        prev.left === left &&
        prev.width === width &&
        prev.openUpward === openUp
      ) {
        return prev
      }
      return { top, left, width, openUpward: openUp }
    })
  }

  const updateOpenUpward = () => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom - GAP
      setOpenUpward(spaceBelow < DROPDOWN_MAX_HEIGHT)
    }
  }

  const select = (opt: string) => {
    onChange(opt)
    setOpen(false)
  }

  const displayLabel =
    opts.find((o) => o.value === value)?.label ?? (value || placeholder)

  useEffect(() => {
    if (disabled && open) setOpen(false)
  }, [disabled, open])

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
      const target = e.target as Node
      if (containerRef.current && !containerRef.current.contains(target)) {
        const portalEl = document.getElementById('popup-select-portal-list')
        if (!portalEl?.contains(target)) setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  useLayoutEffect(() => {
    if (!open || !usePortal) {
      setPortalRect(null)
      return
    }
    updatePortalRect()
    const onScrollOrResize = () => updatePortalRect()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open, usePortal])

  useLayoutEffect(() => {
    if (!open || usePortal) return
    updateOpenUpward()
  }, [open, usePortal])

  return (
    <div ref={containerRef} className={`relative min-w-0 ${className}`}>
      {label && (
        <label
          htmlFor={id}
          className="mb-1 block text-sm font-medium text-foreground"
        >
          {label}
        </label>
      )}
      <button
        ref={buttonRef}
        type="button"
        id={id}
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className="min-h-[44px] w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-left text-foreground hover:bg-card disabled:cursor-not-allowed disabled:opacity-70"
        aria-expanded={open}
        aria-haspopup="listbox"
        title={displayLabel}
      >
        <span
          className={`block min-w-0 truncate text-left ${!value ? 'text-foreground/60' : ''}`}
        >
          {displayLabel}
        </span>
      </button>

      {open && !usePortal && (
        <div
          className={`absolute left-0 right-0 z-[60] max-h-64 overflow-y-auto rounded-lg border border-border shadow-xl ring-1 ring-black/5 dark:ring-white/10 ${
            openUpward ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
          style={{ backgroundColor: 'var(--dropdown-list)' }}
          role="listbox"
        >
          {opts.length === 0 ? (
            <p className="p-3 text-center text-sm text-foreground/60">
              No options
            </p>
          ) : (
            <div className="divide-y divide-border py-1">
              {emptyOption !== undefined && (
                <button
                  type="button"
                  onClick={() => select('')}
                  className={`flex min-h-[44px] w-full items-center px-3 py-2 text-left text-sm text-foreground hover:bg-card ${
                    !value ? 'bg-primary/10 font-medium' : ''
                  }`}
                  role="option"
                  aria-selected={!value}
                >
                  {emptyOption}
                </button>
              )}
              {opts.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => select(opt.value)}
                  className={`flex min-h-[44px] w-full min-w-0 items-center px-3 py-2 text-left text-sm text-foreground hover:bg-card ${
                    value === opt.value ? 'bg-primary/10 font-medium' : ''
                  }`}
                  role="option"
                  aria-selected={value === opt.value}
                  title={opt.label}
                >
                  <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {open && usePortal && portalRect && createPortal(
        <div
          id="popup-select-portal-list"
          role="listbox"
          className="fixed z-[100] mt-1 max-h-64 overflow-y-auto rounded-lg border border-border shadow-xl ring-1 ring-black/5 dark:ring-white/10"
          style={{
            backgroundColor: 'var(--dropdown-list)',
            top: portalRect.top + 4,
            left: portalRect.left,
            minWidth: portalRect.width,
          }}
        >
          {opts.length === 0 ? (
            <p className="p-3 text-center text-sm text-foreground/60">
              No options
            </p>
          ) : (
            <div className="divide-y divide-border py-1">
              {emptyOption !== undefined && (
                <button
                  type="button"
                  onClick={() => select('')}
                  className={`flex min-h-[44px] w-full items-center px-3 py-2 text-left text-sm text-foreground hover:bg-card ${
                    !value ? 'bg-primary/10 font-medium' : ''
                  }`}
                  role="option"
                  aria-selected={!value}
                >
                  {emptyOption}
                </button>
              )}
              {opts.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => select(opt.value)}
                  className={`flex min-h-[44px] w-full min-w-0 items-center px-3 py-2 text-left text-sm text-foreground hover:bg-card ${
                    value === opt.value ? 'bg-primary/10 font-medium' : ''
                  }`}
                  role="option"
                  aria-selected={value === opt.value}
                  title={opt.label}
                >
                  <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
