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
            Selected
          </h3>
          <p className="mb-2 text-xs text-foreground/60">
            Order and add new lines in Form layout below.
          </p>
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {selected.map((f) => (
              <li key={f.id} className="flex items-center gap-2 rounded px-2 py-1.5">
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
