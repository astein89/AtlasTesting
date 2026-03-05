import { useEffect, useRef, useState } from 'react'

interface ColumnFilterDropdownProps {
  columnKey: string
  columnLabel: string
  values: string[]
  selected: Set<string>
  onChange: (selected: Set<string>) => void
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement | null | undefined>
}

export function ColumnFilterDropdown({
  columnKey,
  columnLabel,
  values,
  selected,
  onChange,
  onClose,
  anchorRef,
}: ColumnFilterDropdownProps) {
  const [search, setSearch] = useState('')
  const [localSelected, setLocalSelected] = useState(selected)
  const ref = useRef<HTMLDivElement>(null)

  const uniqueValues = [...new Set(values)].filter((v) => v !== '' && v != null).sort()
  const filteredValues = search.trim()
    ? uniqueValues.filter((v) =>
        String(v).toLowerCase().includes(search.toLowerCase())
      )
    : uniqueValues

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose, anchorRef])

  const toggle = (val: string) => {
    setLocalSelected((prev) => {
      const next = new Set(prev)
      if (next.has(val)) next.delete(val)
      else next.add(val)
      return next
    })
  }

  const selectAll = () => {
    setLocalSelected(new Set(filteredValues))
  }

  const clearAll = () => {
    setLocalSelected(new Set())
  }

  const apply = () => {
    onChange(localSelected)
    onClose()
  }

  const clearFilter = () => {
    onChange(new Set())
    onClose()
  }

  const allSelected = filteredValues.length > 0 && filteredValues.every((v) => localSelected.has(v))
  const someSelected = localSelected.size > 0

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full z-50 mt-1 min-w-[200px] max-w-[280px] rounded-lg border border-border bg-card py-2 shadow-lg"
    >
      <div className="border-b border-border px-3 pb-2">
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
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
}
