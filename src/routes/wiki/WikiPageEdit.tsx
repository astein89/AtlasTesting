import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useBlocker, useLocation, useNavigate, type BlockerFunction } from 'react-router-dom'
import { isAbortLikeError } from '@/api/client'
import { useAbortableEffect } from '@/hooks/useAbortableEffect'
import {
  archiveWikiPage,
  fetchWikiPage,
  fetchWikiPages,
  fetchWikiRoleOptions,
  fetchWikiSlugSuggestion,
  moveWikiPage,
  saveWikiPage,
  WIKI_MAX_MARKDOWN_CHARS,
  type WikiPageKind,
  type WikiPageListItem,
} from '@/api/wiki'
import { humanizePathForTitle } from '@/components/wiki/WikiBreadcrumbs'
import { WikiMarkdownEditor } from '@/components/wiki/WikiMarkdownEditor'
import { WikiPageMetaModal, normalizeWikiPathSlugInput } from '@/components/wiki/WikiPageMetaModal'
import { WikiPathCreateModal, type WikiPathCreateKind } from '@/components/wiki/WikiPathCreateModal'
import { useAlertConfirm } from '@/contexts/AlertConfirmContext'
import { WIKI_PREFIX, wikiEditUrl, wikiPageUrl } from '@/lib/appPaths'
import { truncateMaxCodePoints } from '@/lib/unicodeTruncate'
import {
  parseWikiPathSegment,
  slugifyWikiTitleToSegment,
  validateWikiFullPath,
  wikiNestParentPathOptions,
} from '@/lib/wikiPaths'

interface WikiPageEditProps {
  pagePath: string
}

type WikiEditLocationState = { wikiNewTitle?: string }

function splitWikiPath(pagePathNorm: string): { parent: string; slug: string } {
  const t = pagePathNorm.replace(/^\/+|\/+$/g, '')
  if (!t) return { parent: '', slug: 'page' }
  const segs = t.split('/').filter(Boolean)
  const slug = segs[segs.length - 1] ?? 'page'
  const parent = segs.length > 1 ? segs.slice(0, -1).join('/') : ''
  return { parent, slug }
}

function composeWikiPath(pathParent: string, segmentInput: string): string | null {
  const p = pathParent.trim().replace(/^\/+|\/+$/g, '')
  const parentNorm = p === '' ? '' : validateWikiFullPath(p)
  if (p !== '' && parentNorm == null) return null
  const seg = parseWikiPathSegment(segmentInput)
  if (!seg) return null
  const full = parentNorm ? `${parentNorm}/${seg}` : seg
  return validateWikiFullPath(full)
}

