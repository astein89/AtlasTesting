import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
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
import { getAmrSettings, putAmrSettings, type ZoneCategory } from '@/api/amr'
import { useAlertConfirm } from '@/contexts/AlertConfirmContext'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { randomUuid } from '@/lib/randomUuid'

const UNCATEGORIZED_BUCKET_ID = '__uncategorized__'
const CATEGORY_PREFIX = 'cat:'
const ZONE_PREFIX = 'zone:'
const BUCKET_DROP_PREFIX = 'bucket-drop:'

type LocalCategory = {
  /** Stable local UUID — survives renames so dnd-kit ids stay valid mid-edit. */
  id: string
  name: string
  zones: string[]
}

type Bucket = {
  bucketId: string
  title: string
  zones: string[]
  /** When true, this is the synthesized Uncategorized bucket (zones not assigned to any category). */
  uncategorized: boolean
}

function dragGripIcon() {
  return (
    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm6-12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
    </svg>
  )
}

function SortableCategoryCard({
  category,
  zones,
  orphanZones,
  onRename,
  onRemove,
  children,
}: {
  category: LocalCategory
  zones: string[]
  orphanZones: Set<string>
  onRename: (name: string) => void
  onRemove: () => void
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `${CATEGORY_PREFIX}${category.id}`,
  })
  const style = { transform: CSS.Transform.toString(transform), transition }
  const orphanCount = zones.reduce((acc, z) => acc + (orphanZones.has(z) ? 1 : 0), 0)
  return (
    <li ref={setNodeRef} style={style} className={isDragging ? 'opacity-60' : ''}>
      <div className="rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-2 py-2">
          <button
            type="button"
            className="touch-none cursor-grab rounded p-1.5 text-foreground/45 hover:bg-background hover:text-foreground active:cursor-grabbing"
            {...attributes}
            {...listeners}
            aria-label={`Drag to reorder category ${category.name || '(unnamed)'}`}
          >
            {dragGripIcon()}
          </button>
          <input
            value={category.name}
            onChange={(e) => onRename(e.target.value)}
            placeholder="Category name"
            className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm font-medium text-foreground"
            aria-label="Category name"
          />
          <span className="shrink-0 text-xs text-foreground/60">
            {zones.length} zone{zones.length === 1 ? '' : 's'}
            {orphanCount > 0 ? ` · ${orphanCount} orphan` : ''}
          </span>
          <button
            type="button"
            onClick={onRemove}
            className="shrink-0 rounded px-2 py-1 text-sm text-red-600 hover:bg-red-500/10 dark:text-red-400"
          >
            Remove
          </button>
        </div>
        {children}
      </div>
    </li>
  )
}

function SortableZoneChip({
  zone,
  isOrphan,
  onRemove,
}: {
  zone: string
  isOrphan: boolean
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `${ZONE_PREFIX}${zone}`,
  })
  const style = { transform: CSS.Transform.toString(transform), transition }
  return (
    <li ref={setNodeRef} style={style} className={isDragging ? 'opacity-60' : ''}>
      <div
        className={`flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${
          isOrphan
            ? 'border-amber-500/45 bg-amber-500/10 text-amber-800 dark:text-amber-200'
            : 'border-border bg-background text-foreground'
        }`}
      >
        <button
          type="button"
          className="touch-none cursor-grab rounded p-0.5 text-foreground/45 hover:text-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
          aria-label={`Drag zone ${zone}`}
        >
          <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm6-12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
          </svg>
        </button>
        <span className="font-mono">{zone || '(blank)'}</span>
        {isOrphan ? (
          <span className="ml-0.5 text-[10px] uppercase tracking-wide" title="No stand currently uses this zone">
            no stands
          </span>
        ) : null}
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onRemove}
          className="ml-1 rounded p-0.5 text-foreground/55 hover:bg-background hover:text-red-600"
          aria-label={`Remove zone ${zone}`}
          title="Move to Uncategorized"
        >
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </li>
  )
}

