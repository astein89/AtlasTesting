import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { downloadCsvFromApi } from '../utils/downloadCsv'
import { buildMultiZoneLocationsExportFilename } from '../utils/safeFilename'
import { SimpleDataTable } from '../components/data/SimpleDataTable'
import { LocationBreadcrumb } from '../components/locations/LocationBreadcrumb'
import { useAlertConfirm } from '../contexts/AlertConfirmContext'
import { useAuthStore } from '../store/authStore'
import { normalizeLocationZone, type NormalizedLocationZone } from '../utils/locationApiRows'

type Zone = NormalizedLocationZone

interface LocationSchema {
  id: string
  name: string
}

export function LocationZones() {
  const canWrite = useAuthStore((s) => s.canEditLocationsData())
  const { showConfirm } = useAlertConfirm()
  const navigate = useNavigate()
  const [zones, setZones] = useState<Zone[]>([])
  const [schemas, setSchemas] = useState<LocationSchema[]>([])
  const [newZoneName, setNewZoneName] = useState('')
  const [newZoneDescription, setNewZoneDescription] = useState('')
  const [newZoneSchemaId, setNewZoneSchemaId] = useState<string>('')
  const [newZoneOpen, setNewZoneOpen] = useState(false)
  const [editZone, setEditZone] = useState<Zone | null>(null)
  const [editZoneName, setEditZoneName] = useState('')
  const [editZoneDescription, setEditZoneDescription] = useState('')
  const [savingZone, setSavingZone] = useState(false)
  const [selectedZoneIds, setSelectedZoneIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    void refresh()
  }, [])

  async function refresh() {
    const [zonesResp, schemasResp] = await Promise.all([
      api.get<Zone[]>('/locations/zones'),
      api.get<LocationSchema[]>('/locations/schemas'),
    ])
    setZones((zonesResp.data ?? []).map((z) => normalizeLocationZone(z as Record<string, unknown>)))
    setSchemas(schemasResp.data)
    setSelectedZoneIds((prev) => {
      const next = new Set<string>()
      const existing = new Set(
        (zonesResp.data ?? []).map((z) => normalizeLocationZone(z as Record<string, unknown>).id)
      )
      for (const id of prev) if (existing.has(id)) next.add(id)
      return next
    })
  }

  async function handleCreateZone(e: React.FormEvent) {
    e.preventDefault()
    if (schemas.length === 0 || !newZoneName.trim() || !newZoneSchemaId) return
    await api.post('/locations/zones', {
      name: newZoneName.trim(),
      description: newZoneDescription.trim(),
      schemaId: newZoneSchemaId,
    })
    setNewZoneName('')
    setNewZoneDescription('')
    setNewZoneSchemaId('')
    setNewZoneOpen(false)
    void refresh()
  }

  async function handleExportAll() {
    if (zones.length === 0) return
    const orderedIds = zones.map((z) => z.id)
    const ids = orderedIds.join(',')
    const nameById = (id: string) => zones.find((z) => z.id === id)?.name
    try {
      await downloadCsvFromApi('/locations/export', {
        params: { zoneIds: ids },
        filenameFallback: buildMultiZoneLocationsExportFilename(orderedIds, nameById),
      })
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Export failed')
    }
  }

  async function handleExportSelected() {
    if (selectedZoneIds.size === 0) return
    const orderedIds = Array.from(selectedZoneIds)
    const ids = orderedIds.join(',')
    const nameById = (id: string) => zones.find((z) => z.id === id)?.name
    try {
      await downloadCsvFromApi('/locations/export', {
        params: { zoneIds: ids },
        filenameFallback: buildMultiZoneLocationsExportFilename(orderedIds, nameById),
      })
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Export failed')
    }
  }

  function openEditZone(z: Zone) {
    setEditZone(z)
    setEditZoneName(z.name)
    setEditZoneDescription(z.description ?? '')
  }

  async function handleSaveZone(e: React.FormEvent) {
    e.preventDefault()
    if (!editZone || !editZoneName.trim()) return
    try {
      setSavingZone(true)
      await api.put(`/locations/zones/${editZone.id}`, {
        name: editZoneName.trim(),
        description: editZoneDescription.trim(),
      })
      setEditZone(null)
      void refresh()
    } catch {
      // eslint-disable-next-line no-alert
      window.alert('Failed to save zone')
    } finally {
      setSavingZone(false)
    }
  }

  async function handleDeleteZone(zoneId: string) {
    const z = zones.find((x) => x.id === zoneId)
    const ok = await showConfirm(
      `Delete zone "${z?.name ?? 'this zone'}"? All locations in this zone will be removed. This cannot be undone.`,
      {
        title: 'Delete zone',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        variant: 'danger',
      }
    )
    if (!ok) return
    try {
      await api.delete(`/locations/zones/${zoneId}`)
      setSelectedZoneIds((prev) => {
        const next = new Set(prev)
        next.delete(zoneId)
        return next
      })
      void refresh()
    } catch {
      // eslint-disable-next-line no-alert
      window.alert('Failed to delete zone')
    }
  }

  return (
    <div className="space-y-4">
      <LocationBreadcrumb items={[{ label: 'Locations' }]} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Locations</h1>
          <p className="text-sm text-foreground/70">
            Manage locations and navigate into a zone to generate and view locations.
          </p>
          {schemas.length === 0 && (
            <p className="mt-2 text-sm text-foreground/80">
              <Link to="/locations/schemas" className="font-medium text-primary hover:underline">
                Create at least one location schema
              </Link>{' '}
              before you can add a zone.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canWrite && (
            <button
              type="button"
              onClick={async () => {
                if (schemas.length === 0) {
                  const go = await showConfirm(
                    'Every zone is tied to a location schema. Create at least one schema first, then come back here to add a zone.',
                    {
                      title: 'Create a schema first',
                      confirmLabel: 'Go to Schemas',
                      cancelLabel: 'Cancel',
                      variant: 'default',
                    }
                  )
                  if (go) navigate('/locations/schemas')
                  return
                }
                setNewZoneName('')
                setNewZoneDescription('')
                setNewZoneSchemaId(schemas[0]?.id ?? '')
                setNewZoneOpen(true)
              }}
              title="Add a new zone"
              className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90"
            >
              New zone
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleExportSelected}
          className="rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-card disabled:opacity-50"
          disabled={selectedZoneIds.size === 0}
          title={selectedZoneIds.size === 0 ? 'Select one or more zones first' : 'Export selected zones (CSV)'}
        >
          Export selected (CSV)
        </button>
        <button
          type="button"
          onClick={handleExportAll}
          className="rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-card disabled:opacity-50"
          disabled={zones.length === 0}
        >
          Export all (CSV)
        </button>
      </div>
      {canWrite && editZone && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div
            className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-2">
              <h2 className="text-base font-semibold text-foreground">Edit zone</h2>
              <button
                type="button"
                onClick={() => setEditZone(null)}
                className="shrink-0 rounded-lg px-2 py-1 text-sm text-foreground/70 hover:bg-background"
              >
                Close
              </button>
            </div>
            <form onSubmit={handleSaveZone} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground">Name</label>
                <input
                  type="text"
                  value={editZoneName}
                  onChange={(e) => setEditZoneName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground">Description</label>
                <textarea
                  value={editZoneDescription}
                  onChange={(e) => setEditZoneDescription(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                />
              </div>
              <p className="text-xs text-foreground/60">
                Schema is fixed for this zone: <span className="font-medium">{editZone.schemaName}</span>
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditZone(null)}
                  className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
                  disabled={savingZone}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  disabled={!editZoneName.trim() || savingZone}
                >
                  {savingZone ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {canWrite && newZoneOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div
            className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-2">
              <h2 className="text-base font-semibold text-foreground">New zone</h2>
              <button
                type="button"
                onClick={() => setNewZoneOpen(false)}
                className="shrink-0 rounded-lg px-2 py-1 text-sm text-foreground/70 hover:bg-background"
              >
                Close
              </button>
            </div>
            <form onSubmit={handleCreateZone} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground">Name</label>
                <input
                  type="text"
                  value={newZoneName}
                  onChange={(e) => setNewZoneName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground">Description</label>
                <textarea
                  value={newZoneDescription}
                  onChange={(e) => setNewZoneDescription(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                />
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-sm font-medium text-foreground">Schema</label>
                  <Link
                    to="/locations/schemas"
                    className="text-xs text-primary hover:underline"
                    onClick={() => setNewZoneOpen(false)}
                    title="Open schema editor to add a new schema"
                  >
                    Add new schema
                  </Link>
                </div>
                <select
                  value={newZoneSchemaId}
                  onChange={(e) => setNewZoneSchemaId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                >
                  <option value="">Select schema…</option>
                  {schemas.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {schemas.length === 0 && (
                  <p className="mt-1 text-xs text-foreground/60">
                    No schemas yet. Use “Add new schema” to create one first.
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setNewZoneOpen(false)}
                  className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  disabled={!newZoneName.trim() || !newZoneSchemaId}
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <SimpleDataTable
        preferenceKey="atlas-locations-zones"
        rows={zones}
        getRowKey={(z) => z.id}
        enableSelection
        selectedKeys={selectedZoneIds}
        onSelectedKeysChange={setSelectedZoneIds}
        onRowClick={(z) => {
          navigate(`/locations/zones/${z.id}`)
        }}
        columns={[
          { key: 'name', label: 'Zone', getValue: (z) => z.name, width: '16rem' },
          { key: 'schema', label: 'Schema', getValue: (z) => z.schemaName, width: '16rem' },
          { key: 'count', label: 'Locations', getValue: (z) => String(z.locationCount), width: '10rem' },
          {
            key: 'actions',
            label: '',
            width: '8rem',
            getValue: () => '',
            render: (z) => {
              if (!canWrite) {
                return <span className="text-xs text-foreground/50">View only</span>
              }
              return (
              <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-background"
                  onClick={() => openEditZone(z as Zone)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="rounded border border-red-500/50 px-2 py-1 text-xs text-red-500 hover:bg-red-500/10"
                  onClick={() => void handleDeleteZone((z as Zone).id)}
                >
                  Delete
                </button>
              </div>
              )
            },
          },
        ]}
      />
    </div>
  )
}

export default LocationZones

