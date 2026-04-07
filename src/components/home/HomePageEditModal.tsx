import { useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
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
import { api } from '@/api/client'
import { appModules, type AppModule } from '@/config/modules'
import { useAlertConfirm } from '@/contexts/AlertConfirmContext'
import { HomeCustomLinkEditModal } from '@/components/home/HomeCustomLinkEditModal'
import { HomeModuleCardIcon } from '@/components/home/HomeModuleCardIcon'
import { mergeHomeModuleOrder } from '@/lib/homeModuleOrder'
import { publicAsset } from '@/lib/basePath'
import { externalFaviconCandidateUrls } from '@/lib/linkFavicon'
import {
  WELCOME_LOGO_DEFAULT_REM,
  WELCOME_LOGO_MAX_REM,
  WELCOME_LOGO_MIN_REM,
  clampWelcomeLogoMaxRem,
} from '@/lib/welcomeLogoSize'
import type { HomeCustomLink, HomePageConfig } from '@/types/homePage'

type LinkDialogState = null | 'add' | { edit: number }

const APP_MODULE_ID_SET = new Set(appModules.map((m) => m.id))

function normalizeModulesHiddenFromInitial(ids: string[] | undefined): string[] {
  if (!Array.isArray(ids)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (typeof id !== 'string') continue
    const t = id.trim()
    if (!APP_MODULE_ID_SET.has(t) || seen.has(t)) continue
    out.push(t)
    seen.add(t)
  }
  return out
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
      <span
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border/60 bg-background text-[11px] text-foreground/40"
        title="Email"
      >
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

function SortableModuleRow({
  module: m,
  hideFromHome,
  onToggleHideFromHome,
}: {
  module: AppModule
  hideFromHome: boolean
  onToggleHideFromHome: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: m.id,
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
          aria-label="Drag to reorder module"
        >
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm6-12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
          </svg>
        </button>
        <HomeModuleCardIcon moduleId={m.id} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">{m.title}</div>
          <div className="truncate text-xs text-foreground/55">{m.description}</div>
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-foreground/75 sm:shrink-0">
          <input
            type="checkbox"
            checked={hideFromHome}
            onChange={onToggleHideFromHome}
            className="h-3.5 w-3.5 shrink-0 rounded border-border text-primary"
          />
          Hide on home
        </label>
      </div>
    </li>
  )
}

interface HomePageEditModalProps {
  initial: HomePageConfig
  onClose: () => void
  onSaved: (config: HomePageConfig) => void
}

function SortableLinkRow({
  link,
  onEdit,
  onRemove,
}: {
  link: HomeCustomLink
  onEdit: () => void
  onRemove: () => void
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
          aria-label="Drag to reorder"
        >
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm6-12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <LinkRowFavicon href={link.href} />
            <div className="truncate text-sm font-medium text-foreground">{link.title || '—'}</div>
          </div>
          <div className="truncate font-mono text-xs text-foreground/60">{link.href || '—'}</div>
        {link.allowedRoleSlugs && link.allowedRoleSlugs.length > 0 ? (
          <div className="truncate text-xs text-foreground/45">Roles: {link.allowedRoleSlugs.join(', ')}</div>
        ) : link.requiredPermission ? (
          <div className="truncate text-xs text-foreground/45">Permission (legacy): {link.requiredPermission}</div>
        ) : (
          <div className="truncate text-xs text-foreground/45">Visible to all</div>
        )}
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

export function HomePageEditModal({ initial, onClose, onSaved }: HomePageEditModalProps) {
  const { showAlert } = useAlertConfirm()
  const [introMarkdown, setIntroMarkdown] = useState(initial.introMarkdown)
  const [showWelcomeLogo, setShowWelcomeLogo] = useState(initial.showWelcomeLogo === true)
  const [welcomeLogoMaxRem, setWelcomeLogoMaxRem] = useState(() =>
    clampWelcomeLogoMaxRem(initial.welcomeLogoMaxRem ?? WELCOME_LOGO_DEFAULT_REM)
  )
  const [links, setLinks] = useState<HomeCustomLink[]>(() =>
    initial.customLinks.length ? [...initial.customLinks] : []
  )
  const [moduleOrder, setModuleOrder] = useState(() => mergeHomeModuleOrder(initial.moduleOrder))
  const [modulesHiddenFromHome, setModulesHiddenFromHome] = useState<string[]>(() =>
    normalizeModulesHiddenFromInitial(initial.modulesHiddenFromHome)
  )
  const [linkDialog, setLinkDialog] = useState<LinkDialogState>(null)
  const [saving, setSaving] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (linkDialog != null) {
        e.preventDefault()
        setLinkDialog(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [linkDialog])

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setLinks((items) => {
      const oldIndex = items.findIndex((l) => l.id === active.id)
      const newIndex = items.findIndex((l) => l.id === over.id)
      if (oldIndex < 0 || newIndex < 0) return items
      return arrayMove(items, oldIndex, newIndex)
    })
  }

  const handleModuleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setModuleOrder((ids) => {
      const oldIndex = ids.indexOf(String(active.id))
      const newIndex = ids.indexOf(String(over.id))
      if (oldIndex < 0 || newIndex < 0) return ids
      return arrayMove(ids, oldIndex, newIndex)
    })
  }

  const removeLink = (index: number) => {
    setLinks((prev) => prev.filter((_, i) => i !== index))
  }

  const handleLinkSave = (link: HomeCustomLink) => {
    if (linkDialog === 'add') {
      setLinks((prev) => [...prev, link])
      return
    }
    if (linkDialog && typeof linkDialog === 'object' && 'edit' in linkDialog) {
      const i = linkDialog.edit
      setLinks((prev) => {
        const next = [...prev]
        if (next[i]) next[i] = link
        return next
      })
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const { data } = await api.put<HomePageConfig>('/home', {
        introMarkdown,
        customLinks: links.filter((l) => l.title.trim() && l.href.trim()),
        moduleOrder,
        modulesHiddenFromHome,
        showWelcomeLogo: Boolean(showWelcomeLogo),
        welcomeLogoMaxRem: clampWelcomeLogoMaxRem(welcomeLogoMaxRem),
      })
      onSaved(data)
      onClose()
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to save'
      showAlert(msg)
    } finally {
      setSaving(false)
    }
  }

  const editInitial =
    linkDialog === 'add'
      ? null
      : linkDialog && typeof linkDialog === 'object' && 'edit' in linkDialog
        ? links[linkDialog.edit] ?? null
        : null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-edit-title"
      >
        <div className="shrink-0 border-b border-border px-5 py-4">
          <h2 id="home-edit-title" className="text-lg font-semibold text-foreground">
            Edit home page
          </h2>
          <p className="mt-1 text-sm text-foreground/70">
            Edit the welcome content (Markdown), drag to reorder module cards and extra links, then save. Close
            with Cancel or Save (backdrop clicks do not dismiss).
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-background/40 px-3 py-2.5">
            <input
              type="checkbox"
              checked={showWelcomeLogo}
              onChange={(e) => setShowWelcomeLogo(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-primary"
            />
            <span>
              <span className="block text-sm font-medium text-foreground">Logo beside welcome</span>
              <span className="mt-0.5 block text-xs text-foreground/65">
                Shows <code className="rounded bg-background px-1">public/logo.png</code> to the left of the welcome
                text on medium+ screens (stacked on small screens).
              </span>
            </span>
          </label>

          {showWelcomeLogo ? (
            <div className="rounded-lg border border-border bg-background/40 px-3 py-2.5">
              <label className="mb-2 block text-sm font-medium text-foreground" htmlFor="logo-size">
                Logo size (max width)
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  id="logo-size"
                  type="range"
                  min={WELCOME_LOGO_MIN_REM}
                  max={WELCOME_LOGO_MAX_REM}
                  step="0.5"
                  value={welcomeLogoMaxRem}
                  onChange={(e) => setWelcomeLogoMaxRem(clampWelcomeLogoMaxRem(parseFloat(e.target.value)))}
                  className="h-2 min-w-[8rem] flex-1 cursor-pointer accent-primary"
                />
                <span className="tabular-nums text-sm text-foreground/80">{welcomeLogoMaxRem}rem</span>
              </div>
              <p className="mt-1 text-xs text-foreground/60">
                Between {WELCOME_LOGO_MIN_REM} and {WELCOME_LOGO_MAX_REM} rem. Applies on the home page only.
              </p>
            </div>
          ) : null}

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground" htmlFor="intro-md">
              Welcome content (Markdown)
            </label>
            <textarea
              id="intro-md"
              value={introMarkdown}
              onChange={(e) => setIntroMarkdown(e.target.value)}
              rows={10}
              placeholder={'Headings, **bold**, lists, and [links](/testing) are supported.'}
              className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
            />
            <p className="mt-1 text-xs text-foreground/60">
              Links starting with <code className="rounded bg-background px-1">/</code> stay in the app; http(s)
              URLs open in a new tab.
            </p>
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium text-foreground">Module cards</span>
            <p className="mb-2 text-xs text-foreground/65">
              Reorder cards for the home hub, or hide a module from home only (sidebar and bookmarks still work;
              permissions unchanged).
            </p>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleModuleDragEnd}>
              <SortableContext items={moduleOrder} strategy={verticalListSortingStrategy}>
                <ul className="space-y-2">
                  {moduleOrder.map((id) => {
                    const m = appModules.find((mod) => mod.id === id)
                    if (!m) return null
                    return (
                      <SortableModuleRow
                        key={id}
                        module={m}
                        hideFromHome={modulesHiddenFromHome.includes(id)}
                        onToggleHideFromHome={() =>
                          setModulesHiddenFromHome((prev) =>
                            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
                          )
                        }
                      />
                    )
                  })}
                </ul>
              </SortableContext>
            </DndContext>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">Extra links</span>
              <button
                type="button"
                onClick={() => setLinkDialog('add')}
                className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-background/80"
              >
                Add link
              </button>
            </div>

            {links.length === 0 ? (
              <p className="text-sm text-foreground/60">No extra links yet. Click &quot;Add link&quot;.</p>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={links.map((l) => l.id)} strategy={verticalListSortingStrategy}>
                  <ul className="space-y-2">
                    {links.map((link, i) => (
                      <SortableLinkRow
                        key={link.id}
                        link={link}
                        onEdit={() => setLinkDialog({ edit: i })}
                        onRemove={() => removeLink(i)}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-border bg-card px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-background"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {linkDialog != null && (
        <HomeCustomLinkEditModal
          initial={editInitial}
          onClose={() => setLinkDialog(null)}
          onSave={handleLinkSave}
        />
      )}
    </div>
  )
}
