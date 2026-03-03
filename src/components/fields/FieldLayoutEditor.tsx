import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { DataField } from '../../types'

interface FieldLayoutEditorProps {
  fieldIds: string[]
  value: Record<string, string>
  onChange: (layout: Record<string, string>) => void
}

const WIDTH_PRESETS = ['auto', '80px', '100px', '120px', '150px', '200px']

export function FieldLayoutEditor({
  fieldIds,
  value,
  onChange,
}: FieldLayoutEditorProps) {
  const [fields, setFields] = useState<DataField[]>([])

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

  const updateWidth = (fieldId: string, width: string) => {
    const next = { ...value }
    if (width === 'auto' || !width) {
      delete next[fieldId]
    } else {
      next[fieldId] = width
    }
    onChange(next)
  }

  if (fields.length === 0) return null

  return (
    <div className="rounded-lg border border-border p-4">
      <h3 className="mb-2 text-sm font-medium text-foreground">
        Column widths (data table layout)
      </h3>
      <p className="mb-3 text-sm text-foreground/60">
        Set width for each column. Use px (e.g. 120px) or &quot;auto&quot; for browser default.
      </p>
      <div className="space-y-2">
        {fields.map((f) => (
          <div key={f.id} className="flex items-center gap-3">
            <label className="min-w-[120px] text-sm text-foreground">
              {f.label}
            </label>
            <select
              value={
                WIDTH_PRESETS.includes(value[f.id] || '')
                  ? value[f.id] || 'auto'
                  : 'custom'
              }
              onChange={(e) => {
                const v = e.target.value
                if (v !== 'custom') updateWidth(f.id, v)
              }}
              className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
            >
              {WIDTH_PRESETS.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
              <option value="custom">
                Custom {value[f.id] && !WIDTH_PRESETS.includes(value[f.id]) ? `(${value[f.id]})` : ''}
              </option>
            </select>
            <input
              type="text"
              placeholder="Custom (e.g. 10ch)"
              value={
                value[f.id] && !WIDTH_PRESETS.includes(value[f.id])
                  ? value[f.id]
                  : ''
              }
              onChange={(e) =>
                updateWidth(f.id, e.target.value.trim() || 'auto')
              }
              className="w-24 rounded border border-border bg-background px-2 py-1 text-sm text-foreground placeholder:text-foreground/40"
            />
          </div>
        ))}
      </div>
    </div>
  )
}
