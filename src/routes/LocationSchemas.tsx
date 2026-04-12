import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { SimpleDataTable } from '../components/data/SimpleDataTable'
import { LocationBreadcrumb } from '../components/locations/LocationBreadcrumb'
import { useAlertConfirm } from '../contexts/AlertConfirmContext'
import { useAuthStore } from '../store/authStore'

interface LocationSchema {
  id: string
  name: string
  description?: string | null
}

interface ZoneRow {
  id: string
  name: string
  schemaId: string
}

export function LocationSchemas() {
  const canWrite = useAuthStore((s) => s.canEditLocationSchemas())
  const { showConfirm, showAlert } = useAlertConfirm()
  const [schemas, setSchemas] = useState<LocationSchema[]>([])
  const [zones, setZones] = useState<ZoneRow[]>([])
  const [newSchemaName, setNewSchemaName] = useState('')
  const [newSchemaDescription, setNewSchemaDescription] = useState('')
  const [newSchemaOpen, setNewSchemaOpen] = useState(false)
  const [editSchema, setEditSchema] = useState<LocationSchema | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)
  const [duplicateSource, setDuplicateSource] = useState<LocationSchema | null>(null)
  const [duplicateNewName, setDuplicateNewName] = useState('')
  const [duplicateNewDescription, setDuplicateNewDescription] = useState('')
  const navigate = useNavigate()

  function defaultDuplicateName(name: string): string {
    const t = name.trim()
    return t ? `${t} (copy)` : '(copy)'
  }

  useEffect(() => {
    void refreshSchemas()
  }, [])

  async function refreshSchemas() {
    const [schemasResp, zonesResp] = await Promise.all([
      api.get<LocationSchema[]>('/locations/schemas'),
      api.get<ZoneRow[]>('/locations/zones'),
    ])
    setSchemas(schemasResp.data)
    setZones(zonesResp.data)
  }

  /** Zone names using this schema, sorted for display. */
  function zoneNamesForSchema(schemaId: string): string[] {
    return zones
      .filter((z) => z.schemaId === schemaId)
      .map((z) => z.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  }

  function schemaDeleteBlockedReason(schemaId: string): string | null {
    const using = zones.filter((z) => z.schemaId === schemaId)
    if (using.length === 0) return null
    const maxList = 8
    const names = using.map((z) => z.name)
    const shown = names.slice(0, maxList).join(', ')
    const extra = names.length > maxList ? ` (+${names.length - maxList} more)` : ''
    const n = using.length
    const zoneWord = n === 1 ? 'zone' : 'zones'
    return `This schema is used by ${n} ${zoneWord}: ${shown}${extra}. Remove or reassign those zones first.`
  }

  async function handleCreateSchema(e: React.FormEvent) {
    e.preventDefault()
    if (!newSchemaName.trim()) return
    try {
      const { data } = await api.post<LocationSchema>('/locations/schemas', {
        name: newSchemaName.trim(),
        description: newSchemaDescription.trim() || undefined,
      })
      setNewSchemaName('')
      setNewSchemaDescription('')
      setNewSchemaOpen(false)
      void refreshSchemas()
      navigate(`/locations/schemas/${data.id}`)
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to create schema'
      showAlert(msg, 'Create failed')
    }
  }

  function openEditSchema(s: LocationSchema) {
    setEditSchema(s)
    setEditName(s.name)
    setEditDescription(s.description ?? '')
  }

  async function handleSaveEditSchema(e: React.FormEvent) {
    e.preventDefault()
    if (!editSchema || !editName.trim()) return
    try {
      setSavingEdit(true)
      await api.put(`/locations/schemas/${editSchema.id}`, {
        name: editName.trim(),
        description: editDescription.trim(),
      })
      setEditSchema(null)
      void refreshSchemas()
    } catch {
      // eslint-disable-next-line no-alert
      window.alert('Failed to save schema')
    } finally {
      setSavingEdit(false)
    }
  }

  function openDuplicateModal(row: LocationSchema) {
    setDuplicateSource(row)
    setDuplicateNewName(defaultDuplicateName(row.name))
    setDuplicateNewDescription(row.description ?? '')
  }

  async function handleSubmitDuplicate(e: React.FormEvent) {
    e.preventDefault()
    if (!duplicateSource || !duplicateNewName.trim()) return
    setDuplicatingId(duplicateSource.id)
    try {
      const { data } = await api.post<LocationSchema>(`/locations/schemas/${duplicateSource.id}/duplicate`, {
        name: duplicateNewName.trim(),
        description: duplicateNewDescription.trim(),
      })
      setDuplicateSource(null)
      void refreshSchemas()
      navigate(`/locations/schemas/${data.id}`)
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to duplicate schema'
      showAlert(msg, 'Duplicate failed')
    } finally {
      setDuplicatingId(null)
    }
  }

  async function handleDeleteSchema(schemaId: string) {
    const blocked = schemaDeleteBlockedReason(schemaId)
    if (blocked) {
      showAlert(blocked, 'Cannot delete schema')
      return
    }
    const s = schemas.find((x) => x.id === schemaId)
    const ok = await showConfirm(
      `Delete schema "${s?.name ?? 'this schema'}"? This will remove its component definitions and custom fields. This cannot be undone.`,
      {
        title: 'Delete schema',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        variant: 'danger',
      }
    )
    if (!ok) return
    try {
      await api.delete(`/locations/schemas/${schemaId}`)
      void refreshSchemas()
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to delete schema'
      showAlert(msg, 'Delete failed')
    }
  }

  return (
    <div className="space-y-4">
      <LocationBreadcrumb
        items={[{ label: 'Locations', to: '/locations' }, { label: 'Schemas' }]}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-foreground">Location schemas</h1>
        {canWrite && (
          <button
            type="button"
            onClick={() => setNewSchemaOpen(true)}
            className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90"
          >
            New schema
          </button>
        )}
      </div>
      <p className="text-sm text-foreground/70">
        Define schemas and their components. Zones use these schemas when generating locations.
      </p>

      <SimpleDataTable
        preferenceKey="atlas-locations-schemas"
        rows={schemas}
        getRowKey={(s) => s.id}
        onRowClick={(s) => navigate(`/locations/schemas/${s.id}`)}
        columns={[
          { key: 'name', label: 'Schema', getValue: (s) => s.name, width: '18rem' },
          { key: 'description', label: 'Description', getValue: (s) => s.description ?? '' },
          {
            key: 'zones',
            label: 'Zones',
            width: '16rem',
            getValue: (s) => zoneNamesForSchema(s.id).join(', '),
            render: (s) => {
              const row = s as LocationSchema
              const names = zoneNamesForSchema(row.id)
              if (names.length === 0) {
                return <span className="text-sm text-foreground/45">—</span>
              }
              const text = names.join(', ')
              return (
                <span className="text-sm text-foreground/90" title={text}>
                  {text}
                </span>
              )
            },
          },
          {
            key: 'actions',
            label: '',
            width: '14rem',
            getValue: () => '',
            render: (s) => {
              const row = s as LocationSchema
              const deleteBlocked = schemaDeleteBlockedReason(row.id)
              if (!canWrite) {
                return <span className="text-xs text-foreground/50">View only</span>
              }
              return (
              <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-background"
                  onClick={() => openEditSchema(row)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-background disabled:opacity-50"
                  disabled={duplicatingId === row.id}
                  title="Copy this schema’s components and fields"
                  onClick={() => openDuplicateModal(row)}
                >
                  {duplicatingId === row.id ? '…' : 'Duplicate'}
                </button>
                <button
                  type="button"
                  className="rounded border border-red-500/50 px-2 py-1 text-xs text-red-500 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!!deleteBlocked}
                  title={deleteBlocked ?? 'Delete this schema'}
                  onClick={() => void handleDeleteSchema(row.id)}
                >
                  Delete
                </button>
              </div>
              )
            },
          },
        ]}
      />
        {canWrite && duplicateSource && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
            <div
              className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-start justify-between gap-2">
                <h2 className="text-base font-semibold text-foreground">Duplicate schema</h2>
                <button
                  type="button"
                  onClick={() => !duplicatingId && setDuplicateSource(null)}
                  className="shrink-0 rounded-lg px-2 py-1 text-sm text-foreground/70 hover:bg-background"
                  disabled={!!duplicatingId}
                >
                  Close
                </button>
              </div>
              <p className="mb-4 text-sm text-foreground/75">
                Components and custom fields are copied. Zones and location rows are not.
              </p>
              <form onSubmit={handleSubmitDuplicate} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground">New schema name</label>
                  <input
                    type="text"
                    value={duplicateNewName}
                    onChange={(e) => setDuplicateNewName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                    autoFocus
                    disabled={!!duplicatingId}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground">Description</label>
                  <textarea
                    value={duplicateNewDescription}
                    onChange={(e) => setDuplicateNewDescription(e.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                    disabled={!!duplicatingId}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setDuplicateSource(null)}
                    className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
                    disabled={!!duplicatingId}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    disabled={!duplicateNewName.trim() || !!duplicatingId}
                  >
                    {duplicatingId ? 'Duplicating…' : 'Duplicate'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        {canWrite && editSchema && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
            <div
              className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-start justify-between gap-2">
                <h2 className="text-base font-semibold text-foreground">Edit schema</h2>
                <button
                  type="button"
                  onClick={() => !savingEdit && setEditSchema(null)}
                  className="shrink-0 rounded-lg px-2 py-1 text-sm text-foreground/70 hover:bg-background"
                >
                  Close
                </button>
              </div>
              <form onSubmit={handleSaveEditSchema} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground">Name</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground">Description</label>
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditSchema(null)}
                    className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
                    disabled={savingEdit}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    disabled={!editName.trim() || savingEdit}
                  >
                    {savingEdit ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        {canWrite && newSchemaOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
            <div
              className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-start justify-between gap-2">
                <h2 className="text-base font-semibold text-foreground">New schema</h2>
                <button
                  type="button"
                  onClick={() => setNewSchemaOpen(false)}
                  className="shrink-0 rounded-lg px-2 py-1 text-sm text-foreground/70 hover:bg-background"
                >
                  Close
                </button>
              </div>
              <form onSubmit={handleCreateSchema} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground">Name</label>
                  <input
                    type="text"
                    value={newSchemaName}
                    onChange={(e) => setNewSchemaName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground">Description</label>
                  <textarea
                    value={newSchemaDescription}
                    onChange={(e) => setNewSchemaDescription(e.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setNewSchemaOpen(false)}
                    className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    disabled={!newSchemaName.trim()}
                  >
                    Create
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

    </div>
  )
}

export default LocationSchemas

