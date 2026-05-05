/** Shared controls for sortable, paginated AMR data tables (logs, missions, etc.). */

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const

export type SortDir = 'asc' | 'desc'

export function paginateSlice<T>(rows: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize
  return rows.slice(start, start + pageSize)
}

export function TablePaginationBar({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  idPrefix,
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (p: number) => void
  onPageSizeChange: (n: number) => void
  idPrefix: string
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1)
  const safePage = Math.min(page, totalPages)
  const start = total === 0 ? 0 : (safePage - 1) * pageSize + 1
  const end = Math.min(total, safePage * pageSize)

  return (
    <div className="flex flex-col gap-2 border-t border-border/80 bg-muted/20 px-3 py-2.5 text-xs text-foreground/75 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <p className="tabular-nums">
        {total === 0 ? (
          'No rows on this page.'
        ) : (
          <>
            <span className="text-foreground/90">
              {start}–{end}
            </span>{' '}
            of <span className="font-medium text-foreground/85">{total}</span>
          </>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <label className="flex items-center gap-1.5">
          <span className="text-foreground/60">Rows</span>
          <select
            id={`${idPrefix}-page-size`}
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="min-h-[32px] rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <span className="tabular-nums text-foreground/60">
          Page {safePage} / {totalPages}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={safePage <= 1}
            className="min-h-[32px] rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-40"
            onClick={() => onPageChange(safePage - 1)}
          >
            Prev
          </button>
          <button
            type="button"
            disabled={safePage >= totalPages}
            className="min-h-[32px] rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-40"
            onClick={() => onPageChange(safePage + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}

export function SortableTh({
  label,
  active,
  dir,
  onClick,
}: {
  label: string
  active: boolean
  dir: SortDir
  onClick: () => void
}) {
  const sortHint = active ? (dir === 'asc' ? 'sorted ascending' : 'sorted descending') : 'sort'
  return (
    <th className="px-3 py-2 font-medium">
      <button
        type="button"
        onClick={onClick}
        aria-label={`${label}: ${sortHint}`}
        className="inline-flex w-full min-w-0 items-center gap-1 rounded-md px-0.5 py-0.5 text-left hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span>{label}</span>
        <span className="shrink-0 tabular-nums text-[10px] font-normal text-foreground/45" aria-hidden>
          {active ? (dir === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </button>
    </th>
  )
}
