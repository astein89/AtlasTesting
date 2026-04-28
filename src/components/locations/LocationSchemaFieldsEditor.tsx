import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { api } from '../../api/client'
import type { LocationSchemaField, LocationSchemaFieldConfig, LocationSchemaFieldType } from '../../types/locationSchemaFields'
import { useAlertConfirm } from '../../contexts/AlertConfirmContext'
import { useAuthStore } from '../../store/authStore'
import { randomUuid } from '@/lib/randomUuid'

const localeCompare = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: 'base' })

function newRowId(): string {
  return `opt-${randomUuid()}`
}

interface SelectOptionRow {
  rid: string
  value: string
  description: string
}

function selectRowsFromConfig(config: LocationSchemaFieldConfig): SelectOptionRow[] {
  const opts = config.options ?? []
  const descs = config.optionDescriptions
  if (opts.length === 0) return [{ rid: newRowId(), value: '', description: '' }]
  return opts.map((value, i) => ({
    rid: newRowId(),
    value: String(value),
    description: descs != null && i < descs.length ? String(descs[i] ?? '') : '',
  }))
}

function configFromSelectRows(rows: SelectOptionRow[]): LocationSchemaFieldConfig {
  const nonEmpty = rows
    .map((r) => ({ value: r.value.trim(), description: r.description.trim() }))
    .filter((r) => r.value !== '')
  return {
    options: nonEmpty.map((r) => r.value),
    optionDescriptions: nonEmpty.map((r) => r.description),
  }
}

function summarizeConfig(type: LocationSchemaFieldType, config: LocationSchemaFieldConfig): string {
  if (type === 'select') {
    const n = config.options?.length ?? 0
    if (!n) return 'No options'
    const descs = config.optionDescriptions ?? []
    const withDesc = (config.options ?? []).filter((_, i) => String(descs[i] ?? '').trim()).length
    return withDesc ? `${n} option(s), ${withDesc} with description` : `${n} option(s)`
  }
  if (type === 'text' && config.maxLength != null) {
    return `max ${config.maxLength} chars`
  }
  return '—'
}

function SchemaDragHandle() {
  return (
    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm6-12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
    </svg>
  )
}

function SchemaFieldsTableHead() {
  return (
    <thead>
      <tr className="border-b border-border text-left text-xs font-medium text-foreground/65">
        <th className="w-px px-1 py-2" aria-hidden />
        <th className="px-2 py-2">Label</th>
        <th className="px-2 py-2">Key</th>
        <th className="px-2 py-2">Type</th>
        <th className="px-2 py-2">Details</th>
        <th className="px-2 py-2 text-right">Actions</th>
      </tr>
    </thead>
  )
}

function FieldCells({
  f,
  canWrite,
  dragHandle,
  onOpenEdit,
  onDelete,
}: {
  f: LocationSchemaField
  canWrite: boolean
  dragHandle?: ReactNode
  onOpenEdit: () => void
  onDelete: () => void
}) {
  const details = summarizeConfig(f.type, f.config)
  return (
    <>
      <td className="w-px whitespace-nowrap px-1 py-2 align-middle">
        <div className="flex items-center justify-center">
          {dragHandle ?? <span className="inline-block w-9 shrink-0" aria-hidden />}
        </div>
      </td>
      <td className="px-2 py-2 align-top text-sm font-medium text-foreground">
        <span className="break-words" title={f.label}>
          {f.label}
        </span>
      </td>
      <td className="whitespace-nowrap px-2 py-2 align-middle font-mono text-xs text-foreground/90" title={f.key}>
        {f.key}
      </td>
      <td className="whitespace-nowrap px-2 py-2 align-middle text-xs text-foreground/90">{f.type}</td>
      <td className="px-2 py-2 align-top text-xs text-foreground/90">
        <span className="break-words" title={details !== '—' ? details : undefined}>
          {details}
        </span>
      </td>
      <td className="w-px whitespace-nowrap px-2 py-2 text-right align-middle" onClick={(e) => e.stopPropagation()}>
        {canWrite ? (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-background"
              onClick={onOpenEdit}
            >
              Edit
            </button>
            <button
              type="button"
              className="rounded border border-red-500/50 px-2 py-1 text-xs text-red-500 hover:bg-red-500/10"
              onClick={onDelete}
            >
              Delete
            </button>
          </div>
        ) : (
          <span className="text-xs text-foreground/50">View only</span>
        )}
      </td>
    </>
  )
}

