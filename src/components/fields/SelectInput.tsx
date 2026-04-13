import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getContrastTextColor } from '../../utils/colorContrast'

const DROPDOWN_MAX_HEIGHT = 256
const GAP = 8
const VIEWPORT_MARGIN = 4

interface SelectInputProps {
  value: string
  onChange: (value: string) => void
  options: string[]
  className?: string
  placeholder?: string
  /** Label for the empty value row (value stored as ''). Default None. */
  emptyOptionLabel?: string
  /** Optional background color for the selected value (e.g. status colors) */
  valueColor?: string
  /** Optional map of option value -> hex color to show in the dropdown list */
  optionColors?: Record<string, string>
}

type PortalPlacement = {
  top: number
  left: number
  width: number
  maxHeight: number
}

/** Visible layout viewport rect (accounts for mobile URL bar / pinch via VisualViewport). */
function getVisibleViewportRect(): { top: number; left: number; bottom: number; right: number } {
  const vv = window.visualViewport
  if (vv) {
    return {
      top: vv.offsetTop + VIEWPORT_MARGIN,
      left: vv.offsetLeft + VIEWPORT_MARGIN,
      bottom: vv.offsetTop + vv.height - VIEWPORT_MARGIN,
      right: vv.offsetLeft + vv.width - VIEWPORT_MARGIN,
    }
  }
  return {
    top: VIEWPORT_MARGIN,
    left: VIEWPORT_MARGIN,
    bottom: window.innerHeight - VIEWPORT_MARGIN,
    right: window.innerWidth - VIEWPORT_MARGIN,
  }
}

function computePortalPlacement(rect: DOMRect): PortalPlacement {
  const vp = getVisibleViewportRect()

  let left = rect.left
  let width = rect.width
  if (left + width > vp.right) left = Math.max(vp.left, vp.right - width)
  if (left < vp.left) left = vp.left
  width = Math.min(width, vp.right - left)

  const rawBelow = vp.bottom - rect.bottom - GAP
  const rawAbove = rect.top - vp.top - GAP
  const maxHeightBelow = Math.min(DROPDOWN_MAX_HEIGHT, Math.max(0, rawBelow))
  const maxHeightAbove = Math.min(DROPDOWN_MAX_HEIGHT, Math.max(0, rawAbove))

  const openBelow =
    maxHeightBelow >= DROPDOWN_MAX_HEIGHT ||
    (maxHeightBelow >= maxHeightAbove && maxHeightBelow > 0) ||
    maxHeightAbove <= 0

  if (openBelow && maxHeightBelow > 0) {
    const top = rect.bottom + GAP
    const maxHeight = Math.min(maxHeightBelow, vp.bottom - top)
    return { top, left, width, maxHeight: Math.max(maxHeight, 1) }
  }

  if (maxHeightAbove > 0) {
    let maxHeight = Math.min(maxHeightAbove, DROPDOWN_MAX_HEIGHT)
    let top = rect.top - GAP - maxHeight
    if (top < vp.top) {
      maxHeight = Math.max(1, Math.min(maxHeight, rect.top - vp.top - GAP))
      top = Math.max(vp.top, rect.top - GAP - maxHeight)
    }
    return { top, left, width, maxHeight }
  }

  // Fallback: pin to visible bottom edge (keyboard / tiny band)
  const maxHeight = Math.min(DROPDOWN_MAX_HEIGHT, Math.max(1, vp.bottom - rect.bottom - GAP))
  return { top: rect.bottom + GAP, left, width, maxHeight }
}

