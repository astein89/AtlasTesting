import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Link, useSearchParams } from 'react-router-dom'
import {
  type FileFolderRow,
  type FileFolderTreeNode,
  type FileSortBy,
  type SortOrder,
  type StoredFileRow,
  createFolder,
  downloadFolderArchive,
  downloadStoredFile,
  fetchFileViewBlob,
  getFolderTree,
  listChildFolders,
  listStoredFiles,
  previewCategory,
  uploadStoredFile,
} from '@/api/files'
import { useUserPreference } from '@/hooks/useUserPreference'
import { useAlertConfirm } from '@/contexts/AlertConfirmContext'
import { formatDateTime } from '@/lib/dateTimeConfig'
import { useAuthStore } from '@/store/authStore'
import { filesPathWithFolder, folderIdFromSearch } from '@/lib/filesUrl'
import { useFilesModuleHost } from '@/contexts/FilesModuleHostContext'
import { FILES_TREE_REFRESH_EVENT, requestFilesTreeRefresh } from '@/lib/filesTreeRefresh'
import { findPathToFolder } from '@/components/files/FolderTreeNav'
import { FileEditModal } from '@/components/files/FileEditModal'
import { FolderEditModal } from '@/components/files/FolderEditModal'
import { NewFolderModal, type NewFolderSubmitPayload } from '@/components/files/NewFolderModal'

const EXPLORER_PREF_KEY = 'files_explorer'
type ExplorerPref = { viewMode: 'list' | 'grid'; sortBy: FileSortBy; sortOrder: SortOrder }
const defaultExplorerPref: ExplorerPref = {
  viewMode: 'list',
  sortBy: 'date',
  sortOrder: 'desc',
}

function FolderGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
      />
    </svg>
  )
}

/** Open / view (eye) — Heroicons outline */
function OpenFileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

function DownloadFileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
      />
    </svg>
  )
}

function EditFileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
      />
    </svg>
  )
}

function ClosePanelIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  )
}

function FileActionIconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
    >
      {children}
    </button>
  )
}

function canEditStoredFileMeta(
  file: StoredFileRow,
  userId: string | undefined,
  canManageAcl: boolean
): boolean {
  if (!userId) return false
  if (canManageAcl) return true
  return file.uploaded_by === userId
}

/** Inline preview panel supports image, PDF, text, markdown, CSV — not arbitrary binaries. */
function fileSupportsInlinePreview(mime: string | null): boolean {
  return previewCategory(mime) !== 'other'
}

function fileExtensionFromName(filename: string): string | null {
  const base = filename.replace(/^.*[/\\]/, '')
  const i = base.lastIndexOf('.')
  if (i <= 0 || i >= base.length - 1) return null
  return base.slice(i + 1).toLowerCase()
}

/** Type column: short category for previewable files; otherwise filename extension (not full MIME). */
function fileTypeDisplayLabel(file: StoredFileRow): string {
  if (fileSupportsInlinePreview(file.mime_type)) {
    switch (previewCategory(file.mime_type)) {
      case 'image':
        return 'Image'
      case 'pdf':
        return 'PDF'
      case 'text':
        return 'Text'
      case 'markdown':
        return 'Markdown'
      case 'csv':
        return 'CSV'
      default:
        break
    }
  }
  const ext = fileExtensionFromName(file.original_filename)
  if (ext) return ext
  const m = file.mime_type?.trim()
  if (m) {
    const sub = m.split('/')[1]
    if (sub) return sub.length > 28 ? `${sub.slice(0, 25)}…` : sub
  }
  return '—'
}

