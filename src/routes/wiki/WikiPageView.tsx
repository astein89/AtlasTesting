import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  fetchWikiPage,
  fetchWikiPages,
  fetchWikiSidebarOrder,
  saveWikiPage,
  type WikiPageKind,
  type WikiPageListItem,
} from '@/api/wiki'
import { humanizePathForTitle, WikiBreadcrumbs } from '@/components/wiki/WikiBreadcrumbs'
import { WikiDuplicatePageModal } from '@/components/wiki/WikiDuplicatePageModal'
import { WikiMarkdown } from '@/components/wiki/WikiMarkdown'
import { wikiEditUrl, wikiPageUrl } from '@/lib/appPaths'
import { parseWikiHeadings } from '@/lib/wikiHeadings'
import { buildWikiTree, findWikiTreeNode, sortedTreeChildren, type WikiTreeNode } from '@/lib/wikiTree'
import { wikiNestParentPathOptions } from '@/lib/wikiPaths'
import { useAuthStore } from '@/store/authStore'

interface WikiPageViewProps {
  pagePath: string
}

/** Nested list of child pages under a tree node (preserves sidebar order per level). */
function WikiSubtreeNav({
  parentNode,
  orderMap,
}: {
  parentNode: WikiTreeNode
  orderMap: Record<string, string[]>
}) {
  const kids = sortedTreeChildren(parentNode, orderMap[parentNode.path] ?? null)
  if (kids.length === 0) return null

  return (
    <ul className="space-y-2 text-sm">
      {kids.map((child) => {
        const label = child.title?.trim() || humanizePathForTitle(child.segment)
        const hasNested = child.children.size > 0
        return (
          <li key={child.path}>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <Link
                to={wikiPageUrl(child.path)}
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                {label}
              </Link>
              {hasNested && !child.page ? (
                <span className="text-xs text-foreground/45">(folder)</span>
              ) : null}
            </div>
            {hasNested ? (
              <div className="mt-2 ml-3 border-l border-border pl-3 sm:ml-4 sm:pl-4">
                <WikiSubtreeNav parentNode={child} orderMap={orderMap} />
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

export function WikiPageView({ pagePath }: WikiPageViewProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const canEdit = useAuthStore((s) => s.hasPermission('wiki.edit'))
  const [duplicateOpen, setDuplicateOpen] = useState(false)
  const [resolvedPagePath, setResolvedPagePath] = useState<string | null>(null)
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [viewRoleSlugs, setViewRoleSlugs] = useState<string[] | null>(null)
  const [pageTitleHint, setPageTitleHint] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [folderNav, setFolderNav] = useState<{
    root: WikiTreeNode
    order: Record<string, string[]>
  } | null>(null)
  const [sectionNav, setSectionNav] = useState<{
    root: WikiTreeNode
    order: Record<string, string[]>
  } | null>(null)
  const [wikiPageList, setWikiPageList] = useState<WikiPageListItem[]>([])
  const [wikiPageKind, setWikiPageKind] = useState<WikiPageKind>('page')
  const [showSectionPages, setShowSectionPages] = useState(true)
  const loadGenRef = useRef(0)

  const load = useCallback(async () => {
    const gen = ++loadGenRef.current

    if (!pagePath.trim()) {
      if (gen !== loadGenRef.current) return
      setError('Missing page path.')
      setLoading(false)
      setFolderNav(null)
      setSectionNav(null)
      setViewRoleSlugs(null)
      setPageTitleHint(null)
      setResolvedPagePath(null)
      setWikiPageList([])
      setWikiPageKind('page')
      setShowSectionPages(true)
      return
    }
    setLoading(true)
    setError(null)
    setFolderNav(null)
    setSectionNav(null)
    setViewRoleSlugs(null)
    setPageTitleHint(null)
    setResolvedPagePath(null)
    setShowSectionPages(true)

    const pagesP = fetchWikiPages()
    const orderP = fetchWikiSidebarOrder().catch(() => ({} as Record<string, string[]>))

    try {
      const data = await fetchWikiPage(pagePath)
      if (gen !== loadGenRef.current) return
      const [pages, order] = await Promise.all([pagesP, orderP])
      if (gen !== loadGenRef.current) return
      const tree = buildWikiTree(pages)
      const node = findWikiTreeNode(tree, pagePath)
      const hasKids = node ? sortedTreeChildren(node, order[node.path] ?? null).length > 0 : false
      setMarkdown(data.markdown)
      const hint = pages.find((p) => p.path === data.path)?.title?.trim() || null
      setPageTitleHint(hint)
      const vr = data.viewRoleSlugs
      setViewRoleSlugs(Array.isArray(vr) && vr.length > 0 ? [...vr] : null)
      setSectionNav(node && hasKids ? { root: node, order } : null)
      setResolvedPagePath(data.path)
      setWikiPageList(pages)
      setWikiPageKind(data.pageKind === 'section' ? 'section' : 'page')
      setShowSectionPages(data.pageKind === 'section' ? data.showSectionPages !== false : true)
    } catch (e: unknown) {
      if (gen !== loadGenRef.current) return
      const status = (e as { response?: { status?: number } })?.response?.status
      if (status === 404) {
        try {
          const [pages, order] = await Promise.all([pagesP, orderP])
          if (gen !== loadGenRef.current) return
          setWikiPageList(pages)
          const tree = buildWikiTree(pages)
          const node = findWikiTreeNode(tree, pagePath)
          const kids = node ? sortedTreeChildren(node, order[node.path] ?? null) : []
          if (kids.length > 0 && node) {
            setMarkdown(null)
            setError(null)
            setFolderNav({ root: node, order })
            setResolvedPagePath(null)
            setWikiPageKind('page')
            setShowSectionPages(true)
          } else {
            setError('This page does not exist yet.')
            setMarkdown('')
            setFolderNav(null)
            setResolvedPagePath(null)
            setWikiPageKind('page')
            setShowSectionPages(true)
          }
        } catch {
          if (gen !== loadGenRef.current) return
          setError('This page does not exist yet.')
          setMarkdown('')
          setFolderNav(null)
          setResolvedPagePath(null)
          setWikiPageList([])
          setWikiPageKind('page')
          setShowSectionPages(true)
        }
      } else if (status === 403) {
        const pages = await pagesP.catch(() => [] as WikiPageListItem[])
        if (gen !== loadGenRef.current) return
        setWikiPageList(Array.isArray(pages) ? pages : [])
        const msg =
          (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          'You do not have access to this page.'
        setError(msg)
        setMarkdown(null)
        setResolvedPagePath(null)
        setWikiPageKind('page')
        setShowSectionPages(true)
      } else {
        const pages = await pagesP.catch(() => [] as WikiPageListItem[])
        if (gen !== loadGenRef.current) return
        setWikiPageList(Array.isArray(pages) ? pages : [])
        setError('Could not load this page.')
        setMarkdown(null)
        setResolvedPagePath(null)
        setWikiPageKind('page')
        setShowSectionPages(true)
      }
    } finally {
      if (gen === loadGenRef.current) {
        setLoading(false)
      }
    }
  }, [pagePath])

  useEffect(() => {
    void load()
  }, [load])

  const headings = useMemo(() => (markdown ? parseWikiHeadings(markdown) : []), [markdown])

  useEffect(() => {
    if (!markdown?.trim() || !location.hash) return
    const id = decodeURIComponent(location.hash.slice(1))
    if (!id) return
    const frame = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: 'start' })
    })
    return () => cancelAnimationFrame(frame)
  }, [markdown, location.hash])

  const duplicateNestOptions = useMemo(() => wikiNestParentPathOptions(wikiPageList), [wikiPageList])

  const duplicateInitialTitle = useMemo(() => {
    if (!resolvedPagePath) return ''
    const base = pageTitleHint?.trim() || humanizePathForTitle(resolvedPagePath)
    return `${base} copy`
  }, [pageTitleHint, resolvedPagePath])

  const showArticleToolbar =
    !folderNav && !error && !loading && markdown !== null

  const handlePrint = useCallback(() => {
    window.print()
  }, [])

  const handleDuplicateConfirm = useCallback(
    async (newPath: string) => {
      if (markdown === null) {
        throw new Error('Page content is not loaded.')
      }
      const dupOpts: Parameters<typeof saveWikiPage>[2] = {
        viewRoleSlugs: viewRoleSlugs?.length ? viewRoleSlugs : null,
      }
      if (wikiPageKind === 'section') {
        dupOpts.showSectionPages = showSectionPages
      }
      await saveWikiPage(newPath, markdown, dupOpts)
      navigate(wikiPageUrl(newPath))
    },
    [markdown, navigate, viewRoleSlugs, wikiPageKind, showSectionPages]
  )

  return (
    <>
      <div className="wiki-print-skip mx-auto max-w-3xl text-foreground">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <WikiBreadcrumbs pagePath={pagePath} />
          </div>
          <div className="flex shrink-0 items-center gap-1">
          {showArticleToolbar ? (
            <button
              type="button"
              onClick={handlePrint}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-border bg-background text-foreground hover:bg-background/80"
              aria-label="Print document"
              title="Print document"
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
                  d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
                />
              </svg>
            </button>
          ) : null}
          {canEdit && showArticleToolbar ? (
            <>
              <button
                type="button"
                onClick={() => setDuplicateOpen(true)}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-border bg-background text-foreground hover:bg-background/80"
                aria-label="Duplicate page"
                title="Duplicate page"
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
                    d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"
                  />
                </svg>
              </button>
              <Link
                to={wikiEditUrl(pagePath)}
                className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg border border-border bg-background text-foreground hover:bg-background/80"
                aria-label="Edit page"
                title="Edit page"
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
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                  />
                </svg>
              </Link>
              <Link
                to={wikiEditUrl(pagePath)}
                state={{ wikiOpenMeta: true }}
                className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg border border-border bg-background text-foreground hover:bg-background/80"
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
              </Link>
            </>
          ) : null}
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-foreground/60">Loading…</p>
        ) : folderNav ? (
          <div className="rounded-lg border border-border bg-card p-4 text-sm">
          <p className="mb-3 text-foreground/80">
            This folder has no index page yet. Choose a subpage or create content here.
          </p>
          <WikiSubtreeNav parentNode={folderNav.root} orderMap={folderNav.order} />
          {canEdit ? (
            <p className="mt-4 border-t border-border pt-3">
              <Link to={wikiEditUrl(pagePath)} className="text-primary underline">
                Create index page at &ldquo;{pagePath}&rdquo;
              </Link>
            </p>
          ) : null}
          </div>
        ) : error ? (
          <div className="rounded-lg border border-border bg-card p-4 text-sm">
          <p className="text-destructive">{error}</p>
          {canEdit && error.includes('does not exist') ? (
            <p className="mt-2">
              <Link to={wikiEditUrl(pagePath)} className="text-primary underline">
                Create this page
              </Link>
            </p>
          ) : null}
          </div>
        ) : null}

        {resolvedPagePath ? (
          <WikiDuplicatePageModal
            open={duplicateOpen}
            sourcePagePath={resolvedPagePath}
            initialTitle={duplicateInitialTitle}
            nestParentOptions={duplicateNestOptions}
            onClose={() => setDuplicateOpen(false)}
            onConfirm={handleDuplicateConfirm}
          />
        ) : null}
      </div>

      {!loading && !folderNav && !error && markdown != null ? (
        <div className="mx-auto max-w-3xl text-foreground print:mx-0 print:max-w-none">
          <WikiMarkdown content={markdown} headings={headings} wikiPrintBody />
          {sectionNav && showSectionPages ? (
            <nav
              className="wiki-print-skip mt-8 border-t border-border pt-6"
              aria-label="Pages in this section"
            >
              <h2 className="mb-3 text-sm font-medium text-foreground/90">Pages in this section</h2>
              <WikiSubtreeNav parentNode={sectionNav.root} orderMap={sectionNav.order} />
            </nav>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
