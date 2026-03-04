import { useEffect } from 'react'
import { AutoExpandTextarea } from '../fields/AutoExpandTextarea'
import { AtlasLocationInput } from '../fields/AtlasLocationInput'
import { FractionInput } from '../fields/FractionInput'
import { ImageInput } from '../fields/ImageInput'
import { SelectInput } from '../fields/SelectInput'
import { parseFractionScale } from '../../utils/fraction'
import { buildFormRowsFromOrder, normalizeFormLayoutOrder } from '../../utils/formLayout'
import type { DataField } from '../../types'

interface Record {
  id: string
  recordedAt: string
  status: string
  data: Record<string, string | number | boolean>
}

interface EditRecordModalProps {
  record: Record
  fields: DataField[]
  data: Record<string, string | number | boolean>
  onDataChange: (key: string, value: string | number | boolean) => void
  onSave: () => void
  onCancel: () => void
  onDelete: () => void
  submitting: boolean
  formLayoutOrder?: string[]
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
  if (f.type === 'atlas_location') {
    return (
      <AtlasLocationInput
        value={String(value ?? '')}
        onChange={(v) => onChange(f.key, v)}
        className="w-full"
      />
    )
  }
  if (f.type === 'fraction') {
    return (
      <FractionInput
        value={Number(value) || 0}
        onChange={(v) => onChange(f.key, v)}
        defaultScale={parseFractionScale(f.config?.fractionScale)}
        className="w-full"
      />
    )
  }
  if (f.type === 'image') {
    return (
      <ImageInput
        value={(value as string | string[]) ?? (f.config?.imageMultiple ? [] : '')}
        onChange={(v) => onChange(f.key, v)}
        multiple={f.config?.imageMultiple ?? false}
        className="w-full"
      />
    )
  }
  if (f.type === 'select') {
    return (
      <SelectInput
        value={String(value ?? '')}
        onChange={(v) => onChange(f.key, v)}
        options={f.config?.options || []}
        className="w-full"
      />
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

export function EditRecordModal({
  record,
  fields,
  data,
  onDataChange,
  onSave,
  onCancel,
  onDelete,
  submitting,
  formLayoutOrder = [],
}: EditRecordModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handler)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handler)
      document.body.style.overflow = prevOverflow
    }
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={onCancel}
    >
      <div
        className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-t-xl border border-border bg-card p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-lg sm:rounded-lg sm:pb-6 sm:max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-foreground">
          Edit row — {new Date(record.recordedAt).toLocaleString()}
        </h2>
        <div className="space-y-4">
          {buildFormRowsFromOrder(fields, normalizeFormLayoutOrder(formLayoutOrder, fields)).map((row, ri) => (
            <div key={ri} className="flex gap-4">
              {row.map(({ field }) => (
                <div key={field.id} className="min-w-0 flex-1">
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    {field.label}
                  </label>
                  {renderField(field, data[field.key], onDataChange)}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="mt-6 flex justify-between gap-2">
          <button
            type="button"
            onClick={onDelete}
            disabled={submitting}
            className="min-h-[44px] min-w-[44px] rounded-lg border border-red-500/50 px-4 py-2 text-red-500 hover:bg-red-500/10 disabled:opacity-50 sm:min-h-0 sm:min-w-0"
          >
            Delete
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="min-h-[44px] min-w-[44px] rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background sm:min-h-0 sm:min-w-0"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={submitting}
              className="min-h-[44px] min-w-[44px] rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50 sm:min-h-0 sm:min-w-0"
            >
              {submitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