function SortableFieldRow({
  f,
  canWrite,
  onOpenEdit,
  onDelete,
}: {
  f: LocationSchemaField
  canWrite: boolean
  onOpenEdit: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: f.id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`border-t border-border bg-background/40 ${isDragging ? 'opacity-60' : ''} ${
        canWrite ? 'cursor-pointer hover:bg-background/60' : ''
      }`}
      onClick={
        canWrite
          ? (e) => {
              if ((e.target as HTMLElement).closest('button')) return
              onOpenEdit()
            }
          : undefined
      }
    >
      <FieldCells
        f={f}
        canWrite={canWrite}
        dragHandle={
          <button
            type="button"
            className="touch-none cursor-grab rounded p-1.5 text-foreground/45 hover:bg-background hover:text-foreground active:cursor-grabbing"
            {...attributes}
            {...listeners}
            aria-label="Drag to reorder field"
            onClick={(e) => e.stopPropagation()}
          >
            <SchemaDragHandle />
          </button>
        }
        onOpenEdit={onOpenEdit}
        onDelete={onDelete}
      />
    </tr>
  )
}

function StaticFieldRow({
  f,
  canWrite,
  onOpenEdit,
  onDelete,
}: {
  f: LocationSchemaField
  canWrite: boolean
  onOpenEdit: () => void
  onDelete: () => void
}) {
  return (
    <tr
      className={`border-t border-border bg-background/40 ${canWrite ? 'cursor-pointer hover:bg-background/60' : ''}`}
      onClick={
        canWrite
          ? (e) => {
              if ((e.target as HTMLElement).closest('button')) return
              onOpenEdit()
            }
          : undefined
      }
    >
      <FieldCells f={f} canWrite={canWrite} onOpenEdit={onOpenEdit} onDelete={onDelete} />
    </tr>
  )
}

const FIELD_KEY_MAX_LEN = 64

/** Safe field key: lowercase [a-z0-9_], derived from label (for APIs / JSON). */
function suggestFieldKeyFromLabel(label: string): string {
  const s = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
  if (!s) return 'field'
  return s.slice(0, FIELD_KEY_MAX_LEN)
}

