import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { Link } from 'react-router-dom'
import {
  createAmrStand,
  deleteAmrStand,
  getAmrSettings,
  getAmrStands,
  updateAmrStand,
} from '@/api/amr'
import { ImportAmrStandsModal } from '@/components/amr/ImportAmrStandsModal'
import { AmrZoneCategoriesModal } from '@/components/amr/AmrZoneCategoriesModal'
import { ColumnFilterDropdown } from '@/components/data/ColumnFilterDropdown'
import { PopupSelect } from '@/components/ui/PopupSelect'
import { useSortableHeader } from '@/hooks/useSortableHeader'
import { amrPath } from '@/lib/appPaths'
import { useAuthStore } from '@/store/authStore'
import {
  AMR_STAND_LOCATION_TYPE_NON_STAND,
  AMR_STAND_LOCATION_TYPE_STAND,
  type AmrStandLocationType,
  normalizeAmrStandLocationType,
} from '@/utils/amrStandLocationType'

const STAND_BULK_FIELDS = [
  { value: 'location_type', label: 'Location type' },
  { value: 'zone', label: 'Zone' },
  { value: 'external_ref', label: 'Location' },
  { value: 'dwg_ref', label: 'DWG ref' },
  { value: 'orientation', label: 'Orientation' },
  { value: 'x', label: 'X (m)' },
  { value: 'y', label: 'Y (m)' },
  { value: 'enabled', label: 'Enabled' },
  { value: 'block_pickup', label: 'Block pickup (no lift)' },
  { value: 'block_dropoff', label: 'Block dropoff (no lower)' },
  { value: 'bypass_pallet_check', label: 'Bypass pallet check' },
  { value: 'active_missions', label: 'Active missions (bypass cap)' },
] as const

type StandBulkFieldKey = (typeof STAND_BULK_FIELDS)[number]['value']

const STAND_TABLE_KEYS = [
  'external_ref',
  'stand_type',
  'zone',
  'orientation',
  'xy',
  'enabled',
  'restrictions',
] as const
type StandTableKey = (typeof STAND_TABLE_KEYS)[number]

function standTypeLabel(row: Record<string, unknown>): string {
  const lt = normalizeAmrStandLocationType((row as { location_type?: unknown }).location_type)
  return lt === AMR_STAND_LOCATION_TYPE_NON_STAND ? 'Non-stand waypoint' : 'Rack stand'
}

function restrictionsLabel(row: Record<string, unknown>): string {
  const bp = Number(row.block_pickup) === 1
  const bd = Number(row.block_dropoff) === 1
  const bypass = Number(row.bypass_pallet_check) === 1
  const activeMissions = Math.max(1, Number(row.active_missions ?? 1))
  const parts: string[] = []
  if (bp && bd) parts.push('No lift, No lower')
  else if (bp) parts.push('No lift')
  else if (bd) parts.push('No lower')
  if (bypass) parts.push(`Bypass pallet check (${activeMissions} active)`)
  return parts.join('; ')
}

function standFilterValue(row: Record<string, unknown>, key: StandTableKey): string {
  switch (key) {
    case 'external_ref':
      return String(row.external_ref ?? '')
    case 'stand_type':
      return standTypeLabel(row)
    case 'zone':
      return String(row.zone ?? '')
    case 'orientation':
      return String(row.orientation ?? '')
    case 'xy':
      return `${String(row.x ?? 0)}, ${String(row.y ?? 0)}`
    case 'enabled':
      return Number(row.enabled) === 1 ? 'Yes' : 'No'
    case 'restrictions':
      return restrictionsLabel(row) || 'None'
    default:
      return ''
  }
}

function standSearchHaystack(row: Record<string, unknown>): string {
  return [
    standFilterValue(row, 'external_ref'),
    standFilterValue(row, 'stand_type'),
    standFilterValue(row, 'zone'),
    standFilterValue(row, 'orientation'),
    standFilterValue(row, 'xy'),
    standFilterValue(row, 'enabled'),
    standFilterValue(row, 'restrictions'),
  ]
    .join('\u0001')
    .toLowerCase()
}

function apiErrorMessage(e: unknown): string {
  const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
  if (typeof msg === 'string' && msg.trim()) return msg
  if (e instanceof Error) return e.message
  return 'Something went wrong.'
}

function compareStandRows(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  key: StandTableKey,
  dir: 'asc' | 'desc'
): number {
  const sign = dir === 'asc' ? 1 : -1
  if (key === 'xy') {
    const ax = Number(a.x ?? 0)
    const bx = Number(b.x ?? 0)
    const ay = Number(a.y ?? 0)
    const by = Number(b.y ?? 0)
    if (ax !== bx) return sign * (ax - bx)
    if (ay !== by) return sign * (ay - by)
    return 0
  }
  if (key === 'enabled') {
    const ae = Number(a.enabled) === 1 ? 1 : 0
    const be = Number(b.enabled) === 1 ? 1 : 0
    return sign * (ae - be)
  }
  if (key === 'restrictions') {
    const ar =
      (Number(a.block_pickup) === 1 ? 1 : 0) +
      (Number(a.block_dropoff) === 1 ? 2 : 0) +
      (Number(a.bypass_pallet_check) === 1 ? 4 : 0)
    const br =
      (Number(b.block_pickup) === 1 ? 1 : 0) +
      (Number(b.block_dropoff) === 1 ? 2 : 0) +
      (Number(b.bypass_pallet_check) === 1 ? 4 : 0)
    return sign * (ar - br)
  }
  const va = standFilterValue(a, key)
  const vb = standFilterValue(b, key)
  return sign * va.localeCompare(vb, undefined, { sensitivity: 'base', numeric: true })
}

type StandFormState = {
  zone: string
  external_ref: string
  dwg_ref: string
  orientation: string
  x: number
  y: number
  enabled: boolean
  block_pickup: boolean
  block_dropoff: boolean
  bypass_pallet_check: boolean
  active_missions: number
  location_type: AmrStandLocationType
}

