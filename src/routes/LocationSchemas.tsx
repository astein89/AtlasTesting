import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { SimpleDataTable } from '../components/data/SimpleDataTable'
import { LocationBreadcrumb } from '../components/locations/LocationBreadcrumb'

interface LocationSchema {
  id: string
  name: string
  description?: string | null
  codePattern?: string | null
}

export function LocationSchemas() {
  const [schemas, setSchemas] = useState<LocationSchema[]>([])
  const [newSchemaName, setNewSchemaName] = useState('')
  const [newSchemaOpen, setNewSchemaOpen] = useState(false)
  const [editSchema, setEditSchema] = useState<LocationSchema | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editCodePattern, setEditCodePattern] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    void refreshSchemas()
  }, [])

  async function refreshSchemas() {
    const { data } = await api.get<LocationSchema[]>('/locations/schemas')
    setSchemas(data)
  }

  async function handleCreateSchema(e: React.FormEvent) {
    e.preventDefault()
    if (!newSchemaName.trim()) return
    await api.post('/locations/schemas', { name: newSchemaName.trim() })
    setNewSchemaName('')
    setNewSchemaOpen(false)
    void refreshSchemas()
  }

  function openEditSchema(s: LocationSchema) {
    setEditSchema(s)
    setEditName(s.name)
    setEditDescription(s.description ?? '')
    setEditCodePattern(s.codePattern ?? '')
  }

  async function handleSaveEditSchema(e: React.FormEvent) {
    e.preventDefault()
    if (!editSchema || !editName.trim()) return
    try {
      setSavingEdit(true)
      await api.put(`/locations/schemas/${editSchema.id}`, {
        name: editName.trim(),
        description: editDescription.trim(),
        codePattern: editCodePattern.trim(),
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

  async function handleDeleteSchema(schemaId: string) {
    const s = schemas.find((x) => x.id === schemaId)
    const ok = window.confirm(`Delete schema "${s?.name ?? 'this schema'}"?`)
    if (!ok) return
    try {
      await api.delete(`/locations/schemas/${schemaId}`)
      void refreshSchemas()
    } catch (e: any) {
      const msg = (e?.response?.data?.error as string | undefined) ?? 'Failed to delete schema'
      // eslint-disable-next-line no-alert
      window.alert(msg)
    }
  }

  return (
    <div className="space-y-4">
      <LocationBreadcrumb
        items={[{ label: 'Locations', to: '/locations' }, { label: 'Schemas' }]}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-foreground">Location schemas</h1>
        <button
          type="button"
          onClick={() => setNewSchemaOpen(true)}
          className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90"
        >
          New schema
        </button>
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
            key: 'actions',
            label: '',
            width: '11rem',
            getValue: () => '',
            render: (s) => (
              <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-background"
                  onClick={() => openEditSchema(s as LocationSchema)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="rounded border border-red-500/50 px-2 py-1 text-xs text-red-500 hover:bg-red-500/10"
                  onClick={() => void handleDeleteSchema((s as LocationSchema).id)}
                >
                  Delete
                </button>
              </div>
            ),
          },
        ]}
      />
        {editSchema && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
            onClick={() => !savingEdit && setEditSchema(null)}
          >
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
                <div>
                  <label className="block text-sm font-medium text-foreground">Code pattern</label>
                  <input
                    type="text"
                    value={editCodePattern}
                    onChange={(e) => setEditCodePattern(e.target.value)}
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
        {newSchemaOpen && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
            onClick={() => setNewSchemaOpen(false)}
          >
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

