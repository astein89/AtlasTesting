import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
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
  /** When true, shows a footer bar with “filtered of total” as two numbers (e.g. 3 of 12). */
  showFooterRowCount?: boolean
  /**
   * When true, only a page of rows is rendered at a time. Ignored if `enableRowReorder` is true.
   * Full filtered rows are still passed to `onFilterSnapshotChange`.
   */
  pagination?: boolean
}

/** Numeric page sizes; `0` means show all rows (no slicing). */
const PAGE_SIZE_OPTIONS = [100, 250, 500, 1000, 2500, 5000] as const
const PAGE_SIZE_ALL = 0

function deserializePageSize(s: string): number {
  try {
    const n = JSON.parse(s) as number
    if (n === PAGE_SIZE_ALL) return PAGE_SIZE_ALL
    if (PAGE_SIZE_OPTIONS.includes(n as (typeof PAGE_SIZE_OPTIONS)[number])) return n
  } catch {
    /* ignore */
  }
  return 500
}

const EMPTY_COLUMN_FILTER_SET = new Set<string>()

function stableFilterFingerprint(filters: Record<string, string[]>): string {
  const keys = Object.keys(filters).sort()
  const normalized: Record<string, string[]> = {}
  for (const k of keys) {
    const arr = filters[k]
    normalized[k] = Array.isArray(arr) ? [...arr].sort() : []
  }
  return JSON.stringify(normalized)
}