function formatSize(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function GridThumb({ fileId, mime }: { fileId: string; mime: string | null }) {
  const [url, setUrl] = useState<string | null>(null)
  const urlRef = useRef<string | null>(null)
  useEffect(() => {
    if (previewCategory(mime) !== 'image') {
      setUrl(null)
      return
    }
    let cancelled = false
    void fetchFileViewBlob(fileId).then(({ blob }) => {
      if (cancelled) return
      const u = URL.createObjectURL(blob)
      urlRef.current = u
      setUrl(u)
    })
    return () => {
      cancelled = true
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
      setUrl(null)
    }
  }, [fileId, mime])
  if (previewCategory(mime) !== 'image') {
    return (
      <div className="flex h-20 w-full items-center justify-center rounded border border-border bg-muted/30 text-foreground/50">
        <span className="text-xs">File</span>
      </div>
    )
  }
  if (!url) {
    return (
      <div className="flex h-20 w-full items-center justify-center rounded border border-border bg-muted/20 text-xs text-foreground/50">
        …
      </div>
    )
  }
  return <img src={url} alt="" className="h-20 w-full rounded border border-border object-cover" />
}

function FilePreviewPanel({
  file,
  onClose,
  onEditDetails,
}: {
  file: StoredFileRow | null
  onClose: () => void
  /** Opens the rename / permissions modal (when the user may edit metadata). */
  onEditDetails?: () => void
}) {
  const { showAlert } = useAlertConfirm()
  const [state, setState] = useState<{
    url: string | null
    mime: string
    text: string | null
    error: string | null
  }>({ url: null, mime: '', text: null, error: null })

  useEffect(() => {
    if (!file) return
    let cancelled = false
    let objectUrl: string | null = null
    setState({ url: null, mime: file.mime_type || '', text: null, error: null })

    void (async () => {
      try {
        const { blob, mime } = await fetchFileViewBlob(file.id)
        if (cancelled) return
        const m = mime || file.mime_type || ''
        const cat = previewCategory(m)
        if (cat === 'image' || cat === 'pdf') {
          objectUrl = URL.createObjectURL(blob)
          setState({ url: objectUrl, mime: m, text: null, error: null })
          return
        }
        if (cat === 'text' || cat === 'markdown' || cat === 'csv') {
          const text = await blob.text()
          if (cancelled) return
          setState({ url: null, mime: m, text, error: null })
          return
        }
        setState({
          url: null,
          mime: m,
          text: null,
          error: 'No inline preview for this type. Use Download.',
        })
      } catch {
        if (!cancelled) setState({ url: null, mime: '', text: null, error: 'Could not load file.' })
      }
    })()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [file?.id, file])

  if (!file) return null

  const cat = previewCategory(state.mime || file.mime_type)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2
          id="files-preview-title"
          className="min-w-0 truncate text-sm font-medium"
          title={file.original_filename}
        >
          Preview
        </h2>
        <div className="flex shrink-0 items-center gap-0.5">
          <FileActionIconButton
            label="Download"
            onClick={() =>
              void downloadStoredFile(file.id).catch(() => showAlert('Download failed.', 'Files'))
            }
          >
            <DownloadFileIcon className="h-4 w-4" />
          </FileActionIconButton>
          {onEditDetails ? (
            <FileActionIconButton label="Edit file details" onClick={onEditDetails}>
              <EditFileIcon className="h-4 w-4" />
            </FileActionIconButton>
          ) : null}
          <FileActionIconButton label="Close preview" onClick={onClose}>
            <ClosePanelIcon className="h-4 w-4" />
          </FileActionIconButton>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {state.error ? (
          <p className="text-sm text-foreground/70">{state.error}</p>
        ) : cat === 'image' && state.url ? (
          <div className="flex min-h-0 justify-center py-1">
            <img
              src={state.url}
              alt={file.original_filename}
              className="max-h-[min(85dvh,85vh)] max-w-full object-contain"
            />
          </div>
        ) : cat === 'pdf' && state.url ? (
          <iframe
            title={file.original_filename}
            src={state.url}
            className="h-[min(85dvh,85vh,52rem)] min-h-[16rem] w-full shrink-0 rounded border border-border"
          />
        ) : (cat === 'markdown' || cat === 'text' || cat === 'csv') && state.text != null ? (
          cat === 'markdown' ? (
            <div className="wiki-md-body max-w-none text-sm leading-relaxed text-foreground [&_a]:text-primary [&_a]:underline">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{state.text}</ReactMarkdown>
            </div>
          ) : (
            <pre className="whitespace-pre-wrap break-words rounded border border-border bg-muted/30 p-3 text-xs">
              {state.text}
            </pre>
          )
        ) : (
          <p className="text-sm text-foreground/60">Loading…</p>
        )}
      </div>
    </div>
  )
}

export function FilesExplorer() {
  const hasPermission = useAuthStore((s) => s.hasPermission)
  const userId = useAuthStore((s) => s.user?.id)
  const canManage = hasPermission('files.manage')
  const canManageAcl = canManage || hasPermission('*')
  const { showAlert } = useAlertConfirm()
  const { setFilesModuleHandlers } = useFilesModuleHost()
  const [searchParams, setSearchParams] = useSearchParams()
  const folderId = folderIdFromSearch(searchParams)
  const [prefs, setPrefs] = useUserPreference<ExplorerPref>(
    EXPLORER_PREF_KEY,
    defaultExplorerPref,
    JSON.stringify,
    (s) => {
      try {
        const v = JSON.parse(s) as ExplorerPref
        return {
          viewMode: v.viewMode === 'grid' ? 'grid' : 'list',
          sortBy: ['name', 'date', 'size', 'type'].includes(v.sortBy) ? v.sortBy : 'date',
          sortOrder: v.sortOrder === 'asc' ? 'asc' : 'desc',
        }
      } catch {
        return defaultExplorerPref
      }
    }
  )

  const [tree, setTree] = useState<FileFolderTreeNode[]>([])
  const [childFolders, setChildFolders] = useState<FileFolderRow[]>([])
  const [files, setFiles] = useState<StoredFileRow[]>([])
  const [loading, setLoading] = useState(true)
  const [previewFile, setPreviewFile] = useState<StoredFileRow | null>(null)
  const [editTarget, setEditTarget] = useState<StoredFileRow | null>(null)
  const [folderEditTarget, setFolderEditTarget] = useState<FileFolderRow | null>(null)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const goFolder = useCallback(
    (id: string | null) => {
      setSearchParams(id ? { folder: id } : {})
      setPreviewFile(null)
    },
    [setSearchParams]
  )

  const breadcrumbPath = useMemo(() => findPathToFolder(tree, folderId), [tree, folderId])

  const loadTree = useCallback(async () => {
    try {
      const t = await getFolderTree()
      setTree(t)
    } catch {
      setTree([])
    }
  }, [])

  const loadListing = useCallback(async () => {
    setLoading(true)
    try {
      const [folders, fileRows] = await Promise.all([
        listChildFolders(folderId),
        listStoredFiles({ folderId, sortBy: prefs.sortBy, order: prefs.sortOrder }),
      ])
      const folderSort = (a: FileFolderRow, b: FileFolderRow) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      setChildFolders([...folders].sort(folderSort))
      setFiles(fileRows)
    } catch {
      showAlert('Could not load folder.', 'Files')
      setChildFolders([])
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [folderId, prefs.sortBy, prefs.sortOrder, showAlert])

  useEffect(() => {
    void loadTree()
  }, [loadTree])

  useEffect(() => {
    const onRefresh = () => void loadTree()
    window.addEventListener(FILES_TREE_REFRESH_EVENT, onRefresh)
    return () => window.removeEventListener(FILES_TREE_REFRESH_EVENT, onRefresh)
  }, [loadTree])

  useEffect(() => {
    void loadListing()
  }, [loadListing])

  useEffect(() => {
    if (!previewFile) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewFile(null)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [previewFile])

  const mergedItems = useCallback(() => {
    type Item = { kind: 'folder'; row: FileFolderRow } | { kind: 'file'; row: StoredFileRow }
    const out: Item[] = childFolders.map((row) => ({ kind: 'folder' as const, row }))
    for (const row of files) out.push({ kind: 'file', row })
    return out
  }, [childFolders, files])

  const onOpenItem = async (item: ReturnType<typeof mergedItems>[number]) => {
    if (item.kind === 'folder') {
      goFolder(item.row.id)
      return
    }
    const row = item.row
    const cat = previewCategory(row.mime_type)
    if (cat === 'other') {
      try {
        await downloadStoredFile(row.id)
      } catch {
        showAlert('Download failed.', 'Files')
      }
      return
    }
    setPreviewFile(row)
  }

  const onPickFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files
    if (!picked?.length) return
    let lastUploaded: StoredFileRow | null = null
    try {
      for (let i = 0; i < picked.length; i++) {
        const row = await uploadStoredFile(picked[i], { folderId })
        lastUploaded = row
      }
      await loadListing()
      requestFilesTreeRefresh()
      if (lastUploaded && canEditStoredFileMeta(lastUploaded, userId, canManageAcl)) {
        setPreviewFile(null)
        setEditTarget(lastUploaded)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      showAlert(msg, 'Upload')
    } finally {
      e.target.value = ''
    }
  }

  const createNewFolderFromModal = useCallback(
    async (payload: NewFolderSubmitPayload): Promise<boolean> => {
      try {
        await createFolder(payload.parentId, payload.name.trim(), {
          ...(canManageAcl && payload.allowedRoleSlugs !== undefined
            ? { allowedRoleSlugs: payload.allowedRoleSlugs }
            : {}),
        })
        await loadListing()
        requestFilesTreeRefresh()
        return true
      } catch {
        showAlert('Could not create folder (duplicate name?).', 'Files')
        return false
      }
    },
    [canManageAcl, loadListing, showAlert]
  )

  const openNewFolderModal = useCallback(() => {
    setNewFolderOpen(true)
  }, [])

  const openUploadPicker = useCallback(() => {
    inputRef.current?.click()
  }, [])

  useEffect(() => {
    setFilesModuleHandlers({
      newFolder: openNewFolderModal,
      openUploadPicker,
    })
    return () =>
      setFilesModuleHandlers({
        newFolder: null,
        openUploadPicker: null,
      })
  }, [setFilesModuleHandlers, openNewFolderModal, openUploadPicker])

  const items = mergedItems()

  return (
    <div className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col">
      <input ref={inputRef} type="file" className="hidden" multiple onChange={onPickFiles} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="border-b border-border px-1 py-2 text-sm">
          <nav className="flex flex-wrap items-center gap-1 text-foreground/80" aria-label="Breadcrumb">
            <Link
              to={filesPathWithFolder(null)}
              className="hover:text-primary hover:underline"
              onClick={() => setPreviewFile(null)}
            >
              Files
            </Link>
            {(breadcrumbPath ?? []).map((seg) => (
              <span key={seg.id} className="flex items-center gap-1">
                <span aria-hidden>/</span>
                <Link
                  to={filesPathWithFolder(seg.id)}
                  className="hover:text-primary hover:underline"
                  onClick={() => setPreviewFile(null)}
                >
                  {seg.name}
                </Link>
              </span>
            ))}
          </nav>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
          <div className="mr-auto flex flex-wrap items-center gap-2">
            <span className="text-xs text-foreground/60">View</span>
            <button
              type="button"
              className={`rounded border px-2 py-1 text-xs ${prefs.viewMode === 'list' ? 'border-primary bg-primary/10' : 'border-border'}`}
              onClick={() => setPrefs((p) => ({ ...p, viewMode: 'list' }))}
            >
              List
            </button>
            <button
              type="button"
              className={`rounded border px-2 py-1 text-xs ${prefs.viewMode === 'grid' ? 'border-primary bg-primary/10' : 'border-border'}`}
              onClick={() => setPrefs((p) => ({ ...p, viewMode: 'grid' }))}
            >
              Grid
            </button>
          </div>
          <label className="flex items-center gap-1 text-xs">
            Sort
            <select
              className="rounded border border-border bg-background px-2 py-1"
              value={prefs.sortBy}
              onChange={(e) =>
                setPrefs((p) => ({ ...p, sortBy: e.target.value as FileSortBy }))
              }
            >
              <option value="name">Name</option>
              <option value="date">Date</option>
              <option value="size">Size</option>
              <option value="type">Type</option>
            </select>
          </label>
          <button
            type="button"
            className="rounded border border-border px-2 py-1 text-xs"
            onClick={() =>
              setPrefs((p) => ({ ...p, sortOrder: p.sortOrder === 'asc' ? 'desc' : 'asc' }))
            }
            title="Toggle sort direction"
          >
            {prefs.sortOrder === 'asc' ? 'Asc ↑' : 'Desc ↓'}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-2">
          {loading ? (
            <p className="text-sm text-foreground/60">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-foreground/60">This folder is empty.</p>
          ) : prefs.viewMode === 'grid' ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {items.map((item) =>
                item.kind === 'folder' ? (
                  <button
                    key={`f-${item.row.id}`}
                    type="button"
                    className="flex h-full min-h-0 flex-col rounded-lg border border-border bg-card p-2 text-left hover:bg-muted/50"
                    onClick={() => void onOpenItem(item)}
                  >
                    <div className="flex h-20 shrink-0 items-center justify-center text-amber-700/90 dark:text-amber-400/90">
                      <FolderGlyph className="h-14 w-14" />
                    </div>
                    <div className="mt-1 shrink-0 truncate text-xs font-medium">{item.row.name}</div>
                    <div className="shrink-0 text-[10px] text-foreground/50">—</div>
                    <div
                      className="mt-auto flex shrink-0 items-center gap-1 pt-2"
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      <FileActionIconButton
                        label="Download"
                        onClick={() =>
                          void downloadFolderArchive(item.row.id).catch(() =>
                            showAlert('Download failed.', 'Files')
                          )
                        }
                      >
                        <DownloadFileIcon className="h-4 w-4" />
                      </FileActionIconButton>
                      {canManage ? (
                        <FileActionIconButton label="Edit" onClick={() => setFolderEditTarget(item.row)}>
                          <EditFileIcon className="h-4 w-4" />
                        </FileActionIconButton>
                      ) : null}
                    </div>
                  </button>
                ) : (
                  <button
                    key={`file-${item.row.id}`}
                    type="button"
                    className="flex h-full min-h-0 flex-col rounded-lg border border-border bg-card p-2 text-left hover:bg-muted/50"
                    onClick={() => void onOpenItem(item)}
                  >
                    <GridThumb fileId={item.row.id} mime={item.row.mime_type} />
                    <div className="mt-1 shrink-0 truncate text-xs font-medium" title={item.row.original_filename}>
                      {item.row.original_filename}
                    </div>
                    <div className="shrink-0 text-[10px] text-foreground/50">{formatSize(item.row.size_bytes)}</div>
                    <div
                      className="mt-auto flex shrink-0 items-center gap-1 pt-2"
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      {fileSupportsInlinePreview(item.row.mime_type) ? (
                        <FileActionIconButton
                          label="View"
                          onClick={() => void onOpenItem(item)}
                        >
                          <OpenFileIcon className="h-4 w-4" />
                        </FileActionIconButton>
                      ) : null}
                      <FileActionIconButton
                        label="Download"
                        onClick={() =>
                          void downloadStoredFile(item.row.id).catch(() =>
                            showAlert('Download failed.', 'Files')
                          )
                        }
                      >
                        <DownloadFileIcon className="h-4 w-4" />
                      </FileActionIconButton>
                      {canEditStoredFileMeta(item.row, userId, canManageAcl) ? (
                        <FileActionIconButton
                          label="Edit"
                          onClick={() => setEditTarget(item.row)}
                        >
                          <EditFileIcon className="h-4 w-4" />
                        </FileActionIconButton>
                      ) : null}
                    </div>
                  </button>
                )
              )}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="hidden px-3 py-2 font-medium sm:table-cell">Type</th>
                    <th className="px-3 py-2 font-medium">Size</th>
                    <th className="hidden px-3 py-2 font-medium md:table-cell">Uploaded by</th>
                    <th className="hidden px-3 py-2 font-medium lg:table-cell">Date</th>
                    <th className="sticky right-0 z-20 w-36 min-w-[9rem] border-l border-border bg-muted/40 px-2 py-2 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) =>
                    item.kind === 'folder' ? (
                      <tr key={`f-${item.row.id}`} className="border-b border-border/80">
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            className="font-medium text-primary hover:underline"
                            onClick={() => void onOpenItem(item)}
                          >
                            <span className="inline-flex items-center gap-1.5">
                              <FolderGlyph className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
                              {item.row.name}
                            </span>
                          </button>
                        </td>
                        <td className="hidden px-3 py-2 text-foreground/60 sm:table-cell">Folder</td>
                        <td className="px-3 py-2">—</td>
                        <td className="hidden px-3 py-2 md:table-cell">—</td>
                        <td className="hidden px-3 py-2 lg:table-cell">—</td>
                        <td className="sticky right-0 z-10 w-36 min-w-[9rem] border-l border-border bg-card px-2 py-2 text-right">
                          <div className="inline-flex flex-wrap items-center justify-end gap-1">
                            <FileActionIconButton
                              label="Download"
                              onClick={() =>
                                void downloadFolderArchive(item.row.id).catch(() =>
                                  showAlert('Download failed.', 'Files')
                                )
                              }
                            >
                              <DownloadFileIcon className="h-4 w-4" />
                            </FileActionIconButton>
                            {canManage ? (
                              <FileActionIconButton label="Edit" onClick={() => setFolderEditTarget(item.row)}>
                                <EditFileIcon className="h-4 w-4" />
                              </FileActionIconButton>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={item.row.id} className="border-b border-border/80">
                        <td className="max-w-[10rem] truncate px-3 py-2 sm:max-w-md">
                          <button
                            type="button"
                            className="text-left font-medium hover:text-primary hover:underline"
                            title={item.row.original_filename}
                            onClick={() =>
                              void (fileSupportsInlinePreview(item.row.mime_type)
                                ? setPreviewFile(item.row)
                                : onOpenItem(item))
                            }
                          >
                            {item.row.original_filename}
                          </button>
                        </td>
                        <td
                          className="hidden px-3 py-2 text-foreground/70 sm:table-cell"
                          title={item.row.mime_type?.trim() || undefined}
                        >
                          {fileTypeDisplayLabel(item.row)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">{formatSize(item.row.size_bytes)}</td>
                        <td className="hidden px-3 py-2 md:table-cell">
                          {item.row.uploaded_by_username?.trim() || '—'}
                        </td>
                        <td className="hidden whitespace-nowrap px-3 py-2 lg:table-cell">
                          {item.row.created_at ? formatDateTime(item.row.created_at) : '—'}
                        </td>
                        <td className="sticky right-0 z-10 w-36 min-w-[9rem] border-l border-border bg-card px-2 py-2 text-right">
                          <div className="inline-flex flex-wrap items-center justify-end gap-1">
                            {fileSupportsInlinePreview(item.row.mime_type) ? (
                              <FileActionIconButton
                                label="View"
                                onClick={() => void onOpenItem(item)}
                              >
                                <OpenFileIcon className="h-4 w-4" />
                              </FileActionIconButton>
                            ) : null}
                            <FileActionIconButton
                              label="Download"
                              onClick={() =>
                                void downloadStoredFile(item.row.id).catch(() =>
                                  showAlert('Download failed.', 'Files')
                                )
                              }
                            >
                              <DownloadFileIcon className="h-4 w-4" />
                            </FileActionIconButton>
                            {canEditStoredFileMeta(item.row, userId, canManageAcl) ? (
                              <FileActionIconButton label="Edit" onClick={() => setEditTarget(item.row)}>
                                <EditFileIcon className="h-4 w-4" />
                              </FileActionIconButton>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {previewFile ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="files-preview-title"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default bg-background/75 backdrop-blur-[2px] transition-colors hover:bg-background/85"
            aria-label="Close preview"
            onClick={() => setPreviewFile(null)}
          />
          <div
            className="relative z-10 flex max-h-[min(92dvh,calc(100dvh-1.5rem))] min-h-0 w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <FilePreviewPanel
              file={previewFile}
              onClose={() => setPreviewFile(null)}
              onEditDetails={
                canEditStoredFileMeta(previewFile, userId, canManageAcl)
                  ? () => setEditTarget(previewFile)
                  : undefined
              }
            />
          </div>
        </div>
      ) : null}

      <NewFolderModal
        open={newFolderOpen}
        defaultParentId={folderId}
        canManageAcl={canManageAcl}
        onClose={() => setNewFolderOpen(false)}
        onCreate={createNewFolderFromModal}
      />
      <FolderEditModal
        open={folderEditTarget !== null}
        folder={folderEditTarget}
        canManageAcl={canManageAcl}
        canDelete={canManage}
        onClose={() => setFolderEditTarget(null)}
        onSaved={(_row) => {
          void loadListing()
          requestFilesTreeRefresh()
        }}
        onDeleted={({ id, parentId }) => {
          setFolderEditTarget(null)
          if (folderId === id) {
            setSearchParams(parentId ? { folder: parentId } : {})
            setPreviewFile(null)
          }
          void loadListing()
          requestFilesTreeRefresh()
        }}
      />
      <FileEditModal
        open={editTarget !== null}
        file={editTarget}
        canManageAcl={canManageAcl}
        canDelete={canManage}
        onClose={() => setEditTarget(null)}
        onSaved={(row) => {
          setPreviewFile((p) => (p?.id === row.id ? row : p))
          void loadListing()
        }}
        onDeleted={(id) => {
          setPreviewFile((p) => (p?.id === id ? null : p))
          setEditTarget((t) => (t?.id === id ? null : t))
          void loadListing()
        }}
      />
    </div>
  )
}
