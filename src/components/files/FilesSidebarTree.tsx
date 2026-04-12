import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { getFolderTree, type FileFolderTreeNode } from '@/api/files'
import { FILES_PREFIX } from '@/lib/appPaths'
import { filesPathWithFolder, folderIdFromSearch } from '@/lib/filesUrl'
import { useFilesModuleHost } from '@/contexts/FilesModuleHostContext'
import { FILES_TREE_REFRESH_EVENT } from '@/lib/filesTreeRefresh'
import { useAuthStore } from '@/store/authStore'
import { FolderTreeNav } from './FolderTreeNav'

/** Folder with “+” — Heroicons-style outline, matches explorer folder glyph weight. */
function NewFolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 11.25v3m-1.5-1.5h3" />
    </svg>
  )
}

function ArrowUpTrayIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
      />
    </svg>
  )
}

/**
 * Files module folder tree in the app sidebar. Current folder is synced via `?folder=<id>`.
 */
export function FilesSidebarTree({ onNavigate }: { onNavigate?: () => void }) {
  const { requestNewFolder, requestUploadPicker } = useFilesModuleHost()
  const canManageFiles = useAuthStore((s) => s.hasPermission('files.manage'))
  const canRecycle = useAuthStore((s) => s.hasPermission('files.recycle'))
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const folderId = folderIdFromSearch(searchParams)
  const [tree, setTree] = useState<FileFolderTreeNode[]>([])

  const loadTree = useCallback(async () => {
    try {
      const t = await getFolderTree()
      setTree(t)
    } catch {
      setTree([])
    }
  }, [])

  useEffect(() => {
    void loadTree()
  }, [loadTree])

  useEffect(() => {
    const onRefresh = () => void loadTree()
    window.addEventListener(FILES_TREE_REFRESH_EVENT, onRefresh)
    return () => window.removeEventListener(FILES_TREE_REFRESH_EVENT, onRefresh)
  }, [loadTree])

  const goFolder = (id: string | null) => {
    // On recycle bin, open the library at that folder instead of keeping ?folder= on /files/recycle.
    if (location.pathname === `${FILES_PREFIX}/recycle`) {
      navigate(filesPathWithFolder(id))
    } else {
      setSearchParams(id ? { folder: id } : {})
    }
    onNavigate?.()
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mb-2 flex min-h-9 items-center justify-between gap-2">
          <div className="min-w-0 text-xs font-medium uppercase tracking-wide text-foreground/50">Folders</div>
          {canManageFiles ? (
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                title="New folder"
                aria-label="New folder"
                onClick={() => {
                  requestNewFolder()
                  onNavigate?.()
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-foreground hover:bg-muted"
              >
                <NewFolderIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                title="Upload files"
                aria-label="Upload files"
                onClick={() => requestUploadPicker()}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-foreground hover:bg-muted"
              >
                <ArrowUpTrayIcon className="h-4 w-4" />
              </button>
            </div>
          ) : null}
        </div>
        <FolderTreeNav nodes={tree} currentFolderId={folderId} onSelect={goFolder} />
      </div>
      {canRecycle ? (
        <div className="shrink-0 border-t border-border pt-2">
          <Link
            to={`${FILES_PREFIX}/recycle`}
            onClick={() => onNavigate?.()}
            className="text-sm font-medium text-primary hover:underline"
          >
            Recycle bin
          </Link>
        </div>
      ) : null}
    </div>
  )
}
