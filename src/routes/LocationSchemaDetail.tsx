import { useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, isAbortLikeError } from '../api/client'
import { useAbortableEffect } from '../hooks/useAbortableEffect'
import { SimpleDataTable } from '../components/data/SimpleDataTable'
import { LocationBreadcrumb } from '../components/locations/LocationBreadcrumb'
import { LocationSchemaFieldsEditor } from '../components/locations/LocationSchemaFieldsEditor'
import { useAlertConfirm } from '../contexts/AlertConfirmContext'
import { validateLocationPatternMask } from '../utils/locationPatternMask'
import {
  normalizeLocationSchemaComponent,
  type NormalizedLocationSchemaComponent,
} from '../utils/locationApiRows'
import { useAuthStore } from '../store/authStore'

interface LocationSchema {
  id: string
  name: string
  description?: string | null
}

type SchemaComponent = NormalizedLocationSchemaComponent

const COMPONENT_KEY_MAX_LEN = 64

/** Stable id fragment for JSON / APIs: lowercase, [a-z0-9_], derived from display name. */
function suggestComponentKeyFromDisplayName(displayName: string): string {
  const s = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
  if (!s) return 'part'
  return s.slice(0, COMPONENT_KEY_MAX_LEN)
}

export function LocationSchemaDetail() {
  const canWrite = useAuthStore((s) => s.canEditLocationSchemas())
  const { showConfirm } = useAlertConfirm()
  const { schemaId } = useParams<{ schemaId: string }>()
  const [schema, setSchema] = useState<LocationSchema | null>(null)
  const [components, setComponents] = useState<SchemaComponent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [newComponentOpen, setNewComponentOpen] = useState(false)
  const [newComponentKey, setNewComponentKey] = useState('')
  const [newComponentName, setNewComponentName] = useState('')
  const [newComponentType, setNewComponentType] = useState<'alpha' | 'numeric' | 'mixed' | 'fixed'>('numeric')
  const [newComponentWidth, setNewComponentWidth] = useState<number>(2)
  const [newComponentPatternMask, setNewComponentPatternMask] = useState('')
  const [newComponentFixedValue, setNewComponentFixedValue] = useState('')
  /** When true, display name changes do not overwrite the key field. */
  const newComponentKeyManualRef = useRef(false)

  const [editComponentOpen, setEditComponentOpen] = useState(false)
  const [editComponentId, setEditComponentId] = useState<string | null>(null)
  const [editComponentName, setEditComponentName] = useState('')
  const [editComponentType, setEditComponentType] = useState<'alpha' | 'numeric' | 'mixed' | 'fixed'>('numeric')
  const [editComponentWidth, setEditComponentWidth] = useState<number>(2)
  const [editComponentPatternMask, setEditComponentPatternMask] = useState('')
  const [editComponentFixedValue, setEditComponentFixedValue] = useState('')

  const [editSchemaOpen, setEditSchemaOpen] = useState(false)
  const [editSchemaName, setEditSchemaName] = useState('')
  const [editSchemaDescription, setEditSchemaDescription] = useState('')
  const [savingSchema, setSavingSchema] = useState(false)

  async function load(id: string, signal?: AbortSignal) {
    setLoading(true)
    setError(null)
    try {
      const [schemasResp, compsResp] = await Promise.all([
        api.get<LocationSchema[]>('/locations/schemas', { signal }),
        api.get<SchemaComponent[]>(`/locations/schemas/${id}/components`, { signal }),
      ])
      setSchema(schemasResp.data.find((s) => s.id === id) || null)
      setComponents(compsResp.data.map((row) => normalizeLocationSchemaComponent(row)))
    } catch (e) {
      if (isAbortLikeError(e)) return
      setError('Failed to load schema')
      setSchema(null)
      setComponents([])
    } finally {
      setLoading(false)
    }
  }

  useAbortableEffect(
    (signal) => {
      if (!schemaId) return
      void load(schemaId, signal)
    },
    [schemaId]
  )

  function openNewComponentModal() {
    newComponentKeyManualRef.current = false
    setNewComponentKey('')
    setNewComponentName('')
    setNewComponentType('numeric')
    setNewComponentWidth(2)
    setNewComponentPatternMask('')
    setNewComponentFixedValue('')
    setNewComponentOpen(true)
  }

  async function handleAddComponent(e: React.FormEvent) {
    e.preventDefault()
    const pm = newComponentType === 'mixed' ? newComponentPatternMask.trim() : ''
    if (!schemaId || !newComponentKey.trim() || !newComponentName.trim()) return
    if (newComponentType === 'fixed') {
      if (!newComponentFixedValue.trim()) return
    } else if (!pm && !newComponentWidth) return
    if (pm) {
      const pmErr = validateLocationPatternMask(pm)
      if (pmErr) {
        setError(pmErr)
        return
      }
    }
    try {
      const body: Record<string, unknown> = {
        key: newComponentKey.trim(),
        displayName: newComponentName.trim(),
        type: newComponentType,
      }
      if (newComponentType === 'fixed') {
        body.minValue = newComponentFixedValue.trim()
        body.width = newComponentFixedValue.trim().length
      } else if (newComponentType === 'mixed' && pm) {
        body.patternMask = pm
        body.width = pm.length
      } else {
        body.width = newComponentWidth
      }
      const resp = await api.post<SchemaComponent>(`/locations/schemas/${schemaId}/components`, body)
      setComponents((prev) => [...prev, normalizeLocationSchemaComponent(resp.data)])
      newComponentKeyManualRef.current = false
      setNewComponentKey('')
      setNewComponentName('')
      setNewComponentWidth(2)
      setNewComponentPatternMask('')
      setNewComponentFixedValue('')
      setNewComponentOpen(false)
    } catch {
      setError('Failed to add schema item')
    }
  }

  const sortedComponents = useMemo(() => {
    return [...components].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
  }, [components])

  const [reordering, setReordering] = useState(false)
  const [reorderError, setReorderError] = useState<string | null>(null)

  async function persistOrder(orderedIds: string[]) {
    if (!schemaId) return
    setReordering(true)
    setReorderError(null)
    const prev = components
    setComponents((p) => {
      const map = new Map(p.map((c) => [c.id, c]))
      return orderedIds.map((id, idx) => {
        const c = map.get(id)
        if (!c) return { id, schemaId, key: id, displayName: id, type: 'numeric', width: 1, orderIndex: idx + 1 } as SchemaComponent
        return { ...c, orderIndex: idx + 1 }
      })
    })
    try {
      const resp = await api.put<SchemaComponent[]>(`/locations/schemas/${schemaId}/components/reorder`, {
        orderedIds,
      })
      setComponents(resp.data.map(normalizeLocationSchemaComponent))
    } catch {
      setComponents(prev)
      setReorderError('Failed to save order')
    } finally {
      setReordering(false)
    }
  }

  function moveComponent(id: string, direction: 'up' | 'down') {
    const current = sortedComponents.map((c) => c.id)
    const index = current.indexOf(id)
    if (index === -1) return
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= current.length) return
    const next = [...current]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    void persistOrder(next)
  }

  function openEdit(c: SchemaComponent) {
    const row = normalizeLocationSchemaComponent(c)
    setEditComponentId(row.id)
    setEditComponentName(row.displayName)
    setEditComponentType(row.type)
    setEditComponentWidth(row.width)
    setEditComponentPatternMask(row.patternMask?.trim() ?? '')
    setEditComponentFixedValue(row.minValue?.trim() ?? '')
    setEditComponentOpen(true)
  }

  function openEditSchemaModal() {
    if (!schema) return
    setEditSchemaName(schema.name)
    setEditSchemaDescription(schema.description ?? '')
    setEditSchemaOpen(true)
  }

  async function handleSaveSchemaMeta(e: React.FormEvent) {
    e.preventDefault()
    if (!schemaId || !editSchemaName.trim()) return
    try {
      setSavingSchema(true)
      const resp = await api.put<LocationSchema>(`/locations/schemas/${schemaId}`, {
        name: editSchemaName.trim(),
        description: editSchemaDescription.trim(),
      })
      setSchema(resp.data)
      setEditSchemaOpen(false)
    } catch {
      setError('Failed to save schema')
    } finally {
      setSavingSchema(false)
    }
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!schemaId || !editComponentId) return
    try {
      const pm = editComponentType === 'mixed' ? editComponentPatternMask.trim() : ''
      if (pm) {
        const pmErr = validateLocationPatternMask(pm)
        if (pmErr) {
          setError(pmErr)
          return
        }
      }
      const payload: Record<string, unknown> = {
        displayName: editComponentName.trim(),
        type: editComponentType,
      }
      if (editComponentType === 'fixed') {
        payload.minValue = editComponentFixedValue.trim()
        payload.width = editComponentFixedValue.trim().length
        payload.patternMask = null
      } else {
        payload.width = editComponentType === 'mixed' && pm ? pm.length : editComponentWidth
        payload.patternMask = editComponentType === 'mixed' ? editComponentPatternMask.trim() : null
        payload.minValue = null
        payload.maxValue = null
      }
      const resp = await api.put<SchemaComponent>(
        `/locations/schemas/${schemaId}/components/${editComponentId}`,
        payload
      )
      setComponents((prev) =>
        prev.map((c) => (c.id === editComponentId ? normalizeLocationSchemaComponent(resp.data) : c))
      )
      setEditComponentOpen(false)
      setEditComponentId(null)
    } catch {
      setError('Failed to update schema item')
    }
  }

  async function handleDeleteComponent(c: SchemaComponent) {
    if (!schemaId) return
    const ok = await showConfirm(
      `Delete schema item "${c.displayName}" (${c.key})? Zones using this schema may need locations updated if codes depended on this part.`,
      {
        title: 'Delete schema item',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        variant: 'danger',
      }
    )
    if (!ok) return
    try {
      await api.delete(`/locations/schemas/${schemaId}/components/${c.id}`)
      setComponents((prev) => prev.filter((x) => x.id !== c.id))
      if (editComponentId === c.id) {
        setEditComponentOpen(false)
        setEditComponentId(null)
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to delete schema item'
      setError(msg)
    }
  }

  return (
    <div className="space-y-4">
      <LocationBreadcrumb
        items={[
          { label: 'Locations', to: '/locations' },
          { label: 'Schemas', to: '/locations/schemas' },
          { label: schema?.name ?? 'Schema' },
        ]}
      />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            Schema setup{schema ? `: ${schema.name}` : ''}
          </h1>
          <p className="text-sm text-foreground/70">
            Components define the ordered parts that make up a location code.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canWrite && (
            <>
              <button
                type="button"
                onClick={openEditSchemaModal}
                className="rounded border border-border px-3 py-1.5 text-xs text-foreground hover:bg-background disabled:opacity-50"
                disabled={!schemaId || !schema}
              >
                Edit schema
              </button>
              <button
                type="button"
                onClick={openNewComponentModal}
                className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
                disabled={!schemaId}
              >
                New schema item
              </button>
            </>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {reorderError && <p className="text-sm text-red-500">{reorderError}</p>}

      <p className="text-xs text-foreground/65">
        {canWrite ? 'Drag ⋮⋮ to reorder parts of the location code.' : 'View only — reordering and edits require location write access.'}
      </p>
      <SimpleDataTable
        preferenceKey={`atlas-locations-schema-${schemaId ?? 'unknown'}-components`}
        rows={sortedComponents}
        getRowKey={(c) => c.id}
        onRowClick={canWrite ? (c) => openEdit(c) : undefined}
        enableRowReorder={canWrite}
        disableSort
        disableSearchAndFilters
        onReorder={(orderedIds) => {
          if (!canWrite || reordering) return
          void persistOrder(orderedIds)
        }}
        columns={[
          { key: 'displayName', label: 'Display name', getValue: (c) => c.displayName, width: '18rem' },
          { key: 'key', label: 'Key', getValue: (c) => c.key, width: '10rem' },
          { key: 'type', label: 'Type', getValue: (c) => c.type, width: '10rem' },
          {
            key: 'fixedValue',
            label: 'Fixed',
            getValue: (c) => (c.type === 'fixed' ? (c.minValue ?? '').trim() : ''),
            width: '10rem',
            render: (c) => (
              <span className="font-mono text-xs text-foreground/90">
                {c.type === 'fixed' && (c.minValue ?? '').trim() ? (c.minValue ?? '').trim() : '—'}
              </span>
            ),
          },
          {
            key: 'patternMask',
            label: 'Pattern',
            getValue: (c) => c.patternMask?.trim() ?? '',
            width: '12rem',
            render: (c) => (
              <span className="font-mono text-xs text-foreground/90">
                {c.patternMask?.trim() ? c.patternMask.trim() : '—'}
              </span>
            ),
          },
          { key: 'width', label: 'Chars', getValue: (c) => String(c.width), width: '6rem' },
          {
            key: 'actions',
            label: '',
            width: '11rem',
            getValue: () => '',
            render: (c) => {
              if (!canWrite) {
                return <span className="text-xs text-foreground/50">View only</span>
              }
              return (
              <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-background"
                  onClick={() => openEdit(c as SchemaComponent)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="rounded border border-red-500/50 px-2 py-1 text-xs text-red-500 hover:bg-red-500/10"
                  onClick={() => void handleDeleteComponent(c as SchemaComponent)}
                >
                  Delete
                </button>
              </div>
              )
            },
          },
        ]}
      />

      {schemaId && <LocationSchemaFieldsEditor schemaId={schemaId} onError={(msg) => setError(msg)} />}

      {canWrite && editSchemaOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div
            className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-2">
              <h2 className="text-base font-semibold text-foreground">Edit schema</h2>
              <button
                type="button"
                onClick={() => !savingSchema && setEditSchemaOpen(false)}
                className="shrink-0 rounded-lg px-2 py-1 text-sm text-foreground/70 hover:bg-background"
              >
                Close
              </button>
            </div>
            <form onSubmit={handleSaveSchemaMeta} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground">Name</label>
                <input
                  type="text"
                  value={editSchemaName}
                  onChange={(e) => setEditSchemaName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground">Description</label>
                <textarea
                  value={editSchemaDescription}
                  onChange={(e) => setEditSchemaDescription(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditSchemaOpen(false)}
                  className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
                  disabled={savingSchema}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  disabled={!editSchemaName.trim() || savingSchema}
                >
                  {savingSchema ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {canWrite && newComponentOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div
            className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-2">
              <h2 className="text-base font-semibold text-foreground">New schema item</h2>
              <button
                type="button"
                onClick={() => setNewComponentOpen(false)}
                className="shrink-0 rounded-lg px-2 py-1 text-sm text-foreground/70 hover:bg-background"
              >
                Close
              </button>
            </div>
            <form onSubmit={handleAddComponent} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground">Display name</label>
                <input
                  type="text"
                  value={newComponentName}
                  onChange={(e) => {
                    const v = e.target.value
                    setNewComponentName(v)
                    if (!newComponentKeyManualRef.current) {
                      setNewComponentKey(suggestComponentKeyFromDisplayName(v))
                    }
                  }}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium text-foreground">Key</label>
                  <input
                    type="text"
                    value={newComponentKey}
                    onChange={(e) => {
                      newComponentKeyManualRef.current = true
                      setNewComponentKey(e.target.value)
                    }}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
                    spellCheck={false}
                    autoCapitalize="off"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground">Type</label>
                  <select
                    value={newComponentType}
                    onChange={(e) => {
                      setNewComponentType(e.target.value as 'alpha' | 'numeric' | 'mixed' | 'fixed')
                      setNewComponentPatternMask('')
                      setNewComponentFixedValue('')
                    }}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                  >
                    <option value="numeric">numeric (0–9)</option>
                    <option value="alpha">alpha (A–Z)</option>
                    <option value="mixed">mixed (A–Z and 0–9)</option>
                    <option value="fixed">fixed (literal)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground">Chars</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={newComponentWidth}
                    disabled={
                      newComponentType === 'fixed' ||
                      (newComponentType === 'mixed' && !!newComponentPatternMask.trim())
                    }
                    onChange={(e) =>
                      setNewComponentWidth(
                        e.target.value === '' ? 1 : Math.max(1, Math.min(10, Number(e.target.value)))
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground disabled:opacity-50"
                  />
                </div>
              </div>
              {newComponentType === 'fixed' && (
                <div>
                  <label className="block text-sm font-medium text-foreground">Fixed text</label>
                  <p className="mt-1 mb-1 text-xs text-foreground/60">
                    Shown in location UIs; always included in the location string. Max 32 characters.
                  </p>
                  <input
                    type="text"
                    value={newComponentFixedValue}
                    onChange={(e) => setNewComponentFixedValue(e.target.value)}
                    maxLength={32}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
                    placeholder="e.g. - or SR"
                  />
                </div>
              )}
              {newComponentType === 'mixed' && (
                <div>
                  <label className="block text-sm font-medium text-foreground">Pattern mask (optional)</label>
                  <p className="mt-1 mb-1 text-xs text-foreground/60">
                    @ = letter (A–Z), # = digit (0–9). Any other character is fixed in the value. * is not allowed. If
                    set, length overrides “Chars”.
                  </p>
                  <input
                    type="text"
                    value={newComponentPatternMask}
                    onChange={(e) => {
                      const v = e.target.value
                      setNewComponentPatternMask(v)
                      if (v.trim()) setNewComponentWidth(v.trim().length)
                    }}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
                    placeholder="e.g. @@-##"
                  />
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setNewComponentOpen(false)}
                  className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  disabled={
                    !newComponentKey.trim() ||
                    !newComponentName.trim() ||
                    (newComponentType === 'fixed' && !newComponentFixedValue.trim()) ||
                    (newComponentType !== 'fixed' &&
                      !(newComponentType === 'mixed' && newComponentPatternMask.trim()) &&
                      !newComponentWidth)
                  }
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {canWrite && editComponentOpen && editComponentId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div
            className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-2">
              <h2 className="text-base font-semibold text-foreground">Edit schema item</h2>
              <button
                type="button"
                onClick={() => setEditComponentOpen(false)}
                className="shrink-0 rounded-lg px-2 py-1 text-sm text-foreground/70 hover:bg-background"
              >
                Close
              </button>
            </div>
            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground">Display name</label>
                <input
                  type="text"
                  value={editComponentName}
                  onChange={(e) => setEditComponentName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-foreground">Type</label>
                  <select
                    value={editComponentType}
                    onChange={(e) => {
                      setEditComponentType(e.target.value as 'alpha' | 'numeric' | 'mixed' | 'fixed')
                      setEditComponentPatternMask('')
                      setEditComponentFixedValue('')
                    }}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                  >
                    <option value="numeric">numeric (0–9)</option>
                    <option value="alpha">alpha (A–Z)</option>
                    <option value="mixed">mixed (A–Z and 0–9)</option>
                    <option value="fixed">fixed (literal)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground">Chars</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={editComponentWidth}
                    disabled={
                      editComponentType === 'fixed' ||
                      (editComponentType === 'mixed' && !!editComponentPatternMask.trim())
                    }
                    onChange={(e) =>
                      setEditComponentWidth(
                        e.target.value === '' ? 1 : Math.max(1, Math.min(10, Number(e.target.value)))
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground disabled:opacity-50"
                  />
                </div>
              </div>
              {editComponentType === 'fixed' && (
                <div>
                  <label className="block text-sm font-medium text-foreground">Fixed text</label>
                  <p className="mt-1 mb-1 text-xs text-foreground/60">
                    Shown in location UIs; max 32 characters. Width matches text length.
                  </p>
                  <input
                    type="text"
                    value={editComponentFixedValue}
                    onChange={(e) => setEditComponentFixedValue(e.target.value)}
                    maxLength={32}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
                  />
                </div>
              )}
              {editComponentType === 'mixed' && (
                <div>
                  <label className="block text-sm font-medium text-foreground">Pattern mask (optional)</label>
                  <p className="mt-1 mb-1 text-xs text-foreground/60">
                    @ = letter, # = digit; other characters are literals. * is not allowed. If set, length matches the
                    pattern.
                  </p>
                  <input
                    type="text"
                    value={editComponentPatternMask}
                    onChange={(e) => {
                      const v = e.target.value
                      setEditComponentPatternMask(v)
                      if (v.trim()) setEditComponentWidth(v.trim().length)
                    }}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
                    placeholder="e.g. @@-##"
                  />
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditComponentOpen(false)}
                  className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  disabled={
                    !(editComponentName ?? '').trim() ||
                    (editComponentType === 'fixed' && !editComponentFixedValue.trim()) ||
                    (editComponentType !== 'fixed' &&
                      !(editComponentType === 'mixed' && editComponentPatternMask.trim()) &&
                      !editComponentWidth)
                  }
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default LocationSchemaDetail

