import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { parseFormattedFraction } from '../../utils/fraction'

/** Dedupe, drop blanks, sort — must match the list shown in the dropdown. */
function buildUniqueColumnFilterValues(
  values: string[],
  valueType?: 'fraction' | 'number'
): string[] {
  const uniq = [...new Set(values)].filter((v) => v !== '' && v != null) as string[]
  if (valueType === 'fraction') {
    return uniq.sort((a, b) => {
      const na = parseFormattedFraction(a)
      const nb = parseFormattedFraction(b)
      if (Number.isNaN(na) && Number.isNaN(nb)) return String(a).localeCompare(String(b))
      if (Number.isNaN(na)) return 1
      if (Number.isNaN(nb)) return -1
      return na - nb
    })
  }
  if (valueType === 'number') {
    return uniq.sort((a, b) => {
      const na = parseFloat(a)
      const nb = parseFloat(b)
      if (Number.isNaN(na) && Number.isNaN(nb)) return String(a).localeCompare(String(b))
      if (Number.isNaN(na)) return 1
      if (Number.isNaN(nb)) return -1
      return na - nb
    })
  }
  return uniq.sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }))
}

function selectionCoversAllValues(selected: Set<string>, all: string[]): boolean {
  return all.length > 0 && selected.size === all.length && all.every((v) => selected.has(v))
}

interface ColumnFilterDropdownProps {
  columnKey: string
  columnLabel: string
  values: string[]
  selected: Set<string>
  onChange: (selected: Set<string>) => void
  onClose: () => void
  /**
   * Preferred: stable ref object from useRef + key (avoids new ref identity each parent render).
   */
  tableAnchorRefs?: React.MutableRefObject<Record<string, HTMLElement | null>>
  tableAnchorKey?: string
  /** @deprecated Prefer tableAnchorRefs + tableAnchorKey; inline `{ current: el }` reruns layout every render. */
  anchorRef?: React.RefObject<HTMLElement | null | undefined>
  /** When set, sort list by numeric value (smallest to largest) instead of string order */
  valueType?: 'fraction' | 'number'
}

export function ColumnFilterDropdown({
  columnKey,
  columnLabel,
  values,
  selected,
  onChange,
  onClose,
  tableAnchorRefs,
  tableAnchorKey,
  anchorRef,
  valueType,
}: ColumnFilterDropdownProps) {
  const [search, setSearch] = useState('')
  /** No saved filter: default every faceted value checked (matches current table result set). */
  const [localSelected, setLocalSelected] = useState<Set<string>>(() => {
    if (selected.size > 0) return new Set(selected)
    return new Set(buildUniqueColumnFilterValues(values, valueType))
  })
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const ref = useRef<HTMLDivElement>(null)

  const resolveAnchor = useCallback((): HTMLElement | null => {
    if (tableAnchorRefs && tableAnchorKey != null) {
      return tableAnchorRefs.current[tableAnchorKey] ?? null
    }
    return anchorRef?.current ?? null
  }, [tableAnchorRefs, tableAnchorKey, anchorRef])

  const uniqueValues = useMemo(
    () => buildUniqueColumnFilterValues(values, valueType),
    [values, valueType]
  )

  const searchLower = search.trim().toLowerCase()
  const filteredValues = useMemo(() => {
    if (!searchLower) return uniqueValues
    return uniqueValues.filter((v) => String(v).toLowerCase().includes(searchLower))
  }, [uniqueValues, searchLower])

  const updatePosition = useCallback(() => {
    const anchor = resolveAnchor()
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const dropdownWidth = 280
    const dropdownHeight = 320
    const gap = 4
    let left = rect.left
    let top = rect.bottom + gap
    if (left + dropdownWidth > window.innerWidth) left = window.innerWidth - dropdownWidth
    if (left < 0) left = 0
    if (top + dropdownHeight > window.innerHeight) top = Math.max(0, rect.top - dropdownHeight - gap)
    setPosition({ top, left })
  }, [resolveAnchor])

  useLayoutEffect(() => {
    let cancelled = false
    let attempts = 0
    const maxAttempts = 12
    const run = () => {
      if (cancelled) return
      const anchor = resolveAnchor()
      if (!anchor) {
        attempts += 1
        if (attempts < maxAttempts) {
          requestAnimationFrame(run)
        }
        return
      }
      updatePosition()
    }
    run()
    return () => {
      cancelled = true
    }
  }, [resolveAnchor, columnKey, tableAnchorKey, uniqueValues.length, updatePosition])

  useEffect(() => {
    const onScrollOrResize = () => updatePosition()
    window.addEventListener('resize', onScrollOrResize)
    window.addEventListener('scroll', onScrollOrResize, true)
    return () => {
      window.removeEventListener('resize', onScrollOrResize)
      window.removeEventListener('scroll', onScrollOrResize, true)
    }
  }, [updatePosition])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const anchor = resolveAnchor()
      if (
        ref.current &&
        !ref.current.contains(e.target as Node) &&
        anchor &&
        !anchor.contains(e.target as Node)
      ) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose, resolveAnchor])

  const toggle = useCallback((val: string) => {
    setLocalSelected((prev) => {
      const next = new Set(prev)
      if (next.has(val)) next.delete(val)
      else next.add(val)
      return next
    })
  }, [])

  const selectAll = () => {
    setLocalSelected(new Set(filteredValues))
  }

  const clearAll = () => {
    setLocalSelected(new Set())
  }

  const apply = () => {
    const next = selectionCoversAllValues(localSelected, uniqueValues)
      ? new Set<string>()
      : localSelected
    onChange(next)
    onClose()
  }

  const clearFilter = () => {
    onChange(new Set())
    onClose()
  }

  const someSelected = localSelected.size > 0

  const dropdown = (
    <div
      ref={ref}
      className="fixed z-[100] min-w-[200px] max-w-[280px] rounded-lg border border-border py-2 shadow-xl ring-1 ring-black/5 dark:ring-white/10"
      style={{
        backgroundColor: 'var(--dropdown-list)',
        top: position.top,
        left: position.left,
      }}
    >
      <div className="border-b border-border px-3 pb-2">
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={`Filter ${columnLabel}`}
          className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-foreground/50"
          autoFocus
        />
      </div>
      <div className="flex gap-1 px-2 py-1">
        <button
          type="button"
          onClick={selectAll}
          className="text-xs text-primary hover:underline"
        >
          Select all
        </button>
        <button
          type="button"
          onClick={clearAll}
          className="text-xs text-foreground/70 hover:underline"
        >
          Clear
        </button>
      </div>
      <div className="max-h-[200px] overflow-y-auto px-2">
        {filteredValues.length === 0 ? (
          <p className="py-2 text-center text-sm text-foreground/60">No matches</p>
        ) : (
          <div className="space-y-0.5 py-1">
            {filteredValues.map((val) => (
              <label
                key={val}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-background"
              >
                <input
                  type="checkbox"
                  checked={localSelected.has(val)}
                  onChange={() => toggle(val)}
                  className="h-4 w-4"
                />
                <span className="truncate text-sm text-foreground">{String(val)}</span>
              </label>
            ))}
          </div>
        )}
      </div>
      <div className="flex justify-between gap-2 border-t border-border px-3 pt-2">
        {someSelected ? (
          <button
            type="button"
            onClick={clearFilter}
            className="text-sm text-foreground/70 hover:underline"
          >
            Clear filter
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={apply}
          className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground hover:opacity-90"
        >
          OK
        </button>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(dropdown, document.body) : dropdown
}
