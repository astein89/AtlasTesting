import { useCallback, useEffect, useMemo, useState } from 'react'
import { flushSync } from 'react-dom'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { SimpleDataTable, type SimpleColumn } from '../components/data/SimpleDataTable'
import { getBasePath } from '../lib/basePath'
import { isLocationUuidParam, locationsPath } from '../lib/appPaths'
import { useAuthStore } from '../store/authStore'
import { LocationBreadcrumb } from '../components/locations/LocationBreadcrumb'
import { useAlertConfirm } from '../contexts/AlertConfirmContext'
import { formatSelectOptionLabel, selectOptionTitle, type LocationSchemaField } from '../types/locationSchemaFields'
import { downloadCsvFromApi } from '../utils/downloadCsv'
import { expandLocationGenerationRange, sanitizeGenerateRangeInput } from '../utils/expandLocationGenerationRange'
import { MaskedTextInput } from '../components/fields/MaskedTextInput'
import {
  applyLocationPatternMask,
  normalizeLocationMixedGeneratePartOrNull,
} from '../utils/locationPatternMask'
import { sanitizeFilenameSegment } from '../utils/safeFilename'
import {
  normalizeLocationSchemaComponent,
  normalizeLocationZone,
  type NormalizedLocationZone,
} from '../utils/locationApiRows'

/** Must match server generation caps in `server/routes/locations.ts`. */
const MAX_GENERATE_LOCATIONS = 25_000

type Zone = NormalizedLocationZone

interface LocationRow {
  id: string
  location: string
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
  type: 'alpha' | 'numeric' | 'mixed' | 'fixed'
  width: number
  patternMask?: string | null
  minValue?: string | null
}

function locationComponentHint(c: SchemaComponent): { widthLabel: string; charsetLabel: string } {
  if (c.type === 'fixed') {
    const lit = (c.minValue ?? '').trim()
    return {
      widthLabel: lit ? `${lit.length} char(s) fixed` : 'Fixed (not configured)',
      charsetLabel: 'read-only',
    }
  }
  if (c.type === 'numeric') {
    return { widthLabel: `${c.width} digit(s) max`, charsetLabel: '0–9 only' }
  }
  if (c.type === 'mixed') {
    const pm = c.patternMask?.trim()
    if (pm) {
      return {
        widthLabel: `Pattern (${pm.length} chars)`,
        charsetLabel: `@ letter · # digit · other chars fixed`,
      }
    }
    return { widthLabel: `${c.width} character(s)`, charsetLabel: 'A–Z and 0–9' }
  }
  return { widthLabel: `${c.width} letter(s) max`, charsetLabel: 'A–Z only' }
}

/** Client-side validation aligned with server rules for location component values. */
function validateLocationComponentValue(c: SchemaComponent, raw: string): string | null {
  const s = raw.trim()
  if (c.type === 'fixed') {
    const lit = (c.minValue ?? '').trim()
    if (!lit) return 'Fixed value missing in schema.'
    return s === lit ? null : 'This part is fixed and cannot be changed.'
  }
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
  if (c.type === 'mixed') {
    const pm = c.patternMask?.trim()
    if (pm) {
      const n = normalizeLocationMixedGeneratePartOrNull(s, pm)
      if (n == null) return `Value does not match pattern ${pm}`
      return null
    }
    const t = s.replace(/[a-z]/g, (ch) => ch.toUpperCase())
    if (!/^[A-Z0-9]+$/.test(t)) return 'Use only letters A–Z and digits 0–9.'
    if (t.length !== c.width) return `Must be exactly ${c.width} character(s).`
    return null
  }
  if (!/^[A-Za-z]+$/.test(s)) return 'Use letters A–Z only (no numbers or spaces).'
  if (s.length > c.width) return `At most ${c.width} letter(s).`
  return null
}

