import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { api } from '@/api/client'
import { useAlertConfirm } from '@/contexts/AlertConfirmContext'
import { HomeCustomLinkEditModal } from '@/components/home/HomeCustomLinkEditModal'
import { ToggleSwitch } from '@/components/ui/ToggleSwitch'
import { publicAsset } from '@/lib/basePath'
import { externalFaviconCandidateUrls } from '@/lib/linkFavicon'
import {
  DEFAULT_CUSTOM_LINKS_VISIBLE_COUNT,
  DEFAULT_HOME_HUB_LINK_COLUMNS,
  MAX_CUSTOM_LINKS_ON_HOME,
  MAX_HOME_HUB_LINK_COLUMNS,
  MIN_CUSTOM_LINKS_ON_HOME,
  MIN_HOME_HUB_LINK_COLUMNS,
  clampCustomLinksOnHomeMax,
  clampHomeHubLinkColumns,
  clampLinksShowOnHomeToMax,
  renumberHomeHubSortOrders,
} from '@/lib/homeLinkVisibility'
import { randomUuid } from '@/lib/randomUuid'
import type { HomeCustomLink, HomeLinkCategory, HomePageConfig } from '@/types/homePage'

type LinkDialogState = null | 'add' | { editLinkId: string }

const UNCATEGORIZED_BUCKET = '__uncategorized__'
const HUB_ORDER_PREFIX = 'hub-order-'

/** Partition flat `links` into buckets following category order; preserves global order within each bucket. */
function partitionLinksIntoBuckets(
  globalLinks: HomeCustomLink[],
  categories: HomeLinkCategory[]
): { bucketId: string; title: string; links: HomeCustomLink[] }[] {
  const catIds = new Set(categories.map((c) => c.id))
  const out: { bucketId: string; title: string; links: HomeCustomLink[] }[] = []
  for (const c of categories) {
    out.push({
      bucketId: c.id,
      title: c.title,
      links: globalLinks.filter((l) => (l.categoryId?.trim() ?? '') === c.id),
    })
  }
  out.push({
    bucketId: UNCATEGORIZED_BUCKET,
    title: 'OTHER',
    links: globalLinks.filter((l) => {
      const cid = l.categoryId?.trim() ?? ''
      return !cid || !catIds.has(cid)
    }),
  })
  return out
}

function flattenBucketLists(
  buckets: { bucketId: string; links: HomeCustomLink[] }[]
): HomeCustomLink[] {
  const next: HomeCustomLink[] = []
  for (const b of buckets) {
    const catId = b.bucketId === UNCATEGORIZED_BUCKET ? null : b.bucketId
    for (const link of b.links) {
      next.push({ ...link, categoryId: catId })
    }
  }
  return next
}

function LinkRowFavicon({ href }: { href: string }) {
  const h = href.trim()
  const candidates = useMemo(() => {
    if (h.startsWith('mailto:')) return [] as string[]
    const ext = externalFaviconCandidateUrls(h)
    const fallback = publicAsset('icon.png')
    if (ext.length > 0) return [...ext, fallback]
    return [fallback]
  }, [h])
  const [i, setI] = useState(0)
  useEffect(() => {
    setI(0)
  }, [h])
  if (h.startsWith('mailto:')) {
    return (
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border/60 bg-background text-[11px] text-foreground/40">
        @
      </span>
    )
  }
  const src = candidates[Math.min(i, candidates.length - 1)] ?? publicAsset('icon.png')
  return (
    <img
      key={`${src}-${i}`}
      src={src}
      alt=""
      className="h-8 w-8 shrink-0 rounded border border-border object-contain"
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setI((idx) => (idx < candidates.length - 1 ? idx + 1 : idx))}
    />
  )
}