const defaultStandForm = (): StandFormState => ({
  zone: '',
  external_ref: '',
  dwg_ref: '',
  orientation: '0',
  x: 0,
  y: 0,
  enabled: true,
  block_pickup: false,
  block_dropoff: false,
  bypass_pallet_check: false,
  active_missions: 1,
  location_type: AMR_STAND_LOCATION_TYPE_STAND,
})

function rowToForm(row: Record<string, unknown>): StandFormState {
  return {
    zone: String(row.zone ?? ''),
    external_ref: String(row.external_ref ?? ''),
    dwg_ref: String(row.dwg_ref ?? ''),
    orientation: String(row.orientation ?? '0'),
    x: Number(row.x ?? 0),
    y: Number(row.y ?? 0),
    enabled: Number(row.enabled) === 1,
    block_pickup: Number(row.block_pickup) === 1,
    block_dropoff: Number(row.block_dropoff) === 1,
    bypass_pallet_check: Number(row.bypass_pallet_check) === 1,
    active_missions: Math.max(1, Number(row.active_missions ?? 1)),
    location_type:
      normalizeAmrStandLocationType((row as { location_type?: unknown }).location_type) ===
      AMR_STAND_LOCATION_TYPE_NON_STAND
        ? AMR_STAND_LOCATION_TYPE_NON_STAND
        : AMR_STAND_LOCATION_TYPE_STAND,
  }
}

function StandFormFields({
  form,
  setForm,
  queueingEnabled,
}: {
  form: StandFormState
  setForm: Dispatch<SetStateAction<StandFormState>>
  queueingEnabled: boolean
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="col-span-full text-sm">
        Location type
        <select
          className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
          value={form.location_type}
          onChange={(e) => {
            const v =
              e.target.value === AMR_STAND_LOCATION_TYPE_NON_STAND
                ? AMR_STAND_LOCATION_TYPE_NON_STAND
                : AMR_STAND_LOCATION_TYPE_STAND
            setForm((f) => ({
              ...f,
              location_type: v,
            }))
          }}
        >
          <option value={AMR_STAND_LOCATION_TYPE_STAND}>Rack stand</option>
          <option value={AMR_STAND_LOCATION_TYPE_NON_STAND}>Non-stand waypoint</option>
        </select>
        <span className="mt-1 block text-[11px] text-foreground/55">
          Waypoints skip Hyperion pallet presence in the picker unless &quot;Bypass pallet check&quot; is enabled. Use
          block pickup / dropoff to forbid lift or lower at this node. Cannot belong to stand groups.
        </span>
      </label>
      <label className="text-sm">
        Zone
        <input
          className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
          value={form.zone}
          onChange={(e) => setForm((f) => ({ ...f, zone: e.target.value }))}
        />
      </label>
      <label className="col-span-full text-sm">
        Location (External Ref) *
        <input
          className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
          value={form.external_ref}
          onChange={(e) => setForm((f) => ({ ...f, external_ref: e.target.value }))}
        />
      </label>
      <label className="text-sm">
        DWG ref
        <input
          className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
          value={form.dwg_ref}
          onChange={(e) => setForm((f) => ({ ...f, dwg_ref: e.target.value }))}
        />
      </label>
      <label className="text-sm">
        Orientation
        <select
          className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
          value={form.orientation}
          onChange={(e) => setForm((f) => ({ ...f, orientation: e.target.value }))}
        >
          {['0', '90', '180', '-90'].map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
      <div className="col-span-full grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-2">
        <label className="text-sm">
          X (m)
          <input
            type="number"
            className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
            value={form.x}
            onChange={(e) => setForm((f) => ({ ...f, x: Number(e.target.value) }))}
          />
        </label>
        <label className="text-sm">
          Y (m)
          <input
            type="number"
            className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
            value={form.y}
            onChange={(e) => setForm((f) => ({ ...f, y: Number(e.target.value) }))}
          />
        </label>
      </div>
      <label className="col-span-full flex items-center gap-2 pt-1 text-sm">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
        />
        Enabled
      </label>
      <fieldset className="col-span-full grid gap-2 border-t border-border pt-3 text-sm">
        <legend className="px-1 text-xs font-medium uppercase tracking-wide text-foreground/60">
          Special location restrictions
        </legend>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.block_pickup}
            onChange={(e) => setForm((f) => ({ ...f, block_pickup: e.target.checked }))}
          />
          Block pallet pickup (no lift)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.block_dropoff}
            onChange={(e) => setForm((f) => ({ ...f, block_dropoff: e.target.checked }))}
          />
          Block pallet dropoff (no lower)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.bypass_pallet_check}
            onChange={(e) => setForm((f) => ({ ...f, bypass_pallet_check: e.target.checked }))}
          />
          Bypass pallet check (skip empty-stand verification)
        </label>
        <label className="text-sm">
          Active missions (bypass cap)
          <input
            type="number"
            min={1}
            className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm disabled:opacity-60"
            disabled={!form.bypass_pallet_check || !queueingEnabled}
            value={form.active_missions}
            onChange={(e) =>
              setForm((f) => ({ ...f, active_missions: Math.max(1, Math.floor(Number(e.target.value) || 1)) }))
            }
          />
          <span className="mt-1 block text-[11px] text-foreground/55">
            {queueingEnabled
              ? 'Applies only when Bypass pallet check is enabled.'
              : 'Requires mission queueing enabled in AMR settings.'}
          </span>
        </label>
      </fieldset>
    </div>
  )
}

