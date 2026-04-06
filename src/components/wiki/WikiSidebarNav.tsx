import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  archiveWikiPage,
  fetchWikiPages,
  fetchWikiSidebarOrder,
  saveWikiPage,
  type WikiPageListItem,
} from '@/api/wiki'
import { useAlertConfirm } from '@/contexts/AlertConfirmContext'
import { wikiEditUrl, wikiPageUrl, wikiPath } from '@/lib/appPaths'
import { buildWikiTree, findWikiTreeNode, sortedTreeChildren, type WikiTreeNode } from '@/lib/wikiTree'
import { useAuthStore } from '@/store/authStore'
import { WikiMovePageModal } from './WikiMovePageModal'
import { WikiPathCreateModal, type WikiPathCreateKind } from './WikiPathCreateModal'
import { WikiSidebarPageMenu } from './WikiSidebarPageMenu'
import { WikiSidebarPageSettingsModal } from './WikiSidebarPageSettingsModal'
import { WikiSortModal } from './WikiSortModal'

/** All folder paths under `node` that have children (for expand-all). */
function collectFolderPathsWithChildren(node: WikiTreeNode): string[] {
  const paths: string[] = []
  for (const child of sortedTreeChildren(node)) {
    if (child.children.size > 0) {
      paths.push(child.path)
      paths.push(...collectFolderPathsWithChildren(child))
    }
  }
  return paths
}

/** Double chevron down — expand all */
function ExpandAllIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-4 w-4"
    >
      <polyline points="7 7 12 12 17 7" />
      <polyline points="7 13 12 18 17 13" />
    </svg>
  )
}

/** Double chevron up — collapse all */
function CollapseAllIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-4 w-4"
    >
      <polyline points="7 11 12 6 17 11" />
      <polyline points="7 17 12 12 17 17" />
    </svg>
  )
}

function SectionIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden>
      <path d="M12 10v8M8 14h8M5 4h14a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 18v3M17 20h4" strokeLinecap="round" />
    </svg>
  )
}

function PageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 2v6h6M12 18v-6M9 15h6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SortIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden>
      <path d="M3 6h13M9 12h10M7 18h12" strokeLinecap="round" />
      <path d="M17 8l2-2 2 2M19 16v-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SidebarTabExplorerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0 opacity-90"
      aria-hidden
    >
      <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  )
}

function SidebarTabSearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0 opacity-90"
      aria-hidden
    >
      <path d="m21 21-4.34-4.34M19 11a8 8 0 11-16 0 8 8 0 0116 0z" />
    </svg>
  )
}

function WikiExplorerToolbar({
  className,
  onExpandAll,
  onCollapseAll,
  showExpandCollapse,
  trailing,
}: {
  className?: string
  onExpandAll: () => void
  onCollapseAll: () => void
  showExpandCollapse: boolean
  trailing?: ReactNode
}) {
  return (
    <div
      className={`flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1 border-b border-border/60 pb-1.5 dark:border-border/80 ${
        showExpandCollapse && trailing ? 'justify-between' : 'justify-start'
      } ${className ?? ''}`}
      role="toolbar"
      aria-label="Wiki explorer"
    >
      {showExpandCollapse ? (
        <div className="flex justify-start gap-0.5">
          <button
            type="button"
            onClick={onExpandAll}
            aria-label="Expand all folders"
            title="Expand all folders"
            className="rounded-md p-1.5 text-foreground/45 transition-colors hover:bg-foreground/[0.045] hover:text-foreground/80 dark:hover:bg-foreground/[0.07]"
          >
            <ExpandAllIcon />
          </button>
          <button
            type="button"
            onClick={onCollapseAll}
            aria-label="Collapse all folders"
            title="Collapse all folders"
            className="rounded-md p-1.5 text-foreground/45 transition-colors hover:bg-foreground/[0.045] hover:text-foreground/80 dark:hover:bg-foreground/[0.07]"
          >
            <CollapseAllIcon />
          </button>
        </div>
      ) : null}
      {trailing ? <div className="flex flex-wrap items-center gap-0.5">{trailing}</div> : null}
    </div>
  )
}

