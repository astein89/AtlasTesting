import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api/client'
import { SimpleDataTable, type SimpleColumn } from '../components/data/SimpleDataTable'
import { LocationBreadcrumb } from '../components/locations/LocationBreadcrumb'
import { useAlertConfirm } from '../contexts/AlertConfirmContext'
import { formatSelectOptionLabel, selectOptionTitle, type LocationSchemaField } from '../types/locationSchemaFields'
import { uppercaseAsciiLetters } from '../utils/asciiString'
import { downloadCsvFromApi } from '../utils/downloadCsv'
import { sanitizeFilenameSegment } from '../utils/safeFilename'

interface Zone {
  id: string
  name: string
  description?: string | null
  schemaId: string
  schemaName: string
}

interface LocationRow {
  id: string
  code: string
  components: Record<string, string>
  fieldValues?: Record<string, unknown>
}

function csvEscapeCell(val: string): string {
  const s = val ?? ''
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

interface SchemaComponent {
  id: string
  schemaId: string
  key: string
  displayName: string
  type: 'alpha' | 'numeric'
  width: number
}

/** Client-side validation aligned with server rules for location component values. */
function validateLocationComponentValue(c: SchemaComponent, raw: string): string | null {
  const s = raw.trim()
  if (!s) return 'A value is required.'
  if (c.type === 'numeric') {
    if (!/^\d+$/.test(s)) return 'Use digits only (0–9).'
    const n = Number(s)
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      return 'Enter a valid non-negative whole number.'
    }
    const padded = String(Math.trunc(n)).padStart(c.width, '0')
    if (padded.length > c.width) {
      return `Must fit within ${c.width} digit(s).`
    }
    return null
  }
  if (!/^[A-Za-z]+$/.test(s)) return 'Use letters A–Z only (no numbers or spaces).'
  if (s.length > c.width) return `At most ${c.width} letter(s).`
  return null
}

/** Restrict typing to allowed characters and schema width (matches server normalization). */
function sanitizeLocationComponentInput(c: SchemaComponent, value: string): string {
  if (value === '') return ''
  if (c.type === 'numeric') {
    return value.replace(/\D/g, '').slice(0, c.width)
  }
  return value.replace(/[^A-Za-z]/g, '').slice(0, c.width).toUpperCase()
}

function validateSchemaFieldInput(f: LocationSchemaField, raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  if (f.type === 'number') {
    const n = Number(s)
    if (!Number.isFinite(n)) return 'Invalid number'
    return null
  }
  if (f.type === 'text') {
    const max = f.config.maxLength
    if (max != null && s.length > max) return `At most ${max} character(s)`
    return null
  }
  if (f.type === 'select') {
    const opts = f.config.options ?? []
    if (opts.length === 0) return 'No options configured'
    if (!opts.includes(s)) return 'Choose a valid option'
    return null
  }
  return null
}

