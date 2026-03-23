import { useEffect, useMemo, useRef, useState } from 'react'
import { ColumnFilterDropdown } from './ColumnFilterDropdown'
import { useUserPreference } from '../../hooks/useUserPreference'

export interface SimpleColumn<Row> {
  key: string
  label: string
  /** Return a plain string for searching/filtering/sorting and rendering. */
  getValue: (row: Row) => string
  /** Optional: fixed width for <col>. */
  width?: string
  /** Optional: custom cell renderer. */
  render?: (row: Row) => React.ReactNode
}

interface SimpleDataTableProps<Row> {
  /** Unique key used to persist hidden columns / filters. */
  preferenceKey: string
  columns: Array<SimpleColumn<Row>>
  rows: Row[]
  /** Optional row click handler. */
  onRowClick?: (row: Row) => void
  /** Optional: row key extractor (defaults to array index). */
  getRowKey?: (row: Row, idx: number) => string
  /** Optional: enable drag-and-drop row reordering. */
  enableRowReorder?: boolean
  /** Required when enableRowReorder is true. */
  onReorder?: (orderedKeys: string[]) => void | Promise<void>
  /** Disable header-click sorting (useful for ordered lists). */
  disableSort?: boolean
  /** Disable search + column filters (useful for drag reorder lists). */
  disableSearchAndFilters?: boolean
  /** Optional: enable multi-row selection with checkboxes. */
  enableSelection?: boolean
  /** Controlled selected row keys. Required when enableSelection is true. */
  selectedKeys?: Set<string>
  /** Called when selection changes. Required when enableSelection is true. */
  onSelectedKeysChange?: (next: Set<string>) => void
  /**
   * When true, the component is a flex column: search/filters stay fixed and only the table
   * area scrolls. Use inside a parent with bounded height (e.g. flex-1 min-h-0).
   */
  fillViewportHeight?: boolean
  /**
   * Called when search/column filters or the filtered row list changes (not on sort-only changes).
   * Use for export flows that distinguish “all rows” vs “visible filtered rows”.
   */
  onFilterSnapshotChange?: (snapshot: { hasActiveFilters: boolean; filteredRows: Row[] }) => void
}