function parentFolderForSort(pagePath: string | null): string {
  if (!pagePath) return ''
  const segs = pagePath.split('/').filter(Boolean)
  if (segs.length <= 1) return ''
  return segs.slice(0, -1).join('/')
}

/** LeafWiki-style chevron: closed → right, open → down */
function TreeChevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`h-4 w-4 shrink-0 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

const treeRowInactive = 'text-foreground/80 hover:bg-foreground/[0.045] dark:hover:bg-foreground/[0.07]'
const treeRowActive = 'font-medium text-primary'

type SidebarTab = 'explorer' | 'search'

/** Dialog target: top-level section/page, or nested under a tree path. */
type WikiNewPathTarget = null | { kind: WikiPathCreateKind; under?: string }

function pathAfterWikiMove(current: string | null, from: string, to: string): string | null {
  if (!current) return null
  if (current === from) return to
  if (current.startsWith(`${from}/`)) return to + current.slice(from.length)
  return null
}

interface WikiSidebarNavProps {
  onNavigate?: () => void
}

function ancestorPathsOfPage(pagePath: string): Set<string> {
  const segs = pagePath.split('/').filter(Boolean)
  const paths = new Set<string>()
  for (let i = 0; i < segs.length - 1; i++) {
    paths.add(segs.slice(0, i + 1).join('/'))
  }
  return paths
}

function autoExpandKeysForPath(root: WikiTreeNode, pagePath: string): Set<string> {
  const segs = pagePath.split('/').filter(Boolean)
  const next = new Set<string>()
  for (let i = 0; i < segs.length - 1; i++) {
    next.add(segs.slice(0, i + 1).join('/'))
  }
  const node = findWikiTreeNode(root, pagePath)
  if (node && node.children.size > 0) {
    next.add(pagePath)
  }
  return next
}

function WikiTreeBranch({
  parent,
  expanded,
  toggleExpanded,
  onNavigate,
  sidebarOrder,
  canEdit,
  onNewPageUnder,
  onAddSectionUnder,
  onEditPage,
  onPageSettings,
  onMovePage,
  onDeletePage,
}: {
  parent: WikiTreeNode
  expanded: Set<string>
  toggleExpanded: (folderPath: string) => void
  onNavigate?: () => void
  sidebarOrder: Record<string, string[]>
  canEdit: boolean
  onNewPageUnder: (parentPath: string) => void
  onAddSectionUnder: (parentPath: string) => void
  onEditPage: (path: string) => void
  onPageSettings: (path: string) => void
  onMovePage: (path: string) => void
  onDeletePage: (path: string) => void
}) {
  const rows = sortedTreeChildren(parent, sidebarOrder[parent.path] ?? null)

  return (
    <ul className="flex min-w-0 flex-col">
      {rows.map((child) => {
        const hasKids = child.children.size > 0
        const isOpen = expanded.has(child.path)
        const titleTrim = child.title?.trim()
        const homeOrGuide =
          child.path === 'index' ? 'Home' : child.path === 'guides' ? 'Wiki Guide' : ''
        const label = titleTrim || homeOrGuide || child.segment

        return (
          <li key={child.path} className="min-w-0">
            <div className="flex min-w-0 items-stretch">
              {hasKids ? (
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-label={isOpen ? 'Collapse folder' : 'Expand folder'}
                  onClick={() => toggleExpanded(child.path)}
                  className="flex h-8 w-6 shrink-0 items-center justify-center text-foreground/45 transition-colors hover:text-foreground/70"
                >
                  <TreeChevron open={isOpen} />
                </button>
              ) : (
                <span className="w-6 shrink-0" aria-hidden />
              )}
              <div className="group/wiki-row flex min-w-0 flex-1 items-stretch">
                <NavLink
                  to={wikiPageUrl(child.path)}
                  end
                  onClick={onNavigate}
                  title={child.title ? `${child.path} — ${child.title}` : child.path}
                  className={({ isActive }) =>
                    `relative flex min-h-8 min-w-0 flex-1 items-center overflow-hidden py-0.5 pl-0 pr-0.5 text-sm transition-colors ${
                      isActive ? treeRowActive : treeRowInactive
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive ? (
                        <span
                          className="absolute bottom-0.5 left-0 top-0.5 w-0.5 rounded-full bg-primary/55"
                          aria-hidden
                        />
                      ) : null}
                      <span className="min-w-0 flex-1 truncate pl-1.5">{label}</span>
                    </>
                  )}
                </NavLink>
                {canEdit ? (
                  <WikiSidebarPageMenu
                    pagePath={child.path}
                    onAddPage={() => onNewPageUnder(child.path)}
                    onAddSection={() => onAddSectionUnder(child.path)}
                    onEdit={() => onEditPage(child.path)}
                    onSettings={() => onPageSettings(child.path)}
                    onMove={() => onMovePage(child.path)}
                    onDelete={() => onDeletePage(child.path)}
                  />
                ) : null}
              </div>
            </div>
            {hasKids && isOpen ? (
              <div className="ml-3 min-w-0 border-l border-border/70 pl-2.5 dark:border-border/80">
                <WikiTreeBranch
                  parent={child}
                  expanded={expanded}
                  toggleExpanded={toggleExpanded}
                  onNavigate={onNavigate}
                  sidebarOrder={sidebarOrder}
                  canEdit={canEdit}
                  onNewPageUnder={onNewPageUnder}
                  onAddSectionUnder={onAddSectionUnder}
                  onEditPage={onEditPage}
                  onPageSettings={onPageSettings}
                  onMovePage={onMovePage}
                  onDeletePage={onDeletePage}
                />
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

const tabStripBtn =
  'flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card'

export function WikiSidebarNav({ onNavigate }: WikiSidebarNavProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { showAlert, showConfirm } = useAlertConfirm()
  const canEdit = useAuthStore((s) => s.hasPermission('wiki.edit'))
  const searchInputRef = useRef<HTMLInputElement>(null)
  const sidebarLoadGenRef = useRef(0)
  const [pages, setPages] = useState<WikiPageListItem[]>([])
  const [sidebarOrder, setSidebarOrder] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(true)
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('explorer')
  const [filterQuery, setFilterQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [sortModalOpen, setSortModalOpen] = useState(false)
  const [newPathModal, setNewPathModal] = useState<WikiNewPathTarget>(null)
  const [moveFromPath, setMoveFromPath] = useState<string | null>(null)
  const [pageSettingsPath, setPageSettingsPath] = useState<string | null>(null)

  const normalizedFilter = filterQuery.trim().toLowerCase()
  const hasSearchQuery = normalizedFilter.length > 0

  const filteredPagesForSearch = useMemo(() => {
    if (!hasSearchQuery) return [] as WikiPageListItem[]
    return pages.filter(
      (p) =>
        p.path.toLowerCase().includes(normalizedFilter) ||
        (p.title != null && p.title.toLowerCase().includes(normalizedFilter))
    )
  }, [pages, normalizedFilter, hasSearchQuery])

  const explorerTree = useMemo(() => buildWikiTree(pages), [pages])
  const searchTree = useMemo(() => buildWikiTree(filteredPagesForSearch), [filteredPagesForSearch])

  const displayTree = sidebarTab === 'explorer' ? explorerTree : searchTree

  const expandableFolderPaths = useMemo(
    () => collectFolderPathsWithChildren(displayTree),
    [displayTree]
  )
  const showExpandCollapse =
    !loading &&
    pages.length > 0 &&
    expandableFolderPaths.length > 0 &&
    (sidebarTab === 'explorer' ||
      (sidebarTab === 'search' && hasSearchQuery && filteredPagesForSearch.length > 0))

  const showEditToolbar =
    canEdit && !loading && pages.length > 0 && sidebarTab === 'explorer'

  const showExplorerToolbar = showExpandCollapse || showEditToolbar

  const expandAllFolders = useCallback(() => {
    setExpanded(new Set(expandableFolderPaths))
  }, [expandableFolderPaths])

  const collapseAllFolders = useCallback(() => {
    setExpanded(new Set())
  }, [])

  const load = useCallback(async () => {
    const gen = ++sidebarLoadGenRef.current
    setLoading(true)
    try {
      const [list, order] = await Promise.all([
        fetchWikiPages(),
        fetchWikiSidebarOrder().catch(() => ({} as Record<string, string[]>)),
      ])
      if (gen !== sidebarLoadGenRef.current) return
      setPages(list)
      setSidebarOrder(order && typeof order === 'object' ? order : {})
    } catch {
      if (gen !== sidebarLoadGenRef.current) return
      setPages([])
      setSidebarOrder({})
    } finally {
      if (gen === sidebarLoadGenRef.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, location.pathname])

  const currentPagePath = useMemo(() => {
    const p = location.pathname
    if (!p.startsWith('/wiki')) return null
    const rest = p.slice('/wiki'.length).replace(/^\/+|\/+$/g, '')
    if (!rest) return null
    if (rest.endsWith('/edit')) {
      return rest.slice(0, -5).replace(/\/$/, '') || null
    }
    return rest
  }, [location.pathname])

  const switchToSearch = useCallback(() => {
    setSidebarTab('search')
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
  }, [])

  useEffect(() => {
    const focus = () => {
      switchToSearch()
    }
    window.addEventListener('wiki-sidebar-search-focus', focus)
    return () => window.removeEventListener('wiki-sidebar-search-focus', focus)
  }, [switchToSearch])

  useEffect(() => {
    if (sidebarTab === 'search' && hasSearchQuery) {
      const paths = new Set<string>()
      for (const p of filteredPagesForSearch) {
        for (const a of ancestorPathsOfPage(p.path)) {
          paths.add(a)
        }
      }
      setExpanded(paths)
      return
    }

    if (sidebarTab === 'search' && !hasSearchQuery) {
      setExpanded(new Set())
      return
    }

    if (!currentPagePath) {
      setExpanded(new Set())
      return
    }
    const n = new Set<string>()
    for (const p of autoExpandKeysForPath(explorerTree, currentPagePath)) {
      n.add(p)
    }
    setExpanded(n)
  }, [sidebarTab, hasSearchQuery, filteredPagesForSearch, currentPagePath, explorerTree])

  const toggleExpanded = useCallback((folderPath: string) => {
    setExpanded((prev) => {
      const n = new Set(prev)
      if (n.has(folderPath)) n.delete(folderPath)
      else n.add(folderPath)
      return n
    })
  }, [])

  const handlePathCreateConfirm = useCallback(
    async (
      path: string,
      kind: WikiPathCreateKind,
      meta: { displayTitle: string; createAndEdit: boolean }
    ) => {
      const heading = meta.displayTitle.trim() || path.split('/').pop() || path
      if (kind === 'section') {
        await saveWikiPage(path, `# ${heading}\n\n`, { asIndex: true })
      } else {
        await saveWikiPage(path, `# ${heading}\n\n`)
      }
      await load()
      navigate(meta.createAndEdit ? wikiEditUrl(path) : wikiPageUrl(path))
      onNavigate?.()
    },
    [load, navigate, onNavigate]
  )

  const openNewPageUnder = useCallback((parentPath: string) => {
    setNewPathModal({ kind: 'page', under: parentPath })
  }, [])

  const openNewSectionUnder = useCallback((parentPath: string) => {
    setNewPathModal({ kind: 'section', under: parentPath })
  }, [])

  const openEditPage = useCallback(
    (path: string) => {
      navigate(wikiEditUrl(path))
      onNavigate?.()
    },
    [navigate, onNavigate]
  )

  const closePageSettings = useCallback(() => setPageSettingsPath(null), [])

  const openPageSettings = useCallback((path: string) => {
    setPageSettingsPath(path)
  }, [])

  const handlePageSettingsSaved = useCallback(
    (fromPath: string, toPath: string) => {
      void load()
      if (currentPagePath === fromPath && toPath !== fromPath) {
        navigate(wikiPageUrl(toPath))
      }
    },
    [load, currentPagePath, navigate]
  )

  const handleDeletePage = useCallback(
    async (path: string) => {
      const ok = await showConfirm(
        'This removes the page from the wiki and moves its file (or section folder) to the _deleted folder on the server.',
        {
          title: 'Remove page from wiki?',
          confirmLabel: 'Move to deleted',
          variant: 'danger',
        }
      )
      if (!ok) return
      try {
        await archiveWikiPage(path)
        await load()
        if (currentPagePath === path || (currentPagePath?.startsWith(`${path}/`) ?? false)) {
          navigate(wikiPath())
        }
      } catch (e: unknown) {
        const msg =
          (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          'Could not remove page'
        showAlert(msg)
      }
    },
    [showAlert, showConfirm, load, currentPagePath, navigate]
  )

  const handleMoveComplete = useCallback(
    async (from: string, to: string) => {
      await load()
      const next = pathAfterWikiMove(currentPagePath, from, to)
      if (next != null) navigate(wikiPageUrl(next))
    },
    [load, currentPagePath, navigate]
  )

  const editToolbarButtons = showEditToolbar ? (
    <>
      <button
        type="button"
        onClick={() => setNewPathModal({ kind: 'section' })}
        aria-label="New section"
        title="New section (folder with index page)"
        className="rounded-md p-1.5 text-foreground/45 transition-colors hover:bg-foreground/[0.045] hover:text-foreground/80 dark:hover:bg-foreground/[0.07]"
      >
        <SectionIcon />
      </button>
      <button
        type="button"
        onClick={() => setNewPathModal({ kind: 'page' })}
        aria-label="New page"
        title="New page"
        className="rounded-md p-1.5 text-foreground/45 transition-colors hover:bg-foreground/[0.045] hover:text-foreground/80 dark:hover:bg-foreground/[0.07]"
      >
        <PageIcon />
      </button>
      <button
        type="button"
        onClick={() => setSortModalOpen(true)}
        aria-label="Sort pages"
        title="Sort pages under a parent"
        className="rounded-md p-1.5 text-foreground/45 transition-colors hover:bg-foreground/[0.045] hover:text-foreground/80 dark:hover:bg-foreground/[0.07]"
      >
        <SortIcon />
      </button>
    </>
  ) : null

  const renderTree = () => {
    if (loading) {
      return <p className="px-2 py-1 text-xs text-foreground/50">Loading pages…</p>
    }
    if (pages.length === 0) {
      return <p className="px-2 py-1 text-xs text-foreground/60">No pages yet</p>
    }
    if (sidebarTab === 'search') {
      if (!hasSearchQuery) {
        return (
          <p className="px-2 py-2 text-xs text-foreground/55">
            Type above to filter pages by path or title.
          </p>
        )
      }
      if (filteredPagesForSearch.length === 0) {
        return <p className="px-2 py-1 text-xs text-foreground/60">No matching pages.</p>
      }
    }
    if (sortedTreeChildren(displayTree, sidebarOrder[displayTree.path] ?? null).length === 0) {
      return <p className="px-2 py-1 text-xs text-foreground/60">No pages yet</p>
    }
    return (
      <WikiTreeBranch
        parent={displayTree}
        expanded={expanded}
        toggleExpanded={toggleExpanded}
        onNavigate={onNavigate}
        sidebarOrder={sidebarOrder}
        canEdit={canEdit}
        onNewPageUnder={openNewPageUnder}
        onAddSectionUnder={openNewSectionUnder}
        onEditPage={openEditPage}
        onPageSettings={openPageSettings}
        onMovePage={(path) => setMoveFromPath(path)}
        onDeletePage={handleDeletePage}
      />
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-col overflow-x-hidden">
      <WikiSidebarPageSettingsModal
        pagePath={pageSettingsPath}
        onClose={closePageSettings}
        onSaved={handlePageSettingsSaved}
      />
      <WikiPathCreateModal
        open={newPathModal !== null}
        kind={newPathModal?.kind ?? 'page'}
        parentPath={newPathModal?.under}
        onClose={() => setNewPathModal(null)}
        onConfirm={handlePathCreateConfirm}
      />
      <WikiMovePageModal
        open={moveFromPath !== null}
        fromPath={moveFromPath ?? ''}
        onClose={() => setMoveFromPath(null)}
        onMoved={(to) => {
          const from = moveFromPath ?? ''
          setMoveFromPath(null)
          void handleMoveComplete(from, to)
        }}
      />
      <WikiSortModal
        open={sortModalOpen}
        explorerTree={explorerTree}
        orderMap={sidebarOrder}
        initialParentPath={parentFolderForSort(currentPagePath)}
        onClose={() => setSortModalOpen(false)}
        onSaved={() => void load()}
      />
      <div
        className="-mx-1 flex min-w-0 border-b border-border"
        role="tablist"
        aria-label="Wiki sidebar"
      >
        <button
          type="button"
          role="tab"
          aria-selected={sidebarTab === 'explorer'}
          id="wiki-tab-explorer"
          aria-controls="wiki-panel-explorer"
          onClick={() => {
            setSidebarTab('explorer')
            setFilterQuery('')
          }}
          className={`${tabStripBtn} -mb-px ${
            sidebarTab === 'explorer'
              ? 'border-primary text-primary'
              : 'border-transparent text-foreground/50 hover:text-foreground/80'
          }`}
        >
          <SidebarTabExplorerIcon />
          Explorer
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={sidebarTab === 'search'}
          id="wiki-tab-search"
          aria-controls="wiki-panel-search"
          onClick={() => {
            setSidebarTab('search')
            window.requestAnimationFrame(() => searchInputRef.current?.focus())
          }}
          className={`${tabStripBtn} -mb-px ${
            sidebarTab === 'search'
              ? 'border-primary text-primary'
              : 'border-transparent text-foreground/50 hover:text-foreground/80'
          }`}
        >
          <SidebarTabSearchIcon />
          Search
        </button>
      </div>

      {sidebarTab === 'explorer' ? (
        <div
          id="wiki-panel-explorer"
          role="tabpanel"
          aria-labelledby="wiki-tab-explorer"
          className="mt-2 flex min-w-0 flex-col"
        >
          {showExplorerToolbar ? (
            <WikiExplorerToolbar
              className="mb-1"
              onExpandAll={expandAllFolders}
              onCollapseAll={collapseAllFolders}
              showExpandCollapse={showExpandCollapse}
              trailing={editToolbarButtons}
            />
          ) : null}
          {renderTree()}
        </div>
      ) : (
        <div
          id="wiki-panel-search"
          role="tabpanel"
          aria-labelledby="wiki-tab-search"
          className="mt-2 flex min-w-0 flex-col gap-2"
        >
          <div>
            <label htmlFor="wiki-sidebar-search" className="sr-only">
              Search wiki pages
            </label>
            <input
              ref={searchInputRef}
              id="wiki-sidebar-search"
              type="search"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Filter by path or title…"
              autoComplete="off"
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-foreground/40 outline-none ring-primary focus:ring-1"
            />
          </div>
          {showExpandCollapse ? (
            <WikiExplorerToolbar
              className="-mt-1"
              onExpandAll={expandAllFolders}
              onCollapseAll={collapseAllFolders}
              showExpandCollapse
              trailing={null}
            />
          ) : null}
          {renderTree()}
        </div>
      )}
    </div>
  )
}