export function SelectInput({
  value,
  onChange,
  options,
  className = '',
  placeholder = '(Select)',
  emptyOptionLabel = 'None',
  valueColor,
  optionColors,
}: SelectInputProps) {
  const [open, setOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [portalPlacement, setPortalPlacement] = useState<PortalPlacement | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const highlightIndexRef = useRef(0)
  const listDomId = useId()

  highlightIndexRef.current = highlightIndex

  /** Empty + options, same order as the dropdown list */
  const allOptionValues = useMemo(() => ['', ...options], [options])

  const select = (opt: string) => {
    onChange(opt)
    setOpen(false)
  }

  const moveValueByArrow = (delta: number) => {
    const len = allOptionValues.length
    if (len === 0) return
    const idx = allOptionValues.findIndex((v) => v === value)
    const current = idx >= 0 ? idx : 0
    const next = ((current + delta) % len + len) % len
    onChange(allOptionValues[next])
  }

  const hasColor = value && valueColor
  const triggerStyle = hasColor
    ? { backgroundColor: valueColor, color: getContrastTextColor(valueColor), borderColor: valueColor }
    : undefined

  const updatePlacement = () => {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    setPortalPlacement(computePortalPlacement(rect))
  }

  useEffect(() => {
    if (!open) return
    const idx = allOptionValues.findIndex((v) => v === value)
    setHighlightIndex(idx >= 0 ? idx : 0)
  }, [open, allOptionValues, value])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        return
      }
      const len = allOptionValues.length
      if (len === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlightIndex((i) => (i + 1) % len)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlightIndex((i) => (i - 1 + len) % len)
        return
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        const chosen = allOptionValues[highlightIndexRef.current]
        if (chosen !== undefined) {
          onChange(chosen)
          setOpen(false)
        }
        return
      }
      if (e.key === 'Home') {
        e.preventDefault()
        setHighlightIndex(0)
        return
      }
      if (e.key === 'End') {
        e.preventDefault()
        setHighlightIndex(len - 1)
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, allOptionValues, onChange])

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (containerRef.current?.contains(target)) return
      if (listRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  useLayoutEffect(() => {
    if (!open) {
      setPortalPlacement(null)
      return
    }
    updatePlacement()
    const onScrollOrResize = () => updatePlacement()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    const vv = window.visualViewport
    vv?.addEventListener('resize', onScrollOrResize)
    vv?.addEventListener('scroll', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
      vv?.removeEventListener('resize', onScrollOrResize)
      vv?.removeEventListener('scroll', onScrollOrResize)
    }
  }, [open])

  const dropdownContent = (
    <>
      {options.length === 0 ? (
        <p className="p-3 text-center text-sm text-foreground/60">No options</p>
      ) : (
        <div className="divide-y divide-border py-1">
          <button
            type="button"
            onClick={() => select('')}
            className={`block w-full min-w-0 truncate px-3 py-2 text-left text-sm text-foreground/70 hover:bg-background ${
              !value ? 'bg-primary/10 font-medium' : ''
            } ${open && highlightIndex === 0 ? 'bg-primary/15 ring-1 ring-inset ring-primary/40' : ''}`}
            role="option"
            aria-selected={!value}
            title={emptyOptionLabel}
          >
            {emptyOptionLabel}
          </button>
          {options.map((opt, optIdx) => {
            const flatIndex = optIdx + 1
            const optColor = optionColors?.[opt]
            return (
              <button
                key={opt}
                type="button"
                onClick={() => select(opt)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-background ${
                  value === opt ? 'bg-primary/10 font-medium' : ''
                } ${open && highlightIndex === flatIndex ? 'bg-primary/15 ring-1 ring-inset ring-primary/40' : ''}`}
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
    </>
  )

  const listbox =
    open && portalPlacement ? (
      <div
        ref={listRef}
        id={listDomId}
        role="listbox"
        className="fixed z-[200] overflow-y-auto rounded-lg border border-border shadow-xl ring-1 ring-black/5 dark:ring-white/10"
        style={{
          backgroundColor: 'var(--dropdown-list)',
          top: portalPlacement.top,
          left: portalPlacement.left,
          width: portalPlacement.width,
          maxHeight: portalPlacement.maxHeight,
        }}
      >
        {dropdownContent}
      </div>
    ) : null

  const triggerLabel = value ? value : placeholder

  return (
    <div ref={containerRef} className={`relative min-w-0 ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (open) return
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            moveValueByArrow(e.key === 'ArrowDown' ? 1 : -1)
          }
        }}
        className="flex min-h-[44px] min-w-0 w-full items-center rounded border border-border bg-background px-3 py-2 text-left text-foreground hover:bg-card"
        style={triggerStyle}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listDomId : undefined}
        title={triggerLabel}
      >
        <span
          className={`min-w-0 flex-1 truncate text-left ${!value ? (hasColor ? '' : 'text-foreground/60') : ''}`}
        >
          {triggerLabel}
        </span>
      </button>

      {typeof document !== 'undefined' && listbox ? createPortal(listbox, document.body) : null}
    </div>
  )
}
