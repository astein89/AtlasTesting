import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { DataField } from '../../types'

interface PlanFieldSelectorProps {
  selectedIds: string[]
  onChange: (ids: string[]) => void
  onCreateNew?: () => void
}

export function PlanFieldSelector({
  selectedIds,
  onChange,
  onCreateNew,
}: PlanFieldSelectorProps) {
  const [fields, setFields] = useState<DataField[]>([])
  const [search, setSearch] = useState('')
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)

  useEffect(() => {
    api
      .get<DataField[]>('/fields')
      .then((r) => setFields(r.data))
      .catch(() => setFields([]))
  }, [])

  const filtered = fields.filter(
    (f) =>
      f.key.toLowerCase().includes(search.toLowerCase()) ||
      f.label.toLowerCase().includes(search.toLowerCase())
  )

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id))
    } else {
      onChange([...selectedIds, id])
    }
  }

  const selected = selectedIds
    .map((id) => fields.find((f) => f.id === id))
    .filter(Boolean) as DataField[]

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (draggedIndex === null || draggedIndex === index) return
    const next = [...selectedIds]
    const [removed] = next.splice(draggedIndex, 1)
    next.splice(index, 0, removed)
    onChange(next)
    setDraggedIndex(index)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDraggedIndex(null)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          type="search"
          placeholder="Search fields..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-foreground"
        />
        {onCreateNew && (
          <button
            type="button"
            onClick={onCreateNew}
            className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
          >
            Create new field
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border p-4">
          <h3 className="mb-2 text-sm font-medium text-foreground">Available</h3>
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {filtered
              .filter((f) => !selectedIds.includes(f.id))
              .map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => toggle(f.id)}
                    className="w-full rounded px-2 py-1.5 text-left text-foreground hover:bg-card"
                  >
                    {f.label} ({f.key})
                  </button>
                </li>
              ))}
          </ul>
        </div>
        <div className="rounded-lg border border-border p-4">
          <h3 className="mb-2 text-sm font-medium text-foreground">
            Data fields (drag to reorder)
          </h3>
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {selected.map((f, i) => (
              <li
                key={f.id}
                draggable
                onDragStart={(e) => handleDragStart(e, i)}
                onDragOver={(e) => handleDragOver(e, i)}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
                className={`flex cursor-grab items-center gap-2 rounded border border-transparent px-2 py-1.5 active:cursor-grabbing ${
                  draggedIndex === i ? 'opacity-50' : 'hover:bg-card'
                }`}
              >
                <span className="cursor-grab text-foreground/40" title="Drag to reorder">
                  ⋮⋮
                </span>
                <span className="flex-1 text-foreground">{f.label}</span>
                <button
                  type="button"
                  onClick={() => toggle(f.id)}
                  className="text-red-500 hover:underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
