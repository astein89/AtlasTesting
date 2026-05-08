import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Link } from 'react-router-dom'
import {
  AMR_STAND_GROUP_PREFIX,
  deleteAmrStandGroup,
  getAmrSettings,
  getAmrStandGroups,
  putAmrSettings,
  updateAmrStandGroup,
  type AmrStandGroupRow,
} from '@/api/amr'
import { AmrStandGroupEditorModal } from '@/components/amr/AmrStandGroupEditorModal'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { amrPath } from '@/lib/appPaths'
import { useAuthStore } from '@/store/authStore'

function apiErrorMessage(e: unknown): string {
  const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
  if (typeof msg === 'string' && msg.trim()) return msg
  if (e instanceof Error) return e.message
  return 'Something went wrong.'
}

/** Card preview: column-major fills up to this many horizontal rows × col count */
const CARD_PREVIEW_ROWS = 3

function buildGroupsCategoryZones(prevZones: string[], orderedGroupIds: string[]): string[] {
  const keys = orderedGroupIds.map((id) => `${AMR_STAND_GROUP_PREFIX}${id}`)
  const keySet = new Set(keys)
  const nonGroup = prevZones.filter((z) => !z.startsWith(AMR_STAND_GROUP_PREFIX))
  const stale = prevZones.filter(
    (z) => z.startsWith(AMR_STAND_GROUP_PREFIX) && !keySet.has(z)
  )
  return [...keys, ...stale, ...nonGroup]
}

function CardHeaderSeparator() {
  return (
    <span
      className="h-9 w-px shrink-0 self-center bg-border"
      aria-hidden
      role="presentation"
    />
  )
}

type CardFaceProps = {
  g: AmrStandGroupRow
  canManage: boolean
  /** Drag handle injected into header row next to title (when reorder is allowed). */
  dragSlot?: ReactNode
  onEdit: () => void
  onDelete: () => void
}