/** Picks a key not present in `taken` (other fields + reserved code-part keys). */
function suggestUniqueFieldKey(label: string, taken: Set<string>): string {
  let base = suggestFieldKeyFromLabel(label)
  if (!base) base = 'field'
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}_${n}`)) n += 1
  return `${base}_${n}`.slice(0, FIELD_KEY_MAX_LEN)
}

interface LocationSchemaFieldsEditorProps {
  schemaId: string
  /** Code-part keys in this schema — new field keys must not collide with these */
  reservedComponentKeys?: string[]
  onError?: (message: string) => void
}

export function LocationSchemaFieldsEditor({
  schemaId,
  reservedComponentKeys = [],
  onError,
}: LocationSchemaFieldsEditorProps) {
  const canWrite = useAuthStore((s) => s.canEditLocationSchemas())
  const { showConfirm } = useAlertConfirm()
  const [fields, setFields] = useState<LocationSchemaField[]>([])
  const [loading, setLoading] = useState(true)

  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formKey, setFormKey] = useState('')
  const [formLabel, setFormLabel] = useState('')
  const [formType, setFormType] = useState<LocationSchemaFieldType>('text')
  const [formMaxLength, setFormMaxLength] = useState('')
  const [formSelectRows, setFormSelectRows] = useState<SelectOptionRow[]>([
    { rid: newRowId(), value: '', description: '' },
  ])
  const [draggedSelectIndex, setDraggedSelectIndex] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [reordering, setReordering] = useState(false)
  /** Shown inside the field modal — parent `onError` is above the fold and hidden behind z-[100] overlay. */
  const [editorError, setEditorError] = useState<string | null>(null)
  /** When false, label edits update the key; set true when the user edits key directly. */
  const formKeyManualRef = useRef(false)

  const takenFieldKeys = useMemo(() => {
    const s = new Set<string>()
    for (const f of fields) s.add(f.key.trim())
    for (const k of reservedComponentKeys) {
      const t = k.trim()
      if (t) s.add(t)
    }
    return s
  }, [fields, reservedComponentKeys])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get<LocationSchemaField[]>(`/locations/schemas/${schemaId}/fields`)
      setFields(data)
    } catch {
      onError?.('Failed to load schema fields')
      setFields([])
    } finally {
      setLoading(false)
    }
  }, [schemaId, onError])

  useEffect(() => {
    void load()
  }, [load])

  function closeEditorModal() {
    if (saving) return
    setEditorOpen(false)
    setEditorError(null)
  }

  function openCreate() {
    formKeyManualRef.current = false
    setEditingId(null)
    setFormKey('')
    setFormLabel('')
    setFormType('text')
    setFormMaxLength('')
    setFormSelectRows([{ rid: newRowId(), value: '', description: '' }])
    setEditorError(null)
    setEditorOpen(true)
  }

  function openEdit(f: LocationSchemaField) {
    setEditingId(f.id)
    setFormKey(f.key)
    setFormLabel(f.label)
    setFormType(f.type)
    setFormMaxLength(f.type === 'text' && f.config.maxLength != null ? String(f.config.maxLength) : '')
    setFormSelectRows(
      f.type === 'select' ? selectRowsFromConfig(f.config) : [{ rid: newRowId(), value: '', description: '' }]
    )
    setEditorError(null)
    setEditorOpen(true)
  }

  function buildConfig(): LocationSchemaFieldConfig {
    if (formType === 'select') {
      return configFromSelectRows(formSelectRows)
    }
    if (formType === 'text' && formMaxLength.trim() !== '') {
      const n = Number(formMaxLength)
      if (Number.isFinite(n) && n > 0) return { maxLength: Math.floor(n) }
    }
    return {}
  }

  function setSaveError(message: string) {
    setEditorError(message)
    onError?.(message)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setEditorError(null)
    if (!formKey.trim() || !formLabel.trim()) {
      setSaveError('Key and label are required.')
      return
    }
    if (formType === 'select') {
      const opts = formSelectRows.map((r) => r.value.trim()).filter(Boolean)
      if (opts.length === 0) {
        setSaveError('Select fields need at least one option with a value.')
        return
      }
    }
    try {
      setSaving(true)
      const config = buildConfig()
      if (editingId) {
        const { data } = await api.put<LocationSchemaField>(
          `/locations/schemas/${schemaId}/fields/${editingId}`,
          {
            label: formLabel.trim(),
            type: formType,
            config,
          }
        )
        setFields((prev) => prev.map((x) => (x.id === editingId ? data : x)))
      } else {
        const { data } = await api.post<LocationSchemaField>(`/locations/schemas/${schemaId}/fields`, {
          key: formKey.trim(),
          label: formLabel.trim(),
          type: formType,
          config,
        })
        setFields((prev) => [...prev, data])
      }
      setEditorError(null)
      setEditorOpen(false)
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { error?: unknown } }; message?: string }
      const fromBody = ax.response?.data?.error
      const msg =
        (typeof fromBody === 'string' && fromBody.trim()
          ? fromBody.trim()
          : null) ??
        (typeof ax.message === 'string' && ax.message.trim() ? ax.message.trim() : null) ??
        'Failed to save field'
      setEditorError(msg)
      onError?.(msg)
    } finally {
      setSaving(false)
    }
  }

  async function persistFieldOrder(orderedIds: string[]) {
    if (reordering) return
    setReordering(true)
    const prev = fields
    setFields((p) => {
      const map = new Map(p.map((f) => [f.id, f]))
      return orderedIds.map((id, idx) => {
        const f = map.get(id)
        if (!f) return { id, schemaId, key: id, label: id, type: 'text' as const, config: {}, orderIndex: idx + 1 }
        return { ...f, orderIndex: idx + 1 }
      })
    })
    try {
      const { data } = await api.put<LocationSchemaField[]>(
        `/locations/schemas/${schemaId}/fields/reorder`,
        { orderedIds }
      )
      setFields(data)
    } catch {
      setFields(prev)
      onError?.('Failed to save field order')
    } finally {
      setReordering(false)
    }
  }

  async function handleDelete(id: string) {
    const f = fields.find((x) => x.id === id)
    const ok = await showConfirm(
      `Delete field "${f?.label ?? id}" (${f?.key ?? id})? Location field data that used this key may be affected.`,
      {
        title: 'Delete field',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        variant: 'danger',
      }
    )
    if (!ok) return
    try {
      await api.delete(`/locations/schemas/${schemaId}/fields/${id}`)
      setFields((prev) => prev.filter((x) => x.id !== id))
    } catch {
      onError?.('Failed to delete field')
    }
  }

  const sorted = useMemo(
    () => [...fields].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0)),
    [fields]
  )

  const sortableFieldIds = useMemo(() => sorted.map((f) => f.id), [sorted])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function handleFieldDragEnd(event: DragEndEvent) {
    if (reordering || !canWrite) return
    const { active, over } = event
    if (!over || active.id === over.id) return
    const ids = sorted.map((f) => f.id)
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    const next = arrayMove(ids, oldIndex, newIndex)
    void persistFieldOrder(next)
  }

  function handleSelectDragStart(e: React.DragEvent, index: number) {
    setDraggedSelectIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
  }

  function handleSelectDragOver(e: React.DragEvent, index: number) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (draggedSelectIndex === null || draggedSelectIndex === index) return
    setFormSelectRows((rows) => {
      const next = [...rows]
      const [removed] = next.splice(draggedSelectIndex, 1)
      next.splice(index, 0, removed)
      return next
    })
    setDraggedSelectIndex(index)
  }

  function handleSelectDrop(e: React.DragEvent) {
    e.preventDefault()
    setDraggedSelectIndex(null)
  }

  function handleSelectDragEnd() {
    setDraggedSelectIndex(null)
  }

  function sortSelectRowsByValue(ascending: boolean) {
    setFormSelectRows((rows) => {
      const copy = [...rows]
      copy.sort((a, b) => {
        const av = a.value.trim()
        const bv = b.value.trim()
        if (!av && !bv) return 0
        if (!av) return 1
        if (!bv) return -1
        const cmp = localeCompare(av, bv)
        return ascending ? cmp : -cmp
      })
      return copy
    })
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2 border-t border-border pt-8">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Fields</h2>
          <p className="mt-1 text-sm text-foreground/70">
            Custom attributes for locations in zones that use this schema.
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={openCreate}
            className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90"
          >
            Add field
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-foreground/60">Loading…</p>
      ) : (
        <>
          <p className="text-xs text-foreground/65">
            {canWrite
              ? 'Drag the handle to reorder. Order is used in zone forms and tables.'
              : 'View only — editing fields requires location write access.'}
          </p>
          <div className="w-full min-w-0 overflow-x-auto rounded-lg border border-border bg-card p-3">
            {sorted.length === 0 ? (
              <p className="text-sm text-foreground/60">No fields yet.</p>
            ) : canWrite ? (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleFieldDragEnd}>
                <table className="w-full border-collapse text-sm table-auto">
                  <SchemaFieldsTableHead />
                  <tbody className={reordering ? 'pointer-events-none opacity-60' : undefined}>
                    <SortableContext items={sortableFieldIds} strategy={verticalListSortingStrategy}>
                      {sorted.map((f) => (
                        <SortableFieldRow
                          key={f.id}
                          f={f}
                          canWrite={canWrite}
                          onOpenEdit={() => openEdit(f)}
                          onDelete={() => void handleDelete(f.id)}
                        />
                      ))}
                    </SortableContext>
                  </tbody>
                </table>
              </DndContext>
            ) : (
              <table className="w-full border-collapse text-sm table-auto">
                <SchemaFieldsTableHead />
                <tbody>
                  {sorted.map((f) => (
                    <StaticFieldRow
                      key={f.id}
                      f={f}
                      canWrite={canWrite}
                      onOpenEdit={() => openEdit(f)}
                      onDelete={() => void handleDelete(f.id)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {canWrite && editorOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          role="presentation"
        >
          <div
            className={`w-full rounded-xl border border-border bg-card p-5 shadow-lg ${
              formType === 'select' ? 'max-w-2xl' : 'max-w-lg'
            }`}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-2">
              <h2 className="text-base font-semibold text-foreground">
                {editingId ? 'Edit field' : 'New field'}
              </h2>
              <button
                type="button"
                onClick={() => closeEditorModal()}
                className="shrink-0 rounded-lg px-2 py-1 text-sm text-foreground/70 hover:bg-background"
              >
                Close
              </button>
            </div>
            {editorError && (
              <div
                className="mb-4 rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2.5 text-sm text-red-700 dark:text-red-300"
                role="alert"
              >
                {editorError}
              </div>
            )}
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground">Label</label>
                <input
                  type="text"
                  value={formLabel}
                  onChange={(e) => {
                    const v = e.target.value
                    setFormLabel(v)
                    if (!editingId && !formKeyManualRef.current) {
                      const taken = new Set(takenFieldKeys)
                      const current = formKey.trim()
                      if (current) taken.delete(current)
                      setFormKey(suggestUniqueFieldKey(v, taken))
                    }
                  }}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                  autoFocus={!editingId}
                />
              </div>
              {!editingId && (
                <div>
                  <label className="block text-sm font-medium text-foreground">Key</label>
                  <input
                    type="text"
                    value={formKey}
                    onChange={(e) => {
                      formKeyManualRef.current = true
                      setFormKey(e.target.value)
                    }}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
                    spellCheck={false}
                    autoCapitalize="off"
                  />
                  <p className="mt-1 text-xs text-foreground/60">
                    Auto-generated from the label; edit only if you need a different API key. Must be unique in this
                    schema (including code parts).
                  </p>
                </div>
              )}
              {editingId && (
                <div>
                  <label className="block text-sm font-medium text-foreground">Key</label>
                  <p className="mt-1 font-mono text-sm text-foreground/80">{formKey}</p>
                  <p className="mt-1 text-xs text-foreground/60">Key cannot be changed after the field is created.</p>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-foreground">Type</label>
                <select
                  value={formType}
                  onChange={(e) => {
                    const t = e.target.value as LocationSchemaFieldType
                    setFormType(t)
                    if (t === 'select') {
                      setFormSelectRows((rows) =>
                        rows.length ? rows : [{ rid: newRowId(), value: '', description: '' }]
                      )
                    }
                  }}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                  disabled={!!editingId}
                >
                  <option value="number">Number</option>
                  <option value="text">Text</option>
                  <option value="select">Select</option>
                </select>
              </div>
              {formType === 'text' && (
                <div>
                  <label className="block text-sm font-medium text-foreground">Max length (optional)</label>
                  <input
                    type="number"
                    min={1}
                    value={formMaxLength}
                    onChange={(e) => setFormMaxLength(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                  />
                </div>
              )}
              {formType === 'select' && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="block text-sm font-medium text-foreground">Options</label>
                    <div className="flex flex-wrap items-center gap-2">
                      {formSelectRows.length >= 2 && (
                        <>
                          <button
                            type="button"
                            className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-background"
                            onClick={() => sortSelectRowsByValue(true)}
                            title="Sort options by value (A–Z)"
                          >
                            Sort A→Z
                          </button>
                          <button
                            type="button"
                            className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-background"
                            onClick={() => sortSelectRowsByValue(false)}
                            title="Sort options by value (Z–A)"
                          >
                            Sort Z→A
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-background"
                        onClick={() =>
                          setFormSelectRows((rows) => [...rows, { rid: newRowId(), value: '', description: '' }])
                        }
                      >
                        Add option
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-foreground/65">Drag ⋮⋮ to reorder. Order is used in dropdowns and filters.</p>
                  <div className="max-h-64 overflow-y-auto rounded-lg border border-border p-2">
                    <div className="mb-2 grid grid-cols-[auto_1fr_1fr_auto] gap-2 text-xs font-medium text-foreground/70">
                      <span className="w-8 shrink-0" aria-hidden />
                      <span>Value</span>
                      <span>Description</span>
                      <span className="sr-only">Remove</span>
                    </div>
                    <div className="space-y-1">
                      {formSelectRows.map((row, idx) => (
                        <div
                          key={row.rid}
                          className={`grid grid-cols-[auto_1fr_1fr_auto] gap-2 items-center rounded border border-transparent px-1 py-0.5 ${
                            draggedSelectIndex === idx ? 'opacity-50' : 'hover:bg-background/50'
                          }`}
                          onDragOver={(e) => handleSelectDragOver(e, idx)}
                          onDrop={handleSelectDrop}
                        >
                          <span
                            className="flex w-8 shrink-0 cursor-grab select-none justify-center text-foreground/45"
                            title="Drag to reorder"
                            draggable
                            onDragStart={(e) => handleSelectDragStart(e, idx)}
                            onDragEnd={handleSelectDragEnd}
                            aria-label="Drag to reorder"
                          >
                            ⋮⋮
                          </span>
                          <input
                            type="text"
                            value={row.value}
                            onChange={(e) =>
                              setFormSelectRows((rows) =>
                                rows.map((r, i) =>
                                  i === idx ? { ...r, value: e.target.value } : r
                                )
                              )
                            }
                            onDragOver={(e) => handleSelectDragOver(e, idx)}
                            className="min-w-0 rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                          />
                          <input
                            type="text"
                            value={row.description}
                            onChange={(e) =>
                              setFormSelectRows((rows) =>
                                rows.map((r, i) => (i === idx ? { ...r, description: e.target.value } : r))
                              )
                            }
                            onDragOver={(e) => handleSelectDragOver(e, idx)}
                            className="min-w-0 rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                          />
                          <button
                            type="button"
                            className="shrink-0 rounded border border-border px-2 py-1 text-xs text-foreground/70 hover:bg-background disabled:opacity-40"
                            disabled={formSelectRows.length <= 1}
                            onClick={() => setFormSelectRows((rows) => rows.filter((_, i) => i !== idx))}
                            title="Remove row"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => closeEditorModal()}
                  className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  disabled={!formKey.trim() || !formLabel.trim() || saving}
                  title={
                    !formKey.trim() || !formLabel.trim()
                      ? 'Enter a label (key is generated from it)'
                      : undefined
                  }
                >
                  {saving ? 'Saving…' : editingId ? 'Save' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