export function SimpleDataTable<Row>({
  preferenceKey,
  columns,
  rows,
  onRowClick,
  getRowKey,
  enableRowReorder,
  onReorder,
  disableSort,
  disableSearchAndFilters,
  enableSelection,
  selectedKeys,
  onSelectedKeysChange,
  fillViewportHeight = false,
  onFilterSnapshotChange,
}: SimpleDataTableProps<Row>) {
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState<string>(disableSort ? '' : (columns[0]?.key ?? ''))
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const [hiddenColumnKeys, setHiddenColumnKeys] = useUserPreference<string[]>(
    `${preferenceKey}-hidden-columns`,
    []
  )
  const [columnFilters, setColumnFilters] = useUserPreference<Record<string, string[]>>(
    `${preferenceKey}-filters`,
    {}
  )
  const [openFilterColumn, setOpenFilterColumn] = useState<string | null>(null)
  const filterAnchorRefs = useRef<Record<string, HTMLTableCellElement | null>>({})
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)

  const visibleColumns = useMemo(() => {
    if (disableSearchAndFilters) return columns
    return columns.filter((c) => !hiddenColumnKeys.includes(c.key))
  }, [columns, hiddenColumnKeys, disableSearchAndFilters])

  const filterSets = useMemo(() => {
    const out: Record<string, Set<string>> = {}
    for (const [k, v] of Object.entries(columnFilters)) out[k] = new Set(v)
    return out
  }, [columnFilters])

  const filteredRows = useMemo(() => {
    let out = rows
    if (disableSearchAndFilters) return out
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      out = out.filter((r) =>
        columns.some((c) => c.getValue(r).toLowerCase().includes(q))
      )
    }
    for (const [k, allowed] of Object.entries(filterSets)) {
      if (allowed.size === 0) continue
      const col = columns.find((c) => c.key === k)
      if (!col) continue
      out = out.filter((r) => allowed.has(col.getValue(r)))
    }
    if (sortKey && !disableSort) {
      const col = columns.find((c) => c.key === sortKey)
      if (col) {
        const dir = sortDir === 'asc' ? 1 : -1
        out = [...out].sort((a, b) => dir * col.getValue(a).localeCompare(col.getValue(b)))
      }
    }
    return out
  }, [rows, columns, searchQuery, filterSets, sortKey, sortDir, disableSort, disableSearchAndFilters])

  const displayRows = filteredRows
  const displayRowKeys = useMemo(
    () => displayRows.map((r, i) => (getRowKey ? getRowKey(r, i) : String(i))),
    [displayRows, getRowKey]
  )
  const selection = selectedKeys ?? new Set<string>()
  const displayAllSelected =
    enableSelection && displayRowKeys.length > 0 && displayRowKeys.every((k) => selection.has(k))

  const hasActiveFilters =
    !disableSearchAndFilters &&
    (searchQuery.trim() !== '' || Object.values(filterSets).some((s) => s.size > 0))

  useEffect(() => {
    if (!onFilterSnapshotChange) return
    onFilterSnapshotChange({
      hasActiveFilters,
      filteredRows: displayRows,
    })
  }, [hasActiveFilters, displayRows, onFilterSnapshotChange])

  const getColumnValues = (key: string): string[] => {
    const col = columns.find((c) => c.key === key)
    if (!col) return []
    return rows.map((r) => col.getValue(r))
  }

  const toggleHidden = (key: string) => {
    setHiddenColumnKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }

  const clearAllFilters = () => {
    setSearchQuery('')
    setColumnFilters({})
    setOpenFilterColumn(null)
  }

  const rootClass = fillViewportHeight
    ? 'flex min-h-0 flex-1 flex-col gap-3'
    : 'space-y-3'

  const tableShellClass = fillViewportHeight
    ? 'flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card'
    : 'w-full min-w-0 overflow-x-auto rounded-lg border border-border bg-card'

  return (
    <div className={rootClass}>
      {!disableSearchAndFilters && (
      <div className="shrink-0 flex flex-wrap items-end gap-3">
        <div className="flex flex-1 min-w-[180px] max-w-md flex-col">
          <label className="mb-1 block text-sm font-medium text-foreground">Search</label>
          <div className="relative">
            <input
              type="search"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 pl-9 text-sm text-foreground placeholder:text-foreground/50"
            />
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground/50">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </span>
          </div>
        </div>

        <div className="relative">
          <button
            type="button"
            className="min-h-[44px] rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground hover:bg-background/50"
            onClick={() => setOpenFilterColumn((c) => (c === '__columns__' ? null : '__columns__'))}
            title="Choose columns to display"
          >
            Columns
          </button>
          {openFilterColumn === '__columns__' && (
            <div
              className="absolute right-0 z-50 mt-2 w-64 rounded-lg border border-border bg-card p-2 shadow-xl"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="px-2 pb-1 text-sm font-medium text-foreground">Show columns</div>
              <div className="max-h-64 overflow-auto p-1">
                {columns.map((c) => {
                  const checked = !hiddenColumnKeys.includes(c.key)
                  return (
                    <label
                      key={c.key}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-background/50"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleHidden(c.key)}
                        className="h-4 w-4 rounded border-border"
                      />
                      <span className="truncate text-sm text-foreground">{c.label}</span>
                    </label>
                  )
                })}
              </div>
              <div className="flex justify-end px-2 pt-2">
                <button
                  type="button"
                  className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground hover:opacity-90"
                  onClick={() => setOpenFilterColumn(null)}
                >
                  OK
                </button>
              </div>
            </div>
          )}
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearAllFilters}
            className="min-h-[44px] rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-background"
          >
            Clear filters
          </button>
        )}
        {hasActiveFilters && (
          <span className="text-sm text-foreground/60">
            {displayRows.length} of {rows.length} rows
          </span>
        )}
      </div>
      )}

      <div className={tableShellClass}>
        <div
          className={
            fillViewportHeight
              ? 'min-h-0 flex-1 overflow-auto overscroll-contain'
              : 'contents'
          }
        >
        <table className="w-full">
          <colgroup>
            {enableSelection && <col style={{ width: '2.5rem' }} />}
            {enableRowReorder && <col style={{ width: '2.5rem' }} />}
            {visibleColumns.map((c) => (
              <col key={c.key} style={c.width ? { width: c.width } : undefined} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10 border-b border-border bg-card">
            <tr>
              {enableSelection && (
                <th className="px-2 py-3 text-center text-sm font-medium text-foreground/70">
                  <label className="inline-flex cursor-pointer items-center justify-center" title="Select all">
                    <input
                      type="checkbox"
                      checked={!!displayAllSelected}
                      onChange={(e) => {
                        if (!onSelectedKeysChange) return
                        const next = new Set(selection)
                        if (e.target.checked) {
                          for (const k of displayRowKeys) next.add(k)
                        } else {
                          for (const k of displayRowKeys) next.delete(k)
                        }
                        onSelectedKeysChange(next)
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 rounded border-border"
                    />
                  </label>
                </th>
              )}
              {enableRowReorder && (
                <th className="px-2 py-3 text-left text-sm font-medium text-foreground/70">
                  <span className="sr-only">Reorder</span>
                </th>
              )}
              {visibleColumns.map((c) => {
                const isSorted = sortKey === c.key
                const selectedCount = filterSets[c.key]?.size ?? 0
                return (
                  <th
                    key={c.key}
                    ref={(el) => {
                      filterAnchorRefs.current[c.key] = el
                    }}
                    className={`relative min-w-0 select-none px-4 py-3 text-left text-sm font-medium text-foreground ${
                      disableSort ? '' : 'cursor-pointer hover:bg-background/50'
                    }`}
                    onClick={() => {
                      if (disableSort) return
                      if (sortKey !== c.key) {
                        setSortKey(c.key)
                        setSortDir('asc')
                      } else {
                        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
                      }
                    }}
                    title={disableSort ? undefined : 'Tap to sort.'}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate whitespace-nowrap">{c.label}</span>
                      {!disableSort && isSorted && (
                        <span className="shrink-0 text-foreground/60">
                          {sortDir === 'asc' ? '↓' : '↑'}
                        </span>
                      )}
                      {!disableSearchAndFilters && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setOpenFilterColumn((col) => (col === c.key ? null : c.key))
                          }}
                          className={`shrink-0 rounded p-0.5 hover:bg-background ${
                            selectedCount ? 'text-primary' : 'text-foreground/50'
                          }`}
                          title="Filter column"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                          </svg>
                        </button>
                      )}
                    </span>
                    {!disableSearchAndFilters && openFilterColumn === c.key && (
                      <ColumnFilterDropdown
                        columnKey={c.key}
                        columnLabel={c.label}
                        values={getColumnValues(c.key)}
                        selected={filterSets[c.key] ?? new Set()}
                        onChange={(s) =>
                          setColumnFilters((prev) => ({
                            ...prev,
                            [c.key]: Array.from(s),
                          }))
                        }
                        onClose={() => setOpenFilterColumn(null)}
                        anchorRef={{ current: filterAnchorRefs.current[c.key] }}
                      />
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((r, idx) => {
              const k = getRowKey ? getRowKey(r, idx) : String(idx)
              const isDragOver = enableRowReorder && dragOverKey === k && draggingKey && draggingKey !== k
              const rowIndex = idx
              const draggingIndex = draggingKey
                ? displayRows.findIndex((row, i) => (getRowKey ? getRowKey(row, i) : String(i)) === draggingKey)
                : -1
              const showDropAbove = !!isDragOver && draggingIndex >= 0 && draggingIndex < rowIndex
              const showDropBelow = !!isDragOver && draggingIndex >= 0 && draggingIndex > rowIndex
              return (
                <tr
                  key={k}
                  draggable={!!enableRowReorder}
                  onDragStart={(e) => {
                    if (!enableRowReorder) return
                    e.dataTransfer.setData('text/plain', k)
                    e.dataTransfer.effectAllowed = 'move'
                    setDraggingKey(k)
                  }}
                  onDragEnd={() => {
                    if (!enableRowReorder) return
                    setDraggingKey(null)
                    setDragOverKey(null)
                  }}
                  onDragOver={(e) => {
                    if (!enableRowReorder) return
                    e.preventDefault()
                    setDragOverKey(k)
                  }}
                  onDrop={(e) => {
                    if (!enableRowReorder) return
                    e.preventDefault()
                    const fromKey = draggingKey ?? e.dataTransfer.getData('text/plain')
                    const toKey = k
                    if (!fromKey || fromKey === toKey) return
                    const ordered = rows.map((row, i) => (getRowKey ? getRowKey(row, i) : String(i)))
                    const fromIdx = ordered.indexOf(fromKey)
                    const toIdx = ordered.indexOf(toKey)
                    if (fromIdx < 0 || toIdx < 0) return
                    const next = [...ordered]
                    const [moved] = next.splice(fromIdx, 1)
                    next.splice(toIdx, 0, moved)
                    void onReorder?.(next)
                    setDragOverKey(null)
                  }}
                  className={`${onRowClick ? 'cursor-pointer hover:bg-background/50' : ''} ${
                    enableRowReorder ? 'cursor-grab' : ''
                  } ${isDragOver ? 'bg-background/30' : ''} border-b border-border/60 ${
                    showDropAbove ? 'border-t-2 border-t-primary' : ''
                  } ${showDropBelow ? 'border-b-2 border-b-primary' : ''}`}
                  onClick={() => onRowClick?.(r)}
                >
                  {enableSelection && (
                    <td className="px-2 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <label className="inline-flex cursor-pointer items-center justify-center" title="Select row">
                        <input
                          type="checkbox"
                          checked={selection.has(k)}
                          onChange={(e) => {
                            if (!onSelectedKeysChange) return
                            const next = new Set(selection)
                            if (e.target.checked) next.add(k)
                            else next.delete(k)
                            onSelectedKeysChange(next)
                          }}
                          className="h-4 w-4 rounded border-border"
                        />
                      </label>
                    </td>
                  )}
                  {enableRowReorder && (
                    <td className="px-2 py-3 text-foreground/60" onClick={(e) => e.stopPropagation()}>
                      <span
                        title="Drag to reorder"
                        draggable
                        onDragStart={(e) => {
                          e.stopPropagation()
                          e.dataTransfer.setData('text/plain', k)
                          e.dataTransfer.effectAllowed = 'move'
                          setDraggingKey(k)
                        }}
                        className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-background/50"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01" />
                        </svg>
                      </span>
                    </td>
                  )}
                  {visibleColumns.map((c) => (
                    <td key={c.key} className="min-w-0 px-4 py-3 text-sm text-foreground/90">
                      {c.render ? c.render(r) : <span className="block truncate">{c.getValue(r)}</span>}
                    </td>
                  ))}
                </tr>
              )
            })}
            {displayRows.length === 0 && (
              <tr>
                <td
                  className="px-4 py-6 text-center text-sm text-foreground/60"
                  colSpan={Math.max(1, visibleColumns.length + (enableRowReorder ? 1 : 0) + (enableSelection ? 1 : 0))}
                >
                  {rows.length === 0 ? 'No rows.' : 'No rows match the current filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}