function ZoneBucketArea({
  bucketId,
  zones,
  orphanZones,
  onRemoveZoneFromCategory,
}: {
  bucketId: string
  zones: string[]
  orphanZones: Set<string>
  /** Removes the zone from its category (returns it to Uncategorized). Only called from category cards. */
  onRemoveZoneFromCategory?: (zone: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${BUCKET_DROP_PREFIX}${bucketId}` })
  return (
    <SortableContext
      items={zones.map((z) => `${ZONE_PREFIX}${z}`)}
      strategy={verticalListSortingStrategy}
    >
      <ul
        ref={setNodeRef}
        className={`m-0 flex min-h-[2.5rem] list-none flex-wrap gap-1.5 rounded p-2 transition-colors ${
          isOver ? 'bg-primary/10 ring-2 ring-primary/25' : ''
        }`}
      >
        {zones.length === 0 ? (
          <li className="px-1 text-xs italic text-foreground/45">Drop zones here</li>
        ) : (
          zones.map((zone) => (
            <SortableZoneChip
              key={zone}
              zone={zone}
              isOrphan={orphanZones.has(zone)}
              onRemove={() => onRemoveZoneFromCategory?.(zone)}
            />
          ))
        )}
      </ul>
    </SortableContext>
  )
}

interface AmrZoneCategoriesModalProps {
  /** Distinct trimmed zone names from the loaded stands list — used to derive uncategorized + orphan info. */
  allZones: string[]
  onClose: () => void
  /** Called after a successful save so the parent can refresh dependent data (the picker reads zoneCategories from settings). */
  onSaved: () => void
}

export function AmrZoneCategoriesModal({ allZones, onClose, onSaved }: AmrZoneCategoriesModalProps) {
  const { showAlert } = useAlertConfirm()
  const [categories, setCategories] = useState<LocalCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pendingDeleteCatId, setPendingDeleteCatId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  useEffect(() => {
    let cancelled = false
    void getAmrSettings()
      .then((s) => {
        if (cancelled) return
        const arr = Array.isArray(s.zoneCategories) ? s.zoneCategories : []
        setCategories(
          arr.map<LocalCategory>((c: ZoneCategory) => ({
            id: randomUuid(),
            name: c.name,
            zones: Array.isArray(c.zones) ? [...c.zones] : [],
          }))
        )
      })
      .catch(() => {
        if (!cancelled) showAlert('Could not load zone categories.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [showAlert])

  const allZonesSet = useMemo(() => new Set(allZones), [allZones])

  const buckets = useMemo<Bucket[]>(() => {
    const claimed = new Set<string>()
    const out: Bucket[] = categories.map((c) => {
      for (const z of c.zones) claimed.add(z)
      return {
        bucketId: c.id,
        title: c.name || '(unnamed)',
        zones: [...c.zones],
        uncategorized: false,
      }
    })
    const uncategorized = allZones.filter((z) => !claimed.has(z)).slice().sort((a, b) => a.localeCompare(b))
    out.push({
      bucketId: UNCATEGORIZED_BUCKET_ID,
      title: 'Uncategorized',
      zones: uncategorized,
      uncategorized: true,
    })
    return out
  }, [categories, allZones])

  const orphanZones = useMemo<Set<string>>(() => {
    const orphans = new Set<string>()
    for (const c of categories) {
      for (const z of c.zones) {
        if (!allZonesSet.has(z)) orphans.add(z)
      }
    }
    return orphans
  }, [categories, allZonesSet])
  const orphanCount = orphanZones.size

  const findCategoryWithZone = useCallback(
    (zone: string): { catIdx: number; zoneIdx: number } | null => {
      for (let i = 0; i < categories.length; i++) {
        const idx = categories[i].zones.indexOf(zone)
        if (idx !== -1) return { catIdx: i, zoneIdx: idx }
      }
      return null
    },
    [categories]
  )

  const moveZoneTo = useCallback(
    (zone: string, targetBucketId: string, insertBeforeZone: string | null) => {
      setCategories((prev) => {
        const next = prev.map((c) => ({ ...c, zones: [...c.zones] }))
        for (const c of next) {
          c.zones = c.zones.filter((z) => z !== zone)
        }
        if (targetBucketId === UNCATEGORIZED_BUCKET_ID) return next
        const cIdx = next.findIndex((c) => c.id === targetBucketId)
        if (cIdx < 0) return next
        const list = next[cIdx].zones
        if (insertBeforeZone == null) {
          list.push(zone)
        } else {
          const at = list.indexOf(insertBeforeZone)
          if (at < 0) list.push(zone)
          else list.splice(at, 0, zone)
        }
        return next
      })
    },
    []
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over) return
      const aId = String(active.id)
      const oId = String(over.id)
      if (aId === oId) return

      if (aId.startsWith(CATEGORY_PREFIX)) {
        if (!oId.startsWith(CATEGORY_PREFIX)) return
        const aCatId = aId.slice(CATEGORY_PREFIX.length)
        const oCatId = oId.slice(CATEGORY_PREFIX.length)
        setCategories((prev) => {
          const oldIndex = prev.findIndex((c) => c.id === aCatId)
          const newIndex = prev.findIndex((c) => c.id === oCatId)
          if (oldIndex < 0 || newIndex < 0) return prev
          return arrayMove(prev, oldIndex, newIndex)
        })
        return
      }

      if (!aId.startsWith(ZONE_PREFIX)) return
      const movedZone = aId.slice(ZONE_PREFIX.length)
      let targetBucket: string
      let insertBefore: string | null = null

      if (oId.startsWith(BUCKET_DROP_PREFIX)) {
        targetBucket = oId.slice(BUCKET_DROP_PREFIX.length)
      } else if (oId.startsWith(ZONE_PREFIX)) {
        const overZone = oId.slice(ZONE_PREFIX.length)
        const inUncat = !categories.some((c) => c.zones.includes(overZone))
        if (inUncat) {
          targetBucket = UNCATEGORIZED_BUCKET_ID
        } else {
          const cat = categories.find((c) => c.zones.includes(overZone))
          if (!cat) return
          targetBucket = cat.id
          insertBefore = overZone
        }
      } else {
        return
      }

      moveZoneTo(movedZone, targetBucket, insertBefore)
    },
    [categories, moveZoneTo]
  )

  const renameCategory = useCallback((id: string, name: string) => {
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)))
  }, [])

  const removeCategory = useCallback((id: string) => {
    setCategories((prev) => {
      const cat = prev.find((c) => c.id === id)
      if (!cat) return prev
      return prev.filter((c) => c.id !== id)
    })
  }, [])

  const requestRemoveCategory = useCallback(
    (id: string) => {
      const cat = categories.find((c) => c.id === id)
      if (!cat) return
      if (cat.zones.length === 0) {
        removeCategory(id)
        return
      }
      setPendingDeleteCatId(id)
    },
    [categories, removeCategory]
  )

  const removeZoneFromCategory = useCallback((catId: string, zone: string) => {
    setCategories((prev) =>
      prev.map((c) => (c.id === catId ? { ...c, zones: c.zones.filter((z) => z !== zone) } : c))
    )
  }, [])

  const addCategory = useCallback(() => {
    setCategories((prev) => [...prev, { id: randomUuid(), name: '', zones: [] }])
  }, [])

  const cleanOrphans = useCallback(() => {
    setCategories((prev) =>
      prev.map((c) => ({ ...c, zones: c.zones.filter((z) => allZonesSet.has(z)) }))
    )
  }, [allZonesSet])

  const validate = useCallback((): { ok: true } | { ok: false; error: string } => {
    const seen = new Set<string>()
    for (const c of categories) {
      const t = c.name.trim()
      if (!t) return { ok: false, error: 'Every category needs a name.' }
      const k = t.toLowerCase()
      if (seen.has(k)) return { ok: false, error: `Duplicate category name: "${t}"` }
      seen.add(k)
    }
    return { ok: true }
  }, [categories])

  const save = useCallback(async () => {
    const v = validate()
    if (!v.ok) {
      showAlert(v.error)
      return
    }
    setSaving(true)
    try {
      const payload: ZoneCategory[] = categories.map((c) => ({
        name: c.name.trim(),
        zones: [...c.zones],
      }))
      await putAmrSettings({ zoneCategories: payload })
      onSaved()
      onClose()
    } catch {
      showAlert('Could not save zone categories. Try again.')
    } finally {
      setSaving(false)
    }
  }, [categories, validate, showAlert, onSaved, onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const pendingDeleteCat = pendingDeleteCatId
    ? categories.find((c) => c.id === pendingDeleteCatId) ?? null
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="amr-zone-categories-title"
        className="relative z-10 flex max-h-[min(92vh,720px)] w-full max-w-2xl flex-col overflow-hidden rounded-t-xl border border-border bg-card shadow-lg sm:rounded-xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 id="amr-zone-categories-title" className="text-base font-semibold text-foreground">
              Manage zone categories
            </h2>
            <p className="text-xs text-foreground/60">
              Group zones for the stand picker. Drag zones between categories to assign them, drag the handles to
              reorder.
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-lg p-2 text-foreground/70 hover:bg-muted hover:text-foreground"
            aria-label="Close"
            onClick={onClose}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="text-sm text-foreground/60">Loading…</p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext
                items={categories.map((c) => `${CATEGORY_PREFIX}${c.id}`)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="m-0 list-none space-y-3 p-0">
                  {categories.map((c) => {
                    const bucketZones = c.zones
                    return (
                      <SortableCategoryCard
                        key={c.id}
                        category={c}
                        zones={bucketZones}
                        orphanZones={orphanZones}
                        onRename={(name) => renameCategory(c.id, name)}
                        onRemove={() => requestRemoveCategory(c.id)}
                      >
                        <ZoneBucketArea
                          bucketId={c.id}
                          zones={bucketZones}
                          orphanZones={orphanZones}
                          onRemoveZoneFromCategory={(z) => removeZoneFromCategory(c.id, z)}
                        />
                      </SortableCategoryCard>
                    )
                  })}
                </ul>
              </SortableContext>

              <button
                type="button"
                onClick={addCategory}
                className="mt-3 w-full rounded-lg border border-dashed border-border bg-background px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-muted/50"
              >
                + Add category
              </button>

              <div className="mt-5 rounded-lg border border-border bg-card">
                <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
                  <h3 className="text-sm font-semibold text-foreground">Uncategorized</h3>
                  <span className="shrink-0 text-xs text-foreground/60">
                    {buckets[buckets.length - 1]?.zones.length ?? 0} zone(s)
                  </span>
                </div>
                <ZoneBucketArea
                  bucketId={UNCATEGORIZED_BUCKET_ID}
                  zones={buckets[buckets.length - 1]?.zones ?? []}
                  orphanZones={orphanZones}
                />
              </div>

              {orphanCount > 0 ? (
                <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/45 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                  <span className="flex-1">
                    {orphanCount} zone{orphanCount === 1 ? '' : 's'} reference no current stands. Renaming or
                    deleting stands can leave these behind. Clean up to remove them from categories.
                  </span>
                  <button
                    type="button"
                    onClick={cleanOrphans}
                    className="shrink-0 rounded border border-amber-600/50 bg-background px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-500/10 dark:text-amber-200"
                  >
                    Clean up orphans
                  </button>
                </div>
              ) : null}
            </DndContext>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || loading}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <ConfirmModal
        open={pendingDeleteCat != null}
        title="Remove category"
        message={
          pendingDeleteCat
            ? `Remove "${pendingDeleteCat.name || '(unnamed)'}"? Its ${pendingDeleteCat.zones.length} zone(s) will return to Uncategorized.`
            : ''
        }
        confirmLabel="Remove"
        variant="danger"
        onCancel={() => setPendingDeleteCatId(null)}
        onConfirm={() => {
          if (pendingDeleteCat) removeCategory(pendingDeleteCat.id)
          setPendingDeleteCatId(null)
        }}
      />
    </div>
  )
}
