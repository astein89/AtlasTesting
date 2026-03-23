import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import { SimpleDataTable } from '../data/SimpleDataTable'
import type { LocationSchemaField, LocationSchemaFieldConfig, LocationSchemaFieldType } from '../../types/locationSchemaFields'
import { uppercaseAsciiLetters } from '../../utils/asciiString'
import { useAlertConfirm } from '../../contexts/AlertConfirmContext'

interface SelectOptionRow {
  value: string
  description: string
}

function selectRowsFromConfig(config: LocationSchemaFieldConfig): SelectOptionRow[] {
  const opts = config.options ?? []
  const descs = config.optionDescriptions
  if (opts.length === 0) return [{ value: '', description: '' }]
  return opts.map((value, i) => ({
    value: uppercaseAsciiLetters(String(value)),
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

interface LocationSchemaFieldsEditorProps {
  schemaId: string
  onError?: (message: string) => void
}

export function LocationSchemaFieldsEditor({ schemaId, onError }: LocationSchemaFieldsEditorProps) {
  const { showConfirm } = useAlertConfirm()
  const [fields, setFields] = useState<LocationSchemaField[]>([])
  const [loading, setLoading] = useState(true)

  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formKey, setFormKey] = useState('')
  const [formLabel, setFormLabel] = useState('')
  const [formType, setFormType] = useState<LocationSchemaFieldType>('text')
  const [formMaxLength, setFormMaxLength] = useState('')
  const [formSelectRows, setFormSelectRows] = useState<SelectOptionRow[]>([{ value: '', description: '' }])
  const [saving, setSaving] = useState(false)
  const [reordering, setReordering] = useState(false)

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

  function openCreate() {
    setEditingId(null)
    setFormKey('')
    setFormLabel('')
    setFormType('text')
    setFormMaxLength('')
    setFormSelectRows([{ value: '', description: '' }])
    setEditorOpen(true)
  }

  function openEdit(f: LocationSchemaField) {
    setEditingId(f.id)
    setFormKey(f.key)
    setFormLabel(f.label)
    setFormType(f.type)
    setFormMaxLength(f.type === 'text' && f.config.maxLength != null ? String(f.config.maxLength) : '')
    setFormSelectRows(f.type === 'select' ? selectRowsFromConfig(f.config) : [{ value: '', description: '' }])
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

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!formKey.trim() || !formLabel.trim()) return
    if (formType === 'select') {
      const opts = formSelectRows.map((r) => r.value.trim()).filter(Boolean)
      if (opts.length === 0) {
        onError?.('Select fields need at least one option')
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
      setEditorOpen(false)
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to save field'
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

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2 border-t border-border pt-8">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Fields</h2>
          <p className="mt-1 text-sm text-foreground/70">Drag rows to change order. Order is used in zone forms and tables.</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90"
        >
          Add field
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-foreground/60">Loading…</p>
      ) : (
        <SimpleDataTable
          preferenceKey={`atlas-locations-schema-${schemaId}-custom-fields`}
          rows={sorted}
          getRowKey={(f) => f.id}
          onRowClick={(f) => openEdit(f)}
          enableRowReorder
          onReorder={(orderedIds) => {
            if (reordering) return
            void persistFieldOrder(orderedIds)
          }}
          disableSort
          disableSearchAndFilters
          columns={[
            { key: 'label', label: 'Label', getValue: (f) => f.label, width: '14rem' },
            { key: 'key', label: 'Key', getValue: (f) => f.key, width: '10rem' },
            { key: 'type', label: 'Type', getValue: (f) => f.type, width: '8rem' },
            {
              key: 'summary',
              label: 'Details',
              getValue: (f) => summarizeConfig(f.type, f.config),
            },
            {
              key: 'actions',
              label: '',
              width: '11rem',
              getValue: () => '',
              render: (f) => (
                <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-background"
                    onClick={() => openEdit(f)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="rounded border border-red-500/50 px-2 py-1 text-xs text-red-500 hover:bg-red-500/10"
                    onClick={() => void handleDelete(f.id)}
                  >
                    Delete
                  </button>
                </div>
              ),
            },
          ]}
        />
      )}

      {editorOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => !saving && setEditorOpen(false)}
        >
          <div
            className={`w-full rounded-xl border border-border bg-card p-5 shadow-lg ${
              formType === 'select' ? 'max-w-2xl' : 'max-w-lg'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-2">
              <h2 className="text-base font-semibold text-foreground">
                {editingId ? 'Edit field' : 'New field'}
              </h2>
              <button
                type="button"
                onClick={() => !saving && setEditorOpen(false)}
                className="shrink-0 rounded-lg px-2 py-1 text-sm text-foreground/70 hover:bg-background"
              >
                Close
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              {!editingId && (
                <div>
                  <label className="block text-sm font-medium text-foreground">Key</label>
                  <input
                    type="text"
                    value={formKey}
                    onChange={(e) => setFormKey(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                    autoFocus
                    disabled={!!editingId}
                  />
                </div>
              )}
              {editingId && (
                <div>
                  <label className="block text-sm font-medium text-foreground">Key</label>
                  <p className="mt-1 font-mono text-sm text-foreground/80">{formKey}</p>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-foreground">Label</label>
                <input
                  type="text"
                  value={formLabel}
                  onChange={(e) => setFormLabel(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground">Type</label>
                <select
                  value={formType}
                  onChange={(e) => {
                    const t = e.target.value as LocationSchemaFieldType
                    setFormType(t)
                    if (t === 'select') {
                      setFormSelectRows((rows) => (rows.length ? rows : [{ value: '', description: '' }]))
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
                  <div className="flex items-center justify-between gap-2">
                    <label className="block text-sm font-medium text-foreground">Options</label>
                    <button
                      type="button"
                      className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-background"
                      onClick={() =>
                        setFormSelectRows((rows) => [...rows, { value: '', description: '' }])
                      }
                    >
                      Add option
                    </button>
                  </div>
                  <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-border p-2">
                    <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-medium text-foreground/70">
                      <span>Value</span>
                      <span>Description</span>
                      <span className="sr-only">Remove</span>
                    </div>
                    {formSelectRows.map((row, idx) => (
                      <div key={idx} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                        <input
                          type="text"
                          value={row.value}
                          onChange={(e) =>
                            setFormSelectRows((rows) =>
                              rows.map((r, i) =>
                                i === idx ? { ...r, value: uppercaseAsciiLetters(e.target.value) } : r
                              )
                            )
                          }
                          className="rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                        />
                        <input
                          type="text"
                          value={row.description}
                          onChange={(e) =>
                            setFormSelectRows((rows) =>
                              rows.map((r, i) => (i === idx ? { ...r, description: e.target.value } : r))
                            )
                          }
                          className="rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                        />
                        <button
                          type="button"
                          className="rounded border border-border px-2 py-1 text-xs text-foreground/70 hover:bg-background disabled:opacity-40"
                          disabled={formSelectRows.length <= 1}
                          onClick={() =>
                            setFormSelectRows((rows) => rows.filter((_, i) => i !== idx))
                          }
                          title="Remove row"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditorOpen(false)}
                  className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  disabled={!formKey.trim() || !formLabel.trim() || saving}
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
