import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchWikiPage,
  fetchWikiPages,
  fetchWikiRoleOptions,
  moveWikiPage,
  saveWikiPage,
  type WikiPageKind,
  type WikiPageListItem,
} from '@/api/wiki'
import { humanizePathForTitle } from '@/components/wiki/WikiBreadcrumbs'
import { WikiPageMetaModal, normalizeWikiPathSlugInput } from '@/components/wiki/WikiPageMetaModal'
import { WikiPathCreateModal, type WikiPathCreateKind } from '@/components/wiki/WikiPathCreateModal'
import { useAlertConfirm } from '@/contexts/AlertConfirmContext'
import {
  parseWikiPathSegment,
  validateWikiFullPath,
  wikiNestParentPathOptions,
} from '@/lib/wikiPaths'

type Baseline = {
  markdownNorm: string
  pathParent: string
  pathSlug: string
  rolesKey: string
  showSectionPages: boolean
}

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
  const title = line.replace(/^#+\s*/, '').trim().slice(0, 200)
  return title || undefined
}

function replaceFirstHeading(md: string, newTitle: string): string {
  const title = newTitle.trim() || 'Page'
  const lines = md.split(/\r?\n/)
  const idx = lines.findIndex((l) => l.trim().startsWith('#'))
  if (idx === -1) {
    return `# ${title}\n\n${md}`
  }
  const line = lines[idx]!
  const levelMatch = /^#+/.exec(line.trim())
  const level = levelMatch ? Math.min(levelMatch[0].length, 6) : 1
  const hashes = '#'.repeat(level)
  lines[idx] = `${hashes} ${title}`
  return lines.join('\n')
}

function rolesKeyFromSlugs(slugs: string[]): string {
  return [...new Set(slugs)].sort().join('\0')
}

function viewSlugsFromBaselineRolesKey(key: string): string[] {
  if (!key) return []
  return key.split('\0').filter(Boolean)
}

