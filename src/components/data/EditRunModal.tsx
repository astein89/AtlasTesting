import { useEffect } from 'react'
import { AutoExpandTextarea } from '../fields/AutoExpandTextarea'
import type { DataField } from '../../types'

interface Run {
  id: string
  runAt: string
  status: string
  data: Record<string, string | number | boolean>
}

interface EditRunModalProps {
  run: Run
  fields: DataField[]
  data: Record<string, string | number | boolean>
  onDataChange: (key: string, value: string | number | boolean) => void
  onSave: () => void
  onCancel: () => void
  submitting: boolean
}

function renderField(
  f: DataField,
  value: string | number | boolean,
  onChange: (key: string, val: string | number | boolean) => void
) {
  if (f.type === 'number') {
    return (
      <input
        type="number"
        value={Number(value) || ''}
        onChange={(e) => onChange(f.key, parseFloat(e.target.value) || 0)}
        className="w-full rounded border border-border bg-background px-3 py-2 text-foreground"
      />
    )
  }
  if (f.type === 'boolean') {
    return (
      <input
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(f.key, e.target.checked)}
        className="h-4 w-4"
      />
    )
  }
  if (f.type === 'longtext') {
    return (
      <AutoExpandTextarea
        value={String(value ?? '')}
        onChange={(e) => onChange(f.key, e.target.value)}
        minRows={6}
        className="w-full rounded border border-border bg-background px-3 py-2 text-foreground"
      />
    )
  }
  if (f.type === 'select') {
    return (
      <select
        value={String(value ?? '')}
        onChange={(e) => onChange(f.key, e.target.value)}
        className="w-full rounded border border-border bg-background px-3 py-2 text-foreground"
      >
        <option value="">--</option>
        {(f.config?.options || []).map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    )
  }
  return (
    <input
      type="text"
      value={String(value ?? '')}
      onChange={(e) => onChange(f.key, e.target.value)}
      className="w-full rounded border border-border bg-background px-3 py-2 text-foreground"
    />
  )
}

export function EditRunModal({
  run,
  fields,
  data,
  onDataChange,
  onSave,
  onCancel,
  submitting,
}: EditRunModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-foreground">
          Edit row — {new Date(run.runAt).toLocaleString()}
        </h2>
        <div className="space-y-4">
          {fields.map((f) => (
            <div key={f.id}>
              <label className="mb-1 block text-sm font-medium text-foreground">
                {f.label}
              </label>
              {renderField(f, data[f.key], onDataChange)}
            </div>
          ))}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={submitting}
            className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