/** Restrict typing to allowed characters and schema width (matches server normalization). */
function sanitizeLocationComponentInput(c: SchemaComponent, value: string): string {
  if (c.type === 'fixed') {
    return (c.minValue ?? '').trim()
  }
  if (value === '') return ''
  if (c.type === 'numeric') {
    return value.replace(/\D/g, '').slice(0, c.width)
  }
  if (c.type === 'mixed') {
    const pm = c.patternMask?.trim()
    if (pm) {
      return applyLocationPatternMask(value, pm)
    }
    return value
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, c.width)
      .replace(/[a-z]/g, (ch) => ch.toUpperCase())
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

async function postGenerateLocationsStream(
  zoneId: string,
  body: Record<string, unknown>,
  onProgress: (processed: number, total: number) => void
): Promise<{
  created: number
  skipped: number
  totalRequested: number
  failures: Array<{ location: string; reason: string }>
  failuresTruncated: boolean
}> {
  const basePath = (getBasePath() ?? '').replace(/\/$/, '')
  const url = `${basePath}/api/locations/zones/${encodeURIComponent(zoneId)}/locations/generate?stream=1`
  const token = useAuthStore.getState().accessToken
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    let message = `Request failed (HTTP ${res.status})`
    try {
      const text = await res.text()
      let parsed: unknown
      try {
        parsed = JSON.parse(text) as { error?: string; message?: string }
      } catch {
        parsed = null
      }
      const json = parsed && typeof parsed === 'object' ? (parsed as { error?: string; message?: string }) : null
      if (typeof json?.error === 'string' && json.error.trim()) {
        message = json.error.trim()
      } else if (typeof json?.message === 'string' && json.message.trim()) {
        message = json.message.trim()
      } else if (text.trim()) {
        message = text.trim().slice(0, 500)
      }
    } catch {
      /* ignore */
    }
    throw new Error(message)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''
  const parseComplete = (msg: Record<string, unknown>) => {
    const raw = msg.failures
    const failures = Array.isArray(raw)
      ? raw
          .map((row) => {
            if (!row || typeof row !== 'object') return null
            const o = row as { location?: unknown; reason?: unknown }
            const loc = typeof o.location === 'string' ? o.location : ''
            const reason = typeof o.reason === 'string' ? o.reason : 'Unknown reason'
            if (!loc && !reason) return null
            return { location: loc, reason }
          })
          .filter((x): x is { location: string; reason: string } => x != null)
      : []
    return {
      created: typeof msg.created === 'number' ? msg.created : 0,
      skipped: typeof msg.skipped === 'number' ? msg.skipped : 0,
      totalRequested: typeof msg.totalRequested === 'number' ? msg.totalRequested : 0,
      failures,
      failuresTruncated: Boolean(msg.failuresTruncated),
    }
  }

  let complete: ReturnType<typeof parseComplete> | null = null

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })

    let newlineIdx: number
    while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIdx).trim()
      buffer = buffer.slice(newlineIdx + 1)
      if (!line) continue
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue
      }
      if (msg.type === 'progress' && typeof msg.processed === 'number' && typeof msg.total === 'number') {
        const pr = msg.processed
        const tot = msg.total
        // Flush so multiple NDJSON lines in one chunk still update the bar (React 18 batches otherwise).
        flushSync(() => {
          onProgress(pr, tot)
        })
      } else if (msg.type === 'complete') {
        complete = parseComplete(msg)
      }
    }

    if (done) break
  }

  const tail = buffer.trim()
  if (tail) {
    try {
      const msg = JSON.parse(tail) as Record<string, unknown>
      if (msg.type === 'complete') {
        complete = parseComplete(msg)
      }
    } catch {
      /* ignore */
    }
  }

  if (!complete) {
    throw new Error(
      'The server closed the connection before sending a completion message. If progress was shown, the run may have been interrupted; try again or check server logs.'
    )
  }
  return complete
}

function formatGenerateFailureMessage(err: unknown): string {
  if (err instanceof Error) {
    const m = err.message.trim()
    return m || 'Request failed with no message.'
  }
  if (typeof err === 'string' && err.trim()) return err.trim()
  return 'An unexpected error occurred while generating locations.'
}