export function LocationZoneDetail() {
  const { showConfirm } = useAlertConfirm()
  const { zoneId } = useParams<{ zoneId: string }>()
  const [zone, setZone] = useState<Zone | null>(null)
  const [locations, setLocations] = useState<LocationRow[]>([])
  const [components, setComponents] = useState<SchemaComponent[]>([])
  const [schemaFields, setSchemaFields] = useState<LocationSchemaField[]>([])
  const [ranges, setRanges] = useState<Record<string, string>>({})
  const [generateFieldValues, setGenerateFieldValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [selectedLocationIds, setSelectedLocationIds] = useState<Set<string>>(new Set())
  const [exportChoiceOpen, setExportChoiceOpen] = useState(false)
  const [tableFilterActive, setTableFilterActive] = useState(false)
  const [filteredRowsSnapshot, setFilteredRowsSnapshot] = useState<LocationRow[]>([])

  const [editZoneOpen, setEditZoneOpen] = useState(false)
  const [zoneNameEdit, setZoneNameEdit] = useState('')
  const [zoneDescriptionEdit, setZoneDescriptionEdit] = useState('')
  const [savingZone, setSavingZone] = useState(false)
  const [editingLocation, setEditingLocation] = useState<LocationRow | null>(null)
  const [editLocationComponents, setEditLocationComponents] = useState<Record<string, string>>({})
  const [savingLocation, setSavingLocation] = useState(false)
  const [bulkLocationsOpen, setBulkLocationsOpen] = useState(false)
  const [bulkLocationPatch, setBulkLocationPatch] = useState<Record<string, string>>({})
  const [bulkLocationFieldErrors, setBulkLocationFieldErrors] = useState<Record<string, string>>({})
  const [savingBulkLocations, setSavingBulkLocations] = useState(false)
  const [bulkFieldPatch, setBulkFieldPatch] = useState<Record<string, string>>({})
  const [bulkSchemaFieldErrors, setBulkSchemaFieldErrors] = useState<Record<string, string>>({})
  const [editLocationFieldErrors, setEditLocationFieldErrors] = useState<Record<string, string>>({})
  const [editLocationSchemaFieldValues, setEditLocationSchemaFieldValues] = useState<Record<string, string>>({})
  const [editLocationSchemaFieldErrors, setEditLocationSchemaFieldErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!zoneId) return
    void loadZoneAndSchema(zoneId)
    void refreshLocations(zoneId)
  }, [zoneId])

  async function loadZoneAndSchema(id: string) {
    const zonesResp = await api.get<Zone[]>('/locations/zones')
    const z = zonesResp.data.find((row) => row.id === id) || null
    setZone(z)
    if (z) {
      const [comps, fieldsResp] = await Promise.all([
        api.get<SchemaComponent[]>(`/locations/schemas/${z.schemaId}/components`),
        api.get<LocationSchemaField[]>(`/locations/schemas/${z.schemaId}/fields`),
      ])
      setComponents(comps.data)
      setSchemaFields(fieldsResp.data)
      const initial: Record<string, string> = {}
      for (const c of comps.data) initial[c.key] = ''
      setRanges(initial)
    } else {
      setSchemaFields([])
    }
  }

  async function refreshLocations(id: string) {
    setError(null)
    try {
      const { data } = await api.get<LocationRow[]>(`/locations/zones/${id}/locations`)
      setLocations(
        data.map((r) => ({
          ...r,
          components: (r as LocationRow).components || {},
          fieldValues: (r as LocationRow).fieldValues ?? {},
        }))
      )
      setSelectedLocationIds((prev) => {
        const next = new Set<string>()
        const existing = new Set((data ?? []).map((l) => l.id))
        for (const sel of prev) if (existing.has(sel)) next.add(sel)
        return next
      })
    } catch {
      setError('Failed to load locations')
      setLocations([])
      setSelectedLocationIds(new Set())
    }
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault()
    if (!zoneId) return
    try {
      setGenerating(true)
      const fv: Record<string, unknown> = {}
      for (const f of schemaFields) {
        const raw = (generateFieldValues[f.key] ?? '').trim()
        if (raw === '') continue
        fv[f.key] = f.type === 'number' ? Number(raw) : raw
      }
      await api.post(`/locations/zones/${zoneId}/locations/generate`, {
        components: ranges,
        ...(Object.keys(fv).length > 0 ? { fieldValues: fv } : {}),
      })
      setGenerateOpen(false)
      void refreshLocations(zoneId)
    } catch {
      setError('Failed to generate locations')
    } finally {
      setGenerating(false)
    }
  }

  const onLocationsFilterSnapshot = useCallback(
    (snapshot: { hasActiveFilters: boolean; filteredRows: LocationRow[] }) => {
      setTableFilterActive(snapshot.hasActiveFilters)
      setFilteredRowsSnapshot(snapshot.filteredRows)
    },
    []
  )

  async function runExportAllCsv() {
    if (!zoneId) return
    try {
      await downloadCsvFromApi(`/locations/zones/${zoneId}/locations`, {
        params: { format: 'csv' },
        filenameFallback: `${sanitizeFilenameSegment(zone?.name ?? 'zone')}-locations.csv`,
      })
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Export failed')
    }
  }

  function handleExportCsvClick() {
    if (!zoneId) return
    if (tableFilterActive) {
      setExportChoiceOpen(true)
      return
    }
    void runExportAllCsv()
  }

  function exportFilteredCsvClient() {
    const rows = filteredRowsSnapshot
    const componentKeys = components.map((c) => c.key)
    const fieldKeys = schemaFields.map((f) => f.key)
    const lines: string[] = []
    lines.push(['code', ...componentKeys, ...fieldKeys].join(','))
    for (const r of rows) {
      const comps = r.components || {}
      const fvs = r.fieldValues || {}
      const vals = [
        r.code,
        ...componentKeys.map((k) => String(comps[k] ?? '')),
        ...fieldKeys.map((k) => {
          const v = fvs[k]
          if (v === null || v === undefined) return ''
          return String(v)
        }),
      ]
      lines.push(vals.map(csvEscapeCell).join(','))
    }
    const csv = lines.join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${sanitizeFilenameSegment(zone?.name ?? 'zone')}-locations-filtered.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  function handleExportSelected() {
    if (selectedLocationIds.size === 0) return
    const rows = locations.filter((l) => selectedLocationIds.has(l.id))
    const headers = ['Location', ...components.map((c) => c.displayName)]

    const lines: string[] = []
    lines.push(headers.map(csvEscapeCell).join(','))
    for (const r of rows) {
      const line = [
        r.code,
        ...components.map((c) => String(r.components?.[c.key] ?? '')),
        ...schemaFields.map((f) => {
          const v = r.fieldValues?.[f.key]
          if (v === null || v === undefined) return ''
          return String(v)
        }),
      ]
      lines.push(line.map(csvEscapeCell).join(','))
    }
    const csv = lines.join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const safeZone = (zone?.name ?? 'zone').replace(/[^\w\-]+/g, '_')
    a.href = url
    a.download = `${safeZone}_locations_selected.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function handleDeleteLocation(locationId: string) {
    if (!zoneId) return
    const loc = locations.find((l) => l.id === locationId)
    const ok = await showConfirm(
      `Delete location "${loc?.code ?? 'this location'}"? This cannot be undone.`,
      {
        title: 'Delete location',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        variant: 'danger',
      }
    )
    if (!ok) return
    try {
      await api.delete(`/locations/zones/${zoneId}/locations/${locationId}`)
      setSelectedLocationIds((prev) => {
        const next = new Set(prev)
        next.delete(locationId)
        return next
      })
      void refreshLocations(zoneId)
    } catch {
      // eslint-disable-next-line no-alert
      window.alert('Failed to delete location')
    }
  }

  function openEditZoneModal() {
    if (!zone) return
    setZoneNameEdit(zone.name)
    setZoneDescriptionEdit(zone.description ?? '')
    setEditZoneOpen(true)
  }

  async function handleSaveZone(e: React.FormEvent) {
    e.preventDefault()
    if (!zoneId || !zoneNameEdit.trim()) return
    try {
      setSavingZone(true)
      await api.put(`/locations/zones/${zoneId}`, {
        name: zoneNameEdit.trim(),
        description: zoneDescriptionEdit.trim(),
      })
      setEditZoneOpen(false)
      void loadZoneAndSchema(zoneId)
    } catch {
      // eslint-disable-next-line no-alert
      window.alert('Failed to save zone')
    } finally {
      setSavingZone(false)
    }
  }

  function openEditLocation(loc: LocationRow) {
    const next: Record<string, string> = {}
    for (const c of components) {
      const raw = String(loc.components?.[c.key] ?? '')
      next[c.key] = sanitizeLocationComponentInput(c, raw)
    }
    setEditLocationComponents(next)
    setEditLocationFieldErrors({})
    const fvv: Record<string, string> = {}
    for (const f of schemaFields) {
      const v = loc.fieldValues?.[f.key]
      fvv[f.key] = v === undefined || v === null ? '' : String(v)
    }
    setEditLocationSchemaFieldValues(fvv)
    setEditLocationSchemaFieldErrors({})
    setEditingLocation(loc)
  }

  async function handleSaveLocation(e: React.FormEvent) {
    e.preventDefault()
    if (!zoneId || !editingLocation) return
    const nextErrors: Record<string, string> = {}
    for (const c of components) {
      const err = validateLocationComponentValue(c, editLocationComponents[c.key] ?? '')
      if (err) nextErrors[c.key] = err
    }
    const schemaErrs: Record<string, string> = {}
    for (const f of schemaFields) {
      const err = validateSchemaFieldInput(f, editLocationSchemaFieldValues[f.key] ?? '')
      if (err) schemaErrs[f.key] = err
    }
    if (Object.keys(nextErrors).length > 0 || Object.keys(schemaErrs).length > 0) {
      setEditLocationFieldErrors(nextErrors)
      setEditLocationSchemaFieldErrors(schemaErrs)
      return
    }
    setEditLocationFieldErrors({})
    setEditLocationSchemaFieldErrors({})
    try {
      setSavingLocation(true)
      const fvPayload: Record<string, unknown> = {}
      for (const f of schemaFields) {
        const raw = (editLocationSchemaFieldValues[f.key] ?? '').trim()
        fvPayload[f.key] = raw === '' ? '' : f.type === 'number' ? Number(raw) : raw
      }
      await api.put(`/locations/zones/${zoneId}/locations/${editingLocation.id}`, {
        components: editLocationComponents,
        ...(schemaFields.length > 0 ? { fieldValues: fvPayload } : {}),
      })
      setEditingLocation(null)
      setEditLocationFieldErrors({})
      void refreshLocations(zoneId)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error
      // eslint-disable-next-line no-alert
      window.alert(msg ?? 'Failed to save location')
    } finally {
      setSavingLocation(false)
    }
  }

  function openBulkLocationsModal() {
    if (selectedLocationIds.size <= 1) {
      // eslint-disable-next-line no-alert
      window.alert('Bulk edit requires at least two selected locations.')
      return
    }
    const init: Record<string, string> = {}
    for (const c of components) init[c.key] = ''
    setBulkLocationPatch(init)
    const bf: Record<string, string> = {}
    for (const f of schemaFields) bf[f.key] = ''
    setBulkFieldPatch(bf)
    setBulkLocationFieldErrors({})
    setBulkSchemaFieldErrors({})
    setBulkLocationsOpen(true)
  }

  async function handleBulkLocationsApply(e: React.FormEvent) {
    e.preventDefault()
    if (!zoneId) return
    const ids = Array.from(selectedLocationIds)
    if (ids.length <= 1) {
      // eslint-disable-next-line no-alert
      window.alert('Bulk edit requires at least two selected locations.')
      return
    }
    const partial: Record<string, string> = {}
    const nextErrors: Record<string, string> = {}
    for (const c of components) {
      const v = bulkLocationPatch[c.key]?.trim() ?? ''
      if (v === '') continue
      const err = validateLocationComponentValue(c, v)
      if (err) nextErrors[c.key] = err
      else partial[c.key] = v
    }
    const fieldPartial: Record<string, unknown> = {}
    const fieldErrs: Record<string, string> = {}
    for (const f of schemaFields) {
      const raw = bulkFieldPatch[f.key]?.trim() ?? ''
      if (raw === '') continue
      const err = validateSchemaFieldInput(f, raw)
      if (err) fieldErrs[f.key] = err
      else fieldPartial[f.key] = f.type === 'number' ? Number(raw) : raw
    }
    if (Object.keys(nextErrors).length > 0 || Object.keys(fieldErrs).length > 0) {
      setBulkLocationFieldErrors(nextErrors)
      setBulkSchemaFieldErrors(fieldErrs)
      return
    }
    if (Object.keys(partial).length === 0 && Object.keys(fieldPartial).length === 0) {
      // eslint-disable-next-line no-alert
      window.alert('Enter at least one component or field value to apply to all selected locations.')
      return
    }
    setBulkLocationFieldErrors({})
    setBulkSchemaFieldErrors({})
    try {
      setSavingBulkLocations(true)
      let ok = 0
      let failed = 0
      const body: { components?: Record<string, string>; fieldValues?: Record<string, unknown> } = {}
      if (Object.keys(partial).length > 0) body.components = partial
      if (Object.keys(fieldPartial).length > 0) body.fieldValues = fieldPartial
      for (const id of ids) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await api.put(`/locations/zones/${zoneId}/locations/${id}`, body)
          ok++
        } catch {
          failed++
        }
      }
      setBulkLocationsOpen(false)
      setSelectedLocationIds(new Set())
      void refreshLocations(zoneId)
      if (failed > 0) {
        // eslint-disable-next-line no-alert
        window.alert(`Updated ${ok} location(s). ${failed} failed (e.g. duplicate code).`)
      }
    } finally {
      setSavingBulkLocations(false)
    }
  }

  async function handleDeleteSelectedLocations() {
    if (!zoneId) return
    if (selectedLocationIds.size === 0) return
    const n = selectedLocationIds.size
    const ok = await showConfirm(
      `Delete ${n} selected location${n === 1 ? '' : 's'}? This cannot be undone.`,
      {
        title: 'Delete locations',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        variant: 'danger',
      }
    )
    if (!ok) return
    try {
      const ids = Array.from(selectedLocationIds)
      for (const id of ids) {
        // sequential to keep it simple & avoid overloading
        // eslint-disable-next-line no-await-in-loop
        await api.delete(`/locations/zones/${zoneId}/locations/${id}`)
      }
      setSelectedLocationIds(new Set())
      void refreshLocations(zoneId)
    } catch {
      // eslint-disable-next-line no-alert
      window.alert('Failed to delete selected locations')
    }
  }

  const preview = useMemo(() => {
    const order = components
    const byKey: Record<string, string[]> = {}
    const errors: string[] = []

    const alphaToNum = (ch: string) => ch.toUpperCase().charCodeAt(0) - 65
    const numToAlpha = (n: number) => String.fromCharCode(65 + n)

    const expand = (exprRaw: string, type: 'alpha' | 'numeric', width: number): string[] => {
      const expr = (exprRaw ?? '').trim()
      if (!expr) return []
      const parts = expr
        .split(/[;,]+/g)
        .map((p) => p.trim())
        .filter(Boolean)
      const out: string[] = []
      for (const part of parts) {
        const m = part.match(/^([A-Za-z0-9]+)\s*-\s*([A-Za-z0-9]+)$/)
        if (m) {
          const start = m[1]
          const end = m[2]
          if (type === 'numeric') {
            const a = parseInt(start, 10)
            const b = parseInt(end, 10)
            if (Number.isNaN(a) || Number.isNaN(b)) continue
            const step = a <= b ? 1 : -1
            for (let n = a; step > 0 ? n <= b : n >= b; n += step) {
              out.push(String(n).padStart(width, '0'))
            }
          } else {
            const a = alphaToNum(start[0] ?? '')
            const b = alphaToNum(end[0] ?? '')
            if (a < 0 || b < 0 || a > 25 || b > 25) continue
            const step = a <= b ? 1 : -1
            for (let n = a; step > 0 ? n <= b : n >= b; n += step) {
              out.push(numToAlpha(n).padStart(width, 'A'))
            }
          }
          continue
        }
        // Single value
        if (type === 'numeric') {
          const n = parseInt(part, 10)
          if (Number.isNaN(n)) continue
          out.push(String(n).padStart(width, '0'))
        } else {
          const ch = (part[0] ?? '').toUpperCase()
          if (!/^[A-Z]$/.test(ch)) continue
          out.push(ch.padStart(width, 'A'))
        }
      }
      return Array.from(new Set(out))
    }

    for (const c of order) {
      const values = expand(ranges[c.key] ?? '', c.type, c.width)
      if (values.length === 0) {
        // allow empty while editing; preview will show 0
        byKey[c.key] = []
      } else {
        byKey[c.key] = values
      }
      if ((ranges[c.key] ?? '').trim() && byKey[c.key].length === 0) {
        errors.push(`${c.displayName} (${c.key}) has no valid values`)
      }
    }

    const dims = order.map((c) => byKey[c.key].length)
    const total = dims.some((d) => d === 0) ? 0 : dims.reduce((a, b) => a * b, 1)

    const buildCodes = (mode: 'first' | 'last', n: number): string[] => {
      if (total === 0) return []
      const lists = order.map((c) => byKey[c.key])
      const idxs = lists.map(() => 0)
      const lens = lists.map((l) => l.length)

      const getAt = (indexes: number[]) => {
        const parts = indexes.map((i, k) => lists[k][i] ?? '')
        return parts.join('')
      }

      const codes: string[] = []
      if (mode === 'first') {
        while (codes.length < n) {
          codes.push(getAt(idxs))
          // increment like odometer (last dimension fastest)
          let pos = idxs.length - 1
          while (pos >= 0) {
            idxs[pos] += 1
            if (idxs[pos] < lens[pos]) break
            idxs[pos] = 0
            pos -= 1
          }
          if (pos < 0) break
        }
        return codes
      }

      // last: start at end and decrement
      for (let i = 0; i < idxs.length; i++) idxs[i] = Math.max(0, lens[i] - 1)
      while (codes.length < n) {
        codes.push(getAt(idxs))
        let pos = idxs.length - 1
        while (pos >= 0) {
          idxs[pos] -= 1
          if (idxs[pos] >= 0) break
          idxs[pos] = Math.max(0, lens[pos] - 1)
          pos -= 1
        }
        if (pos < 0) break
      }
      return codes.reverse()
    }

    const first5 = buildCodes('first', 5)
    const last5 = total <= 5 ? [] : buildCodes('last', 5)
    return { total, first5, last5, errors }
  }, [components, ranges])

  const locationColumns = useMemo(() => {
    const cols: Array<SimpleColumn<LocationRow>> = [
      { key: 'code', label: 'Location', getValue: (l) => l.code, width: '14rem' },
    ]
    for (const c of components) {
      cols.push({
        key: c.key,
        label: c.displayName,
        getValue: (l) => String(l.components?.[c.key] ?? ''),
        width: '12rem',
      })
    }
    for (const f of schemaFields) {
      cols.push({
        key: `sf-${f.id}`,
        label: f.label,
        getValue: (l) => {
          const v = l.fieldValues?.[f.key]
          if (v === undefined || v === null) return ''
          return String(v)
        },
        width: '10rem',
      })
    }
    return cols
  }, [components, schemaFields])

  return (
    <div className="flex h-[calc(100dvh-5rem)] max-h-[calc(100dvh-5rem)] min-h-0 flex-col gap-4">
      <div className="shrink-0 space-y-4">
        <LocationBreadcrumb
          items={[
            { label: 'Locations', to: '/locations' },
            { label: zone?.name ?? 'Zone' },
          ]}
        />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-foreground">
              Zone: {zone?.name ?? 'Loading…'}
            </h1>
            {zone?.description?.trim() && (
              <p className="mt-2 max-w-3xl whitespace-pre-wrap text-sm text-foreground/80">
                {zone.description.trim()}
              </p>
            )}
            {zone && (
              <p
                className={`text-sm text-foreground/70 ${zone.description?.trim() ? 'mt-2' : 'mt-1'}`}
              >
                Schema: <span className="font-medium">{zone.schemaName}</span>
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {zone && (
              <button
                type="button"
                className="rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-card"
                onClick={() => openEditZoneModal()}
              >
                Edit zone
              </button>
            )}
            <button
              type="button"
              className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
              onClick={() => {
                const init: Record<string, string> = {}
                for (const f of schemaFields) init[f.key] = ''
                setGenerateFieldValues(init)
                setGenerateOpen(true)
              }}
              disabled={components.length === 0}
            >
              Generate…
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-card disabled:opacity-50"
            onClick={openBulkLocationsModal}
            disabled={selectedLocationIds.size <= 1}
            title={
              selectedLocationIds.size <= 1
                ? 'Select at least two locations to use bulk edit'
                : 'Apply component or field values to selected locations'
            }
          >
            Bulk edit…
          </button>
          <button
            type="button"
            className="rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-card disabled:opacity-50"
            onClick={handleExportSelected}
            disabled={selectedLocationIds.size === 0}
            title={selectedLocationIds.size === 0 ? 'Select one or more locations first' : 'Export selected locations (CSV)'}
          >
            Export selected
          </button>
          <button
            type="button"
            className="rounded border border-red-500/50 bg-background px-3 py-1.5 text-xs text-red-500 hover:bg-red-500/10 disabled:opacity-50"
            onClick={() => void handleDeleteSelectedLocations()}
            disabled={selectedLocationIds.size === 0}
            title={selectedLocationIds.size === 0 ? 'Select one or more locations first' : 'Delete selected locations'}
          >
            Delete selected
          </button>
          <button
            type="button"
            className="rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-card disabled:opacity-50"
            onClick={handleExportCsvClick}
            disabled={!zoneId}
          >
            Export CSV
          </button>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <SimpleDataTable
            fillViewportHeight
            preferenceKey={`atlas-locations-zone-${zoneId ?? 'unknown'}-locations`}
            rows={locations}
            getRowKey={(l) => l.id}
            enableSelection
            selectedKeys={selectedLocationIds}
            onSelectedKeysChange={setSelectedLocationIds}
            onFilterSnapshotChange={onLocationsFilterSnapshot}
            columns={[
              ...locationColumns,
              {
                key: 'actions',
                label: '',
                width: '8rem',
                getValue: () => '',
                render: (l) => (
                  <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-background"
                      onClick={() => openEditLocation(l as LocationRow)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="rounded border border-red-500/50 px-2 py-1 text-xs text-red-500 hover:bg-red-500/10"
                      onClick={() => void handleDeleteLocation((l as LocationRow).id)}
                    >
                      Delete
                    </button>
                  </div>
                ),
              },
            ]}
          />
      </div>
      {bulkLocationsOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            if (!savingBulkLocations) {
              setBulkLocationsOpen(false)
              setBulkLocationFieldErrors({})
              setBulkSchemaFieldErrors({})
            }
          }}
        >
          <div
            className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-foreground">Bulk edit locations</h2>
                <p className="text-xs text-foreground/70">
                  {selectedLocationIds.size} location(s) selected. Only filled fields are applied to each
                  selected row (other parts stay as they are).
                </p>
                {selectedLocationIds.size <= 1 && (
                  <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-200">
                    Select at least two locations in the table below, then apply.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!savingBulkLocations) {
                    setBulkLocationsOpen(false)
                    setBulkLocationFieldErrors({})
                    setBulkSchemaFieldErrors({})
                  }
                }}
                className="shrink-0 rounded-lg px-2 py-1 text-sm text-foreground/70 hover:bg-background"
              >
                Close
              </button>
            </div>
            <form onSubmit={handleBulkLocationsApply} className="space-y-3">
              {(Object.keys(bulkLocationFieldErrors).length > 0 ||
                Object.keys(bulkSchemaFieldErrors).length > 0) && (
                <div
                  className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400"
                  role="alert"
                >
                  Fix invalid values below. Code parts: allowed type and length. Fields: valid numbers, text
                  length, or select options.
                </div>
              )}
              {components.map((c) => (
                <div key={c.id}>
                  <label className="block text-sm font-medium text-foreground">
                    {c.displayName} ({c.key})
                    <span className="ml-1 font-normal text-foreground/50">
                      — {c.type === 'numeric' ? `${c.width} digit(s) max` : `${c.width} letter(s) max`},{' '}
                      {c.type === 'numeric' ? '0–9 only' : 'A–Z only'}
                    </span>
                  </label>
                  <input
                    type="text"
                    inputMode={c.type === 'numeric' ? 'numeric' : 'text'}
                    autoComplete="off"
                    maxLength={c.width}
                    spellCheck={false}
                    value={bulkLocationPatch[c.key] ?? ''}
                    onChange={(e) => {
                      const next = sanitizeLocationComponentInput(c, e.target.value)
                      setBulkLocationPatch((prev) => ({
                        ...prev,
                        [c.key]: next,
                      }))
                      setBulkLocationFieldErrors((prev) => {
                        const n = { ...prev }
                        delete n[c.key]
                        return n
                      })
                    }}
                    className={`mt-1 w-full rounded-lg border bg-background px-3 py-2 text-foreground ${
                      bulkLocationFieldErrors[c.key]
                        ? 'border-red-500 ring-1 ring-red-500/30'
                        : 'border-border'
                    }`}
                    aria-invalid={bulkLocationFieldErrors[c.key] ? true : undefined}
                  />
                  {bulkLocationFieldErrors[c.key] && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">{bulkLocationFieldErrors[c.key]}</p>
                  )}
                </div>
              ))}
              {schemaFields.length > 0 && (
                <div className="border-t border-border pt-3 space-y-3">
                  <p className="text-xs font-medium text-foreground">Optional fields</p>
                  {schemaFields.map((f) => (
                    <div key={f.id}>
                      <label className="block text-sm font-medium text-foreground">
                        {f.label} ({f.key})
                        <span className="ml-1 font-normal text-foreground/50">
                          — {f.type}
                          {f.type === 'text' && f.config.maxLength != null
                            ? `, max ${f.config.maxLength} chars`
                            : ''}
                        </span>
                      </label>
                      {f.type === 'number' && (
                        <input
                          type="text"
                          inputMode="decimal"
                          value={bulkFieldPatch[f.key] ?? ''}
                          onChange={(e) => {
                            setBulkFieldPatch((prev) => ({ ...prev, [f.key]: e.target.value }))
                            setBulkSchemaFieldErrors((prev) => {
                              const n = { ...prev }
                              delete n[f.key]
                              return n
                            })
                          }}
                          className={`mt-1 w-full rounded-lg border bg-background px-3 py-2 text-foreground ${
                            bulkSchemaFieldErrors[f.key]
                              ? 'border-red-500 ring-1 ring-red-500/30'
                              : 'border-border'
                          }`}
                        />
                      )}
                      {f.type === 'text' && (
                        <input
                          type="text"
                          value={bulkFieldPatch[f.key] ?? ''}
                          onChange={(e) => {
                            setBulkFieldPatch((prev) => ({ ...prev, [f.key]: e.target.value }))
                            setBulkSchemaFieldErrors((prev) => {
                              const n = { ...prev }
                              delete n[f.key]
                              return n
                            })
                          }}
                          className={`mt-1 w-full rounded-lg border bg-background px-3 py-2 text-foreground ${
                            bulkSchemaFieldErrors[f.key]
                              ? 'border-red-500 ring-1 ring-red-500/30'
                              : 'border-border'
                          }`}
                        />
                      )}
                      {f.type === 'select' && (
                        <select
                          value={bulkFieldPatch[f.key] ?? ''}
                          onChange={(e) => {
                            setBulkFieldPatch((prev) => ({ ...prev, [f.key]: e.target.value }))
                            setBulkSchemaFieldErrors((prev) => {
                              const n = { ...prev }
                              delete n[f.key]
                              return n
                            })
                          }}
                          className={`mt-1 w-full rounded-lg border bg-background px-3 py-2 text-foreground ${
                            bulkSchemaFieldErrors[f.key]
                              ? 'border-red-500 ring-1 ring-red-500/30'
                              : 'border-border'
                          }`}
                        >
                          <option value="">Leave unchanged</option>
                          {(f.config.options ?? []).map((opt) => (
                            <option
                              key={opt}
                              value={opt}
                              title={selectOptionTitle(opt, f.config) ?? undefined}
                            >
                              {formatSelectOptionLabel(opt, f.config)}
                            </option>
                          ))}
                        </select>
                      )}
                      {bulkSchemaFieldErrors[f.key] && (
                        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                          {bulkSchemaFieldErrors[f.key]}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setBulkLocationsOpen(false)
                    setBulkLocationFieldErrors({})
                    setBulkSchemaFieldErrors({})
                  }}
                  className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
                  disabled={savingBulkLocations}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  disabled={savingBulkLocations || selectedLocationIds.size <= 1}
                >
                  {savingBulkLocations ? 'Applying…' : 'Apply to selected'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {exportChoiceOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setExportChoiceOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3">
              <h2 className="text-base font-semibold text-foreground">Export CSV</h2>
              <p className="mt-2 text-sm leading-relaxed text-foreground/80">
                Search or column filters are active. Export every location in this zone, or only the rows that
                match the current filters ({filteredRowsSnapshot.length} of {locations.length} shown in the
                table).
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <button
                type="button"
                className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-background"
                onClick={() => setExportChoiceOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-background"
                onClick={() => {
                  exportFilteredCsvClient()
                  setExportChoiceOpen(false)
                }}
              >
                Filtered only ({filteredRowsSnapshot.length})
              </button>
              <button
                type="button"
                className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
                onClick={() => {
                  setExportChoiceOpen(false)
                  void runExportAllCsv()
                }}
              >
                All locations ({locations.length})
              </button>
            </div>
          </div>
        </div>
      )}
      {editZoneOpen && zone && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
            onClick={() => setEditZoneOpen(false)}
          >
            <div
              className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-start justify-between gap-2">
                <h2 className="text-base font-semibold text-foreground">Edit zone</h2>
                <button
                  type="button"
                  onClick={() => setEditZoneOpen(false)}
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
                    value={zoneNameEdit}
                    onChange={(e) => setZoneNameEdit(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground">Description</label>
                  <textarea
                    value={zoneDescriptionEdit}
                    onChange={(e) => setZoneDescriptionEdit(e.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                  />
                </div>
                <p className="text-xs text-foreground/60">
                  Schema: <span className="font-medium">{zone.schemaName}</span>
                </p>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditZoneOpen(false)}
                    className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
                    disabled={savingZone}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    disabled={!zoneNameEdit.trim() || savingZone}
                  >
                    {savingZone ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        {editingLocation && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
            onClick={() => {
              setEditingLocation(null)
              setEditLocationFieldErrors({})
              setEditLocationSchemaFieldErrors({})
            }}
          >
            <div
              className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-foreground">Edit location</h2>
                  <p className="text-xs text-foreground/70">
                    Code updates from components:{' '}
                    <span className="font-mono">{editingLocation.code}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingLocation(null)
                    setEditLocationFieldErrors({})
                    setEditLocationSchemaFieldErrors({})
                  }}
                  className="shrink-0 rounded-lg px-2 py-1 text-sm text-foreground/70 hover:bg-background"
                >
                  Close
                </button>
              </div>
              <form onSubmit={handleSaveLocation} className="space-y-3">
                {(Object.keys(editLocationFieldErrors).length > 0 ||
                  Object.keys(editLocationSchemaFieldErrors).length > 0) && (
                  <div
                    className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400"
                    role="alert"
                  >
                    Fix invalid values below (code parts and optional fields).
                  </div>
                )}
                {components.map((c) => (
                  <div key={c.id}>
                    <label className="block text-sm font-medium text-foreground">
                      {c.displayName} ({c.key})
                      <span className="ml-1 font-normal text-foreground/50">
                        — {c.type === 'numeric' ? `${c.width} digit(s) max` : `${c.width} letter(s) max`},{' '}
                        {c.type === 'numeric' ? '0–9 only' : 'A–Z only'}
                      </span>
                    </label>
                    <input
                      type="text"
                      inputMode={c.type === 'numeric' ? 'numeric' : 'text'}
                      autoComplete="off"
                      maxLength={c.width}
                      spellCheck={false}
                      value={editLocationComponents[c.key] ?? ''}
                      onChange={(e) => {
                        const next = sanitizeLocationComponentInput(c, e.target.value)
                        setEditLocationComponents((prev) => ({
                          ...prev,
                          [c.key]: next,
                        }))
                        setEditLocationFieldErrors((prev) => {
                          const next = { ...prev }
                          delete next[c.key]
                          return next
                        })
                      }}
                      className={`mt-1 w-full rounded-lg border bg-background px-3 py-2 text-foreground ${
                        editLocationFieldErrors[c.key]
                          ? 'border-red-500 ring-1 ring-red-500/30'
                          : 'border-border'
                      }`}
                      aria-invalid={editLocationFieldErrors[c.key] ? true : undefined}
                    />
                    {editLocationFieldErrors[c.key] && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">{editLocationFieldErrors[c.key]}</p>
                    )}
                  </div>
                ))}
                {schemaFields.length > 0 && (
                  <div className="border-t border-border pt-3 space-y-3">
                    <p className="text-xs font-medium text-foreground">Fields</p>
                    {schemaFields.map((f) => (
                      <div key={f.id}>
                        <label className="block text-sm font-medium text-foreground">
                          {f.label} ({f.key})
                        </label>
                        {f.type === 'number' && (
                          <input
                            type="text"
                            inputMode="decimal"
                            value={editLocationSchemaFieldValues[f.key] ?? ''}
                            onChange={(e) => {
                              setEditLocationSchemaFieldValues((prev) => ({
                                ...prev,
                                [f.key]: e.target.value,
                              }))
                              setEditLocationSchemaFieldErrors((prev) => {
                                const n = { ...prev }
                                delete n[f.key]
                                return n
                              })
                            }}
                            className={`mt-1 w-full rounded-lg border bg-background px-3 py-2 text-foreground ${
                              editLocationSchemaFieldErrors[f.key]
                                ? 'border-red-500 ring-1 ring-red-500/30'
                                : 'border-border'
                            }`}
                          />
                        )}
                        {f.type === 'text' && (
                          <input
                            type="text"
                            value={editLocationSchemaFieldValues[f.key] ?? ''}
                            onChange={(e) => {
                              setEditLocationSchemaFieldValues((prev) => ({
                                ...prev,
                                [f.key]: e.target.value,
                              }))
                              setEditLocationSchemaFieldErrors((prev) => {
                                const n = { ...prev }
                                delete n[f.key]
                                return n
                              })
                            }}
                            className={`mt-1 w-full rounded-lg border bg-background px-3 py-2 text-foreground ${
                              editLocationSchemaFieldErrors[f.key]
                                ? 'border-red-500 ring-1 ring-red-500/30'
                                : 'border-border'
                            }`}
                          />
                        )}
                        {f.type === 'select' && (
                          <select
                            value={editLocationSchemaFieldValues[f.key] ?? ''}
                            onChange={(e) => {
                              setEditLocationSchemaFieldValues((prev) => ({
                                ...prev,
                                [f.key]: e.target.value,
                              }))
                              setEditLocationSchemaFieldErrors((prev) => {
                                const n = { ...prev }
                                delete n[f.key]
                                return n
                              })
                            }}
                            className={`mt-1 w-full rounded-lg border bg-background px-3 py-2 text-foreground ${
                              editLocationSchemaFieldErrors[f.key]
                                ? 'border-red-500 ring-1 ring-red-500/30'
                                : 'border-border'
                            }`}
                          >
                            <option value="">—</option>
                            {(f.config.options ?? []).map((opt) => (
                              <option
                                key={opt}
                                value={opt}
                                title={selectOptionTitle(opt, f.config) ?? undefined}
                              >
                                {formatSelectOptionLabel(opt, f.config)}
                              </option>
                            ))}
                          </select>
                        )}
                        {editLocationSchemaFieldErrors[f.key] && (
                          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                            {editLocationSchemaFieldErrors[f.key]}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingLocation(null)
                      setEditLocationFieldErrors({})
                      setEditLocationSchemaFieldErrors({})
                    }}
                    className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
                    disabled={savingLocation}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    disabled={savingLocation}
                  >
                    {savingLocation ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        {generateOpen && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
            onClick={() => setGenerateOpen(false)}
          >
            <div
              className="w-full max-w-4xl rounded-xl border border-border bg-card p-6 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-5 flex items-start justify-between gap-3 border-b border-border pb-4">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold tracking-tight text-foreground">Generate locations</h2>
                  <p className="text-sm leading-relaxed text-foreground/70">
                    Enter ranges like <span className="font-mono text-foreground/90">1-3,5</span> or{' '}
                    <span className="font-mono text-foreground/90">A-C</span>.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setGenerateOpen(false)}
                  className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm text-foreground/70 hover:bg-background"
                >
                  Close
                </button>
              </div>

              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
                <form onSubmit={handleGenerate} className="flex min-h-0 flex-col gap-4 text-sm">
                  <div className="space-y-2.5">
                    {components.map((c) => (
                      <div key={c.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                        <label className="shrink-0 text-sm font-medium text-foreground sm:w-44">
                          {c.displayName}{' '}
                          <span className="font-normal text-foreground/60">({c.width})</span>
                        </label>
                        <input
                          type="text"
                          value={ranges[c.key] ?? ''}
                          onChange={(e) => {
                            const v =
                              c.type === 'alpha' ? uppercaseAsciiLetters(e.target.value) : e.target.value
                            setRanges((prev) => ({
                              ...prev,
                              [c.key]: v,
                            }))
                          }}
                          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                          placeholder={c.type === 'alpha' ? 'e.g. A-C' : 'e.g. 1-3,5'}
                        />
                      </div>
                    ))}
                  </div>

                  {schemaFields.length > 0 && (
                    <div className="space-y-2 border-t border-border pt-4">
                      <div className="text-sm font-medium text-foreground">Optional attributes</div>
                      {schemaFields.map((f) => (
                        <div key={f.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                          <label className="shrink-0 text-sm font-medium text-foreground sm:w-44">
                            {f.label}{' '}
                            <span className="font-normal text-foreground/50">({f.key})</span>
                          </label>
                          {f.type === 'number' && (
                            <input
                              type="text"
                              inputMode="decimal"
                              value={generateFieldValues[f.key] ?? ''}
                              onChange={(e) =>
                                setGenerateFieldValues((prev) => ({
                                  ...prev,
                                  [f.key]: e.target.value,
                                }))
                              }
                              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                              placeholder="Optional"
                            />
                          )}
                          {f.type === 'text' && (
                            <input
                              type="text"
                              value={generateFieldValues[f.key] ?? ''}
                              onChange={(e) =>
                                setGenerateFieldValues((prev) => ({
                                  ...prev,
                                  [f.key]: e.target.value,
                                }))
                              }
                              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                              placeholder="Optional"
                            />
                          )}
                          {f.type === 'select' && (
                            <select
                              value={generateFieldValues[f.key] ?? ''}
                              onChange={(e) =>
                                setGenerateFieldValues((prev) => ({
                                  ...prev,
                                  [f.key]: e.target.value,
                                }))
                              }
                              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                            >
                              <option value="">—</option>
                              {(f.config.options ?? []).map((opt) => (
                                <option
                                  key={opt}
                                  value={opt}
                                  title={selectOptionTitle(opt, f.config) ?? undefined}
                                >
                                  {formatSelectOptionLabel(opt, f.config)}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {preview.errors.length > 0 && (
                    <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-sm text-red-600 dark:text-red-400">
                      {preview.errors.map((m) => (
                        <div key={m}>{m}</div>
                      ))}
                    </div>
                  )}

                  <div className="mt-auto flex flex-wrap justify-end gap-2 border-t border-border pt-4">
                    <button
                      type="button"
                      className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-background"
                      onClick={() => setGenerateOpen(false)}
                      disabled={generating}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                      disabled={generating || preview.total === 0}
                      title={preview.total === 0 ? 'Enter valid ranges to generate' : 'Generate locations'}
                    >
                      {generating ? 'Generating…' : `Generate (${preview.total.toLocaleString()})`}
                    </button>
                  </div>
                </form>

                <aside className="flex flex-col text-sm lg:border-l lg:border-border lg:pl-6">
                  <div className="rounded-lg border border-border bg-muted/30 p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/80 pb-3">
                      <span className="text-base font-semibold text-foreground">Preview</span>
                      <span className="text-sm text-foreground/70">
                        Total{' '}
                        <span className="font-mono text-base font-semibold tabular-nums text-foreground">
                          {preview.total.toLocaleString()}
                        </span>
                      </span>
                    </div>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <div className="min-w-0">
                        <div className="mb-2 text-sm font-medium text-foreground/80">First 5</div>
                        <div className="space-y-1.5 rounded-md bg-background/60 px-2.5 py-2">
                          {preview.first5.length === 0 ? (
                            <div className="text-sm text-foreground/50">—</div>
                          ) : (
                            preview.first5.map((c) => (
                              <div key={`first-${c}`} className="font-mono text-sm leading-snug text-foreground">
                                {c}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                      <div className="min-w-0">
                        <div className="mb-2 text-sm font-medium text-foreground/80">Last 5</div>
                        <div className="space-y-1.5 rounded-md bg-background/60 px-2.5 py-2">
                          {preview.last5.length === 0 ? (
                            <div className="text-sm text-foreground/50">—</div>
                          ) : (
                            preview.last5.map((c) => (
                              <div key={`last-${c}`} className="font-mono text-sm leading-snug text-foreground">
                                {c}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          </div>
        )}
    </div>
  )
}

export default LocationZoneDetail

