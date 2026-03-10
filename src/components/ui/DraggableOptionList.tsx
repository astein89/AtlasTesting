import { useState } from 'react'

const localeCompare = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: 'base' })

function parseBulkOptions(text: string): string[] {
  const parsed = text
    .split(/\n|,/)
    .map((s) => s.trim())
    .filter(Boolean)
  const deduped = [...new Set(parsed)]
  deduped.sort(localeCompare)
  return deduped
}

export interface DraggableOptionListProps {
  items: string[]
  onReorder: (items: string[]) => void
  renderRow: (item: string, index: number) => React.ReactNode
  onAdd?: () => void
  addLabel?: string
  onBulkAdd?: (items: string[]) => void
  bulkAddLabel?: string
  /** Optional class for the list container (ul) */
  listClassName?: string
}

/**
 * List of options with drag handle to reorder. Matches FormLayoutEditor drag-and-drop UX.
 */
export function DraggableOptionList({
  items,
  onReorder,
  renderRow,
  onAdd,
  addLabel = '+ Add option',
  onBulkAdd,
  bulkAddLabel = 'Bulk add',
  listClassName = '',
}: DraggableOptionListProps) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (draggedIndex === null || draggedIndex === index) return
    const next = [...items]
    const [removed] = next.splice(draggedIndex, 1)
    next.splice(index, 0, removed)
    onReorder(next)
    setDraggedIndex(index)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDraggedIndex(null)
  }

  const handleDragEnd = () => setDraggedIndex(null)

  const handleBulkApply = () => {
    const parsed = parseBulkOptions(bulkText)
    if (parsed.length > 0) onBulkAdd?.(parsed)
    setBulkText('')
    setBulkOpen(false)
  }

  const handleBulkCancel = () => {
    setBulkText('')
    setBulkOpen(false)
  }

  const showSortButtons = items.length >= 2

  return (
    <div className="space-y-2">
      <ul
        className={`max-h-96 space-y-0.5 overflow-y-auto rounded border border-border bg-card p-2 ${listClassName}`.trim()}
      >
        {items.map((item, i) => (
          <li
            key={i}
            draggable
            onDragStart={(e) => handleDragStart(e, i)}
            onDragOver={(e) => handleDragOver(e, i)}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            className={`flex cursor-grab items-center gap-2 rounded border border-transparent px-2 py-1 active:cursor-grabbing ${
              draggedIndex === i ? 'opacity-50' : 'hover:bg-background/50'
            }`}
          >
            <span className="shrink-0 cursor-grab text-foreground/40" title="Drag to reorder">
              ⋮⋮
            </span>
            <div className="min-w-0 flex-1">{renderRow(item, i)}</div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="rounded-lg border border-border px-3 py-1 text-sm text-foreground hover:bg-background"
          >
            {addLabel}
          </button>
        )}
        {onBulkAdd && (
          <>
            <button
              type="button"
              onClick={() => setBulkOpen((o) => !o)}
              className="rounded-lg border border-border px-3 py-1 text-sm text-foreground hover:bg-background"
            >
              {bulkAddLabel}
            </button>
            {bulkOpen && (
              <div className="w-full space-y-2 rounded-lg border border-border bg-card p-2">
                <textarea
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder="One option per line, or comma-separated"
                  rows={4}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleBulkApply}
                    className="rounded-lg border border-border px-3 py-1 text-sm text-foreground hover:bg-background"
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={handleBulkCancel}
                    className="rounded-lg border border-border px-3 py-1 text-sm text-foreground hover:bg-background"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {showSortButtons && (
          <>
            <button
              type="button"
              onClick={() => onReorder([...items].sort((a, b) => localeCompare(a, b)))}
              className="rounded-lg border border-border px-2 py-1 text-sm text-foreground hover:bg-background"
              title="Sort A–Z"
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => onReorder([...items].sort((a, b) => localeCompare(b, a)))}
              className="rounded-lg border border-border px-2 py-1 text-sm text-foreground hover:bg-background"
              title="Sort Z–A"
            >
              ↑
            </button>
          </>
        )}
      </div>
    </div>
  )
}
