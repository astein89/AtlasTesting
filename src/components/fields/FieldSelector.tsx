import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { DataField } from '../../types'

interface FieldSelectorProps {
  selectedIds: string[]
  onChange: (ids: string[]) => void
  onCreateNew?: () => void
}

export function FieldSelector({
  selectedIds,
  onChange,
  onCreateNew,
}: FieldSelectorProps) {
  const [fields, setFields] = useState<DataField[]>([])
  const [search, setSearch] = useState('')

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

  const move = (from: number, to: number) => {
    const next = [...selectedIds]
    const [removed] = next.splice(from, 1)
    next.splice(to, 0, removed)
    onChange(next)
  }

  const selected = selectedIds
    .map((id) => fields.find((f) => f.id === id))
    .filter(Boolean) as DataField[]

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
          <h3 className="mb-2 text-sm font-medium text-foreground">Selected (order)</h3>
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {selected.map((f, i) => (
              <li key={f.id} className="flex items-center gap-2">
                <span className="text-foreground/60">{i + 1}.</span>
                <span className="flex-1 text-foreground">{f.label}</span>
                <button
                  type="button"
                  onClick={() => move(i, Math.max(0, i - 1))}
                  disabled={i === 0}
                  className="text-foreground/60 hover:text-foreground disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(i, Math.min(selected.length - 1, i + 1))}
                  disabled={i === selected.length - 1}
                  className="text-foreground/60 hover:text-foreground disabled:opacity-30"
                >
                  ↓
                </button>
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
