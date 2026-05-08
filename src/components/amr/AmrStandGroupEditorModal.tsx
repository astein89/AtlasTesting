import { useCallback, useEffect, useMemo, useState } from 'react'
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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  createAmrStandGroup,
  getAmrStandGroups,
  getAmrStands,
  updateAmrStandGroup,
  type AmrStandGroupRow,
  type AmrStandRow,
} from '@/api/amr'
import { AmrStandPickerModal, type AmrStandPickerRow } from '@/components/amr/AmrStandPickerModal'

function apiErrorMessage(e: unknown): string {
  const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
  if (typeof msg === 'string' && msg.trim()) return msg
  if (e instanceof Error) return e.message
  return 'Something went wrong.'
}

type MemberRow = {
  standId: string
  externalRef: string
}

function SortableMemberRow({
  member,
  idx,
  onRemove,
}: {
  member: MemberRow
  idx: number
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: member.standId,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm ${
        isDragging ? 'relative z-[5] opacity-95 shadow-md ring-2 ring-ring' : ''
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <button
          type="button"
          className="touch-none flex h-9 w-9 shrink-0 cursor-grab items-center justify-center rounded-lg border border-border bg-muted/40 text-foreground/55 hover:bg-muted hover:text-foreground active:cursor-grabbing"
          aria-label="Drag to reorder"
          title="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm6-12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
          </svg>
        </button>
        <span className="w-5 shrink-0 text-right font-mono text-xs text-foreground/55">{idx + 1}.</span>
        <span className="min-w-0 break-all font-mono text-foreground">
          {member.externalRef || `(stand ${member.standId})`}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onRemove}
          className="rounded px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-500/10 dark:text-red-300"
          title="Remove from group"
        >
          Remove
        </button>
      </div>
    </li>
  )
}

