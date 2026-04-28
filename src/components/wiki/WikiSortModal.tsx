import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
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
import { saveWikiSidebarOrder } from '@/api/wiki'
import { humanizePathForTitle } from '@/components/wiki/WikiBreadcrumbs'
import { useAlertConfirm } from '@/contexts/AlertConfirmContext'
import { findWikiTreeNode, sortedTreeChildren, type WikiTreeNode } from '@/lib/wikiTree'

function sortModalLabelForNode(node: WikiTreeNode): string {
  if (node.path === '') return 'Top level'
  const t = node.title?.trim()
  if (t) return t
  return humanizePathForTitle(node.path)
}

function collectParentsWithChildren(
  root: WikiTreeNode
): { path: string; label: string }[] {
  const out: { path: string; label: string }[] = []
  function walk(node: WikiTreeNode) {
    if (node.children.size === 0) return
    out.push({
      path: node.path,
      label: sortModalLabelForNode(node),
    })
    for (const c of sortedTreeChildren(node)) {
      walk(c)
    }
  }
  walk(root)
  return out
}

function mergeChildOrder(
  node: WikiTreeNode,
  parentPath: string,
  orderMap: Record<string, string[]>
): string[] {
  const preferred = orderMap[parentPath]
  const seen = new Set<string>()
  const next: string[] = []
  if (preferred?.length) {
    for (const s of preferred) {
      if (node.children.has(s) && !seen.has(s)) {
        next.push(s)
        seen.add(s)
      }
    }
  }
  for (const c of sortedTreeChildren(node)) {
    if (!seen.has(c.segment)) next.push(c.segment)
  }
  return next
}

function DragHandleIcon() {
  return (
    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm6-12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
    </svg>
  )
}

function SortableSegmentRow({
  segment,
  label,
  disabled,
}: {
  segment: string
  label: string
  disabled: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: segment,
    disabled,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1.5 ${
        isDragging ? 'z-10 opacity-70 shadow-md ring-2 ring-primary/30' : ''
      }`}
    >
      <button
        type="button"
        className="touch-none cursor-grab rounded p-1.5 text-foreground/45 hover:bg-foreground/[0.06] hover:text-foreground/80 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
        {...attributes}
        {...listeners}
        disabled={disabled}
        aria-label={`Drag to reorder ${label}`}
      >
        <DragHandleIcon />
      </button>
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">{label}</span>
        <span className="block truncate font-mono text-xs text-foreground/45">{segment}</span>
      </div>
    </li>
  )
}

export function WikiSortModal({
  open,
  explorerTree,
  orderMap,
  initialParentPath,
  onClose,
  onSaved,
}: {
  open: boolean
  explorerTree: WikiTreeNode
  orderMap: Record<string, string[]>
  initialParentPath: string
  onClose: () => void
  onSaved: () => void
}) {
  const { showAlert } = useAlertConfirm()
  const [parentPath, setParentPath] = useState(initialParentPath)
  const [orderedSegments, setOrderedSegments] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const parentOptions = useMemo(() => collectParentsWithChildren(explorerTree), [explorerTree])

  const parentNode = useMemo(
    () => findWikiTreeNode(explorerTree, parentPath),
    [explorerTree, parentPath]
  )

  useEffect(() => {
    if (!open) return
    setParentPath(initialParentPath)
  }, [open, initialParentPath])

  useEffect(() => {
    if (!open) return
    if (!parentNode?.children.size) {
      setOrderedSegments([])
      return
    }
    setOrderedSegments(mergeChildOrder(parentNode, parentPath, orderMap))
  }, [open, parentPath, explorerTree, orderMap, parentNode])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const handleDragEnd = (event: DragEndEvent) => {
    if (saving) return
    const { active, over } = event
    if (!over || active.id === over.id) return
    setOrderedSegments((items) => {
      const oldIndex = items.indexOf(String(active.id))
      const newIndex = items.indexOf(String(over.id))
      if (oldIndex < 0 || newIndex < 0) return items
      return arrayMove(items, oldIndex, newIndex)
    })
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await saveWikiSidebarOrder({ [parentPath]: orderedSegments })
      onSaved()
      onClose()
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Could not save order'
      showAlert(msg)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const modal = (
    <div
      className="fixed inset-0 z-[100] flex min-h-0 items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wiki-sort-title"
    >
      <div
        className="mx-auto flex max-h-[min(85vh,calc(100dvh-2rem))] w-full max-w-md shrink-0 flex-col rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border pl-4 pr-1">
          <h2 id="wiki-sort-title" className="min-w-0 flex-1 py-3 pr-2 text-lg font-semibold text-foreground">
            Sort pages
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 min-w-[44px] shrink-0 items-center justify-center rounded-lg text-foreground/70 hover:bg-background hover:text-foreground"
            aria-label="Close"
          >
            <span className="text-2xl leading-none" aria-hidden>
              ×
            </span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <label htmlFor="wiki-sort-parent" className="mb-1 block text-xs font-medium text-foreground/70">
            Parent
          </label>
          <select
            id="wiki-sort-parent"
            value={parentPath}
            onChange={(e) => setParentPath(e.target.value)}
            className="mb-4 w-full rounded-lg border border-border bg-background px-2 py-2 text-sm text-foreground"
          >
            {parentOptions.map((o) => (
              <option key={o.path === '' ? '__root__' : o.path} value={o.path}>
                {o.label}
              </option>
            ))}
          </select>
          {orderedSegments.length === 0 ? (
            <p className="text-sm text-foreground/60">No pages under this parent.</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-foreground/55">Drag handles to reorder. Keyboard: focus a handle and use arrow keys.</p>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={orderedSegments} strategy={verticalListSortingStrategy}>
                  <ul className="flex flex-col gap-1">
                    {orderedSegments.map((seg) => {
                      const child = parentNode?.children.get(seg)
                      const label = child
                        ? sortModalLabelForNode(child)
                        : humanizePathForTitle(seg)
                      return <SortableSegmentRow key={seg} segment={seg} label={label} disabled={saving} />
                    })}
                  </ul>
                </SortableContext>
              </DndContext>
            </>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-3 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || orderedSegments.length === 0}
            onClick={() => void handleSave()}
            className="min-h-[44px] rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save order'}
          </button>
        </div>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(modal, document.body) : null
}