export function AmrStands() {
  const canManage = useAuthStore((s) => s.hasPermission('amr.stands.manage'))
  const [missionQueueingEnabled, setMissionQueueingEnabled] = useState(true)
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [form, setForm] = useState(defaultStandForm)
  const [editStand, setEditStand] = useState<Record<string, unknown> | null>(null)
  const [editForm, setEditForm] = useState(defaultStandForm)
  const [addModalError, setAddModalError] = useState<string | null>(null)
  const [editModalError, setEditModalError] = useState<string | null>(null)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [bulkEditField, setBulkEditField] = useState<StandBulkFieldKey | null>(null)
  const [bulkEditStr, setBulkEditStr] = useState('')
  const [bulkEditNum, setBulkEditNum] = useState(0)
  const [bulkEditEnabled, setBulkEditEnabled] = useState(true)
  const [bulkEditLocationType, setBulkEditLocationType] = useState<AmrStandLocationType>(
    AMR_STAND_LOCATION_TYPE_STAND
  )
  const [bulkEditSubmitting, setBulkEditSubmitting] = useState(false)
  const [bulkEditError, setBulkEditError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [columnFilters, setColumnFilters] = useState<Record<string, Set<string>>>({})
  const [openFilterColumn, setOpenFilterColumn] = useState<string | null>(null)
  const filterAnchorRefs = useRef<Record<string, HTMLTableCellElement | null>>({})
  const [sort, setSort] = useState<{ key: StandTableKey; dir: 'asc' | 'desc' }>({
    key: 'external_ref',
    dir: 'asc',
  })
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const load = useCallback(() => {
    setLoading(true)
    void getAmrStands()
      .then((s) => setRows(s))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])
  useEffect(() => {
    void getAmrSettings().then((s) => setMissionQueueingEnabled(s.missionQueueingEnabled !== false))
  }, [])

  useEffect(() => {
    const valid = new Set(rows.map((r) => String(r.id)))
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => valid.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [rows])

  const closeAddModal = useCallback(() => {
    setAddOpen(false)
    setAddModalError(null)
    setForm(defaultStandForm())
  }, [])

  const closeEditModal = useCallback(() => {
    setEditStand(null)
    setEditModalError(null)
    setEditForm(defaultStandForm())
  }, [])

  const openEdit = useCallback((row: Record<string, unknown>) => {
    setEditModalError(null)
    setEditForm(rowToForm(row))
    setEditStand(row)
  }, [])

  const closeBulkEditModal = useCallback(() => {
    setBulkEditOpen(false)
    setBulkEditField(null)
    setBulkEditError(null)
    setBulkEditLocationType(AMR_STAND_LOCATION_TYPE_STAND)
  }, [])

  useEffect(() => {
    if (addOpen) setAddModalError(null)
  }, [addOpen])

  useEffect(() => {
    if (!addOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAddModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [addOpen, closeAddModal])

  useEffect(() => {
    if (!editStand) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeEditModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editStand, closeEditModal])

  useEffect(() => {
    if (!bulkEditOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeBulkEditModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [bulkEditOpen, closeBulkEditModal])

  const saveNew = async () => {
    if (!form.external_ref.trim()) return
    const ref = form.external_ref.trim()
    setAddModalError(null)
    try {
      await createAmrStand({
        zone: form.zone,
        external_ref: ref,
        location_label: ref,
        dwg_ref: form.dwg_ref || undefined,
        orientation: form.orientation,
        x: form.x,
        y: form.y,
        enabled: form.enabled,
        block_pickup: form.block_pickup,
        block_dropoff: form.block_dropoff,
        bypass_pallet_check: form.bypass_pallet_check,
        active_missions: form.active_missions,
        location_type: form.location_type,
      })
      closeAddModal()
      load()
    } catch (e) {
      setAddModalError(apiErrorMessage(e))
    }
  }

  const saveEdit = async () => {
    if (!editStand || !editForm.external_ref.trim()) return
    const ref = editForm.external_ref.trim()
    setEditModalError(null)
    try {
      await updateAmrStand(String(editStand.id), {
        zone: editForm.zone,
        external_ref: ref,
        location_label: ref,
        dwg_ref: editForm.dwg_ref || undefined,
        orientation: editForm.orientation,
        x: editForm.x,
        y: editForm.y,
        enabled: editForm.enabled,
        block_pickup: editForm.block_pickup,
        block_dropoff: editForm.block_dropoff,
        bypass_pallet_check: editForm.bypass_pallet_check,
        active_missions: editForm.active_missions,
        location_type: editForm.location_type,
      })
      closeEditModal()
      load()
    } catch (e) {
      setEditModalError(apiErrorMessage(e))
    }
  }

  const handleSort = useCallback((key: StandTableKey, addSecondary: boolean) => {
    if (addSecondary) return
    setSort((s) =>
      s.key !== key ? { key, dir: 'asc' } : { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
    )
  }, [])

  const getSortHandlers = useSortableHeader(handleSort)
  const getSortIndex = (key: StandTableKey) => (sort.key === key ? 0 : -1)
  const getSortDir = (key: StandTableKey) => (sort.key === key ? sort.dir : undefined)

  const getColumnValues = useCallback((key: StandTableKey): string[] => {
    return rows.map((r) => standFilterValue(r, key))
  }, [rows])

  const zoneStandCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of rows) {
      const z = String(r.zone ?? '').trim()
      if (!z) continue
      m[z] = (m[z] ?? 0) + 1
    }
    return m
  }, [rows])

  const filteredRows = useMemo(() => {
    let result = rows
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      result = result.filter((r) => standSearchHaystack(r).includes(q))
    }
    for (const [colKey, allowed] of Object.entries(columnFilters)) {
      if (!allowed || allowed.size === 0) continue
      const k = colKey as StandTableKey
      if (!STAND_TABLE_KEYS.includes(k)) continue
      result = result.filter((r) => allowed.has(standFilterValue(r, k)))
    }
    return result
  }, [rows, searchQuery, columnFilters])

  const displayRows = useMemo(() => {
    const copy = [...filteredRows]
    copy.sort((a, b) => compareStandRows(a, b, sort.key, sort.dir))
    return copy
  }, [filteredRows, sort])

  const hasActiveFilters =
    searchQuery.trim() !== '' || Object.values(columnFilters).some((s) => s && s.size > 0)

  const clearAllFilters = () => {
    setSearchQuery('')
    setColumnFilters({})
    setOpenFilterColumn(null)
  }

  const toggleRowSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const bulkDeleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) return
    if (!confirm(`Delete ${selectedIds.size} stand(s)? This cannot be undone.`)) return
    await Promise.all([...selectedIds].map((id) => deleteAmrStand(id)))
    setSelectedIds(new Set())
    load()
  }, [selectedIds, load])

  const seedBulkEditFromFirstSelected = useCallback(
    (key: StandBulkFieldKey) => {
      const firstId = [...selectedIds][0]
      const row = rows.find((r) => String(r.id) === firstId)
      if (!row) return
      switch (key) {
        case 'location_type':
          setBulkEditLocationType(
            normalizeAmrStandLocationType((row as { location_type?: unknown }).location_type) ===
              AMR_STAND_LOCATION_TYPE_NON_STAND
              ? AMR_STAND_LOCATION_TYPE_NON_STAND
              : AMR_STAND_LOCATION_TYPE_STAND
          )
          break
        case 'zone':
          setBulkEditStr(String(row.zone ?? ''))
          break
        case 'external_ref':
          setBulkEditStr(String(row.external_ref ?? ''))
          break
        case 'dwg_ref':
          setBulkEditStr(String(row.dwg_ref ?? ''))
          break
        case 'orientation':
          setBulkEditStr(String(row.orientation ?? '0'))
          break
        case 'x':
          setBulkEditNum(Number(row.x ?? 0))
          break
        case 'y':
          setBulkEditNum(Number(row.y ?? 0))
          break
        case 'enabled':
          setBulkEditEnabled(Number(row.enabled) === 1)
          break
        case 'block_pickup':
          setBulkEditEnabled(Number(row.block_pickup) === 1)
          break
        case 'block_dropoff':
          setBulkEditEnabled(Number(row.block_dropoff) === 1)
          break
        case 'bypass_pallet_check':
          setBulkEditEnabled(Number(row.bypass_pallet_check) === 1)
          break
        case 'active_missions':
          setBulkEditNum(Math.max(1, Number(row.active_missions ?? 1)))
          break
        default:
          break
      }
    },
    [rows, selectedIds]
  )

  const buildBulkEditPatch = useCallback((): Record<string, unknown> | null => {
    if (!bulkEditField) return null
    switch (bulkEditField) {
      case 'location_type':
        return { location_type: bulkEditLocationType }
      case 'zone':
        return { zone: bulkEditStr }
      case 'external_ref': {
        const ref = bulkEditStr.trim()
        return ref ? { external_ref: ref, location_label: ref } : null
      }
      case 'dwg_ref':
        return { dwg_ref: bulkEditStr.trim() === '' ? null : bulkEditStr.trim() }
      case 'orientation':
        return { orientation: bulkEditStr }
      case 'x':
        return { x: bulkEditNum }
      case 'y':
        return { y: bulkEditNum }
      case 'enabled':
        return { enabled: bulkEditEnabled }
      case 'block_pickup':
        return { block_pickup: bulkEditEnabled }
      case 'block_dropoff':
        return { block_dropoff: bulkEditEnabled }
      case 'bypass_pallet_check':
        return { bypass_pallet_check: bulkEditEnabled }
      case 'active_missions':
        return { active_missions: Math.max(1, Math.floor(Number(bulkEditNum) || 1)) }
      default:
        return null
    }
  }, [bulkEditField, bulkEditStr, bulkEditNum, bulkEditEnabled, bulkEditLocationType])

  const applyBulkEdit = useCallback(async () => {
    const patch = buildBulkEditPatch()
    if (patch == null || selectedIds.size === 0) return
    setBulkEditSubmitting(true)
    setBulkEditError(null)
    try {
      const ids = [...selectedIds]
      const settled = await Promise.allSettled(ids.map((id) => updateAmrStand(id, patch)))
      const rejected = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected')
      if (rejected.length > 0) {
        const msgs = rejected.map((r) => apiErrorMessage(r.reason))
        const uniq = [...new Set(msgs)]
        setBulkEditError(
          rejected.length === settled.length
            ? uniq.join(' ')
            : `${rejected.length} of ${settled.length} stands could not be updated: ${uniq.join(' ')}`
        )
        load()
        return
      }
      setBulkEditOpen(false)
      setBulkEditField(null)
      setBulkEditError(null)
      setSelectedIds(new Set())
      load()
    } finally {
      setBulkEditSubmitting(false)
    }
  }, [buildBulkEditPatch, selectedIds, load])

  const openBulkEditModal = useCallback(() => {
    setBulkEditError(null)
    const first: StandBulkFieldKey = 'zone'
    setBulkEditField(first)
    seedBulkEditFromFirstSelected(first)
    setBulkEditOpen(true)
  }, [seedBulkEditFromFirstSelected])

  const tableColSpan = canManage ? 9 : 7

  const filterIcon = (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
      />
    </svg>
  )

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Positions / stands</h1>
          <p className="mt-1 text-sm text-foreground/70">
            Location (External Ref) values are sent to the fleet as <code className="text-xs">position</code>. X and Y
            are map coordinates in meters.
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2 shrink-0">
            <Link
              to={amrPath('stands', 'groups')}
              className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-background"
              title="Manage stand groups (pools used for stop 2+ destinations)"
            >
              Manage groups
            </Link>
            <button
              type="button"
              className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-background"
              title="Group zones into ordered categories shown in the stand picker"
              onClick={() => setCategoriesOpen(true)}
            >
              Categories
            </button>
            <button
              type="button"
              className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-background"
              title="Import stands from CSV file"
              onClick={() => setImportOpen(true)}
            >
              Import
            </button>
            <button
              type="button"
              className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground"
              onClick={() => setAddOpen(true)}
            >
              Add stand
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex min-w-[200px] max-w-md flex-1 flex-col">
          <label className="mb-1 block text-sm font-medium text-foreground">Search</label>
          <div className="relative">
            <input
              type="search"
              placeholder="Search stands…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 pl-9 text-sm text-foreground placeholder:text-foreground/50"
              aria-label="Search stands"
            />
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground/50">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </span>
          </div>
        </div>
        {hasActiveFilters ? (
          <>
            <button
              type="button"
              onClick={clearAllFilters}
              className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-background"
            >
              Clear filters
            </button>
            <span className="text-sm text-foreground/60">
              {filteredRows.length} of {rows.length} stands
            </span>
          </>
        ) : null}
      </div>

      {canManage ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm">
          <span className="font-medium text-foreground">{selectedIds.size} selected</span>
          <button
            type="button"
            disabled={selectedIds.size === 0}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-background/80 disabled:opacity-50"
            onClick={openBulkEditModal}
          >
            Bulk edit
          </button>
          <button
            type="button"
            disabled={selectedIds.size === 0}
            className="rounded-lg border border-red-600/60 px-3 py-1.5 text-red-600 hover:bg-red-600/10 disabled:pointer-events-none disabled:opacity-40 dark:text-red-400"
            onClick={() => void bulkDeleteSelected()}
          >
            Delete selected
          </button>
          <button
            type="button"
            disabled={selectedIds.size === 0}
            className="text-foreground/70 underline hover:text-foreground disabled:opacity-40"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear selection
          </button>
        </div>
      ) : null}

      {canManage && addOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
          role="presentation"
        >
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-xl border border-border bg-card p-4 shadow-lg"
            role="dialog"
            aria-labelledby="amr-add-stand-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="amr-add-stand-title" className="text-sm font-semibold">
                Add stand
              </h2>
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-sm hover:bg-background"
                onClick={closeAddModal}
              >
                Cancel
              </button>
            </div>
            {addModalError ? (
              <div
                role="alert"
                className="mb-3 rounded-lg border border-red-600/45 bg-red-600/10 px-3 py-2 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-200"
              >
                {addModalError}
              </div>
            ) : null}
            <StandFormFields
              form={form}
              setForm={setForm}
              queueingEnabled={missionQueueingEnabled}
            />
            <button
              type="button"
              className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground"
              onClick={() => void saveNew()}
            >
              Add
            </button>
          </div>
        </div>
      ) : null}

      {canManage && editStand ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
          role="presentation"
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl border border-border bg-card p-4 shadow-lg"
            role="dialog"
            aria-labelledby="amr-edit-stand-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="amr-edit-stand-title" className="text-sm font-semibold">
                Edit stand
              </h2>
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-sm hover:bg-background"
                onClick={closeEditModal}
              >
                Cancel
              </button>
            </div>
            {editModalError ? (
              <div
                role="alert"
                className="mb-3 rounded-lg border border-red-600/45 bg-red-600/10 px-3 py-2 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-200"
              >
                {editModalError}
              </div>
            ) : null}
            <StandFormFields
              form={editForm}
              setForm={setEditForm}
              queueingEnabled={missionQueueingEnabled}
            />
            <button
              type="button"
              className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground"
              onClick={() => void saveEdit()}
            >
              Save
            </button>
          </div>
        </div>
      ) : null}

      {canManage && importOpen ? (
        <ImportAmrStandsModal onClose={() => setImportOpen(false)} onImported={() => load()} />
      ) : null}

      {canManage && categoriesOpen ? (
        <AmrZoneCategoriesModal
          allZones={Array.from(
            new Set(
              rows
                .map((r) => String(r.zone ?? '').trim())
                .filter((z): z is string => z !== '')
            )
          ).sort((a, b) => a.localeCompare(b))}
          zoneStandCounts={zoneStandCounts}
          onClose={() => setCategoriesOpen(false)}
          onSaved={() => {
            setCategoriesOpen(false)
          }}
        />
      ) : null}

      {canManage && bulkEditOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg"
            role="dialog"
            aria-labelledby="amr-bulk-edit-title"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="amr-bulk-edit-title" className="mb-4 text-lg font-semibold text-foreground">
              Bulk edit {selectedIds.size} stand(s)
            </h3>
            {bulkEditError ? (
              <div
                role="alert"
                className="mb-4 rounded-lg border border-red-600/45 bg-red-600/10 px-3 py-2 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-200"
              >
                {bulkEditError}
              </div>
            ) : null}
            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-foreground">Field</label>
              <PopupSelect
                label=""
                value={bulkEditField ?? ''}
                onChange={(v) => {
                  const key = (v || null) as StandBulkFieldKey | null
                  setBulkEditField(key)
                  if (key) seedBulkEditFromFirstSelected(key)
                }}
                emptyOption="Select a field"
                options={STAND_BULK_FIELDS.map((o) => ({ value: o.value, label: o.label }))}
                usePortal
              />
            </div>
            {bulkEditField === 'location_type' ? (
              <div className="mb-4">
                <label className="mb-1 block text-sm font-medium text-foreground">New value</label>
                <select
                  className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                  value={bulkEditLocationType}
                  onChange={(e) =>
                    setBulkEditLocationType(
                      e.target.value === AMR_STAND_LOCATION_TYPE_NON_STAND
                        ? AMR_STAND_LOCATION_TYPE_NON_STAND
                        : AMR_STAND_LOCATION_TYPE_STAND
                    )
                  }
                >
                  <option value={AMR_STAND_LOCATION_TYPE_STAND}>Rack stand</option>
                  <option value={AMR_STAND_LOCATION_TYPE_NON_STAND}>Non-stand waypoint</option>
                </select>
                <p className="mt-2 text-xs text-foreground/55">
                  Waypoints cannot be in stand groups. Stands still in a group will return an error until removed.
                </p>
              </div>
            ) : null}
            {bulkEditField === 'orientation' ? (
              <div className="mb-4">
                <label className="mb-1 block text-sm font-medium text-foreground">New value</label>
                <select
                  className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                  value={bulkEditStr}
                  onChange={(e) => setBulkEditStr(e.target.value)}
                >
                  {['0', '90', '180', '-90'].map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {bulkEditField === 'enabled' ? (
              <label className="mb-4 flex cursor-pointer items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border"
                  checked={bulkEditEnabled}
                  onChange={(e) => setBulkEditEnabled(e.target.checked)}
                />
                Enabled
              </label>
            ) : null}
            {bulkEditField === 'block_pickup' ? (
              <label className="mb-4 flex cursor-pointer items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border"
                  checked={bulkEditEnabled}
                  onChange={(e) => setBulkEditEnabled(e.target.checked)}
                />
                Block pallet pickup (no lift)
              </label>
            ) : null}
            {bulkEditField === 'block_dropoff' ? (
              <label className="mb-4 flex cursor-pointer items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border"
                  checked={bulkEditEnabled}
                  onChange={(e) => setBulkEditEnabled(e.target.checked)}
                />
                Block pallet dropoff (no lower)
              </label>
            ) : null}
            {bulkEditField === 'bypass_pallet_check' ? (
              <label className="mb-4 flex cursor-pointer items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border"
                  checked={bulkEditEnabled}
                  onChange={(e) => setBulkEditEnabled(e.target.checked)}
                />
                Bypass pallet check
              </label>
            ) : null}
            {bulkEditField === 'x' || bulkEditField === 'y' ? (
              <div className="mb-4">
                <label className="mb-1 block text-sm font-medium text-foreground">
                  New value ({bulkEditField === 'x' ? 'X (m)' : 'Y (m)'})
                </label>
                <input
                  type="number"
                  className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                  value={bulkEditNum}
                  onChange={(e) => setBulkEditNum(Number(e.target.value))}
                />
              </div>
            ) : null}
            {bulkEditField === 'zone' || bulkEditField === 'dwg_ref' || bulkEditField === 'external_ref' ? (
              <div className="mb-4">
                <label className="mb-1 block text-sm font-medium text-foreground">
                  {bulkEditField === 'dwg_ref'
                    ? 'DWG ref'
                    : bulkEditField === 'external_ref'
                      ? 'Location'
                      : 'Zone'}
                </label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                  value={bulkEditStr}
                  onChange={(e) => setBulkEditStr(e.target.value)}
                  placeholder={bulkEditField === 'dwg_ref' ? 'Leave empty to clear' : ''}
                />
                {bulkEditField === 'external_ref' && selectedIds.size > 1 && bulkEditStr.trim() !== '' ? (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                    External ref must be unique per stand. Applying the same value to multiple rows usually fails after
                    the first stand (same as duplicate DWG refs).
                  </p>
                ) : null}
                {bulkEditField === 'dwg_ref' && selectedIds.size > 1 && bulkEditStr.trim() !== '' ? (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                    DWG ref must be unique per stand. Applying the same non-empty value to multiple rows usually fails
                    after the first stand.
                  </p>
                ) : null}
              </div>
            ) : null}
            {bulkEditField === 'active_missions' ? (
              <div className="mb-4">
                <label className="mb-1 block text-sm font-medium text-foreground">Active missions (minimum 1)</label>
                <input
                  type="number"
                  min={1}
                  className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                  value={bulkEditNum}
                  onChange={(e) =>
                    setBulkEditNum(Math.max(1, Math.floor(Number(e.target.value) || 1)))
                  }
                />
                <p className="mt-2 text-xs text-foreground/55">
                  {missionQueueingEnabled
                    ? 'Used as the occupancy bypass cap when &quot;Bypass pallet check&quot; is enabled on the stand.'
                    : 'Bypass cap only applies when mission queueing is enabled in AMR settings; value is still stored on each stand.'}
                </p>
              </div>
            ) : null}
            {!bulkEditField ? (
              <p className="mb-4 text-sm text-foreground/60">Choose a field to edit.</p>
            ) : null}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closeBulkEditModal}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  !bulkEditField ||
                  bulkEditSubmitting ||
                  (bulkEditField === 'external_ref' && !bulkEditStr.trim())
                }
                onClick={() => void applyBulkEdit()}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {bulkEditSubmitting ? 'Applying…' : 'Apply to all'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[48rem] text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {canManage ? (
                <th className="w-10 px-2 py-2 font-medium text-foreground">
                  <label className="flex cursor-pointer items-center justify-center">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border"
                      checked={
                        displayRows.length > 0 &&
                        displayRows.every((r) => selectedIds.has(String(r.id)))
                      }
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds(new Set(displayRows.map((r) => String(r.id))))
                        } else {
                          setSelectedIds(new Set())
                        }
                      }}
                      aria-label="Select all visible stands"
                    />
                  </label>
                </th>
              ) : null}
              <th
                ref={(el) => {
                  filterAnchorRefs.current.external_ref = el
                }}
                className="relative min-w-0 cursor-pointer select-none px-3 py-2 font-medium text-foreground hover:bg-muted/60"
                {...getSortHandlers('external_ref')}
                title="Tap to sort. Long-press or Shift+click to add secondary sort."
              >
                <span className="flex min-w-0 items-center gap-1">
                  <span className="min-w-0 truncate">Location</span>
                  {getSortIndex('external_ref') >= 0 && (
                    <span className="shrink-0 text-foreground/60">
                      {getSortIndex('external_ref') + 1}
                      {getSortDir('external_ref') === 'asc' ? '↓' : '↑'}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setOpenFilterColumn((c) => (c === 'external_ref' ? null : 'external_ref'))
                    }}
                    className={`shrink-0 rounded p-0.5 hover:bg-background ${
                      columnFilters.external_ref?.size ? 'text-primary' : 'text-foreground/50'
                    }`}
                    title="Filter column"
                  >
                    {filterIcon}
                  </button>
                </span>
                {openFilterColumn === 'external_ref' && (
                  <ColumnFilterDropdown
                    columnKey="external_ref"
                    columnLabel="Location"
                    values={getColumnValues('external_ref')}
                    selected={columnFilters.external_ref ?? new Set()}
                    onChange={(s) => setColumnFilters((p) => ({ ...p, external_ref: s }))}
                    onClose={() => setOpenFilterColumn(null)}
                    tableAnchorRefs={filterAnchorRefs}
                    tableAnchorKey="external_ref"
                  />
                )}
              </th>
              <th
                ref={(el) => {
                  filterAnchorRefs.current.stand_type = el
                }}
                className="relative min-w-0 cursor-pointer select-none px-3 py-2 font-medium text-foreground hover:bg-muted/60"
                {...getSortHandlers('stand_type')}
                title="Tap to sort"
              >
                <span className="flex min-w-0 items-center gap-1">
                  <span className="min-w-0 truncate">Type</span>
                  {getSortIndex('stand_type') >= 0 && (
                    <span className="shrink-0 text-foreground/60">
                      {getSortIndex('stand_type') + 1}
                      {getSortDir('stand_type') === 'asc' ? '↓' : '↑'}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setOpenFilterColumn((c) => (c === 'stand_type' ? null : 'stand_type'))
                    }}
                    className={`shrink-0 rounded p-0.5 hover:bg-background ${
                      columnFilters.stand_type?.size ? 'text-primary' : 'text-foreground/50'
                    }`}
                    title="Filter column"
                  >
                    {filterIcon}
                  </button>
                </span>
                {openFilterColumn === 'stand_type' && (
                  <ColumnFilterDropdown
                    columnKey="stand_type"
                    columnLabel="Type"
                    values={getColumnValues('stand_type')}
                    selected={columnFilters.stand_type ?? new Set()}
                    onChange={(s) => setColumnFilters((p) => ({ ...p, stand_type: s }))}
                    onClose={() => setOpenFilterColumn(null)}
                    tableAnchorRefs={filterAnchorRefs}
                    tableAnchorKey="stand_type"
                  />
                )}
              </th>
              <th
                ref={(el) => {
                  filterAnchorRefs.current.zone = el
                }}
                className="relative min-w-0 cursor-pointer select-none px-3 py-2 font-medium text-foreground hover:bg-muted/60"
                {...getSortHandlers('zone')}
                title="Tap to sort"
              >
                <span className="flex min-w-0 items-center gap-1">
                  <span className="min-w-0 truncate">Zone</span>
                  {getSortIndex('zone') >= 0 && (
                    <span className="shrink-0 text-foreground/60">
                      {getSortIndex('zone') + 1}
                      {getSortDir('zone') === 'asc' ? '↓' : '↑'}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setOpenFilterColumn((c) => (c === 'zone' ? null : 'zone'))
                    }}
                    className={`shrink-0 rounded p-0.5 hover:bg-background ${
                      columnFilters.zone?.size ? 'text-primary' : 'text-foreground/50'
                    }`}
                    title="Filter column"
                  >
                    {filterIcon}
                  </button>
                </span>
                {openFilterColumn === 'zone' && (
                  <ColumnFilterDropdown
                    columnKey="zone"
                    columnLabel="Zone"
                    values={getColumnValues('zone')}
                    selected={columnFilters.zone ?? new Set()}
                    onChange={(s) => setColumnFilters((p) => ({ ...p, zone: s }))}
                    onClose={() => setOpenFilterColumn(null)}
                    tableAnchorRefs={filterAnchorRefs}
                    tableAnchorKey="zone"
                  />
                )}
              </th>
              <th
                ref={(el) => {
                  filterAnchorRefs.current.orientation = el
                }}
                className="relative min-w-0 cursor-pointer select-none px-3 py-2 font-medium text-foreground hover:bg-muted/60"
                {...getSortHandlers('orientation')}
                title="Tap to sort"
              >
                <span className="flex min-w-0 items-center gap-1">
                  <span className="min-w-0 truncate">Orientation</span>
                  {getSortIndex('orientation') >= 0 && (
                    <span className="shrink-0 text-foreground/60">
                      {getSortIndex('orientation') + 1}
                      {getSortDir('orientation') === 'asc' ? '↓' : '↑'}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setOpenFilterColumn((c) => (c === 'orientation' ? null : 'orientation'))
                    }}
                    className={`shrink-0 rounded p-0.5 hover:bg-background ${
                      columnFilters.orientation?.size ? 'text-primary' : 'text-foreground/50'
                    }`}
                    title="Filter column"
                  >
                    {filterIcon}
                  </button>
                </span>
                {openFilterColumn === 'orientation' && (
                  <ColumnFilterDropdown
                    columnKey="orientation"
                    columnLabel="Orientation"
                    values={getColumnValues('orientation')}
                    selected={columnFilters.orientation ?? new Set()}
                    onChange={(s) => setColumnFilters((p) => ({ ...p, orientation: s }))}
                    onClose={() => setOpenFilterColumn(null)}
                    tableAnchorRefs={filterAnchorRefs}
                    tableAnchorKey="orientation"
                  />
                )}
              </th>
              <th
                ref={(el) => {
                  filterAnchorRefs.current.xy = el
                }}
                className="relative min-w-0 cursor-pointer select-none px-3 py-2 font-medium text-foreground hover:bg-muted/60"
                {...getSortHandlers('xy')}
                title="Tap to sort"
              >
                <span className="flex min-w-0 items-center gap-1">
                  <span className="min-w-0 truncate">X/Y (m)</span>
                  {getSortIndex('xy') >= 0 && (
                    <span className="shrink-0 text-foreground/60">
                      {getSortIndex('xy') + 1}
                      {getSortDir('xy') === 'asc' ? '↓' : '↑'}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setOpenFilterColumn((c) => (c === 'xy' ? null : 'xy'))
                    }}
                    className={`shrink-0 rounded p-0.5 hover:bg-background ${
                      columnFilters.xy?.size ? 'text-primary' : 'text-foreground/50'
                    }`}
                    title="Filter column"
                  >
                    {filterIcon}
                  </button>
                </span>
                {openFilterColumn === 'xy' && (
                  <ColumnFilterDropdown
                    columnKey="xy"
                    columnLabel="X/Y (m)"
                    values={getColumnValues('xy')}
                    selected={columnFilters.xy ?? new Set()}
                    onChange={(s) => setColumnFilters((p) => ({ ...p, xy: s }))}
                    onClose={() => setOpenFilterColumn(null)}
                    tableAnchorRefs={filterAnchorRefs}
                    tableAnchorKey="xy"
                  />
                )}
              </th>
              <th
                ref={(el) => {
                  filterAnchorRefs.current.enabled = el
                }}
                className="relative min-w-0 cursor-pointer select-none px-3 py-2 font-medium text-foreground hover:bg-muted/60"
                {...getSortHandlers('enabled')}
                title="Tap to sort"
              >
                <span className="flex min-w-0 items-center gap-1">
                  <span className="min-w-0 truncate">Enabled</span>
                  {getSortIndex('enabled') >= 0 && (
                    <span className="shrink-0 text-foreground/60">
                      {getSortIndex('enabled') + 1}
                      {getSortDir('enabled') === 'asc' ? '↓' : '↑'}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setOpenFilterColumn((c) => (c === 'enabled' ? null : 'enabled'))
                    }}
                    className={`shrink-0 rounded p-0.5 hover:bg-background ${
                      columnFilters.enabled?.size ? 'text-primary' : 'text-foreground/50'
                    }`}
                    title="Filter column"
                  >
                    {filterIcon}
                  </button>
                </span>
                {openFilterColumn === 'enabled' && (
                  <ColumnFilterDropdown
                    columnKey="enabled"
                    columnLabel="Enabled"
                    values={getColumnValues('enabled')}
                    selected={columnFilters.enabled ?? new Set()}
                    onChange={(s) => setColumnFilters((p) => ({ ...p, enabled: s }))}
                    onClose={() => setOpenFilterColumn(null)}
                    tableAnchorRefs={filterAnchorRefs}
                    tableAnchorKey="enabled"
                  />
                )}
              </th>
              <th
                ref={(el) => {
                  filterAnchorRefs.current.restrictions = el
                }}
                className="relative min-w-0 cursor-pointer select-none px-3 py-2 font-medium text-foreground hover:bg-muted/60"
                {...getSortHandlers('restrictions')}
                title="Tap to sort"
              >
                <span className="flex min-w-0 items-center gap-1">
                  <span className="min-w-0 truncate">Restrictions</span>
                  {getSortIndex('restrictions') >= 0 && (
                    <span className="shrink-0 text-foreground/60">
                      {getSortIndex('restrictions') + 1}
                      {getSortDir('restrictions') === 'asc' ? '↓' : '↑'}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setOpenFilterColumn((c) => (c === 'restrictions' ? null : 'restrictions'))
                    }}
                    className={`shrink-0 rounded p-0.5 hover:bg-background ${
                      columnFilters.restrictions?.size ? 'text-primary' : 'text-foreground/50'
                    }`}
                    title="Filter column"
                  >
                    {filterIcon}
                  </button>
                </span>
                {openFilterColumn === 'restrictions' && (
                  <ColumnFilterDropdown
                    columnKey="restrictions"
                    columnLabel="Restrictions"
                    values={getColumnValues('restrictions')}
                    selected={columnFilters.restrictions ?? new Set()}
                    onChange={(s) => setColumnFilters((p) => ({ ...p, restrictions: s }))}
                    onClose={() => setOpenFilterColumn(null)}
                    tableAnchorRefs={filterAnchorRefs}
                    tableAnchorKey="restrictions"
                  />
                )}
              </th>
              {canManage ? (
                <th className="px-3 py-2 font-medium text-foreground">Actions</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={tableColSpan} className="px-3 py-4 text-foreground/60">
                  Loading…
                </td>
              </tr>
            ) : displayRows.length === 0 ? (
              <tr>
                <td colSpan={tableColSpan} className="px-3 py-8 text-center text-foreground/60">
                  {rows.length === 0
                    ? 'No stands yet.'
                    : 'No stands match the current search or filters.'}
                </td>
              </tr>
            ) : (
              displayRows.map((r) => (
                <StandRow
                  key={String(r.id)}
                  row={r}
                  canManage={canManage}
                  selected={selectedIds.has(String(r.id))}
                  onToggleSelect={toggleRowSelect}
                  onEdit={openEdit}
                  onChanged={load}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StandRow({
  row,
  canManage,
  selected,
  onToggleSelect,
  onEdit,
  onChanged,
}: {
  row: Record<string, unknown>
  canManage: boolean
  selected: boolean
  onToggleSelect: (id: string) => void
  onEdit: (row: Record<string, unknown>) => void
  onChanged: () => void
}) {
  const enabled = Number(row.enabled) === 1
  const id = String(row.id)

  const remove = async () => {
    if (!confirm('Delete this stand?')) return
    await deleteAmrStand(id)
    onChanged()
  }

  return (
    <tr
      className={`border-b border-border/60 ${
        canManage && selected ? 'bg-blue-600/15 dark:bg-blue-500/15' : ''
      }`}
    >
      {canManage ? (
        <td className="w-10 px-2 py-2">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border"
            checked={selected}
            onChange={() => onToggleSelect(id)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select stand ${String(row.external_ref ?? id)}`}
          />
        </td>
      ) : null}
      <td className="px-3 py-2 font-mono text-xs">{String(row.external_ref)}</td>
      <td className="px-3 py-2">
        {normalizeAmrStandLocationType((row as { location_type?: unknown }).location_type) ===
        AMR_STAND_LOCATION_TYPE_NON_STAND ? (
          <span
            className="inline-flex rounded-full border border-violet-500/35 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-800 dark:text-violet-200"
            title="Non-stand waypoint"
          >
            Waypoint
          </span>
        ) : (
          <span
            className="inline-flex rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-foreground"
            title="Rack stand"
          >
            Rack
          </span>
        )}
      </td>
      <td className="px-3 py-2">{String(row.zone ?? '')}</td>
      <td className="px-3 py-2">{String(row.orientation ?? '')}</td>
      <td className="px-3 py-2 text-xs">
        {String(row.x ?? 0)}, {String(row.y ?? 0)}
      </td>
      <td className="px-3 py-2">{enabled ? 'Yes' : 'No'}</td>
      <td className="px-3 py-2">
        {(() => {
          const bp = Number(row.block_pickup) === 1
          const bd = Number(row.block_dropoff) === 1
          const bypass = Number(row.bypass_pallet_check) === 1
          if (!bp && !bd && !bypass) return <span className="text-foreground/40">—</span>
          return (
            <span className="flex flex-wrap gap-1">
              {bp ? (
                <span
                  className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300"
                  title="Pallet pickup blocked"
                >
                  No lift
                </span>
              ) : null}
              {bd ? (
                <span
                  className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300"
                  title="Pallet dropoff blocked"
                >
                  No lower
                </span>
              ) : null}
              {bypass ? (
                <span
                  className="inline-flex items-center rounded-full border border-blue-500/40 bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-700 dark:text-blue-300"
                  title="Hyperion empty-stand checks skipped for this location"
                >
                  Bypass pallet check
                </span>
              ) : null}
            </span>
          )
        })()}
      </td>
      {canManage ? (
        <td className="px-3 py-2">
          <button
            type="button"
            className="mr-2 text-xs text-primary underline"
            onClick={() => onEdit(row)}
          >
            Edit
          </button>
          <button type="button" className="text-xs text-red-600 underline" onClick={() => void remove()}>
            Delete
          </button>
        </td>
      ) : null}
    </tr>
  )
}

export default AmrStands