/** Apply global search + column filters. Omit one column so its dropdown only lists values still possible given the rest. */
function filterRowsBySearchAndColumnFilters<Row>(
  rows: Row[],
  columns: Array<SimpleColumn<Row>>,
  searchQuery: string,
  filterSets: Record<string, Set<string>>,
  excludeColumnKey?: string | null
): Row[] {
  let out = rows
  const q = searchQuery.trim().toLowerCase()
  if (q) {
    out = out.filter((r) => columns.some((c) => c.getValue(r).toLowerCase().includes(q)))
  }
  for (const [k, allowed] of Object.entries(filterSets)) {
    if (excludeColumnKey != null && k === excludeColumnKey) continue
    if (allowed.size === 0) continue
    const col = columns.find((c) => c.key === k)
    if (!col) continue
    out = out.filter((r) => allowed.has(col.getValue(r)))
  }
  return out
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
  showFooterRowCount,
  pagination = false,
}: SimpleDataTableProps<Row>) {
  const pagingActive = !!pagination && !enableRowReorder
  const [pageIndex, setPageIndex] = useState(0)
  /** True while React is applying a paginated slice (large filtered sets can make this noticeable). */
  const [isPagePending, startPageTransition] = useTransition()
  const [pageSize, setPageSize] = useUserPreference<number>(
    `${preferenceKey}-page-size`,
    500,
    JSON.stringify,
    deserializePageSize
  )

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
  const filterAnchorRefs = useRef<Record<string, HTMLElement | null>>({})
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
    out = filterRowsBySearchAndColumnFilters(rows, columns, searchQuery, filterSets)
    if (sortKey && !disableSort) {
      const col = columns.find((c) => c.key === sortKey)
      if (col) {
        const dir = sortDir === 'asc' ? 1 : -1
        out = [...out].sort((a, b) => dir * col.getValue(a).localeCompare(col.getValue(b)))
      }
    }
    return out
  }, [rows, columns, searchQuery, filterSets, sortKey, sortDir, disableSort, disableSearchAndFilters])

  const effectivePageSize = useMemo(() => {
    if (pageSize === PAGE_SIZE_ALL) return PAGE_SIZE_ALL
    const n = Number(pageSize)
    if (Number.isFinite(n) && PAGE_SIZE_OPTIONS.includes(n as (typeof PAGE_SIZE_OPTIONS)[number])) return n
    return 500
  }, [pageSize])

  /** Reset page only from real user actions — never from effects (prefs/columns refs break Next/Prev). */
  const goToFirstPage = useCallback(() => {
    if (pagingActive) setPageIndex(0)
  }, [pagingActive])

  const showAllRows = effectivePageSize === PAGE_SIZE_ALL
  const pageSizeSafe = showAllRows
    ? Math.max(1, filteredRows.length || 1)
    : Math.max(1, effectivePageSize)
  const totalFiltered = filteredRows.length
  const totalPages =
    totalFiltered === 0 || showAllRows ? 1 : Math.ceil(totalFiltered / pageSizeSafe)
  const maxPageIndex = totalFiltered === 0 || showAllRows ? 0 : totalPages - 1

  useEffect(() => {
    if (!pagingActive) return
    setPageIndex((i) => (i > maxPageIndex ? maxPageIndex : i))
  }, [pagingActive, maxPageIndex])

  const pageStart =
    pagingActive && !showAllRows ? pageIndex * pageSizeSafe : 0
  const pagedRows = useMemo(() => {
    if (!pagingActive) return filteredRows
    if (showAllRows) return filteredRows
    return filteredRows.slice(pageStart, pageStart + pageSizeSafe)
  }, [pagingActive, filteredRows, pageStart, pageSizeSafe, showAllRows])

  /** Keys for all rows matching current filters — used for header “Select all” (includes every page when paginated). */
  const allFilteredRowKeys = useMemo(
    () => filteredRows.map((r, i) => (getRowKey ? getRowKey(r, i) : String(i))),
    [filteredRows, getRowKey]
  )

  const selection = selectedKeys ?? new Set<string>()
  const displayAllSelected =
    enableSelection &&
    allFilteredRowKeys.length > 0 &&
    allFilteredRowKeys.every((k) => selection.has(k))

  const hasActiveFilters =
    !disableSearchAndFilters &&
    (searchQuery.trim() !== '' || Object.values(filterSets).some((s) => s.size > 0))

  const filterFingerprint = useMemo(() => stableFilterFingerprint(columnFilters), [columnFilters])

  const filteredRowsRef = useRef(filteredRows)
  filteredRowsRef.current = filteredRows

  useEffect(() => {
    if (!onFilterSnapshotChange) return
    onFilterSnapshotChange({
      hasActiveFilters,
      filteredRows: filteredRowsRef.current,
    })
  }, [
    hasActiveFilters,
    rows,
    filteredRows.length,
    sortKey,
    sortDir,
    searchQuery,
    filterFingerprint,
    onFilterSnapshotChange,
  ])

  /**
   * Distinct values for the open filter only — from rows matching search and every *other* column filter,
   * so options stay in sync with what can still appear in the current result (faceted filtering).
   */
  const openColumnDistinctValues = useMemo(() => {
    if (!openFilterColumn) return [] as string[]
    const col = columns.find((c) => c.key === openFilterColumn)
    if (!col) return []
    const base =
      disableSearchAndFilters
        ? rows
        : filterRowsBySearchAndColumnFilters(rows, columns, searchQuery, filterSets, openFilterColumn)
    const s = new Set<string>()
    for (const r of base) {
      const v = col.getValue(r)
      if (v === '' || v == null) continue
      const t = String(v).trim()
      if (t !== '') s.add(t)
    }
    return Array.from(s).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    )
  }, [openFilterColumn, rows, columns, searchQuery, filterSets, disableSearchAndFilters])

  const toggleHidden = (key: string) => {
    goToFirstPage()
    setHiddenColumnKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }

  const clearAllFilters = () => {
    goToFirstPage()
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
              onChange={(e) => {
                setSearchQuery(e.target.value)
                goToFirstPage()
              }}
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
        {hasActiveFilters && !showFooterRowCount && (
          <span className="text-sm text-foreground/60">
            {filteredRows.length} of {rows.length} rows
          </span>
        )}
      </div>
      )}

      <div className={`${tableShellClass}${pagingActive ? ' relative' : ''}`}>
        <div
          className={
            fillViewportHeight
              ? 'relative min-h-0 flex-1 overflow-auto overscroll-contain'
              : 'relative w-full min-w-0 overflow-x-auto'
          }
        >
          {pagingActive && isPagePending && (
            <div
              className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-background/50 backdrop-blur-[1px]"
              aria-busy="true"
              aria-live="polite"
              role="status"
            >
              <div
                className="h-9 w-9 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent"
                aria-hidden
              />
              <span className="text-xs text-foreground/80">Updating page…</span>
            </div>
          )}
        <table className={`w-full ${pagingActive && isPagePending ? 'pointer-events-none opacity-60' : ''}`}>
          <colgroup>
            {enableSelection && <col style={{ width: '2.5rem' }} />}
            {enableRowReorder && <col style={{ width: '2rem' }} />}
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
                          for (const k of allFilteredRowKeys) next.add(k)
                        } else {
                          for (const k of allFilteredRowKeys) next.delete(k)
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
                    className={`relative min-w-0 select-none px-4 py-3 text-left text-sm font-medium text-foreground ${
                      disableSort ? '' : 'cursor-pointer hover:bg-background/50'
                    }`}
                    onClick={() => {
                      if (disableSort) return
                      goToFirstPage()
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
                          ref={(el) => {
                            filterAnchorRefs.current[c.key] = el
                          }}
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
                        values={openColumnDistinctValues}
                        selected={filterSets[c.key] ?? EMPTY_COLUMN_FILTER_SET}
                        onChange={(s) => {
                          goToFirstPage()
                          startTransition(() => {
                            setColumnFilters((prev) => ({
                              ...prev,
                              [c.key]: Array.from(s),
                            }))
                          })
                        }}
                        onClose={() => setOpenFilterColumn(null)}
                        tableAnchorRefs={filterAnchorRefs}
                        tableAnchorKey={c.key}
                      />
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {(pagingActive ? pagedRows : filteredRows).map((r, idx) => {
              const globalIdx = pagingActive ? pageStart + idx : idx
              const k = getRowKey ? getRowKey(r, globalIdx) : String(globalIdx)
              const isDragOver = enableRowReorder && dragOverKey === k && draggingKey && draggingKey !== k
              const rowIndex = idx
              const draggingIndex = draggingKey
                ? filteredRows.findIndex((row, i) => (getRowKey ? getRowKey(row, i) : String(i)) === draggingKey)
                : -1
              const showDropAbove = !!isDragOver && draggingIndex >= 0 && draggingIndex < rowIndex
              const showDropBelow = !!isDragOver && draggingIndex >= 0 && draggingIndex > rowIndex
              return (
                <tr
                  key={k}
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
                    enableRowReorder && draggingKey === k ? 'opacity-50' : ''
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
                    <td className="w-8 px-1 py-3 align-middle" onClick={(e) => e.stopPropagation()}>
                      <span
                        className="flex w-8 shrink-0 cursor-grab select-none justify-center text-foreground/45"
                        title="Drag to reorder"
                        draggable
                        onDragStart={(e) => {
                          e.stopPropagation()
                          e.dataTransfer.setData('text/plain', k)
                          e.dataTransfer.effectAllowed = 'move'
                          setDraggingKey(k)
                        }}
                        onDragEnd={(e) => {
                          e.stopPropagation()
                          setDraggingKey(null)
                          setDragOverKey(null)
                        }}
                        aria-label="Drag to reorder"
                      >
                        ⋮⋮
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
            {filteredRows.length === 0 && (
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
        {(showFooterRowCount || (pagingActive && totalFiltered > 0)) && (
          <div
            className={`shrink-0 border-t border-border bg-muted/40 px-4 py-2.5 text-left text-sm text-foreground/90 ${
              fillViewportHeight ? '' : 'w-full min-w-0'
            } ${showFooterRowCount && pagingActive && totalFiltered > 0 ? 'flex flex-col gap-2' : ''}`}
            role="status"
            aria-live="polite"
          >
            {pagingActive && totalFiltered > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border bg-background text-foreground hover:bg-background/80 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={showAllRows || pageIndex <= 0 || isPagePending}
                    aria-label="First page"
                    onClick={() => startPageTransition(() => setPageIndex(0))}
                  >
                    <svg
                      className="h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      aria-hidden
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M18.75 19.5L11.25 12l7.5-7.5M11.25 19.5L3.75 12l7.5-7.5"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border bg-background text-foreground hover:bg-background/80 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={showAllRows || pageIndex <= 0 || isPagePending}
                    aria-label="Previous page"
                    onClick={() =>
                      startPageTransition(() => setPageIndex((i) => Math.max(0, i - 1)))
                    }
                  >
                    <svg
                      className="h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      aria-hidden
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border bg-background text-foreground hover:bg-background/80 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={showAllRows || pageIndex >= maxPageIndex || isPagePending}
                    aria-label="Next page"
                    onClick={() =>
                      startPageTransition(() =>
                        setPageIndex((i) => Math.min(maxPageIndex, i + 1))
                      )
                    }
                  >
                    <svg
                      className="h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      aria-hidden
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border bg-background text-foreground hover:bg-background/80 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={showAllRows || pageIndex >= maxPageIndex || isPagePending}
                    aria-label="Last page"
                    onClick={() => startPageTransition(() => setPageIndex(maxPageIndex))}
                  >
                    <svg
                      className="h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      aria-hidden
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5.25 4.5l7.5 7.5-7.5 7.5M13.25 4.5l7.5 7.5-7.5 7.5"
                      />
                    </svg>
                  </button>
                  {!showAllRows && totalPages > 1 && (
                    <span className="text-foreground/80">
                      Page{' '}
                      <span className="tabular-nums font-medium text-foreground">{pageIndex + 1}</span>
                      {' of '}
                      <span className="tabular-nums text-foreground/90">{totalPages}</span>
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {!showAllRows && (
                    <span className="text-foreground/80">
                      Showing{' '}
                      <span className="tabular-nums font-medium text-foreground">{pageStart + 1}</span>
                      <span className="text-foreground/80">–</span>
                      <span className="tabular-nums font-medium text-foreground">
                        {pageStart + pagedRows.length}
                      </span>
                      {' of '}
                      <span className="tabular-nums text-foreground/90">{totalFiltered}</span>
                    </span>
                  )}
                  <label className="flex items-center gap-2 text-foreground/80">
                    <span className="whitespace-nowrap">Rows per page</span>
                    <select
                      className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      value={effectivePageSize === PAGE_SIZE_ALL ? 'all' : String(effectivePageSize)}
                      aria-label="Rows per page"
                      disabled={isPagePending}
                      onChange={(e) => {
                        const v = e.target.value
                        startPageTransition(() => {
                          setPageIndex(0)
                          setPageSize(v === 'all' ? PAGE_SIZE_ALL : Number(v))
                        })
                      }}
                    >
                      {PAGE_SIZE_OPTIONS.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                      <option value="all">All</option>
                    </select>
                  </label>
                </div>
              </div>
            )}
            {showFooterRowCount && (
              <div>
                <span className="tabular-nums font-medium text-foreground">{filteredRows.length}</span>
                <span className="text-foreground/80"> of </span>
                <span className="tabular-nums text-foreground/90">{rows.length}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