function mergeNestParentOptions(pages: WikiPageListItem[], currentParent: string): string[] {
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

export function WikiSidebarPageSettingsModal({
  pagePath,
  onClose,
  onSaved,
}: {
  pagePath: string | null
  onClose: () => void
  onSaved: (fromPath: string, toPath: string) => void
}) {
  const { showAlert } = useAlertConfirm()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [wikiPageList, setWikiPageList] = useState<WikiPageListItem[]>([])
  const [wikiPageKind, setWikiPageKind] = useState<WikiPageKind>('page')
  const [markdown, setMarkdown] = useState('')
  const [pathParent, setPathParent] = useState('')
  const [pathSlug, setPathSlug] = useState('')
  const [viewRoleSlugs, setViewRoleSlugs] = useState<string[]>([])
  const [showSectionPages, setShowSectionPages] = useState(true)
  const [roleOptions, setRoleOptions] = useState<{ slug: string; label: string }[]>([])
  const [pageDisplayName, setPageDisplayName] = useState('')
  const [baseline, setBaseline] = useState<Baseline | null>(null)
  const [pageExistsOnServer, setPageExistsOnServer] = useState(false)
  const [newSectionModalOpen, setNewSectionModalOpen] = useState(false)
  const slugTouchedRef = useRef(false)
  const loadGenRef = useRef(0)

  const resolvedPath = useMemo(() => composeWikiPath(pathParent, pathSlug), [pathParent, pathSlug])
  const nestParentOptions = useMemo(
    () => mergeNestParentOptions(wikiPageList, pathParent),
    [wikiPageList, pathParent]
  )

  useEffect(() => {
    void fetchWikiRoleOptions()
      .then(setRoleOptions)
      .catch(() => setRoleOptions([]))
  }, [])

  useEffect(() => {
    if (!pagePath) {
      setBaseline(null)
      setPageExistsOnServer(false)
      return
    }
    const gen = ++loadGenRef.current
    setLoading(true)
    setBaseline(null)
    setPageExistsOnServer(false)
    slugTouchedRef.current = true

    void (async () => {
      try {
        const [data, pages] = await Promise.all([
          fetchWikiPage(pagePath),
          fetchWikiPages(),
        ])
        if (gen !== loadGenRef.current) return
        setWikiPageList(Array.isArray(pages) ? pages : [])
        setMarkdown(data.markdown)
        setWikiPageKind(data.pageKind === 'section' ? 'section' : 'page')
        const split = splitWikiPath(data.path)
        setPathParent(split.parent)
        setPathSlug(split.slug)
        const heading = firstHeadingFromMarkdown(data.markdown)
        setPageDisplayName(heading ?? humanizePathForTitle(split.slug))
        setViewRoleSlugs(
          Array.isArray(data.viewRoleSlugs) && data.viewRoleSlugs.length > 0
            ? [...data.viewRoleSlugs]
            : []
        )
        const sp = data.pageKind === 'section' ? data.showSectionPages !== false : true
        setShowSectionPages(sp)
        setPageExistsOnServer(true)
        const titleForDoc = (heading ?? humanizePathForTitle(split.slug)).trim() || 'Page'
        const mdNorm = replaceFirstHeading(data.markdown, titleForDoc)
        const rk =
          Array.isArray(data.viewRoleSlugs) && data.viewRoleSlugs.length > 0
            ? rolesKeyFromSlugs(data.viewRoleSlugs)
            : ''
        setBaseline({
          markdownNorm: mdNorm,
          pathParent: split.parent,
          pathSlug: split.slug,
          rolesKey: rk,
          showSectionPages: sp,
        })
      } catch {
        if (gen !== loadGenRef.current) return
        showAlert('Could not load this page.')
        onClose()
      } finally {
        if (gen === loadGenRef.current) {
          setLoading(false)
        }
      }
    })()
  }, [pagePath, showAlert, onClose])

  const handleNewSectionConfirm = useCallback(
    async (
      path: string,
      kind: WikiPathCreateKind,
      meta: { displayTitle: string; createAndEdit: boolean }
    ) => {
      const heading = meta.displayTitle.trim() || path.split('/').pop() || path
      if (kind === 'section') {
        await saveWikiPage(path, `# ${heading}\n\n`, { asIndex: true })
      }
      const pages = await fetchWikiPages().catch(() => [] as WikiPageListItem[])
      setWikiPageList(Array.isArray(pages) ? pages : [])
      setPathParent(path)
      setNewSectionModalOpen(false)
    },
    []
  )

  const dismissWithoutSave = useCallback(() => {
    if (!baseline) {
      onClose()
      return
    }
    const h = firstHeadingFromMarkdown(baseline.markdownNorm)
    setPageDisplayName(h ?? humanizePathForTitle(baseline.pathSlug))
    setPathParent(baseline.pathParent)
    setPathSlug(baseline.pathSlug)
    setViewRoleSlugs(viewSlugsFromBaselineRolesKey(baseline.rolesKey))
    setShowSectionPages(baseline.showSectionPages)
    setMarkdown(baseline.markdownNorm)
    slugTouchedRef.current = true
    onClose()
  }, [baseline, onClose])

  const saveAndClose = useCallback(async () => {
    if (!pagePath || baseline === null) {
      onClose()
      return
    }
    const t = pageDisplayName.trim() || humanizePathForTitle(pathSlug)
    const mdToSave = replaceFirstHeading(markdown, t || 'Page')
    const rk = rolesKeyFromSlugs(viewRoleSlugs)
    const sectionListDirty =
      wikiPageKind === 'section' && showSectionPages !== baseline.showSectionPages
    if (
      mdToSave === baseline.markdownNorm &&
      pathParent === baseline.pathParent &&
      pathSlug === baseline.pathSlug &&
      rk === baseline.rolesKey &&
      !sectionListDirty
    ) {
      onClose()
      return
    }
    const newPath = composeWikiPath(pathParent, pathSlug)
    if (!newPath) {
      showAlert(
        'The wiki path is invalid. Use a valid slug and optional folder path (letters, digits, hyphens per segment).'
      )
      return
    }
    setSaving(true)
    try {
      if (pageExistsOnServer && newPath !== pagePath) {
        await moveWikiPage(pagePath, newPath)
      }
      const sortedRoles = [...new Set(viewRoleSlugs)].sort()
      const saveOpts: Parameters<typeof saveWikiPage>[2] = {
        viewRoleSlugs: sortedRoles.length > 0 ? sortedRoles : null,
      }
      if (wikiPageKind === 'section') {
        saveOpts.showSectionPages = showSectionPages
      }
      await saveWikiPage(newPath, mdToSave, saveOpts)
      onSaved(pagePath, newPath)
      onClose()
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to save'
      showAlert(msg)
    } finally {
      setSaving(false)
    }
  }, [
    pagePath,
    baseline,
    pageDisplayName,
    pathSlug,
    markdown,
    viewRoleSlugs,
    wikiPageKind,
    showSectionPages,
    pathParent,
    pageExistsOnServer,
    showAlert,
    onSaved,
    onClose,
  ])

  const toggleViewRole = (slug: string) => {
    setViewRoleSlugs((prev) => {
      if (prev.includes(slug)) return prev.filter((s) => s !== slug)
      return [...prev, slug]
    })
  }

  if (!pagePath) return null

  if (loading || baseline === null) {
    return (
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
        role="alert"
        aria-busy="true"
      >
        <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground">
          Loading page settings…
        </p>
      </div>
    )
  }

  return (
    <>
      <WikiPathCreateModal
        open={newSectionModalOpen}
        kind="section"
        parentPath={pathParent || undefined}
        onClose={() => setNewSectionModalOpen(false)}
        onConfirm={handleNewSectionConfirm}
      />
      <WikiPageMetaModal
        open
        onClose={() => void saveAndClose()}
        onCancel={dismissWithoutSave}
        onEscape={dismissWithoutSave}
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
        disabled={saving}
      />
    </>
  )
}
