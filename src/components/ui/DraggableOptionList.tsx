import { useState } from 'react'

export interface DraggableOptionListProps {
  items: string[]
  onReorder: (items: string[]) => void
  renderRow: (item: string, index: number) => React.ReactNode
  onAdd?: () => void
  addLabel?: string
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
  listClassName = '',
}: DraggableOptionListProps) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)

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
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="rounded-lg border border-border px-3 py-1 text-sm text-foreground hover:bg-background"
        >
          {addLabel}
        </button>
      )}
    </div>
  )
}