function StandGroupCardFace({ g, canManage, dragSlot, onEdit, onDelete }: CardFaceProps) {
  const members = [...(g.members ?? [])].sort((a, b) => a.position - b.position)
  const previewCapNarrow = 2 * CARD_PREVIEW_ROWS
  const previewCapWide = 3 * CARD_PREVIEW_ROWS
  const shownNarrow = members.slice(0, previewCapNarrow)
  const shownWide = members.slice(0, previewCapWide)
  const overflowNarrow = Math.max(0, members.length - previewCapNarrow)
  const overflowWide = Math.max(0, members.length - previewCapWide)

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-colors hover:border-primary/45">
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border pb-3">
          {dragSlot}
          {dragSlot ? <CardHeaderSeparator /> : null}
          <span className="line-clamp-2 min-w-0 flex-1 text-base font-semibold leading-snug text-foreground">
            {g.name}
          </span>
          <CardHeaderSeparator />
          <p className="shrink-0 text-[11px] leading-snug text-foreground/65 whitespace-nowrap sm:text-xs">
            {members.length} stand{members.length === 1 ? '' : 's'}
          </p>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 gap-3">
          <div className="min-w-0 flex-1 space-y-2">
          {members.length > 0 ? (
            <div className="space-y-1">
              <div
                className="columns-2 gap-x-3 font-mono text-[11px] leading-snug text-foreground/90 sm:hidden [&>*]:break-inside-avoid"
                aria-label="Stands in priority order (preview, up to 3 rows)"
              >
                {shownNarrow.map((m, idx) => (
                  <div key={m.standId} className="mb-0.5 flex min-w-0 gap-1">
                    <span className="shrink-0 tabular-nums text-foreground/45">{idx + 1}.</span>
                    <span className="min-w-0 truncate" title={m.externalRef}>
                      {m.externalRef}
                    </span>
                  </div>
                ))}
              </div>
              <div
                className="hidden columns-3 gap-x-3 font-mono text-[11px] leading-snug text-foreground/90 sm:block sm:text-xs [&>*]:break-inside-avoid"
                aria-label="Stands in priority order (preview, up to 3 rows)"
              >
                {shownWide.map((m, idx) => (
                  <div key={m.standId} className="mb-0.5 flex min-w-0 gap-1">
                    <span className="shrink-0 tabular-nums text-foreground/45">{idx + 1}.</span>
                    <span className="min-w-0 truncate" title={m.externalRef}>
                      {m.externalRef}
                    </span>
                  </div>
                ))}
              </div>
              {overflowNarrow > 0 ? (
                <p className="text-[11px] text-foreground/55 italic sm:hidden">
                  + {overflowNarrow} more stand{overflowNarrow === 1 ? '' : 's'}
                </p>
              ) : null}
              {overflowWide > 0 ? (
                <p className="hidden text-[11px] text-foreground/55 italic sm:block sm:text-xs">
                  + {overflowWide} more stand{overflowWide === 1 ? '' : 's'}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-[11px] italic leading-snug text-foreground/55 sm:text-xs">
              No stands in this group
            </p>
          )}
          </div>
          {canManage ? (
            <div
              className="flex shrink-0 flex-col items-end gap-1.5 self-start"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="inline-flex min-h-[40px] min-w-[5.5rem] items-center justify-center rounded-lg border border-border bg-background px-3 text-[11px] font-medium leading-tight text-foreground hover:bg-muted sm:text-xs"
                onClick={onEdit}
              >
                Edit
              </button>
              <button
                type="button"
                className="inline-flex min-h-[40px] min-w-[5.5rem] items-center justify-center rounded-lg border border-red-500/40 bg-red-500/10 px-3 text-[11px] font-medium leading-tight text-red-700 hover:bg-red-500/15 dark:border-red-500/35 dark:text-red-300 sm:text-xs"
                onClick={onDelete}
              >
                Delete
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function SortableStandGroupCard(props: CardFaceProps & { groupId: string }) {
  const { groupId, ...face } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: groupId,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  const dragSlot = (
    <button
      type="button"
      className="flex h-9 w-9 shrink-0 touch-none cursor-grab items-center justify-center rounded-lg border border-border bg-muted/50 text-foreground/55 hover:bg-muted hover:text-foreground active:cursor-grabbing"
      aria-label="Drag to reorder groups"
      title="Drag to reorder (Groups zone category)"
      {...attributes}
      {...listeners}
    >
      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm6-12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
      </svg>
    </button>
  )
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`min-h-0 list-none ${isDragging ? 'z-10 opacity-90' : ''}`}
    >
      <StandGroupCardFace {...face} dragSlot={dragSlot} />
    </li>
  )
}

export function AmrStandGroups() {
  const canManage = useAuthStore((s) => s.hasPermission('amr.stands.manage'))
  const [rows, setRows] = useState<AmrStandGroupRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [reorderBusy, setReorderBusy] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorGroupId, setEditorGroupId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AmrStandGroupRow | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const load = useCallback(() => {
    setErr(null)
    setLoading(true)
    void getAmrStandGroups()
      .then((groups) => setRows(groups))
      .catch((e) => setErr(apiErrorMessage(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const persistGroupOrder = useCallback(
    async (withOrder: AmrStandGroupRow[], prevSnapshot: AmrStandGroupRow[]) => {
      setReorderBusy(true)
      setErr(null)
      try {
        await Promise.all(
          withOrder.map((g, i) => updateAmrStandGroup(g.id, { sort_order: i }))
        )
        const settings = await getAmrSettings()
        const cats = [...(settings.zoneCategories ?? [])]
        const gi = cats.findIndex((c) => c.name.trim().toLowerCase() === 'groups')
        if (gi >= 0) {
          const prevZones = cats[gi].zones ?? []
          const orderedIds = withOrder.map((g) => g.id)
          const newZones = buildGroupsCategoryZones(prevZones, orderedIds)
          if (JSON.stringify(newZones) !== JSON.stringify(prevZones)) {
            cats[gi] = { ...cats[gi], zones: newZones }
            await putAmrSettings({ zoneCategories: cats })
          }
        }
      } catch (e) {
        setErr(apiErrorMessage(e))
        setRows(prevSnapshot)
      } finally {
        setReorderBusy(false)
      }
    },
    []
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!canManage || reorderBusy) return
      const { active, over } = event
      if (!over || active.id === over.id) return
      const activeId = String(active.id)
      const overId = String(over.id)
      setRows((prev) => {
        const oldIndex = prev.findIndex((r) => r.id === activeId)
        const newIndex = prev.findIndex((r) => r.id === overId)
        if (oldIndex < 0 || newIndex < 0) return prev
        const next = arrayMove(prev, oldIndex, newIndex)
        const withOrder = next.map((g, i) => ({ ...g, sort_order: i }))
        void persistGroupOrder(withOrder, prev)
        return withOrder
      })
    },
    [canManage, reorderBusy, persistGroupOrder]
  )

  const confirmDelete = async () => {
    const g = pendingDelete
    if (!g || deleteBusy) return
    setDeleteBusy(true)
    setErr(null)
    try {
      await deleteAmrStandGroup(g.id)
      setPendingDelete(null)
      load()
    } catch (e) {
      setErr(apiErrorMessage(e))
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <ConfirmModal
        open={pendingDelete != null}
        title="Delete stand group"
        message={
          pendingDelete
            ? `Remove “${pendingDelete.name}”? Missions queued on this group will need a new destination.`
            : ''
        }
        confirmLabel={deleteBusy ? 'Deleting…' : 'Delete'}
        variant="danger"
        onCancel={() => {
          if (!deleteBusy) setPendingDelete(null)
        }}
        onConfirm={() => void confirmDelete()}
      />

      <AmrStandGroupEditorModal
        open={editorOpen}
        groupId={editorGroupId}
        onClose={() => {
          setEditorOpen(false)
          setEditorGroupId(null)
        }}
        onSaved={() => {
          load()
          setEditorOpen(false)
          setEditorGroupId(null)
        }}
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Stand groups</h1>
          <p className="mt-1 text-sm text-foreground/70">
            Pools of stands used as a single destination on stop 2+ when creating a mission. Picks an
            available member at dispatch and queues if none are free.{' '}
            <Link className="text-primary underline" to={amrPath('stands', 'manage')}>
              Manage stands
            </Link>
            .
            {canManage ? (
              <span className="text-foreground/70">
                {' '}
                Drag the handle on each card to set list order and the order of groups under the Groups zone
                category in the stand picker.
              </span>
            ) : null}
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            className="inline-flex min-h-[44px] shrink-0 items-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-100"
            onClick={() => {
              setEditorGroupId(null)
              setEditorOpen(true)
            }}
          >
            New group
          </button>
        ) : null}
      </div>

      {err ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-950 dark:text-red-50">
          {err}
        </div>
      ) : null}

      {reorderBusy ? (
        <p className="text-xs text-foreground/60" aria-live="polite">
          Saving order…
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-foreground/60">Loading stand groups…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-foreground/70">
          No stand groups yet.
          {canManage ? ' Use New group to create one.' : ''}
        </div>
      ) : canManage ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={rows.map((r) => r.id)} strategy={rectSortingStrategy}>
            <ul className="flex flex-col gap-4 p-0 list-none">
              {rows.map((g) => (
                <SortableStandGroupCard
                  key={g.id}
                  groupId={g.id}
                  g={g}
                  canManage={canManage}
                  onEdit={() => {
                    setEditorGroupId(g.id)
                    setEditorOpen(true)
                  }}
                  onDelete={() => setPendingDelete(g)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : (
        <ul className="flex flex-col gap-4 p-0 list-none">
          {rows.map((g) => (
            <li key={g.id}>
              <StandGroupCardFace
                g={g}
                canManage={false}
                onEdit={() => {}}
                onDelete={() => {}}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default AmrStandGroups