function firstHeadingFromMarkdown(md: string): string | undefined {
  const line = md.split(/\r?\n/).find((l) => l.trim().startsWith('#'))
  if (!line) return undefined
  const title = truncateMaxCodePoints(line.replace(/^#+\s*/, '').trim(), 200)
  return title || undefined
}

type WikiEditBaseline = {
  markdownNorm: string
  /** Page name field snapshot (sidebar title); independent of markdown # heading. */
  displayTitle: string
  pathParent: string
  pathSlug: string
  rolesKey: string
  /** Meaningful for sections: list under section content on wiki view. */
  showSectionPages: boolean
}

function rolesKeyFromSlugs(slugs: string[]): string {
  return [...new Set(slugs)].sort().join('\0')
}

function viewSlugsFromBaselineRolesKey(key: string): string[] {
  if (!key) return []
  return key.split('\0').filter(Boolean)
}

function WikiLeaveUnsavedModal({
  open,
  saving,
  saveDisabled,
  onCancel,
  onLeave,
  onSave,
}: {
  open: boolean
  saving: boolean
  saveDisabled: boolean
  onCancel: () => void
  onLeave: () => void
  onSave: () => void
}) {
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="wiki-leave-title"
      aria-describedby="wiki-leave-desc"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border pl-4 pr-1">
          <h2
            id="wiki-leave-title"
            className="min-w-0 flex-1 py-3 pr-2 text-lg font-semibold leading-tight text-foreground"
          >
            Leave editor?
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-11 min-w-[44px] shrink-0 items-center justify-center rounded-lg text-foreground/70 hover:bg-background hover:text-foreground"
            aria-label="Cancel"
          >
            <span className="text-2xl leading-none" aria-hidden>
              ×
            </span>
          </button>
        </div>
        <p id="wiki-leave-desc" className="px-4 py-4 text-sm leading-relaxed text-foreground">
          You have unsaved changes. Leave discards them, Cancel keeps you in the editor, and Save
          writes your changes then continues.
        </p>
        <div className="flex shrink-0 flex-wrap justify-end gap-3 border-t border-border px-4 py-3">
          <button
            type="button"
            disabled={saving}
            onClick={onLeave}
            className="min-h-[44px] rounded-lg border border-destructive/60 px-4 py-2 text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            Leave
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onCancel}
            className="min-h-[44px] min-w-[100px] rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || saveDisabled}
            onClick={onSave}
            className="min-h-[44px] min-w-[100px] rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function mergeNestParentOptions(
  pages: WikiPageListItem[],
  currentParent: string
): string[] {
  const base = wikiNestParentPathOptions(pages)
  const p = currentParent.trim()
  const merged = p && !base.includes(p) ? [...base, p] : [...base]
  merged.sort((a, b) => {
    if (a === '') return -1
    if (b === '') return 1
    return a.localeCompare(b)
  })
  return merged
}

export function WikiPageEdit({ pagePath }: WikiPageEditProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { showAlert, showConfirm } = useAlertConfirm()
  const [markdown, setMarkdown] = useState('# New page\n\n')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState(false)
  /** True only after a successful GET — new (404) pages cannot be archived. */
  const [pageExistsOnServer, setPageExistsOnServer] = useState(false)
  const [pathParent, setPathParent] = useState('')
  const [pathSlug, setPathSlug] = useState('')
  const [viewRoleSlugs, setViewRoleSlugs] = useState<string[]>([])
  const [showSectionPages, setShowSectionPages] = useState(true)
  const [roleOptions, setRoleOptions] = useState<{ slug: string; label: string }[]>([])
  const [wikiPageList, setWikiPageList] = useState<WikiPageListItem[]>([])
  const [pageDisplayName, setPageDisplayName] = useState('')
  const [newSectionModalOpen, setNewSectionModalOpen] = useState(false)
  const slugTouchedRef = useRef(false)
  const importMdInputRef = useRef<HTMLInputElement>(null)
  /** When true, the next in-app navigation skips the unsaved-changes dialog (e.g. after archive). */
  const allowLeaveWithoutSaveRef = useRef(false)
  const loadGenRef = useRef(0)
  /** Bumps when `pagePath` changes or markdown is replaced from the server/import/meta cancel/save — resets wiki editor undo. */
  const [editorHistoryKey, setEditorHistoryKey] = useState(0)
  const [metaModalOpen, setMetaModalOpen] = useState(false)
  const [wikiPageKind, setWikiPageKind] = useState<WikiPageKind>('page')
  const [baseline, setBaseline] = useState<WikiEditBaseline | null>(null)

  const resolvedPath = useMemo(() => composeWikiPath(pathParent, pathSlug), [pathParent, pathSlug])
  const nestParentOptions = useMemo(
    () => mergeNestParentOptions(wikiPageList, pathParent),
    [wikiPageList, pathParent]
  )

  useEffect(() => {
    setEditorHistoryKey((k) => k + 1)
  }, [pagePath])

  const load = useCallback(async (signal?: AbortSignal) => {
    const gen = ++loadGenRef.current

    if (!pagePath.trim()) {
      if (gen !== loadGenRef.current) return
      setLoading(false)
      return
    }
    setLoading(true)
    setBaseline(null)
    setPageExistsOnServer(false)
    const state = location.state as WikiEditLocationState | null
    const fromNav =
      typeof state?.wikiNewTitle === 'string' ? state.wikiNewTitle.trim() : ''
    let pagesP: Promise<WikiPageListItem[]> | undefined
    pagesP = fetchWikiPages(signal)
    try {
      const data = await fetchWikiPage(pagePath, signal)
      if (gen !== loadGenRef.current) return
      const pages = await pagesP.catch(() => [] as WikiPageListItem[])
      setWikiPageList(Array.isArray(pages) ? pages : [])
      setMarkdown(data.markdown)
      setEditorHistoryKey((k) => k + 1)
      setWikiPageKind(data.pageKind === 'section' ? 'section' : 'page')
      const split = splitWikiPath(data.path)
      setPathParent(split.parent)
      setPathSlug(split.slug)
      const heading = firstHeadingFromMarkdown(data.markdown)
      const storedTitle = data.pageTitle?.trim()
      const resolvedDisplay = storedTitle || heading || humanizePathForTitle(split.slug)
      setPageDisplayName(resolvedDisplay)
      setViewRoleSlugs(
        Array.isArray(data.viewRoleSlugs) && data.viewRoleSlugs.length > 0
          ? [...data.viewRoleSlugs]
          : []
      )
      const sp = data.pageKind === 'section' ? data.showSectionPages !== false : true
      setShowSectionPages(sp)
      slugTouchedRef.current = true
      setPageExistsOnServer(true)
      {
        const rk =
          Array.isArray(data.viewRoleSlugs) && data.viewRoleSlugs.length > 0
            ? rolesKeyFromSlugs(data.viewRoleSlugs)
            : ''
        setBaseline({
          markdownNorm: data.markdown,
          displayTitle: resolvedDisplay,
          pathParent: split.parent,
          pathSlug: split.slug,
          rolesKey: rk,
          showSectionPages: sp,
        })
      }
    } catch (e: unknown) {
      if (gen !== loadGenRef.current) return
      if (isAbortLikeError(e)) return
      const status = (e as { response?: { status?: number } })?.response?.status
      if (status === 404) {
        const pages = await pagesP.catch(() => [] as WikiPageListItem[])
        setWikiPageList(Array.isArray(pages) ? pages : [])
        const split = splitWikiPath(pagePath)
        setPathParent(split.parent)
        setPathSlug(split.slug)
        setViewRoleSlugs([])
        setShowSectionPages(true)
        slugTouchedRef.current = false
        const fallback = pagePath.split('/').pop() ?? 'Page'
        const display = fromNav || humanizePathForTitle(fallback)
        setMarkdown(`# ${display}\n\n`)
        setEditorHistoryKey((k) => k + 1)
        setPageDisplayName(display)
        setWikiPageKind('page')
        setPageExistsOnServer(false)
        {
          const starterMd = `# ${display}\n\n`
          setBaseline({
            markdownNorm: starterMd,
            displayTitle: display,
            pathParent: split.parent,
            pathSlug: split.slug,
            rolesKey: '',
            showSectionPages: true,
          })
        }
      } else {
        const pages = await pagesP.catch(() => [] as WikiPageListItem[])
        setWikiPageList(Array.isArray(pages) ? pages : [])
        setWikiPageKind('page')
        const timedOut = (e as { code?: string })?.code === 'ECONNABORTED'
        void showAlert(timedOut ? 'Request timed out. Try again.' : 'Could not load page for editing.')
        slugTouchedRef.current = true
        setPageExistsOnServer(false)
      }
    } finally {
      if (gen !== loadGenRef.current) {
        void pagesP?.catch(() => {})
      }
      if (gen === loadGenRef.current) {
        setLoading(false)
      }
    }
  }, [pagePath, showAlert, location.state])

  useAbortableEffect((signal) => void load(signal).catch(() => {}), [load])

  useEffect(() => {
    allowLeaveWithoutSaveRef.current = false
  }, [pagePath])

  useEffect(() => {
    void fetchWikiRoleOptions()
      .then(setRoleOptions)
      .catch(() => setRoleOptions([]))
  }, [])

  useEffect(() => {
    if (loading || pageExistsOnServer || slugTouchedRef.current) return
    const title = pageDisplayName.trim()
    if (!title) return
    const ac = new AbortController()
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const { slug } = await fetchWikiSlugSuggestion(pathParent, title, ac.signal)
          if (!slugTouchedRef.current) setPathSlug(slug)
        } catch {
          if (ac.signal.aborted) return
          if (!slugTouchedRef.current) setPathSlug(slugifyWikiTitleToSegment(title))
        }
      })()
    }, 350)
    return () => {
      window.clearTimeout(timer)
      ac.abort()
    }
  }, [pageDisplayName, pathParent, loading, pageExistsOnServer])

  const isDirty = useMemo(() => {
    if (loading || baseline === null) return false
    const rk = rolesKeyFromSlugs(viewRoleSlugs)
    const sectionListDirty =
      wikiPageKind === 'section' && showSectionPages !== baseline.showSectionPages
    return (
      markdown !== baseline.markdownNorm ||
      pageDisplayName.trim() !== baseline.displayTitle.trim() ||
      pathParent !== baseline.pathParent ||
      pathSlug !== baseline.pathSlug ||
      rk !== baseline.rolesKey ||
      sectionListDirty
    )
  }, [
    loading,
    baseline,
    markdown,
    pageDisplayName,
    pathSlug,
    pathParent,
    viewRoleSlugs,
    wikiPageKind,
    showSectionPages,
  ])

  const blocker = useBlocker(
    useCallback<BlockerFunction>(
      ({ currentLocation, nextLocation }) => {
        if (allowLeaveWithoutSaveRef.current) return false
        if (!isDirty) return false
        return (
          currentLocation.pathname !== nextLocation.pathname ||
          currentLocation.search !== nextLocation.search ||
          currentLocation.hash !== nextLocation.hash
        )
      },
      [isDirty]
    )
  )

  useEffect(() => {
    if (!isDirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isDirty])

  const handleNewSectionConfirm = useCallback(
    async (
      path: string,
      kind: WikiPathCreateKind,
      meta: { displayTitle: string; createAndEdit: boolean }
    ) => {
      const heading = meta.displayTitle.trim() || path.split('/').pop() || path
      if (kind === 'section') {
        await saveWikiPage(path, `# ${heading}\n\n`, { asIndex: true, pageTitle: heading })
      }
      const pages = await fetchWikiPages().catch(() => [] as WikiPageListItem[])
      setWikiPageList(Array.isArray(pages) ? pages : [])
      setPathParent(path)
    },
    []
  )

  const saveWikiToServer = useCallback(
    async (markdownOverride?: string): Promise<{ newPath: string } | null> => {
      const newPath = composeWikiPath(pathParent, pathSlug)
      if (!newPath) {
        setMetaModalOpen(true)
        showAlert(
          'The wiki path is invalid. Use a valid slug and optional folder path (letters, digits, hyphens per segment).'
        )
        return null
      }
      const mdSource = markdownOverride ?? markdown
      try {
        if (pageExistsOnServer && newPath !== pagePath) {
          await moveWikiPage(pagePath, newPath)
        }
        const sortedRoles = [...new Set(viewRoleSlugs)].sort()
        const saveOpts: Parameters<typeof saveWikiPage>[2] = {
          viewRoleSlugs: sortedRoles.length > 0 ? sortedRoles : null,
          pageTitle: pageDisplayName.trim() || null,
        }
        if (wikiPageKind === 'section') {
          saveOpts.showSectionPages = showSectionPages
        }
        const saved = await saveWikiPage(newPath, mdSource, saveOpts)
        setMarkdown(mdSource)
        setEditorHistoryKey((k) => k + 1)
        const split = splitWikiPath(newPath)
        const spAfter =
          wikiPageKind === 'section' ? saved.showSectionPages !== false : true
        setShowSectionPages(spAfter)
        const displaySnap = pageDisplayName.trim()
        setBaseline({
          markdownNorm: mdSource,
          displayTitle: displaySnap,
          pathParent: split.parent,
          pathSlug: split.slug,
          rolesKey: rolesKeyFromSlugs(sortedRoles),
          showSectionPages: spAfter,
        })
        return { newPath }
      } catch (e: unknown) {
        const msg =
          (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to save'
        showAlert(msg)
        return null
      }
    },
  [
    pagePath,
    pathParent,
    pathSlug,
    markdown,
    pageDisplayName,
    viewRoleSlugs,
    wikiPageKind,
    showSectionPages,
    pageExistsOnServer,
    showAlert,
  ]
)

  const cancelMetaModal = useCallback(() => {
    if (!baseline) {
      setMetaModalOpen(false)
      return
    }
    setPageDisplayName(baseline.displayTitle)
    setPathParent(baseline.pathParent)
    setPathSlug(baseline.pathSlug)
    setViewRoleSlugs(viewSlugsFromBaselineRolesKey(baseline.rolesKey))
    setShowSectionPages(baseline.showSectionPages)
    setMarkdown(baseline.markdownNorm)
    setEditorHistoryKey((k) => k + 1)
    slugTouchedRef.current = true
    setMetaModalOpen(false)
  }, [baseline])

  const finishMetaModal = useCallback(async () => {
    if (loading || baseline === null) {
      setMetaModalOpen(false)
      return
    }
    const rk = rolesKeyFromSlugs(viewRoleSlugs)
    const sectionListDirty =
      wikiPageKind === 'section' && showSectionPages !== baseline.showSectionPages
    if (
      markdown === baseline.markdownNorm &&
      pageDisplayName.trim() === baseline.displayTitle.trim() &&
      pathParent === baseline.pathParent &&
      pathSlug === baseline.pathSlug &&
      rk === baseline.rolesKey &&
      !sectionListDirty
    ) {
      setMetaModalOpen(false)
      return
    }
    setSaving(true)
    try {
      const result = await saveWikiToServer()
      if (result) {
        setMetaModalOpen(false)
        if (result.newPath !== pagePath) {
          allowLeaveWithoutSaveRef.current = true
          navigate(wikiEditUrl(result.newPath), { replace: true })
        }
      }
    } finally {
      setSaving(false)
    }
  }, [
    loading,
    baseline,
    pageDisplayName,
    pathSlug,
    markdown,
    viewRoleSlugs,
    wikiPageKind,
    showSectionPages,
    pathParent,
    pagePath,
    saveWikiToServer,
    navigate,
  ])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const result = await saveWikiToServer()
      if (result) {
        allowLeaveWithoutSaveRef.current = true
        navigate(wikiPageUrl(result.newPath))
      }
    } finally {
      setSaving(false)
    }
  }, [saveWikiToServer, navigate])

  const handleBlockedCancel = useCallback(() => {
    if (blocker.state === 'blocked') blocker.reset()
  }, [blocker])

  const handleBlockedLeave = useCallback(() => {
    if (blocker.state === 'blocked') blocker.proceed()
  }, [blocker])

  const handleBlockedSave = useCallback(async () => {
    if (blocker.state !== 'blocked') return
    setSaving(true)
    try {
      const result = await saveWikiToServer()
      if (result) {
        allowLeaveWithoutSaveRef.current = true
        blocker.proceed()
      }
    } finally {
      setSaving(false)
    }
  }, [blocker, saveWikiToServer])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.key !== 's' && e.key !== 'S')) return
      if (e.altKey) return
      if (e.isComposing) return
      const saveDisabled = saving || loading || archiving || resolvedPath == null
      e.preventDefault()
      if (saveDisabled) return
      if (blocker.state === 'blocked') void handleBlockedSave()
      else void handleSave()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [
    archiving,
    blocker.state,
    handleBlockedSave,
    handleSave,
    loading,
    resolvedPath,
    saving,
  ])

  const handleArchive = async () => {
    const ok = await showConfirm(
      'This removes the page from the wiki and moves the file to the _deleted folder on the server. You can restore it manually from there if needed.',
      {
        title: 'Remove page from wiki?',
        confirmLabel: 'Move to deleted',
        variant: 'danger',
      }
    )
    if (!ok) return
    setArchiving(true)
    try {
      await archiveWikiPage(pagePath)
      allowLeaveWithoutSaveRef.current = true
      navigate(WIKI_PREFIX)
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Could not move page to deleted folder'
      showAlert(msg)
    } finally {
      setArchiving(false)
    }
  }

  const toggleViewRole = (slug: string) => {
    setViewRoleSlugs((prev) => {
      if (prev.includes(slug)) return prev.filter((s) => s !== slug)
      return [...prev, slug]
    })
  }

  if (!pagePath.trim()) {
    return <p className="text-sm text-destructive">Invalid path.</p>
  }

  const cancelHref = wikiPageUrl(resolvedPath ?? pagePath)

  return (
    <div className="mx-auto max-w-7xl px-1 text-foreground md:px-0">
      <WikiLeaveUnsavedModal
        open={blocker.state === 'blocked'}
        saving={saving}
        saveDisabled={resolvedPath == null}
        onCancel={handleBlockedCancel}
        onLeave={handleBlockedLeave}
        onSave={() => void handleBlockedSave()}
      />
      <WikiPathCreateModal
        open={newSectionModalOpen}
        kind="section"
        parentPath={pathParent || undefined}
        onClose={() => setNewSectionModalOpen(false)}
        onConfirm={handleNewSectionConfirm}
      />
      <WikiPageMetaModal
        open={metaModalOpen}
        onClose={() => void finishMetaModal()}
        onCancel={cancelMetaModal}
        onEscape={cancelMetaModal}
        wikiPageKind={wikiPageKind}
        pageDisplayName={pageDisplayName}
        onPageDisplayNameChange={setPageDisplayName}
        nestParentOptions={nestParentOptions}
        onRequestNewSection={() => setNewSectionModalOpen(true)}
        pathParent={pathParent}
        onPathParentChange={setPathParent}
        pathSlug={pathSlug}
        onPathSlugChange={(v) => {
          slugTouchedRef.current = true
          setPathSlug(v)
        }}
        onPathSlugBlur={() => setPathSlug((prev) => normalizeWikiPathSlugInput(prev))}
        pathValid={resolvedPath != null}
        resolvedPathPreview={resolvedPath}
        roleOptions={roleOptions}
        viewRoleSlugs={viewRoleSlugs}
        onToggleRole={toggleViewRole}
        showSectionPages={showSectionPages}
        onShowSectionPagesChange={setShowSectionPages}
        disabled={saving || archiving}
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="min-w-0 flex-1 text-lg font-semibold">
          {wikiPageKind === 'section' ? 'Edit section' : 'Edit page'} —{' '}
          <span className="font-mono">{resolvedPath ?? pagePath}</span>
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {pageExistsOnServer ? (
            <button
              type="button"
              disabled={saving || loading || archiving}
              onClick={() => void handleArchive()}
              className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg border border-destructive/60 bg-background text-destructive hover:bg-destructive/15 disabled:opacity-50"
              aria-busy={archiving}
              aria-label={archiving ? 'Removing from wiki' : 'Remove from wiki'}
              title={archiving ? 'Removing…' : 'Remove from wiki'}
            >
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </button>
          ) : null}
          {!loading ? (
            <button
              type="button"
              onClick={() => setMetaModalOpen(true)}
              className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-border bg-background text-foreground hover:bg-background/80 ${
                resolvedPath == null ? 'ring-2 ring-destructive/55' : ''
              }`}
              aria-label={wikiPageKind === 'section' ? 'Section settings' : 'Page settings'}
              title={wikiPageKind === 'section' ? 'Section settings' : 'Page settings'}
            >
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </button>
          ) : null}
          <input
            ref={importMdInputRef}
            type="file"
            accept=".md,.markdown,text/markdown"
            className="sr-only"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              if (!/\.(md|markdown)$/i.test(f.name)) {
                void showAlert('Choose a .md or .markdown file.')
                return
              }
              const reader = new FileReader()
              reader.onload = () => {
                const text = typeof reader.result === 'string' ? reader.result : ''
                if (text.length > WIKI_MAX_MARKDOWN_CHARS) {
                  void showAlert(
                    `File is too large (max ${WIKI_MAX_MARKDOWN_CHARS.toLocaleString()} characters).`
                  )
                  return
                }
                setMarkdown(text)
                setEditorHistoryKey((k) => k + 1)
              }
              reader.onerror = () => {
                void showAlert('Could not read that file.')
              }
              reader.readAsText(f, 'UTF-8')
            }}
          />
          <button
            type="button"
            disabled={saving || loading || archiving}
            onClick={() => importMdInputRef.current?.click()}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-border bg-background text-foreground hover:bg-background/80 disabled:opacity-50"
            aria-label="Import markdown file"
            title="Import markdown file — replaces editor content"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16"
              />
            </svg>
          </button>
          <button
            type="button"
            disabled={archiving}
            onClick={() => navigate(cancelHref)}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-background disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || loading || archiving || resolvedPath == null}
            onClick={() => void handleSave()}
            title="Save (Ctrl+S or ⌘S)"
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-foreground/60">Loading…</p>
      ) : (
        <WikiMarkdownEditor
          value={markdown}
          onChange={setMarkdown}
          disabled={saving || archiving}
          historyResetKey={`${pagePath}:${editorHistoryKey}`}
        />
      )}
    </div>
  )
}