function SortableCategoryRow({
  cat,
  onTitleChange,
  onRemove,
}: {
  cat: HomeLinkCategory
  onTitleChange: (title: string) => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: cat.id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  return (
    <li ref={setNodeRef} style={style} className={isDragging ? 'opacity-60' : ''}>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/50 py-2 pl-1 pr-2">
        <button
          type="button"
          className="touch-none cursor-grab rounded p-1.5 text-foreground/45 hover:bg-background hover:text-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder category"
        >
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm6-12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
          </svg>
        </button>
        <input
          value={cat.title}
          onChange={(e) => onTitleChange(e.target.value)}
          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
          aria-label="Category title"
        />
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded px-2 py-1 text-sm text-red-600 hover:bg-red-500/10 dark:text-red-400"
        >
          Remove
        </button>
      </div>
    </li>
  )
}

function SortableHubOrderRow({
  sortableId,
  link,
  onRemoveFromHome,
}: {
  sortableId: string
  link: HomeCustomLink
  onRemoveFromHome: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  return (
    <li ref={setNodeRef} style={style} className={isDragging ? 'opacity-60' : ''}>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background/50 py-2 pl-1 pr-2">
        <button
          type="button"
          className="touch-none cursor-grab rounded p-1.5 text-foreground/45 hover:bg-background hover:text-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder on home hub"
        >
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm6-12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
          </svg>
        </button>
        <LinkRowFavicon href={link.href} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">{link.title || '—'}</div>
          <div className="truncate font-mono text-xs text-foreground/60">{link.href || '—'}</div>
        </div>
        <button
          type="button"
          onClick={onRemoveFromHome}
          onPointerDown={(e) => e.stopPropagation()}
          className="shrink-0 rounded px-2 py-1 text-sm text-red-600 hover:bg-red-500/10 dark:text-red-400"
        >
          Remove from home
        </button>
      </div>
    </li>
  )
}

function LinkBucketSection({
  bucketId,
  title,
  children,
}: {
  bucketId: string
  title: string
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `bucket-drop-${bucketId}`,
  })
  return (
    <div
      ref={setNodeRef}
      className={`min-h-[4rem] rounded-lg border border-dashed border-border/90 p-3 transition-colors ${
        isOver ? 'bg-primary/10 ring-2 ring-primary/25' : 'bg-background/40'
      }`}
    >
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-foreground/50">{title}</h3>
      {children}
    </div>
  )
}

function SortableLinkRow({
  link,
  onEdit,
  onRemove,
  onShowOnHomeChange,
  showOnHomeToggleDisabled,
  maxOnHome,
}: {
  link: HomeCustomLink
  onEdit: () => void
  onRemove: () => void
  onShowOnHomeChange: (showOnHome: boolean) => void
  /** When true, turning “on home” on is blocked (limit reached). */
  showOnHomeToggleDisabled: boolean
  maxOnHome: number
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: link.id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  return (
    <li ref={setNodeRef} style={style} className={isDragging ? 'opacity-60' : ''}>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background/50 py-2 pl-1 pr-2">
        <button
          type="button"
          className="touch-none cursor-grab rounded p-1.5 text-foreground/45 hover:bg-background hover:text-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder link"
        >
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm6-12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
          </svg>
        </button>
        <LinkRowFavicon href={link.href} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">{link.title || '—'}</div>
          <div className="truncate font-mono text-xs text-foreground/60">{link.href || '—'}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ToggleSwitch
            checked={link.showOnHome !== false}
            onCheckedChange={onShowOnHomeChange}
            aria-label="Show link on home hub"
            size="sm"
            disabled={showOnHomeToggleDisabled}
            title={
              showOnHomeToggleDisabled
                ? `Only ${maxOnHome} link(s) can be on the home hub. Turn another link off or raise “Max links on home”.`
                : 'Show this link as a card on the home hub'
            }
            onPointerDown={(e) => e.stopPropagation()}
          />
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="shrink-0 rounded px-2 py-1 text-sm font-medium text-primary hover:bg-background"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded px-2 py-1 text-sm text-red-600 hover:bg-red-500/10 dark:text-red-400"
        >
          Remove
        </button>
      </div>
    </li>
  )
}

export interface HomeLinksManagerPanelProps {
  /** When set (e.g. modal on `/links`), show a Close control instead of nav links. */
  onClose?: () => void
  /** Called after “Save links” succeeds so the underlying page can refresh. */
  onSaved?: () => void
}

export function HomeLinksManagerPanel({ onClose, onSaved }: HomeLinksManagerPanelProps) {
  const { showAlert } = useAlertConfirm()
  const [categories, setCategories] = useState<HomeLinkCategory[]>([])
  const [links, setLinks] = useState<HomeCustomLink[]>([])
  const [maxLinksOnHome, setMaxLinksOnHome] = useState(DEFAULT_CUSTOM_LINKS_VISIBLE_COUNT)
  const [hubLinkColumns, setHubLinkColumns] = useState(DEFAULT_HOME_HUB_LINK_COLUMNS)
  const [linksPageColumns, setLinksPageColumns] = useState(DEFAULT_HOME_HUB_LINK_COLUMNS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [linkDialog, setLinkDialog] = useState<LinkDialogState>(null)
  const [activeDragLinkId, setActiveDragLinkId] = useState<string | null>(null)
  const [activeHubDragId, setActiveHubDragId] = useState<string | null>(null)
  const loadedRef = useRef(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<HomePageConfig>('/home')
      setCategories(
        Array.isArray(data.linkCategories)
          ? [...data.linkCategories].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
          : []
      )
      const rawLinks = Array.isArray(data.customLinks) ? [...data.customLinks] : []
      const n = data.customLinksInitialVisibleCount
      const maxCap = clampCustomLinksOnHomeMax(
        typeof n === 'number' && Number.isFinite(n) ? n : DEFAULT_CUSTOM_LINKS_VISIBLE_COUNT
      )
      setMaxLinksOnHome(maxCap)
      const cols = clampHomeHubLinkColumns(data.homeHubLinkColumns)
      setHubLinkColumns(cols)
      setLinksPageColumns(
        clampHomeHubLinkColumns(data.linksPageLinkColumns ?? data.homeHubLinkColumns ?? cols)
      )
      setLinks(clampLinksShowOnHomeToMax(rawLinks, maxCap))
    } catch {
      showAlert('Could not load home links.')
    } finally {
      setLoading(false)
    }
  }, [showAlert])

  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    void load()
  }, [load])

  const handleCatDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setCategories((items) => {
      const oldIndex = items.findIndex((c) => c.id === active.id)
      const newIndex = items.findIndex((c) => c.id === over.id)
      if (oldIndex < 0 || newIndex < 0) return items
      return arrayMove(items, oldIndex, newIndex).map((c, i) => ({ ...c, sortOrder: i }))
    })
  }

  const handleLinkDragStart = (event: DragStartEvent) => {
    setActiveDragLinkId(String(event.active.id))
  }

  const handleLinkDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveDragLinkId(null)
    if (!over || active.id === over.id) return

    setLinks((prev) => {
      const buckets = partitionLinksIntoBuckets(prev, categories).map((b) => ({
        bucketId: b.bucketId,
        title: b.title,
        links: [...b.links],
      }))

      const activeId = String(active.id)
      const overId = String(over.id)

      const findBucketIdxWithLink = (linkId: string) =>
        buckets.findIndex((b) => b.links.some((l) => l.id === linkId))

      const activeBidx = findBucketIdxWithLink(activeId)
      if (activeBidx < 0) return prev

      const activeIdxInBucket = buckets[activeBidx].links.findIndex((l) => l.id === activeId)
      if (activeIdxInBucket < 0) return prev

      let overBidx: number
      let overIdxInBucket: number

      if (overId.startsWith('bucket-drop-')) {
        const bid = overId.slice('bucket-drop-'.length)
        overBidx = buckets.findIndex((b) => b.bucketId === bid)
        if (overBidx < 0) return prev
        overIdxInBucket = buckets[overBidx].links.length
      } else {
        overBidx = findBucketIdxWithLink(overId)
        if (overBidx < 0) return prev
        overIdxInBucket = buckets[overBidx].links.findIndex((l) => l.id === overId)
        if (overIdxInBucket < 0) return prev
      }

      if (activeBidx === overBidx) {
        const list = buckets[activeBidx].links
        if (overId.startsWith('bucket-drop-')) {
          const newList = arrayMove(list, activeIdxInBucket, list.length - 1)
          buckets[activeBidx] = { ...buckets[activeBidx], links: newList }
        } else {
          const newList = arrayMove(list, activeIdxInBucket, overIdxInBucket)
          buckets[activeBidx] = { ...buckets[activeBidx], links: newList }
        }
        return flattenBucketLists(buckets)
      }

      const [moved] = buckets[activeBidx].links.splice(activeIdxInBucket, 1)
      if (!moved) return prev

      const targetCat =
        buckets[overBidx].bucketId === UNCATEGORIZED_BUCKET ? null : buckets[overBidx].bucketId
      const movedUpdated: HomeCustomLink = { ...moved, categoryId: targetCat }

      let insertAt = overIdxInBucket
      if (overId.startsWith('bucket-drop-')) {
        insertAt = buckets[overBidx].links.length
      }

      buckets[overBidx].links.splice(insertAt, 0, movedUpdated)

      return flattenBucketLists(buckets)
    })
  }

  const handleLinkDragCancel = () => {
    setActiveDragLinkId(null)
  }

  const handleHubOrderDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveHubDragId(null)
    if (!over || active.id === over.id) return
    const hubId = (raw: string) =>
      raw.startsWith(HUB_ORDER_PREFIX) ? raw.slice(HUB_ORDER_PREFIX.length) : ''
    const activeLinkId = hubId(String(active.id))
    const overSid = String(over.id)
    const overLinkId = hubId(overSid)
    if (!activeLinkId || !overLinkId) return
    setLinks((prev) => {
      const ordered = [...prev.filter((l) => l.showOnHome !== false)].sort(
        (a, b) =>
          (a.homeSortOrder ?? 0) - (b.homeSortOrder ?? 0) || a.id.localeCompare(b.id)
      )
      const oldIndex = ordered.findIndex((l) => l.id === activeLinkId)
      const newIndex = ordered.findIndex((l) => l.id === overLinkId)
      if (oldIndex < 0 || newIndex < 0) return prev
      const reordered = arrayMove(ordered, oldIndex, newIndex)
      const rank = new Map(reordered.map((l, i) => [l.id, i]))
      return prev.map((l) =>
        l.showOnHome !== false && rank.has(l.id)
          ? { ...l, homeSortOrder: rank.get(l.id)! }
          : l
      )
    })
  }

  const handleHubDragStart = (event: DragStartEvent) => {
    setActiveHubDragId(String(event.active.id))
  }

  const handleHubDragCancel = () => {
    setActiveHubDragId(null)
  }

  const addCategory = () => {
    setCategories((prev) => [
      ...prev,
      { id: randomUuid(), title: 'New category', sortOrder: prev.length },
    ])
  }

  const removeCategory = (index: number) => {
    const removed = categories[index]
    if (!removed) return
    setCategories((prev) => prev.filter((_, i) => i !== index).map((c, i) => ({ ...c, sortOrder: i })))
    setLinks((prev) =>
      prev.map((l) => (l.categoryId === removed.id ? { ...l, categoryId: null } : l))
    )
  }

  const removeLink = (linkId: string) => {
    setLinks((prev) => renumberHomeHubSortOrders(prev.filter((l) => l.id !== linkId)))
  }

  const handleLinkSave = (link: HomeCustomLink) => {
    const cap = clampCustomLinksOnHomeMax(maxLinksOnHome)
    let saved: HomeCustomLink = { ...link }
    if (saved.showOnHome !== false) {
      const editId =
        linkDialog && typeof linkDialog === 'object' && 'editLinkId' in linkDialog
          ? linkDialog.editLinkId
          : undefined
      const othersOn = links.filter(
        (l) => l.showOnHome !== false && (!editId || l.id !== editId)
      ).length
      if (othersOn >= cap) {
        saved = { ...saved, showOnHome: false }
        showAlert(
          `Home hub allows at most ${cap} links. This link was saved without “show on home” — make room or raise “Max links on home”.`
        )
      }
    }
    if (linkDialog === 'add') {
      setLinks((prev) => {
        let row = saved
        if (saved.showOnHome !== false) {
          const onHome = prev.filter((l) => l.showOnHome !== false)
          const maxHo = onHome.reduce((m, x) => Math.max(m, x.homeSortOrder ?? 0), -1)
          row = { ...saved, homeSortOrder: maxHo + 1 }
        }
        return [...prev, row]
      })
      return
    }
    if (linkDialog && typeof linkDialog === 'object' && 'editLinkId' in linkDialog) {
      const id = linkDialog.editLinkId
      const prevLink = links.find((l) => l.id === id)
      let next = saved
      if (saved.showOnHome !== false && prevLink?.showOnHome === false) {
        const others = links.filter((l) => l.showOnHome !== false && l.id !== id)
        const maxHo = others.reduce((m, x) => Math.max(m, x.homeSortOrder ?? 0), -1)
        next = { ...saved, homeSortOrder: maxHo + 1 }
      }
      setLinks((prev) => prev.map((l) => (l.id === id ? next : l)))
    }
  }

  const handleSaveAll = async () => {
    const catsOrdered = categories.map((c, i) => ({ ...c, sortOrder: i }))
    const n = clampCustomLinksOnHomeMax(maxLinksOnHome)
    const cols = clampHomeHubLinkColumns(hubLinkColumns)
    const linksCols = clampHomeHubLinkColumns(linksPageColumns)
    const trimmed = links.filter((l) => l.title.trim() && l.href.trim())
    const toSave = clampLinksShowOnHomeToMax(trimmed, n)
    setSaving(true)
    try {
      await api.put<HomePageConfig>('/home', {
        customLinks: toSave,
        linkCategories: catsOrdered,
        customLinksInitialVisibleCount: n,
        homeHubLinkColumns: cols,
        linksPageLinkColumns: linksCols,
        homeHubCategoryColumnMap: {},
        homeHubOtherLinksColumn: null,
        homeHubColumnCategoryIds: [],
      })
      setLinks(toSave)
      onSaved?.()
      onClose?.()
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to save'
      showAlert(msg)
    } finally {
      setSaving(false)
    }
  }

  const editInitial =
    linkDialog === 'add'
      ? null
      : linkDialog && typeof linkDialog === 'object' && 'editLinkId' in linkDialog
        ? links.find((l) => l.id === linkDialog.editLinkId) ?? null
        : null

  const categoryOptions = useMemo(
    () => categories.map((c) => ({ id: c.id, title: c.title })),
    [categories]
  )

  const linkBuckets = useMemo(
    () => partitionLinksIntoBuckets(links, categories),
    [links, categories]
  )

  const activeDragLink = useMemo(
    () => (activeDragLinkId ? links.find((l) => l.id === activeDragLinkId) : undefined),
    [activeDragLinkId, links]
  )

  const hubOrdered = useMemo(() => {
    const onHome = links.filter((l) => l.showOnHome !== false)
    return [...onHome].sort(
      (a, b) =>
        (a.homeSortOrder ?? 0) - (b.homeSortOrder ?? 0) || a.id.localeCompare(b.id)
    )
  }, [links])

  const activeHubLink = useMemo(() => {
    if (!activeHubDragId?.startsWith(HUB_ORDER_PREFIX)) return undefined
    const id = activeHubDragId.slice(HUB_ORDER_PREFIX.length)
    return links.find((l) => l.id === id)
  }, [activeHubDragId, links])

  const maxOnHome = useMemo(
    () => clampCustomLinksOnHomeMax(maxLinksOnHome),
    [maxLinksOnHome]
  )
  const onHomeCount = useMemo(
    () => links.filter((l) => l.showOnHome !== false).length,
    [links]
  )

  const handleShowOnHomeChange = useCallback(
    (linkId: string, show: boolean) => {
      if (!show) {
        setLinks((prev) =>
          renumberHomeHubSortOrders(
            prev.map((l) => (l.id === linkId ? { ...l, showOnHome: false } : l))
          )
        )
        return
      }
      setLinks((prev) => {
        const row = prev.find((l) => l.id === linkId)
        if (!row || row.showOnHome !== false) return prev
        const countOn = prev.filter((l) => l.showOnHome !== false).length
        if (countOn >= maxOnHome) {
          showAlert(
            `You can enable at most ${maxOnHome} links on the home hub. Turn another link off first or raise “Max links on home”.`
          )
          return prev
        }
        const othersOn = prev.filter((l) => l.showOnHome !== false)
        const maxHo = othersOn.reduce((m, x) => Math.max(m, x.homeSortOrder ?? 0), -1)
        return prev.map((l) =>
          l.id === linkId ? { ...l, showOnHome: true, homeSortOrder: maxHo + 1 } : l
        )
      })
    },
    [maxOnHome, showAlert]
  )

  const modalHomeSlotsRemaining = useMemo(() => {
    const cap = clampCustomLinksOnHomeMax(maxLinksOnHome)
    if (linkDialog === 'add') {
      return Math.max(0, cap - links.filter((l) => l.showOnHome !== false).length)
    }
    if (linkDialog && typeof linkDialog === 'object' && 'editLinkId' in linkDialog) {
      const id = linkDialog.editLinkId
      const used = links.filter((l) => l.showOnHome !== false && l.id !== id).length
      return Math.max(0, cap - used)
    }
    return cap
  }, [linkDialog, links, maxLinksOnHome])

  const headerActions = onClose ? (
    <button
      type="button"
      onClick={onClose}
      className="shrink-0 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-background/80"
    >
      Close
    </button>
  ) : (
    <div className="flex flex-wrap gap-3 text-sm">
      <Link to="/links" className="font-medium text-primary hover:underline">
        View links page
      </Link>
      <Link to="/" className="text-foreground/80 hover:underline">
        Home
      </Link>
    </div>
  )

  const saveFooter = (
    <footer className="shrink-0 border-t border-border bg-card px-4 py-4">
      <div className="mx-auto flex max-w-3xl justify-end gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onClose?.()
          }}
          className="rounded-lg border border-border bg-background px-5 py-2.5 text-sm font-medium text-foreground hover:bg-background/80 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={loading || saving || linkDialog != null}
          title={
            linkDialog != null
              ? 'Finish or cancel the add/edit link dialog before saving all links.'
              : undefined
          }
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void handleSaveAll()
          }}
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </footer>
  )

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-border bg-card px-4 py-4">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
            <h1 id="manage-links-heading" className="text-2xl font-semibold text-foreground">
              Manage links
            </h1>
            {headerActions}
          </div>
        </header>
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-16">
          <p className="text-sm text-foreground/60">Loading…</p>
        </div>
        {saveFooter}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border bg-card px-4 py-4">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
          <h1 id="manage-links-heading" className="text-2xl font-semibold text-foreground">
            Manage links
          </h1>
          {headerActions}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-8">
        <p className="text-sm text-foreground/70">
          Configure the home hub and <Link to="/links" className="text-primary hover:underline">/links</Link> layout,
          then manage categories and links.
        </p>

        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">Home hub</h2>
          <p className="mt-1 text-xs text-foreground/65">
            Home page “Links” area: single grid of cards in the order below. Between {MIN_HOME_HUB_LINK_COLUMNS} and{' '}
            {MAX_HOME_HUB_LINK_COLUMNS} columns; at most {MIN_CUSTOM_LINKS_ON_HOME}–{MAX_CUSTOM_LINKS_ON_HOME} links on the
            hub at once.
          </p>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-foreground" htmlFor="hub-link-columns">
                Columns on home hub
              </label>
              <input
                id="hub-link-columns"
                type="number"
                min={MIN_HOME_HUB_LINK_COLUMNS}
                max={MAX_HOME_HUB_LINK_COLUMNS}
                value={hubLinkColumns}
                onChange={(e) => {
                  const parsed = parseInt(e.target.value, 10)
                  const next = clampHomeHubLinkColumns(
                    Number.isFinite(parsed) ? parsed : MIN_HOME_HUB_LINK_COLUMNS
                  )
                  setHubLinkColumns(next)
                }}
                className="mt-2 w-full max-w-[10rem] rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground" htmlFor="hub-link-count">
                Max links on home
              </label>
              <input
                id="hub-link-count"
                type="number"
                min={MIN_CUSTOM_LINKS_ON_HOME}
                max={MAX_CUSTOM_LINKS_ON_HOME}
                value={maxLinksOnHome}
                onChange={(e) => {
                  const parsed = parseInt(e.target.value, 10)
                  const next = clampCustomLinksOnHomeMax(
                    Number.isFinite(parsed) ? parsed : MIN_CUSTOM_LINKS_ON_HOME
                  )
                  setMaxLinksOnHome(next)
                  setLinks((prev) => clampLinksShowOnHomeToMax(prev, next))
                }}
                className="mt-2 w-full max-w-[10rem] rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </div>
          </div>

          <div className="mt-6 border-t border-border pt-5">
            <p className="text-sm font-medium text-foreground">Hub card order</p>
            <p className="mt-1 text-xs text-foreground/65">
              Drag to reorder. Only links with “show on home” appear here; directory order on{' '}
              <Link to="/links">/links</Link> is unchanged.
            </p>
            {hubOrdered.length > 0 ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleHubDragStart}
                onDragEnd={handleHubOrderDragEnd}
                onDragCancel={handleHubDragCancel}
              >
                <SortableContext
                  items={hubOrdered.map((l) => `${HUB_ORDER_PREFIX}${l.id}`)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="mt-3 space-y-2">
                    {hubOrdered.map((link) => (
                      <SortableHubOrderRow
                        key={`${HUB_ORDER_PREFIX}${link.id}`}
                        sortableId={`${HUB_ORDER_PREFIX}${link.id}`}
                        link={link}
                        onRemoveFromHome={() => handleShowOnHomeChange(link.id, false)}
                      />
                    ))}
                  </ul>
                </SortableContext>
                <DragOverlay dropAnimation={null}>
                  {activeHubLink ? (
                    <div className="rounded-lg border border-border bg-card p-2 opacity-95 shadow-lg">
                      <div className="text-sm font-medium text-foreground">{activeHubLink.title}</div>
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            ) : (
              <p className="mt-3 text-sm text-foreground/60">
                No links on the home hub yet. Turn on “show on home” for links in the list below.
              </p>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">Links page</h2>
            <p className="mt-1 text-xs text-foreground/65">
              Full directory at <span className="font-mono text-foreground/80">/links</span>. Within each category
              heading, cards fill a grid left to right.
            </p>
            <div className="mt-4">
              <label className="block text-sm font-medium text-foreground" htmlFor="links-page-columns">
                Columns on links page
              </label>
              <p className="mt-1 text-xs text-foreground/65">
                Between {MIN_HOME_HUB_LINK_COLUMNS} and {MAX_HOME_HUB_LINK_COLUMNS}.
              </p>
              <input
                id="links-page-columns"
                type="number"
                min={MIN_HOME_HUB_LINK_COLUMNS}
                max={MAX_HOME_HUB_LINK_COLUMNS}
                value={linksPageColumns}
                onChange={(e) => {
                  const parsed = parseInt(e.target.value, 10)
                  setLinksPageColumns(
                    clampHomeHubLinkColumns(
                      Number.isFinite(parsed) ? parsed : MIN_HOME_HUB_LINK_COLUMNS
                    )
                  )
                }}
                className="mt-2 w-28 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </div>
        </section>

        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-foreground">Categories</h2>
            <button
              type="button"
              onClick={addCategory}
              className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-background/80"
            >
              Add category
            </button>
          </div>
          <p className="mb-3 text-xs text-foreground/65">
            Headings on the home hub (by category) and on the links page. Reorder here and drag links between sections
            below.
          </p>

          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-foreground/55">Category order</p>
          {categories.length === 0 ? (
            <p className="text-sm text-foreground/60">No categories yet.</p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCatDragEnd}>
              <SortableContext items={categories.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                <ul className="space-y-2">
                  {categories.map((cat, index) => (
                    <SortableCategoryRow
                      key={cat.id}
                      cat={cat}
                      onTitleChange={(title) =>
                        setCategories((prev) =>
                          prev.map((c, i) => (i === index ? { ...c, title } : c))
                        )
                      }
                      onRemove={() => removeCategory(index)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}
        </section>

        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-foreground">Links</h2>
            <button
              type="button"
              onClick={() => setLinkDialog('add')}
              className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-background/80"
            >
              Add link
            </button>
          </div>
          <p className="mb-3 text-xs text-foreground/65">
            Drag cards between categories to assign them. Order within each group is saved for the links page. Use{' '}
            <strong className="font-medium text-foreground/80">Home hub</strong> above to arrange cards on the home
            hub.
          </p>
          {links.length === 0 ? (
            <p className="text-sm text-foreground/60">No links yet. Click &quot;Add link&quot;.</p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleLinkDragStart}
              onDragEnd={handleLinkDragEnd}
              onDragCancel={handleLinkDragCancel}
            >
              <div className="space-y-4">
                {linkBuckets.map((bucket) => (
                  <LinkBucketSection key={bucket.bucketId} bucketId={bucket.bucketId} title={bucket.title}>
                    <SortableContext
                      id={`container-${bucket.bucketId}`}
                      items={bucket.links.map((l) => l.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <ul className="space-y-2">
                        {bucket.links.map((link) => (
                          <SortableLinkRow
                            key={link.id}
                            link={link}
                            maxOnHome={maxOnHome}
                            onEdit={() => setLinkDialog({ editLinkId: link.id })}
                            onRemove={() => removeLink(link.id)}
                            showOnHomeToggleDisabled={
                              link.showOnHome === false && onHomeCount >= maxOnHome
                            }
                            onShowOnHomeChange={(show) => handleShowOnHomeChange(link.id, show)}
                          />
                        ))}
                      </ul>
                      {bucket.links.length === 0 ? (
                        <p className="py-3 text-center text-xs text-foreground/45">Drop links here</p>
                      ) : null}
                    </SortableContext>
                  </LinkBucketSection>
                ))}
              </div>
              <DragOverlay dropAnimation={null}>
                {activeDragLink ? (
                  <div className="rounded-lg border border-border bg-card p-2 opacity-95 shadow-lg">
                    <div className="text-sm font-medium text-foreground">{activeDragLink.title}</div>
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}
        </section>
        </div>
      </div>

      {saveFooter}

      {linkDialog != null && (
        <HomeCustomLinkEditModal
          initial={editInitial}
          linkCategories={categoryOptions.length > 0 ? categoryOptions : undefined}
          maxLinksOnHome={maxOnHome}
          homeShowOnRemainingSlots={modalHomeSlotsRemaining}
          onClose={() => setLinkDialog(null)}
          onSave={handleLinkSave}
        />
      )}
    </div>
  )
}
