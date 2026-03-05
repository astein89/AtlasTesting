import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { buildFormRowsFromOrder, createSeparatorId, isSeparatorId } from '../../utils/formLayout'
import type { DataField } from '../../types'

interface FormLayoutEditorProps {
  fieldIds: string[]
  value: string[]
  onChange: (order: string[]) => void
  onAddSeparator?: () => void
}

export function FormLayoutEditor({
  fieldIds,
  value,
  onChange,
  onAddSeparator,
}: FormLayoutEditorProps) {
  const [fields, setFields] = useState<DataField[]>([])
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)

  useEffect(() => {
    if (fieldIds.length === 0) {
      setFields([])
      return
    }
    Promise.all(
      fieldIds.map((id) => api.get<DataField>(`/fields/${id}`).then((r) => r.data))
    )
      .then(setFields)
      .catch(() => setFields([]))
  }, [fieldIds.join(',')])

  const order = value.length > 0 ? value : fieldIds

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (draggedIndex === null || draggedIndex === index) return
    const next = [...order]
    const [removed] = next.splice(draggedIndex, 1)
    next.splice(index, 0, removed)
    onChange(next)
    setDraggedIndex(index)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDraggedIndex(null)
  }

  const handleDragEnd = () => setDraggedIndex(null)

  const addSeparator = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (onAddSeparator) {
      onAddSeparator()
    } else {
      onChange([...order, createSeparatorId()])
    }
  }

  const removeSeparator = (id: string) => {
    onChange(order.filter((x) => x !== id))
  }

  if (fields.length === 0) return null

  const fieldMap = new Map(fields.map((f) => [f.id, f]))
  const rows = buildFormRowsFromOrder(fields, order)

  return (
    <div className="rounded-lg border border-border p-4">
      <h3 className="mb-2 text-sm font-medium text-foreground">
        Form layout (add/edit row)
      </h3>
      <p className="mb-3 text-sm text-foreground/60">
        Drag to reorder fields. Up to 3 fields per row. Add new line separators to start a new row.
      </p>
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="flex-1">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-foreground/60">Order</span>
            <button
              type="button"
              onClick={addSeparator}
              className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-background"
            >
              + New line
            </button>
          </div>
          <ul className="max-h-96 space-y-0.5 overflow-y-auto rounded border border-border bg-card p-2">
            {order.map((id, i) => {
              if (isSeparatorId(id)) {
                return (
                  <li
                    key={id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, i)}
                    onDragOver={(e) => handleDragOver(e, i)}
                    onDrop={handleDrop}
                    onDragEnd={handleDragEnd}
                    className={`flex cursor-grab items-center gap-2 rounded border border-dashed border-foreground/30 px-2 py-1 active:cursor-grabbing ${
                      draggedIndex === i ? 'opacity-50' : 'hover:bg-background/50'
                    }`}
                  >
                    <span className="cursor-grab text-foreground/40" title="Drag to reorder">
                      ⋮⋮
                    </span>
                    <span className="flex-1 text-sm text-foreground/70">— New line —</span>
                    <button
                      type="button"
                      onClick={() => removeSeparator(id)}
                      className="text-red-500 hover:underline"
                    >
                      Remove
                    </button>
                  </li>
                )
              }
              const field = fieldMap.get(id)
              if (!field) return null
              return (
                <li
                  key={id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, i)}
                  onDragOver={(e) => handleDragOver(e, i)}
                  onDrop={handleDrop}
                  onDragEnd={handleDragEnd}
                  className={`flex cursor-grab items-center gap-2 rounded border border-transparent px-2 py-1 active:cursor-grabbing ${
                    draggedIndex === i ? 'opacity-50' : 'hover:bg-background/50'
                  }`}
                >
                  <span className="cursor-grab text-foreground/40" title="Drag to reorder">
                    ⋮⋮
                  </span>
                  <span className="flex-1 text-foreground">{field.label}</span>
                </li>
              )
            })}
          </ul>
        </div>
        <div className="flex-1">
          <p className="mb-2 text-xs font-medium text-foreground/60">Live preview</p>
          <div className="space-y-2 rounded border border-border bg-card p-3">
            {rows.map((row, ri) => (
              <div key={ri} className="flex gap-2">
                {row.map(({ field }) => (
                  <div key={field.id} className="min-w-0 flex-1">
                    <div className="rounded border border-dashed border-border bg-background/50 px-2 py-1.5 text-xs text-foreground/80">
                      {field.label}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