export function LocationZoneDetail() {
  const { showConfirm } = useAlertConfirm()
  const canWriteLocations = useAuthStore((s) => s.canEditLocationsData())
  const navigate = useNavigate()
  const location = useLocation()
  const { zoneId } = useParams<{ zoneId: string }>()
  const [zone, setZone] = useState<Zone | null>(null)
  const [locations, setLocations] = useState<LocationRow[]>([])
  /** True while fetching `/locations/zones/:id/locations` (large lists can take noticeable time). */
  const [locationsLoading, setLocationsLoading] = useState(true)
  const [components, setComponents] = useState<SchemaComponent[]>([])
  const [schemaFields, setSchemaFields] = useState<LocationSchemaField[]>([])
  const [ranges, setRanges] = useState<Record<string, string>>({})
  const [generateFieldValues, setGenerateFieldValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generateProgress, setGenerateProgress] = useState<{ processed: number; total: number } | null>(
    null
  )
  /** After a successful run: optionally clear inputs and/or close the dialog. */
  const [generateCloseAfterRun, setGenerateCloseAfterRun] = useState(false)
  const [generateClearAfterRun, setGenerateClearAfterRun] = useState(false)
  /** Shown after a generate run when some rows were skipped (with reasons from the server). */
  const [generateFailureReport, setGenerateFailureReport] = useState<{
    created: number
    skipped: number
    totalRequested: number
    failures: Array<{ location: string; reason: string }>
    failuresTruncated: boolean
  } | null>(null)
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

  /** Progress for bulk edit (stepped) or bulk delete (one-shot; count for label only). */
  const [mutationProgress, setMutationProgress] = useState<
    | { kind: 'bulk-edit'; processed: number; total: number }
    | { kind: 'bulk-delete'; count: number }
    | null
  >(null)
  /** Indeterminate busy state for single-location save or delete. */
  const [singleMutation, setSingleMutation] = useState<'save' | 'delete' | null>(null)

  const mutationBusy =
    mutationProgress !== null || singleMutation !== null || savingBulkLocations

  useEffect(() => {
    if (!zoneId) {
      setLocationsLoading(false)
      return
    }
    setLocations([])
    setSelectedLocationIds(new Set())
    void loadZoneAndSchema(zoneId)
    void refreshLocations(zoneId)
  }, [zoneId])

  useEffect(() => {
    if (!zone?.slug || !zoneId) return
    const canonical = locationsPath('zones', zone.slug)
    if (
      location.pathname !== canonical &&
      (isLocationUuidParam(zoneId) || zoneId !== zone.slug)
    ) {
      navigate({ pathname: canonical, search: location.search }, { replace: true })
    }
  }, [zone?.slug, zoneId, location.pathname, location.search, navigate])

  /** Keep range inputs aligned when component keys change (e.g. schema refresh) without dropping typed values. */
  useEffect(() => {
    if (components.length === 0) return
    setRanges((prev) => {
      const next: Record<string, string> = {}
      for (const c of components) {
        next[c.key] = prev[c.key] ?? ''
      }
      return next
    })
  }, [components])

  async function loadZoneAndSchema(id: string) {
    const zonesResp = await api.get<Zone[]>('/locations/zones')
    const param = id.trim()
    const z =
      zonesResp.data
        .map((row) => normalizeLocationZone(row as unknown as Record<string, unknown>))
        .find(
          (row) =>
            row.id === param ||
            (row.slug && row.slug.toLowerCase() === param.toLowerCase())
        ) ?? null
    setZone(z)
    if (z?.schemaId) {
      const [comps, fieldsResp] = await Promise.all([
        api.get<SchemaComponent[]>(`/locations/schemas/${z.schemaId}/components`),
        api.get<LocationSchemaField[]>(`/locations/schemas/${z.schemaId}/fields`),
      ])
      const compsNorm = comps.data.map((row) => normalizeLocationSchemaComponent(row))
      setComponents(compsNorm)
      setSchemaFields(fieldsResp.data)
      const initial: Record<string, string> = {}
      for (const c of compsNorm) initial[c.key] = ''
      setRanges(initial)
    } else {
      setSchemaFields([])
      setComponents([])
      setRanges({})
    }
  }

  const refreshLocations = useCallback(async (id: string) => {
    setLocationsLoading(true)
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
    } finally {
      setLocationsLoading(false)
    }
  }, [])

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
    lines.push(['location', ...componentKeys, ...fieldKeys].join(','))
    for (const r of rows) {
      const comps = r.components || {}
      const fvs = r.fieldValues || {}
      const vals = [
        r.location,
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
        r.location,
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

  const handleDeleteLocation = useCallback(
    async (locationId: string) => {
      if (!zoneId) return
      const loc = locations.find((l) => l.id === locationId)
      const ok = await showConfirm(
        `Delete location "${loc?.location ?? 'this location'}"? This cannot be undone.`,
        {
          title: 'Delete location',
          confirmLabel: 'Delete',
          cancelLabel: 'Cancel',
          variant: 'danger',
        }
      )
      if (!ok) return
      try {
        setSingleMutation('delete')
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
      } finally {
        setSingleMutation(null)
      }
    },
    [zoneId, locations, showConfirm, refreshLocations]
  )

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

  const openEditLocation = useCallback(
    (loc: LocationRow) => {
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
    },
    [components, schemaFields]
  )

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
      setSingleMutation('save')
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
      setSingleMutation(null)
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
      if (c.type === 'fixed') continue
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
      setMutationProgress({ kind: 'bulk-edit', processed: 0, total: ids.length })
      let ok = 0
      let failed = 0
      const body: { components?: Record<string, string>; fieldValues?: Record<string, unknown> } = {}
      if (Object.keys(partial).length > 0) body.components = partial
      if (Object.keys(fieldPartial).length > 0) body.fieldValues = fieldPartial
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]!
        setMutationProgress({ kind: 'bulk-edit', processed: i, total: ids.length })
        await new Promise<void>((r) => requestAnimationFrame(() => r()))
        try {
          // eslint-disable-next-line no-await-in-loop
          await api.put(`/locations/zones/${zoneId}/locations/${id}`, body)
          ok++
        } catch {
          failed++
        }
        setMutationProgress({ kind: 'bulk-edit', processed: i + 1, total: ids.length })
      }
      setBulkLocationsOpen(false)
      setSelectedLocationIds(new Set())
      void refreshLocations(zoneId)
      if (failed > 0) {
        // eslint-disable-next-line no-alert
        window.alert(`Updated ${ok} location(s). ${failed} failed (e.g. duplicate location).`)
      }
    } finally {
      setSavingBulkLocations(false)
      setMutationProgress(null)
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
    const ids = Array.from(selectedLocationIds)
    try {
      setMutationProgress({ kind: 'bulk-delete', count: ids.length })
      await api.post<{ deleted: number }>(`/locations/zones/${zoneId}/locations/bulk-delete`, { ids })
      setSelectedLocationIds(new Set())
      void refreshLocations(zoneId)
    } catch {
      // eslint-disable-next-line no-alert
      window.alert('Failed to delete selected locations')
    } finally {
      setMutationProgress(null)
    }
  }

  const preview = useMemo(() => {
    const order = components
    const byKey: Record<string, string[]> = {}
    const errors: string[] = []

    for (const c of order) {
      if (c.type === 'fixed') {
        const lit = (c.minValue ?? '').trim()
        if (!lit) {
          errors.push(`${c.displayName}: fixed value not configured in schema`)
          byKey[c.key] = []
        } else {
          byKey[c.key] = [lit]
        }
        continue
      }
      const raw = (ranges[c.key] ?? '').trim()
      if (!raw) {
        byKey[c.key] = []
        continue
      }
      const { values, error } = expandLocationGenerationRange(
        raw,
        c.type,
        c.width,
        c.patternMask,
        null
      )
      if (error) {
        errors.push(`${c.displayName}: ${error}`)
        byKey[c.key] = []
      } else if (values.length === 0) {
        errors.push(`${c.displayName}: no values produced`)
        byKey[c.key] = []
      } else {
        byKey[c.key] = values
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

  const clearGenerateInputs = useCallback(() => {
    const clearedRanges: Record<string, string> = {}
    for (const c of components) clearedRanges[c.key] = ''
    setRanges(clearedRanges)
    const clearedFv: Record<string, string> = {}
    for (const f of schemaFields) clearedFv[f.key] = ''
    setGenerateFieldValues(clearedFv)
    setGenerateError(null)
  }, [components, schemaFields])

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault()
    if (!zoneId) return
    if (preview.errors.length > 0 || preview.total === 0) return
    if (preview.total > MAX_GENERATE_LOCATIONS) return
    try {
      setGenerateError(null)
      setGenerateFailureReport(null)
      setGenerating(true)
      setGenerateProgress({ processed: 0, total: preview.total })
      const fv: Record<string, unknown> = {}
      for (const f of schemaFields) {
        const raw = (generateFieldValues[f.key] ?? '').trim()
        if (raw === '') continue
        fv[f.key] = f.type === 'number' ? Number(raw) : raw
      }
      const body: Record<string, unknown> = {
        components: ranges,
        ...(Object.keys(fv).length > 0 ? { fieldValues: fv } : {}),
      }
      const genResult = await postGenerateLocationsStream(zoneId, body, (processed, total) => {
        setGenerateProgress({ processed, total })
      })
      if (genResult.skipped > 0) {
        setGenerateFailureReport({
          created: genResult.created,
          skipped: genResult.skipped,
          totalRequested: genResult.totalRequested,
          failures: genResult.failures,
          failuresTruncated: genResult.failuresTruncated,
        })
      } else {
        setGenerateFailureReport(null)
      }
      if (generateClearAfterRun) {
        clearGenerateInputs()
      } else {
        setGenerateError(null)
      }
      if (generateCloseAfterRun) {
        setGenerateOpen(false)
      }
      void refreshLocations(zoneId)
    } catch (err) {
      setGenerateError(formatGenerateFailureMessage(err))
    } finally {
      setGenerating(false)
      setGenerateProgress(null)
    }
  }

  const locationColumns = useMemo(() => {
    const cols: Array<SimpleColumn<LocationRow>> = [
      { key: 'location', label: 'Location', getValue: (l) => l.location, width: '14rem' },
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

  const getLocationRowKey = useCallback((l: LocationRow) => l.id, [])

  const tableColumnsWithActions = useMemo(() => {
    if (!canWriteLocations) return locationColumns
    return [
      ...locationColumns,
      {
        key: 'actions',
        label: '',
        width: '8rem',
        getValue: () => '',
        render: (l: LocationRow) => (
          <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-background disabled:opacity-50"
              onClick={() => openEditLocation(l)}
              disabled={mutationBusy}
            >
              Edit
            </button>
            <button
              type="button"
              className="rounded border border-red-500/50 px-2 py-1 text-xs text-red-500 hover:bg-red-500/10 disabled:opacity-50"
              onClick={() => void handleDeleteLocation(l.id)}
              disabled={mutationBusy}
            >
              Delete
            </button>
          </div>
        ),
      },
    ]
  }, [canWriteLocations, locationColumns, openEditLocation, handleDeleteLocation, mutationBusy])

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
            {zone && canWriteLocations && (
              <button
                type="button"
                className="rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-card"
                onClick={() => openEditZoneModal()}
              >
                Edit zone
              </button>
            )}
            {canWriteLocations && (
              <button
                type="button"
                className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
                onClick={() => {
                  setGenerateFieldValues((prev) => {
                    const next = { ...prev }
                    for (const f of schemaFields) {
                      if (!(f.key in next)) next[f.key] = ''
                    }
                    return next
                  })
                  setGenerateError(null)
                  setGenerateFailureReport(null)
                  setGenerateCloseAfterRun(false)
                  setGenerateClearAfterRun(false)
                  setGenerateOpen(true)
                }}
                disabled={components.length === 0}
              >
                Generate…
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
            {canWriteLocations && (
            <button
              type="button"
              className="rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-card disabled:opacity-50"
              onClick={openBulkLocationsModal}
              disabled={mutationBusy || locationsLoading || selectedLocationIds.size <= 1}
              title={
                selectedLocationIds.size <= 1
                  ? 'Select at least two locations to use bulk edit'
                  : 'Apply component or field values to selected locations'
              }
            >
              Bulk edit…
            </button>
            )}
            <button
              type="button"
              className="rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-card disabled:opacity-50"
              onClick={handleExportSelected}
              disabled={mutationBusy || locationsLoading || selectedLocationIds.size === 0}
              title={selectedLocationIds.size === 0 ? 'Select one or more locations first' : 'Export selected locations (CSV)'}
            >
              Export selected
            </button>
            {canWriteLocations && (
            <button
              type="button"
              className="rounded border border-red-500/50 bg-background px-3 py-1.5 text-xs text-red-500 hover:bg-red-500/10 disabled:opacity-50"
              onClick={() => void handleDeleteSelectedLocations()}
              disabled={mutationBusy || locationsLoading || selectedLocationIds.size === 0}
              title={selectedLocationIds.size === 0 ? 'Select one or more locations first' : 'Delete selected locations'}
            >
              Delete selected
            </button>
            )}
          <button
            type="button"
            className="rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-card disabled:opacity-50"
            onClick={handleExportCsvClick}
            disabled={!zoneId || locationsLoading}
          >
            Export CSV
          </button>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <SimpleDataTable
          fillViewportHeight
          pagination
          preferenceKey={`atlas-locations-zone-${zoneId ?? 'unknown'}-locations`}
          rows={locations}
          getRowKey={getLocationRowKey}
          enableSelection
          selectedKeys={selectedLocationIds}
          onSelectedKeysChange={setSelectedLocationIds}
          onFilterSnapshotChange={onLocationsFilterSnapshot}
          showFooterRowCount
          columns={tableColumnsWithActions}
        />
        {locationsLoading && (
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/55 backdrop-blur-[1px]"
            aria-busy="true"
            aria-live="polite"
            role="status"
          >
            <div
              className="h-10 w-10 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent"
              aria-hidden
            />
            <span className="text-sm text-foreground/85">Loading locations…</span>
          </div>
        )}
      </div>
      {canWriteLocations && bulkLocationsOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
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
              {components.map((c) => {
                const hint = locationComponentHint(c)
                return (
                <div key={c.id}>
                  <label className="block text-sm font-medium text-foreground">
                    {c.displayName} ({c.key})
                    <span className="ml-1 font-normal text-foreground/50">
                      — {hint.widthLabel}, {hint.charsetLabel}
                    </span>
                  </label>
                  {c.type === 'fixed' ? (
                    <div className="mt-1 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 font-mono text-sm text-foreground">
                      {(c.minValue ?? '').trim() || '—'}
                    </div>
                  ) : c.type === 'mixed' && c.patternMask?.trim() ? (
                    <MaskedTextInput
                      value={bulkLocationPatch[c.key] ?? ''}
                      onChange={(next) => {
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
                      config={{ textPatternMask: c.patternMask.trim() }}
                      locationPatternSlots
                      className={`mt-1 w-full rounded-lg border bg-background px-3 py-2 text-foreground ${
                        bulkLocationFieldErrors[c.key]
                          ? 'border-red-500 ring-1 ring-red-500/30'
                          : 'border-border'
                      }`}
                    />
                  ) : (
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
                  )}
                  {bulkLocationFieldErrors[c.key] && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">{bulkLocationFieldErrors[c.key]}</p>
                  )}
                </div>
                )
              })}
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
              {savingBulkLocations &&
                mutationProgress?.kind === 'bulk-edit' &&
                mutationProgress.total > 0 && (
                  <div className="space-y-1.5 rounded-lg border border-border bg-muted/40 px-3 py-3">
                    <div className="flex items-center justify-between gap-2 text-xs text-foreground/80">
                      <span>Applying bulk edit</span>
                      <span className="tabular-nums font-medium text-foreground">
                        {mutationProgress.processed.toLocaleString()} /{' '}
                        {mutationProgress.total.toLocaleString()}
                      </span>
                    </div>
                    <div
                      className="h-2.5 w-full overflow-hidden rounded-full bg-background"
                      role="progressbar"
                      aria-valuenow={mutationProgress.processed}
                      aria-valuemin={0}
                      aria-valuemax={mutationProgress.total}
                      aria-label="Bulk edit progress"
                    >
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.round((mutationProgress.processed / mutationProgress.total) * 100)
                          )}%`,
                        }}
                      />
                    </div>
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
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
      {canWriteLocations && editZoneOpen && zone && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
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
        {canWriteLocations && editingLocation && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
            <div
              className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-foreground">Edit location</h2>
                  <p className="text-xs text-foreground/70">
                    Code updates from components:{' '}
                    <span className="font-mono">{editingLocation.location}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (savingLocation) return
                    setEditingLocation(null)
                    setEditLocationFieldErrors({})
                    setEditLocationSchemaFieldErrors({})
                  }}
                  className="shrink-0 rounded-lg px-2 py-1 text-sm text-foreground/70 hover:bg-background"
                  disabled={savingLocation}
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
                {components.map((c) => {
                  const hint = locationComponentHint(c)
                  return (
                  <div key={c.id}>
                    <label className="block text-sm font-medium text-foreground">
                      {c.displayName} ({c.key})
                      <span className="ml-1 font-normal text-foreground/50">
                        — {hint.widthLabel}, {hint.charsetLabel}
                      </span>
                    </label>
                    {c.type === 'fixed' ? (
                      <div className="mt-1 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 font-mono text-sm text-foreground">
                        {(c.minValue ?? '').trim() || '—'}
                      </div>
                    ) : c.type === 'mixed' && c.patternMask?.trim() ? (
                      <MaskedTextInput
                        value={editLocationComponents[c.key] ?? ''}
                        onChange={(next) => {
                          setEditLocationComponents((prev) => ({
                            ...prev,
                            [c.key]: next,
                          }))
                          setEditLocationFieldErrors((prev) => {
                            const n = { ...prev }
                            delete n[c.key]
                            return n
                          })
                        }}
                        config={{ textPatternMask: c.patternMask.trim() }}
                        locationPatternSlots
                        className={`mt-1 w-full rounded-lg border bg-background px-3 py-2 text-foreground ${
                          editLocationFieldErrors[c.key]
                            ? 'border-red-500 ring-1 ring-red-500/30'
                            : 'border-border'
                        }`}
                      />
                    ) : (
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
                    )}
                    {editLocationFieldErrors[c.key] && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">{editLocationFieldErrors[c.key]}</p>
                    )}
                  </div>
                  )
                })}
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
                {savingLocation && singleMutation === 'save' && (
                  <div className="space-y-1.5 rounded-lg border border-border bg-muted/40 px-3 py-3">
                    <div className="flex items-center justify-between gap-2 text-xs text-foreground/80">
                      <span>Saving location</span>
                    </div>
                    <div
                      className="h-2.5 w-full overflow-hidden rounded-full bg-background"
                      role="progressbar"
                      aria-busy="true"
                      aria-label="Saving location"
                    >
                      <div className="h-full w-full animate-pulse rounded-full bg-primary/85" />
                    </div>
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (savingLocation) return
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
        {canWriteLocations && generateOpen && (
          <div className="fixed inset-0 z-[100] overflow-y-auto overscroll-contain bg-black/50">
            <div className="flex min-h-full items-center justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:p-6">
              <div
                className="my-auto w-full max-h-[min(90dvh,calc(100dvh-2rem))] max-w-4xl overflow-y-auto overscroll-contain rounded-xl border border-border bg-card p-6 shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
              <div className="mb-5 border-b border-border pb-4">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold tracking-tight text-foreground">Generate locations</h2>
                  <p className="text-sm leading-relaxed text-foreground/70">
                    Enter ranges like <span className="font-mono text-foreground/90">1-3,5</span>,{' '}
                    <span className="font-mono text-foreground/90">A-C</span>, or for mixed parts{' '}
                    <span className="font-mono text-foreground/90">A1-C3</span> (letters and digits per position).
                  </p>
                </div>
              </div>

              {generateError && (
                <div
                  className="mb-4 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300"
                  role="alert"
                >
                  <div className="font-semibold text-red-800 dark:text-red-200">Generation failed</div>
                  <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">{generateError}</p>
                  <p className="mt-3 text-xs text-red-600/90 dark:text-red-400/90">
                    This message comes from the server when the request could not be completed. Adjust ranges or
                    optional fields as indicated, then try again.
                  </p>
                </div>
              )}

              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
                <form onSubmit={handleGenerate} className="flex min-h-0 flex-col gap-4 text-sm">
                  <div className="space-y-2.5">
                    {components.map((c) => {
                      const w = c.width
                      const charWord = w === 1 ? 'char' : 'chars'
                      const pm = c.patternMask?.trim()
                      const fixedLit = (c.minValue ?? '').trim()
                      const typeAndCount =
                        c.type === 'fixed'
                          ? `Fixed · ${fixedLit ? `"${fixedLit}"` : 'not configured'}`
                          : c.type === 'alpha'
                            ? `Letters (A–Z) · ${w} ${charWord}`
                            : c.type === 'numeric'
                              ? `Digits (0–9) · ${w} ${charWord}`
                              : pm
                                ? `Pattern mask · ${pm}`
                                : `Mixed (A–Z & 0–9) · ${w} ${charWord}`
                      const placeholder =
                        c.type === 'fixed'
                          ? ''
                          : c.type === 'alpha'
                            ? 'e.g. A-C'
                            : c.type === 'numeric'
                              ? 'e.g. 1-3,5'
                              : pm
                                ? 'comma-separated full codes, e.g. AA-01,AA-02'
                                : 'e.g. A1-C3 or 1A,2A'
                      return (
                      <div key={c.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                        <label className="shrink-0 text-sm font-medium text-foreground sm:w-44">
                          <span className="block text-foreground">{c.displayName}</span>
                          <span className="mt-0.5 block text-xs font-normal text-foreground/60">
                            {typeAndCount}
                          </span>
                        </label>
                        {c.type === 'fixed' ? (
                          <div className="min-w-0 flex-1 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 font-mono text-sm text-foreground">
                            {fixedLit || '—'}
                          </div>
                        ) : (
                          <input
                            type="text"
                            value={ranges[c.key] ?? ''}
                            onChange={(e) => {
                              const v = sanitizeGenerateRangeInput(e.target.value, c.type, c.patternMask)
                              setRanges((prev) => ({
                                ...prev,
                                [c.key]: v,
                              }))
                            }}
                            inputMode={c.type === 'numeric' ? 'numeric' : 'text'}
                            autoCapitalize={c.type === 'alpha' ? 'characters' : 'off'}
                            spellCheck={false}
                            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                            placeholder={placeholder}
                          />
                        )}
                      </div>
                      )
                    })}
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

                  {preview.errors.length === 0 && preview.total > MAX_GENERATE_LOCATIONS && (
                    <div
                      className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-900 dark:text-amber-100"
                      role="alert"
                    >
                      <span className="font-medium">Too many locations.</span> This run would create{' '}
                      <span className="tabular-nums font-semibold">{preview.total.toLocaleString()}</span>{' '}
                      locations; the maximum per generation is{' '}
                      <span className="tabular-nums font-semibold">
                        {MAX_GENERATE_LOCATIONS.toLocaleString()}
                      </span>
                      . Narrow your ranges and try again.
                    </div>
                  )}

                  {generating && generateProgress && generateProgress.total > 0 && (
                    <div className="space-y-1.5 rounded-lg border border-border bg-muted/40 px-3 py-3">
                      <div className="flex items-center justify-between gap-2 text-xs text-foreground/80">
                        <span>Generating locations</span>
                        <span className="tabular-nums font-medium text-foreground">
                          {generateProgress.processed.toLocaleString()} /{' '}
                          {generateProgress.total.toLocaleString()}
                        </span>
                      </div>
                      <div
                        className="h-2.5 w-full overflow-hidden rounded-full bg-background"
                        role="progressbar"
                        aria-valuenow={generateProgress.processed}
                        aria-valuemin={0}
                        aria-valuemax={generateProgress.total}
                        aria-label="Generate progress"
                      >
                        <div
                          className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
                          style={{
                            width: `${Math.min(
                              100,
                              Math.round((generateProgress.processed / generateProgress.total) * 100)
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="mt-auto flex flex-col gap-3 border-t border-border pt-4">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-background disabled:opacity-50"
                        onClick={() => {
                          setGenerateError(null)
                          setGenerateOpen(false)
                        }}
                        disabled={generating}
                        title="Close this dialog"
                      >
                        Close
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-background disabled:opacity-50"
                        onClick={clearGenerateInputs}
                        disabled={generating}
                        title="Clear range inputs and optional attributes"
                      >
                        Clear
                      </button>
                      <button
                        type="submit"
                        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                        disabled={
                          generating ||
                          preview.total === 0 ||
                          preview.total > MAX_GENERATE_LOCATIONS
                        }
                        title={
                          preview.total === 0
                            ? 'Enter valid ranges to generate'
                            : preview.total > MAX_GENERATE_LOCATIONS
                              ? `At most ${MAX_GENERATE_LOCATIONS.toLocaleString()} locations per generation`
                              : 'Generate locations'
                        }
                      >
                        {generating ? 'Generating…' : `Generate (${preview.total.toLocaleString()})`}
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-2">
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground/85">
                        <span>Clear after run</span>
                        <input
                          type="checkbox"
                          checked={generateClearAfterRun}
                          onChange={(e) => setGenerateClearAfterRun(e.target.checked)}
                          disabled={generating}
                          className="h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-primary"
                        />
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground/85">
                        <span>Close after run</span>
                        <input
                          type="checkbox"
                          checked={generateCloseAfterRun}
                          onChange={(e) => setGenerateCloseAfterRun(e.target.checked)}
                          disabled={generating}
                          className="h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-primary"
                        />
                      </label>
                    </div>
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
          </div>
        )}
        {generateFailureReport && (
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4"
            role="presentation"
            onClick={() => setGenerateFailureReport(null)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="generate-failure-modal-title"
              className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-amber-500/40 bg-card shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="shrink-0 border-b border-border px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <h2
                      id="generate-failure-modal-title"
                      className="text-base font-semibold text-amber-950 dark:text-amber-100"
                    >
                      Some locations were not created
                    </h2>
                    <p className="text-sm text-foreground/85">
                      Created {generateFailureReport.created.toLocaleString()} of{' '}
                      {generateFailureReport.totalRequested.toLocaleString()}. Skipped{' '}
                      {generateFailureReport.skipped.toLocaleString()}.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm text-foreground/70 hover:bg-background"
                    onClick={() => setGenerateFailureReport(null)}
                  >
                    Close
                  </button>
                </div>
              </div>
              {generateFailureReport.failures.length > 0 && (
                <div className="flex min-h-0 flex-1 flex-col px-5 py-3">
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-background">
                    <div
                      className="grid shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-3 border-b border-border bg-muted px-3 py-2 text-xs font-semibold text-foreground"
                      role="row"
                    >
                      <div role="columnheader">Location</div>
                      <div role="columnheader">Reason</div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                      <ul className="divide-y divide-border/70 text-xs" role="list">
                        {generateFailureReport.failures.map((f, idx) => (
                          <li
                            key={`${f.location}-${idx}`}
                            className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-3 px-3 py-1.5"
                            role="row"
                          >
                            <div className="min-w-0 break-all font-mono tabular-nums text-foreground" role="cell">
                              {f.location}
                            </div>
                            <div className="min-w-0 text-foreground/90" role="cell">
                              {f.reason}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
              {generateFailureReport.failuresTruncated && (
                <div className="shrink-0 border-t border-border px-5 py-3">
                  <p className="text-xs text-foreground/75">
                    List shows the first {generateFailureReport.failures.length.toLocaleString()} skipped
                    location(s); {generateFailureReport.skipped.toLocaleString()} skipped in total.
                  </p>
                </div>
              )}
              <div className="shrink-0 border-t border-border px-5 py-3">
                <button
                  type="button"
                  className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
                  onClick={() => setGenerateFailureReport(null)}
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        )}
      {mutationProgress?.kind === 'bulk-delete' || singleMutation === 'delete' ? (
        <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-[110] border-t border-border bg-card/95 px-4 py-3 shadow-[0_-4px_24px_rgba(0,0,0,0.12)] backdrop-blur supports-[backdrop-filter]:bg-card/85 dark:shadow-[0_-4px_24px_rgba(0,0,0,0.35)]">
          <div className="pointer-events-auto mx-auto max-w-3xl space-y-1.5">
            {mutationProgress?.kind === 'bulk-delete' ? (
              <>
                <div className="flex items-center justify-between gap-2 text-xs text-foreground/80">
                  <span>
                    Deleting {mutationProgress.count.toLocaleString()} location
                    {mutationProgress.count === 1 ? '' : 's'}…
                  </span>
                </div>
                <div
                  className="h-2.5 w-full overflow-hidden rounded-full bg-background"
                  role="progressbar"
                  aria-busy="true"
                  aria-label="Bulk delete in progress"
                >
                  <div className="h-full w-full animate-pulse rounded-full bg-primary/85" />
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 text-xs text-foreground/80">
                  <span>Deleting location</span>
                </div>
                <div
                  className="h-2.5 w-full overflow-hidden rounded-full bg-background"
                  role="progressbar"
                  aria-busy="true"
                  aria-label="Deleting location"
                >
                  <div className="h-full w-full animate-pulse rounded-full bg-primary/85" />
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default LocationZoneDetail