export function AmrStandGroupEditorModal({
  open,
  onClose,
  groupId,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  /** `null` = create a new group; string id = edit existing. */
  groupId: string | null
  onSaved?: () => void
}) {
  const [name, setName] = useState('')
  const [members, setMembers] = useState<MemberRow[]>([])
  const [stands, setStands] = useState<AmrStandRow[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    if (!open) {
      setName('')
      setMembers([])
      setErr(null)
      setPickerOpen(false)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (pickerOpen) return
      if (!saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, saving, pickerOpen])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setErr(null)
    void getAmrStands()
      .then((rows) => {
        if (cancelled) return
        setStands(rows as AmrStandRow[])
      })
      .catch((e) => {
        if (!cancelled) setErr(apiErrorMessage(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    if (!groupId) {
      setName('')
      setMembers([])
      return
    }
    let cancelled = false
    setLoading(true)
    setErr(null)
    void getAmrStandGroups()
      .then((rows: AmrStandGroupRow[]) => {
        if (cancelled) return
        const g = rows.find((r) => r.id === groupId)
        if (!g) {
          setErr('Group not found')
          return
        }
        setName(g.name ?? '')
        const sortedMembers = [...(g.members ?? [])].sort((a, b) => a.position - b.position)
        setMembers(
          sortedMembers.map((m) => ({
            standId: String(m.standId),
            externalRef: String(m.externalRef ?? ''),
          }))
        )
      })
      .catch((e) => {
        if (!cancelled) setErr(apiErrorMessage(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, groupId])

  const standByRef = useMemo(() => {
    const map = new Map<string, AmrStandRow>()
    for (const s of stands) {
      const ref = String(s.external_ref ?? '').trim()
      if (ref) map.set(ref, s)
    }
    return map
  }, [stands])

  const pickerRows: AmrStandPickerRow[] = useMemo(
    () =>
      stands
        .filter((s) => Number(s.enabled ?? 1) === 1)
        .map((s) => ({
          id: String(s.id),
          external_ref: String(s.external_ref ?? ''),
          zone: String(s.zone ?? ''),
          location_label: String(s.location_label ?? ''),
          orientation: String(s.orientation ?? '0'),
          block_pickup: Number(s.block_pickup ?? 0),
          block_dropoff: Number(s.block_dropoff ?? 0),
          bypass_pallet_check: Number(s.bypass_pallet_check ?? 0),
        })),
    [stands]
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleMemberDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const activeId = String(active.id)
    const overId = String(over.id)
    setMembers((prev) => {
      const oldIndex = prev.findIndex((m) => m.standId === activeId)
      const newIndex = prev.findIndex((m) => m.standId === overId)
      if (oldIndex < 0 || newIndex < 0) return prev
      return arrayMove(prev, oldIndex, newIndex)
    })
  }, [])

  const sortMembersAlphabetically = useCallback(() => {
    setMembers((prev) =>
      [...prev].sort((a, b) =>
        a.externalRef.localeCompare(b.externalRef, undefined, { sensitivity: 'base', numeric: true })
      )
    )
  }, [])

  const removeMember = (idx: number) => {
    setMembers((prev) => prev.filter((_, i) => i !== idx))
  }

  const addRefs = (refs: string[]) => {
    setMembers((prev) => {
      const haveIds = new Set(prev.map((m) => m.standId))
      const additions: MemberRow[] = []
      for (const ref of refs) {
        const stand = standByRef.get(ref.trim())
        if (!stand) continue
        const sid = String(stand.id)
        if (haveIds.has(sid)) continue
        haveIds.add(sid)
        additions.push({ standId: sid, externalRef: String(stand.external_ref ?? '') })
      }
      if (additions.length === 0) return prev
      return [...prev, ...additions]
    })
  }

  const save = async () => {
    if (saving) return
    const trimmed = name.trim()
    if (!trimmed) {
      setErr('Name is required.')
      return
    }
    if (members.length === 0) {
      setErr('Add at least one stand to the group.')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      const memberStandIds = members.map((m) => m.standId)
      if (groupId) {
        await updateAmrStandGroup(groupId, { name: trimmed, memberStandIds })
      } else {
        await createAmrStandGroup({ name: trimmed, memberStandIds })
      }
      onSaved?.()
    } catch (e) {
      setErr(apiErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const title = groupId ? 'Edit stand group' : 'New stand group'
  const memberRefs = members.map((m) => m.externalRef)

  return (
    <>
      {pickerOpen ? (
        <AmrStandPickerModal
          stands={pickerRows}
          stackOrder="aboveDialogs"
          onClose={() => setPickerOpen(false)}
          onSelect={() => {
            /* unused in multi-select */
          }}
          multiSelect={{
            initialSelectedRefs: memberRefs,
            onConfirm: (refs) => {
              const known = new Set(memberRefs)
              const additions = refs.filter((r) => !known.has(r))
              if (additions.length > 0) addRefs(additions)
            },
          }}
        />
      ) : null}

      <div className="fixed inset-0 z-[62] flex min-h-0 items-stretch justify-center p-0 sm:items-center sm:p-4">
        <div className="absolute inset-0 bg-black/50" aria-hidden />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="amr-stand-group-editor-title"
          className="relative z-10 flex h-full min-h-0 max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl sm:h-auto sm:max-h-[min(90vh,100dvh)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
            <h2
              id="amr-stand-group-editor-title"
              className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight text-foreground sm:text-lg"
            >
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="shrink-0 rounded-lg p-2 text-foreground/70 hover:bg-background hover:text-foreground disabled:opacity-50"
              aria-label="Close"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {err ? (
            <div className="border-b border-red-500/35 bg-red-500/10 px-4 py-2 text-sm text-red-950 dark:bg-red-500/15 dark:text-red-50 sm:px-5">
              {err}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
            {loading ? (
              <p className="text-sm text-foreground/60">Loading…</p>
            ) : (
              <div className="space-y-5">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-foreground/80">Group name</span>
                  <input
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value)
                      setErr(null)
                    }}
                    className="min-h-[40px] rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    placeholder="e.g. East dock cells"
                  />
                </label>

                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Stands in group</p>
                      <p className="text-xs text-foreground/60">
                        Order is priority — drag to reorder; top of the list is tried first at dispatch.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={members.length < 2}
                        onClick={sortMembersAlphabetically}
                        title={
                          members.length < 2 ? 'Add at least two stands to sort' : 'Sort stands A–Z by external ref'
                        }
                        className="inline-flex min-h-[40px] shrink-0 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Sort A–Z
                      </button>
                      <button
                        type="button"
                        onClick={() => setPickerOpen(true)}
                        className="inline-flex min-h-[40px] shrink-0 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-muted"
                      >
                        Add stands…
                      </button>
                    </div>
                  </div>

                  {members.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-sm text-foreground/60">
                      No stands added yet. Use <strong>Add stands…</strong> to choose from the location picker.
                    </div>
                  ) : (
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleMemberDragEnd}>
                      <SortableContext
                        items={members.map((m) => m.standId)}
                        strategy={verticalListSortingStrategy}
                      >
                        <ul className="divide-y divide-border rounded-lg border border-border">
                          {members.map((m, idx) => (
                            <SortableMemberRow
                              key={m.standId}
                              member={m}
                              idx={idx}
                              onRemove={() => removeMember(idx)}
                            />
                          ))}
                        </ul>
                      </SortableContext>
                    </DndContext>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3 sm:px-5">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="inline-flex min-h-[44px] shrink-0 items-center rounded-lg border border-border px-4 text-sm hover:bg-muted disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || loading}
              className="inline-flex min-h-[44px] shrink-0 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : groupId ? 'Save changes' : 'Create group'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
