import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentType,
  type DragEvent,
  type ReactNode,
} from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  type FileFolderRow,
  type FileFolderTreeNode,
  type FileSortBy,
  type SortOrder,
  type StoredFileRow,
  createFolder,
  deleteFolder,
  deleteStoredFile,
  downloadFolderArchive,
  downloadStoredFile,
  fetchFileViewBlob,
  getFolderDeleteImpact,
  getFolderTree,
  listChildFolders,
  listStoredFiles,
  previewCategory,
  searchLibraryFiles,
  uploadStoredFile,
} from '@/api/files'
import { isAbortLikeError } from '@/api/client'
import { useUserPreference } from '@/hooks/useUserPreference'
import { useAlertConfirm } from '@/contexts/AlertConfirmContext'
import { formatDateTime } from '@/lib/dateTimeConfig'
import { useAuthStore } from '@/store/authStore'
import { isTestingUuidParam } from '@/lib/appPaths'
import { fileFolderNavSegment, filesPathWithFolder, folderIdFromSearch } from '@/lib/filesUrl'
import { useFilesModuleHost } from '@/contexts/FilesModuleHostContext'
import { FILES_TREE_REFRESH_EVENT, requestFilesTreeRefresh } from '@/lib/filesTreeRefresh'
import { ColumnFilterDropdown } from '@/components/data/ColumnFilterDropdown'
import { findFolderInTreeByParam, findPathToFolder } from '@/components/files/FolderTreeNav'
import { AppMarkdown } from '@/components/markdown/AppMarkdown'
import { BulkFileUploadApplyModal } from '@/components/files/BulkFileUploadApplyModal'
import { FileEditModal } from '@/components/files/FileEditModal'
import { FolderEditModal } from '@/components/files/FolderEditModal'
import { NewFolderModal, type NewFolderSubmitPayload } from '@/components/files/NewFolderModal'

const EXPLORER_PREF_KEY = 'files_explorer'

/** Preset max width (px) for grid thumbnails; `lg` uses the full grid cell width. */
type GridThumbSizePreset = 'sm' | 'md' | 'lg'

type ExplorerPref = {
  viewMode: 'list' | 'grid'
  sortBy: FileSortBy
  sortOrder: SortOrder
  gridThumbSize: GridThumbSizePreset
}

const defaultExplorerPref: ExplorerPref = {
  viewMode: 'list',
  sortBy: 'name',
  sortOrder: 'asc',
  gridThumbSize: 'md',
}

const GRID_THUMB_SIZE_OPTIONS: { value: GridThumbSizePreset; label: string; maxPx: number }[] = [
  { value: 'sm', label: 'Small', maxPx: 160 },
  { value: 'md', label: 'Medium', maxPx: 220 },
  { value: 'lg', label: 'Large', maxPx: 0 },
]

function gridThumbPresetWidthPx(preset: GridThumbSizePreset): number {
  const row = GRID_THUMB_SIZE_OPTIONS.find((o) => o.value === preset)
  return row?.maxPx ?? 220
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

/** 16:10 frame, smallest — grid thumbnail size control */
function ThumbSizeSmIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <rect x="8" y="5" width="8" height="5" rx="1" />
    </svg>
  )
}

function ThumbSizeMdIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <rect x="6" y="5" width="12" height="7.5" rx="1" />
    </svg>
  )
}

/** Large = full cell width — Heroicons-style “arrows pointing out” */
function ThumbSizeLgIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M20.25 3.75v4.5m0-4.5h-4.5m4.5 0L15 9m0 6l3.75 3.75v-4.5m0 4.5h-4.5m4.5 0L15 15M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15"
      />
    </svg>
  )
}

const GRID_THUMB_SIZE_ICONS: Record<GridThumbSizePreset, ComponentType<{ className?: string }>> = {
  sm: ThumbSizeSmIcon,
  md: ThumbSizeMdIcon,
  lg: ThumbSizeLgIcon,
}

/** List layout — rows with bullets (Heroicons-style outline). */
function ViewListIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.007h-.007V6.75zm0 5.25h.007v.007h-.007v-.007zm0 5.25h.007v.007h-.007v-.007z"
      />
    </svg>
  )
}

/** Grid layout — 2×2 squares (Heroicons-style outline). */
function ViewGridIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75a2.25 2.25 0 012.25-2.25h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25v-2.25zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z"
      />
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

function parseListSelectionKey(key: string): { kind: 'file' | 'folder'; id: string } | null {
  if (key.startsWith('file:')) return { kind: 'file', id: key.slice(5) }
  if (key.startsWith('folder:')) return { kind: 'folder', id: key.slice(7) }
  return null
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

type FileTypeGlyphKind =
  | 'pdf'
  | 'text'
  | 'markdown'
  | 'csv'
  | 'archive'
  | 'video'
  | 'audio'
  | 'officeWord'
  | 'officeSheet'
  | 'officeSlides'
  | 'code'
  | 'generic'

function fileTypeGlyphKind(mime: string | null, filename: string): FileTypeGlyphKind {
  const cat = previewCategory(mime)
  if (cat === 'pdf') return 'pdf'
  if (cat === 'markdown') return 'markdown'
  if (cat === 'csv') return 'csv'
  if (cat === 'text') return 'text'
  const m = (mime || '').toLowerCase()
  const ext = (fileExtensionFromName(filename) || '').toLowerCase()

  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'

  if (
    m.includes('zip') ||
    m.includes('compressed') ||
    m.includes('x-rar') ||
    m.includes('x-7z') ||
    m.includes('tar') ||
    m.includes('gzip') ||
    ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz'].includes(ext)
  ) {
    return 'archive'
  }

  if (m.includes('wordprocessingml') || m.includes('msword') || ext === 'doc' || ext === 'docx' || ext === 'odt') {
    return 'officeWord'
  }
  if (
    m.includes('spreadsheetml') ||
    m.includes('ms-excel') ||
    ext === 'xls' ||
    ext === 'xlsx' ||
    ext === 'ods'
  ) {
    return 'officeSheet'
  }
  if (m.includes('presentationml') || m.includes('powerpoint') || ext === 'ppt' || ext === 'pptx' || ext === 'odp') {
    return 'officeSlides'
  }

  if (
    m.includes('javascript') ||
    m.includes('json') ||
    m.includes('xml') ||
    m.includes('html') ||
    m.includes('yaml') ||
    ext === 'js' ||
    ext === 'mjs' ||
    ext === 'cjs' ||
    ext === 'ts' ||
    ext === 'tsx' ||
    ext === 'jsx' ||
    ext === 'py' ||
    ext === 'rs' ||
    ext === 'go' ||
    ext === 'java' ||
    ext === 'c' ||
    ext === 'cpp' ||
    ext === 'h' ||
    ext === 'hpp' ||
    ext === 'html' ||
    ext === 'htm' ||
    ext === 'css' ||
    ext === 'json' ||
    ext === 'xml' ||
    ext === 'yaml' ||
    ext === 'yml' ||
    ext === 'sh' ||
    ext === 'ps1' ||
    ext === 'bat' ||
    ext === 'cmd'
  ) {
    return 'code'
  }

  return 'generic'
}

/** Outline glyph for grid / list when there is no inline preview thumbnail. */
function FileTypeGlyphIcon({
  mime,
  filename,
  className,
}: {
  mime: string | null
  filename: string
  className?: string
}) {
  const k = fileTypeGlyphKind(mime, filename)
  const stroke = 1.5
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      aria-hidden
    >
      {k === 'pdf' ? (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
        />
      ) : k === 'text' ? (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
        />
      ) : k === 'markdown' ? (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 18H5.625c-.621 0-1.125-.504-1.125-1.125V4.125c0-.621.504-1.125 1.125-1.125h12.75c.621 0 1.125.504 1.125 1.125V11.25a9 9 0 0 1-9 9Zm-3.75-8.25v5.25m3.75-3.75h3"
        />
      ) : k === 'csv' ? (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 0 1-1.125-1.125V5.625m17.25 13.875a1.125 1.125 0 0 0 1.125-1.125M3.375 19.5c0 .621.504 1.125 1.125 1.125m17.25-13.875v13.875m0-13.875a1.125 1.125 0 0 0-1.125-1.125m-17.25 0A1.125 1.125 0 0 0 2.25 5.625m17.25 0c0-.621-.504-1.125-1.125-1.125M3.375 5.625h17.25m-12 3.75h.008v.008H8.375V9.375Zm0 3h.008v.008H8.375V12.375Zm0 3h.008v.008H8.375V15.375Zm4.5-6h.008v.008H12.875V9.375Zm0 3h.008v.008H12.875V12.375Zm0 3h.008v.008H12.875V15.375Zm4.5-6h.008v.008H17.375V9.375Zm0 3h.008v.008H17.375V12.375Zm0 3h.008v.008H17.375V15.375Z"
        />
      ) : k === 'archive' ? (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z"
        />
      ) : k === 'video' ? (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9a2.25 2.25 0 0 0-2.25 2.25v9a2.25 2.25 0 0 0 2.25 2.25Z"
        />
      ) : k === 'audio' ? (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m9 9 10.5-3v21m-9-3v-3.75a2.25 2.25 0 0 1 2.25-2.25h.75a2.25 2.25 0 0 1 2.25 2.25V18m-9-9v9m0-9c0-1.657 1.343-3 3-3s3 1.343 3 3v9"
        />
      ) : k === 'officeWord' ? (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h4.5m-4.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
        />
      ) : k === 'officeSheet' ? (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 0 1-1.125-1.125V5.625m17.25 13.875a1.125 1.125 0 0 0 1.125-1.125M3.375 19.5c0 .621.504 1.125 1.125 1.125m17.25-13.875v13.875m0-13.875a1.125 1.125 0 0 0-1.125-1.125m-17.25 0A1.125 1.125 0 0 0 2.25 5.625m17.25 0c0-.621-.504-1.125-1.125-1.125M3.375 5.625h8.25m-8.25 0c-.621 0-1.125.504-1.125 1.125v3.75m9-4.875h8.25m-8.25 0c-.621 0-1.125.504-1.125 1.125v3.75m-9 3.75h17.25"
        />
      ) : k === 'officeSlides' ? (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3"
        />
      ) : k === 'code' ? (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5"
        />
      ) : (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 18H5.625c-.621 0-1.125-.504-1.125-1.125V4.125c0-.621.504-1.125 1.125-1.125h12.75c.621 0 1.125.504 1.125 1.125V11.25a9 9 0 0 1-9 9Z"
        />
      )}
    </svg>
  )
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

/** List table on narrow viewports: cap visible filename length (see `title` on button for full name). */
function truncateTableFilename(name: string, maxChars = 40): string {
  if (name.length <= maxChars) return name
  return `${name.slice(0, maxChars)}…`
}

type ExplorerColumnKey = 'name' | 'type' | 'size' | 'uploader' | 'date'

const EXPLORER_COLUMN_KEYS: ExplorerColumnKey[] = ['name', 'type', 'size', 'uploader', 'date']

function explorerItemFilterValues(
  item: { kind: 'folder'; row: FileFolderRow } | { kind: 'file'; row: StoredFileRow }
): Record<ExplorerColumnKey, string> {
  if (item.kind === 'folder') {
    return {
      name: item.row.name,
      type: 'Folder',
      size: '—',
      uploader: '—',
      date: '—',
    }
  }
  const f = item.row
  return {
    name: f.original_filename,
    type: fileTypeDisplayLabel(f),
    size: formatSize(f.size_bytes),
    uploader: f.uploaded_by_username?.trim() || '—',
    date: f.created_at ? formatDateTime(f.created_at) : '—',
  }
}

/** Search matches folder/file rows using the same visible fields as the table (name, type, …; files also MIME). */
function explorerRowMatchesSearch(
  searchLower: string,
  item: { kind: 'folder'; row: FileFolderRow } | { kind: 'file'; row: StoredFileRow }
): boolean {
  if (!searchLower) return true
  const v = explorerItemFilterValues(item)
  const parts = [v.name, v.type, v.size, v.uploader, v.date]
  if (item.kind === 'file') {
    parts.push(item.row.mime_type?.trim() || '')
  }
  return parts.some((p) => p.toLowerCase().includes(searchLower))
}

function buildDistinctColumnValues(
  folders: FileFolderRow[],
  fileRows: StoredFileRow[]
): Record<ExplorerColumnKey, string[]> {
  const name = new Set<string>()
  const type = new Set<string>()
  const size = new Set<string>()
  const uploader = new Set<string>()
  const date = new Set<string>()
  for (const row of folders) {
    const v = explorerItemFilterValues({ kind: 'folder', row })
    name.add(v.name)
    type.add(v.type)
    size.add(v.size)
    uploader.add(v.uploader)
    date.add(v.date)
  }
  for (const row of fileRows) {
    const v = explorerItemFilterValues({ kind: 'file', row })
    name.add(v.name)
    type.add(v.type)
    size.add(v.size)
    uploader.add(v.uploader)
    date.add(v.date)
  }
  const sortStr = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  return {
    name: [...name].sort(sortStr),
    type: [...type].sort(sortStr),
    size: [...size].sort(sortStr),
    uploader: [...uploader].sort(sortStr),
    date: [...date].sort(sortStr),
  }
}

function passesExplorerColumnFilters(
  vals: Record<ExplorerColumnKey, string>,
  columnFilters: Partial<Record<ExplorerColumnKey, string[]>>,
  distinct: Record<ExplorerColumnKey, string[]>
): boolean {
  for (const key of EXPLORER_COLUMN_KEYS) {
    const allowed = columnFilters[key]
    if (!allowed || allowed.length === 0) continue
    const universe = distinct[key]
    if (universe.length === 0) continue
    if (allowed.length >= universe.length && universe.every((u) => allowed.includes(u))) continue
    if (!allowed.includes(vals[key])) return false
  }
  return true
}

function isExplorerColumnFilterActive(
  key: ExplorerColumnKey,
  filters: Partial<Record<ExplorerColumnKey, string[]>>,
  distinct: Record<ExplorerColumnKey, string[]>
): boolean {
  const sel = filters[key]
  const universe = distinct[key]
  if (!sel?.length || !universe.length) return false
  if (sel.length < universe.length) return true
  return !universe.every((x) => sel.includes(x))
}

function GridThumbFrame({
  thumbMaxPx,
  children,
}: {
  thumbMaxPx: number
  children: ReactNode
}) {
  return (
    <div className="flex w-full shrink-0 justify-center">
      <div
        className="relative aspect-[16/10] w-full overflow-hidden rounded border border-border bg-muted/30"
        style={thumbMaxPx > 0 ? { maxWidth: `${thumbMaxPx}px` } : undefined}
      >
        {children}
      </div>
    </div>
  )
}

function GridThumb({
  fileId,
  mime,
  filename,
  thumbMaxPx,
}: {
  fileId: string
  mime: string | null
  filename: string
  thumbMaxPx: number
}) {
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
      <GridThumbFrame thumbMaxPx={thumbMaxPx}>
        <div className="absolute inset-0 flex items-center justify-center text-foreground/55">
          <FileTypeGlyphIcon mime={mime} filename={filename} className="h-11 w-11" />
        </div>
      </GridThumbFrame>
    )
  }
  if (!url) {
    return (
      <GridThumbFrame thumbMaxPx={thumbMaxPx}>
        <div className="absolute inset-0 flex items-center justify-center text-xs text-foreground/50">
          …
        </div>
      </GridThumbFrame>
    )
  }
  return (
    <GridThumbFrame thumbMaxPx={thumbMaxPx}>
      <img src={url} alt="" className="absolute inset-0 h-full w-full object-contain" />
    </GridThumbFrame>
  )
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
          error: 'no-preview',
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
        {state.error === 'no-preview' ? (
          <div className="flex flex-col items-center justify-center gap-4 py-10 text-center">
            <FileTypeGlyphIcon
              mime={state.mime || file.mime_type}
              filename={file.original_filename}
              className="h-16 w-16 text-foreground/50"
            />
            <p className="max-w-sm text-sm text-foreground/80">
              No preview is available for this file type. Download the file to open it on your device.
            </p>
            <button
              type="button"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              onClick={() =>
                void downloadStoredFile(file.id).catch(() => showAlert('Download failed.', 'Files'))
              }
            >
              Download
            </button>
          </div>
        ) : state.error ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-foreground/70">{state.error}</p>
            <button
              type="button"
              className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
              onClick={() =>
                void downloadStoredFile(file.id).catch(() => showAlert('Download failed.', 'Files'))
              }
            >
              Try download
            </button>
          </div>
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
            <AppMarkdown content={state.text} />
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
  const { showAlert, showConfirm } = useAlertConfirm()
  const { setFilesModuleHandlers } = useFilesModuleHost()
  const [searchParams, setSearchParams] = useSearchParams()
  const folderId = folderIdFromSearch(searchParams)
  const [prefs, setPrefs] = useUserPreference<ExplorerPref>(
    EXPLORER_PREF_KEY,
    defaultExplorerPref,
    JSON.stringify,
    (s) => {
      try {
        const v = JSON.parse(s) as ExplorerPref & { gridThumbSize?: string }
        let gridThumbSize: GridThumbSizePreset = 'md'
        const g = v.gridThumbSize
        if (g === 'sm' || g === 'md' || g === 'lg') gridThumbSize = g
        else if (g === 'full') gridThumbSize = 'lg'
        return {
          viewMode: v.viewMode === 'grid' ? 'grid' : 'list',
          sortBy: ['name', 'date', 'size', 'type'].includes(v.sortBy) ? v.sortBy : 'name',
          sortOrder: v.sortOrder === 'asc' ? 'asc' : 'desc',
          gridThumbSize,
        }
      } catch {
        return defaultExplorerPref
      }
    }
  )

  const gridThumbMaxPx = useMemo(
    () => gridThumbPresetWidthPx(prefs.gridThumbSize),
    [prefs.gridThumbSize]
  )

  /** More columns + tighter gap for Small/Medium so tiles shrink; Large matches the original roomy grid. */
  const gridLayoutClassName = useMemo(() => {
    switch (prefs.gridThumbSize) {
      case 'sm':
        return 'grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7'
      case 'md':
        return 'grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
      case 'lg':
      default:
        return 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'
    }
  }, [prefs.gridThumbSize])

  const [tree, setTree] = useState<FileFolderTreeNode[]>([])
  const [childFolders, setChildFolders] = useState<FileFolderRow[]>([])
  const [files, setFiles] = useState<StoredFileRow[]>([])
  const [loading, setLoading] = useState(true)
  const [previewFile, setPreviewFile] = useState<StoredFileRow | null>(null)
  const [editTarget, setEditTarget] = useState<StoredFileRow | null>(null)
  const [bulkApplyTargets, setBulkApplyTargets] = useState<StoredFileRow[] | null>(null)
  /** List view only: `file:${id}` | `folder:${id}` */
  const searchInputId = useId()
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [globalSearchFolders, setGlobalSearchFolders] = useState<FileFolderRow[]>([])
  const [globalSearchFiles, setGlobalSearchFiles] = useState<StoredFileRow[]>([])
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false)
  const [searchRefreshNonce, setSearchRefreshNonce] = useState(0)
  const [columnFilters, setColumnFilters] = useState<Partial<Record<ExplorerColumnKey, string[]>>>({})
  const [openFilterColumn, setOpenFilterColumn] = useState<ExplorerColumnKey | null>(null)
  const filterAnchorRefs = useRef<Record<string, HTMLElement | null>>({})
  const [listSelection, setListSelection] = useState<Set<string>>(new Set())
  const [folderEditTarget, setFolderEditTarget] = useState<FileFolderRow | null>(null)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listSelectAllRef = useRef<HTMLInputElement>(null)

  const goFolder = useCallback(
    (folderKey: string | null) => {
      setSearchParams(folderKey ? { folder: folderKey } : {})
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

  const refreshGlobalSearchIfActive = useCallback(() => {
    if (debouncedSearch.trim()) setSearchRefreshNonce((n) => n + 1)
  }, [debouncedSearch])

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchQuery), 300)
    return () => window.clearTimeout(t)
  }, [searchQuery])

  useEffect(() => {
    const q = debouncedSearch.trim()
    if (!q) {
      setGlobalSearchFolders([])
      setGlobalSearchFiles([])
      setGlobalSearchLoading(false)
      return
    }
    const ac = new AbortController()
    setGlobalSearchLoading(true)
    void (async () => {
      try {
        const r = await searchLibraryFiles({
          q,
          sortBy: prefs.sortBy,
          order: prefs.sortOrder,
          signal: ac.signal,
        })
        if (!ac.signal.aborted) {
          setGlobalSearchFolders(r.folders)
          setGlobalSearchFiles(r.files)
        }
      } catch (e) {
        if (!isAbortLikeError(e)) showAlert('Could not search library.', 'Files')
      } finally {
        if (!ac.signal.aborted) setGlobalSearchLoading(false)
      }
    })()
    return () => ac.abort()
  }, [debouncedSearch, prefs.sortBy, prefs.sortOrder, searchRefreshNonce, showAlert])

  useEffect(() => {
    void loadTree()
  }, [loadTree])

  useEffect(() => {
    if (!folderId || tree.length === 0) return
    const node = findFolderInTreeByParam(tree, folderId)
    if (!node?.slug?.trim()) return
    const seg = fileFolderNavSegment(node)
    if (isTestingUuidParam(folderId) && seg !== folderId) {
      setSearchParams({ folder: seg }, { replace: true })
    }
  }, [tree, folderId, setSearchParams])

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

  useEffect(() => {
    setListSelection(new Set())
    setSearchQuery('')
    setColumnFilters({})
    setOpenFilterColumn(null)
  }, [folderId])

  const searchLower = searchQuery.trim().toLowerCase()
  const isGlobalSearchMode = debouncedSearch.trim().length > 0

  const effectiveFolders = isGlobalSearchMode ? globalSearchFolders : childFolders
  const effectiveFiles = isGlobalSearchMode ? globalSearchFiles : files

  const searchFilteredFolders = useMemo(() => {
    if (isGlobalSearchMode) return effectiveFolders
    if (!searchLower) return childFolders
    return childFolders.filter((f) => explorerRowMatchesSearch(searchLower, { kind: 'folder', row: f }))
  }, [isGlobalSearchMode, effectiveFolders, childFolders, searchLower])

  const searchFilteredFiles = useMemo(() => {
    if (isGlobalSearchMode) return effectiveFiles
    if (!searchLower) return files
    return files.filter((f) => explorerRowMatchesSearch(searchLower, { kind: 'file', row: f }))
  }, [isGlobalSearchMode, effectiveFiles, files, searchLower])

  const distinctColumnValues = useMemo(
    () => buildDistinctColumnValues(searchFilteredFolders, searchFilteredFiles),
    [searchFilteredFolders, searchFilteredFiles]
  )

  const displayFolders = useMemo(() => {
    return searchFilteredFolders.filter((row) =>
      passesExplorerColumnFilters(
        explorerItemFilterValues({ kind: 'folder', row }),
        columnFilters,
        distinctColumnValues
      )
    )
  }, [searchFilteredFolders, columnFilters, distinctColumnValues])

  const displayFiles = useMemo(() => {
    return searchFilteredFiles.filter((row) =>
      passesExplorerColumnFilters(
        explorerItemFilterValues({ kind: 'file', row }),
        columnFilters,
        distinctColumnValues
      )
    )
  }, [searchFilteredFiles, columnFilters, distinctColumnValues])

  const hasActiveExplorerFilters =
    searchQuery.trim() !== '' ||
    EXPLORER_COLUMN_KEYS.some((k) => isExplorerColumnFilterActive(k, columnFilters, distinctColumnValues))

  const clearExplorerFilters = useCallback(() => {
    setSearchQuery('')
    setColumnFilters({})
    setOpenFilterColumn(null)
  }, [])

  const onHeaderSort = useCallback((sortBy: FileSortBy) => {
    setPrefs((p) => {
      if (p.sortBy !== sortBy) return { ...p, sortBy, sortOrder: 'asc' }
      return { ...p, sortOrder: p.sortOrder === 'asc' ? 'desc' : 'asc' }
    })
  }, [])

  useEffect(() => {
    if (prefs.viewMode !== 'list') setListSelection(new Set())
  }, [prefs.viewMode])

  const mergedItems = useCallback(() => {
    type Item = { kind: 'folder'; row: FileFolderRow } | { kind: 'file'; row: StoredFileRow }
    const out: Item[] = displayFolders.map((row) => ({ kind: 'folder' as const, row }))
    for (const row of displayFiles) out.push({ kind: 'file', row })
    return out
  }, [displayFolders, displayFiles])

  const onOpenItem = async (item: ReturnType<typeof mergedItems>[number]) => {
    if (item.kind === 'folder') {
      goFolder(fileFolderNavSegment(item.row))
      return
    }
    const row = item.row
    const cat = previewCategory(row.mime_type)
    if (cat === 'other') {
      const ok = await showConfirm(
        `No preview is available for this file type. Download "${row.original_filename}"?`,
        {
          title: 'Download file',
          confirmLabel: 'Download',
          cancelLabel: 'Cancel',
          variant: 'default',
        }
      )
      if (!ok) return
      try {
        await downloadStoredFile(row.id)
      } catch {
        showAlert('Download failed.', 'Files')
      }
      return
    }
    setPreviewFile(row)
  }

  const uploadFilesFromList = useCallback(
    async (fileArray: File[]) => {
      if (!canManage || fileArray.length === 0) return
      const uploaded: StoredFileRow[] = []
      try {
        for (let i = 0; i < fileArray.length; i++) {
          uploaded.push(await uploadStoredFile(fileArray[i], { folderId }))
        }
        await loadListing()
        refreshGlobalSearchIfActive()
        requestFilesTreeRefresh()
        setPreviewFile(null)
        const allEditable = uploaded.every((r) => canEditStoredFileMeta(r, userId, canManageAcl))
        if (uploaded.length >= 2 && allEditable) {
          setBulkApplyTargets(uploaded)
        } else if (uploaded.length === 1 && allEditable) {
          setEditTarget(uploaded[0])
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed'
        showAlert(msg, 'Upload')
      }
    },
    [canManage, folderId, loadListing, refreshGlobalSearchIfActive, userId, canManageAcl, showAlert]
  )

  const onPickFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files
    if (!picked?.length) return
    await uploadFilesFromList(Array.from(picked))
    e.target.value = ''
  }

  const [dropActive, setDropActive] = useState(false)

  const hasFileDrag = (e: DragEvent) =>
    Array.from(e.dataTransfer?.types ?? []).includes('Files')

  const onExplorerDragEnter = (e: DragEvent) => {
    if (!canManage || !hasFileDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    setDropActive(true)
  }

  const onExplorerDragLeave = (e: DragEvent) => {
    if (!canManage) return
    e.preventDefault()
    e.stopPropagation()
    const related = e.relatedTarget as Node | null
    const el = e.currentTarget
    if (related && el instanceof Element && el.contains(related)) {
      return
    }
    setDropActive(false)
  }

  const onExplorerDragOver = (e: DragEvent) => {
    if (!canManage || !hasFileDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }

  const onExplorerDrop = (e: DragEvent) => {
    if (!canManage) return
    e.preventDefault()
    e.stopPropagation()
    setDropActive(false)
    const dt = e.dataTransfer.files
    if (!dt?.length) return
    void uploadFilesFromList(Array.from(dt))
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
        refreshGlobalSearchIfActive()
        requestFilesTreeRefresh()
        return true
      } catch {
        showAlert('Could not create folder (duplicate name?).', 'Files')
        return false
      }
    },
    [canManageAcl, loadListing, refreshGlobalSearchIfActive, showAlert]
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
  const rawListingEmpty = isGlobalSearchMode
    ? globalSearchFolders.length === 0 && globalSearchFiles.length === 0
    : childFolders.length === 0 && files.length === 0
  const showListingSpinner = isGlobalSearchMode ? globalSearchLoading : loading
  const filtersExcludedEverything =
    !rawListingEmpty && items.length === 0 && hasActiveExplorerFilters

  const listSelectKeys = useMemo(
    () => displayFolders.map((r) => `folder:${r.id}`).concat(displayFiles.map((r) => `file:${r.id}`)),
    [displayFolders, displayFiles]
  )

  const allListSelected =
    listSelectKeys.length > 0 && listSelectKeys.every((k) => listSelection.has(k))
  const someListSelected = listSelectKeys.some((k) => listSelection.has(k))

  useEffect(() => {
    const el = listSelectAllRef.current
    if (!el) return
    el.indeterminate = someListSelected && !allListSelected
  }, [someListSelected, allListSelected])

  const clearListSelection = useCallback(() => setListSelection(new Set()), [])

  const toggleListKey = useCallback((key: string) => {
    setListSelection((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const onListSelectAllClick = useCallback(() => {
    setListSelection((prev) => {
      const next = new Set(prev)
      if (listSelectKeys.every((k) => prev.has(k))) {
        for (const k of listSelectKeys) next.delete(k)
      } else {
        for (const k of listSelectKeys) next.add(k)
      }
      return next
    })
  }, [listSelectKeys])

  const handleListDownloadSelected = useCallback(async () => {
    const keys = Array.from(listSelection)
    for (let i = 0; i < keys.length; i++) {
      const p = parseListSelectionKey(keys[i])
      if (!p) continue
      try {
        if (p.kind === 'folder') await downloadFolderArchive(p.id)
        else await downloadStoredFile(p.id)
      } catch {
        showAlert('Download failed.', 'Files')
      }
      if (i < keys.length - 1) await new Promise((r) => setTimeout(r, 200))
    }
  }, [listSelection, showAlert])

  const handleListEditSelected = useCallback(() => {
    const parsed = Array.from(listSelection)
      .map(parseListSelectionKey)
      .filter((x): x is NonNullable<typeof x> => x != null)
    if (parsed.length === 0) return
    const fileRows = parsed
      .filter((p) => p.kind === 'file')
      .map((p) => displayFiles.find((f) => f.id === p.id))
      .filter((x): x is StoredFileRow => x != null)
    const folderRows = parsed
      .filter((p) => p.kind === 'folder')
      .map((p) => displayFolders.find((f) => f.id === p.id))
      .filter((x): x is FileFolderRow => x != null)

    if (fileRows.length + folderRows.length < parsed.length) {
      showAlert('Some items are no longer in this folder.', 'Files')
      return
    }

    if (fileRows.length && folderRows.length) {
      showAlert('Select only files or only folders to edit.', 'Files')
      return
    }
    if (folderRows.length) {
      if (folderRows.length > 1) {
        showAlert('Edit one folder at a time.', 'Files')
        return
      }
      if (!canManage) {
        showAlert('You do not have permission to edit folders.', 'Files')
        return
      }
      setFolderEditTarget(folderRows[0])
      return
    }
    if (fileRows.length === 1) {
      const f = fileRows[0]
      if (!canEditStoredFileMeta(f, userId, canManageAcl)) {
        showAlert('You do not have permission to edit this file.', 'Files')
        return
      }
      setEditTarget(f)
      return
    }
    if (fileRows.length >= 2) {
      const allEditable = fileRows.every((f) => canEditStoredFileMeta(f, userId, canManageAcl))
      if (!allEditable) {
        showAlert('Some selected files cannot be edited.', 'Files')
        return
      }
      setBulkApplyTargets(fileRows)
    }
  }, [listSelection, displayFiles, displayFolders, canManage, canManageAcl, userId, showAlert])

  const handleListDeleteSelected = useCallback(async () => {
    if (!canManage) return
    const parsed = Array.from(listSelection)
      .map(parseListSelectionKey)
      .filter((x): x is NonNullable<typeof x> => x != null)
    if (parsed.length === 0) return

    let confirmMessage: string
    if (parsed.length === 1 && parsed[0].kind === 'folder') {
      const folderId = parsed[0].id
      const row = displayFolders.find((c) => c.id === folderId)
      const name = row?.name ?? 'folder'
      let fileCount = 0
      let subfolderCount = 0
      try {
        const impact = await getFolderDeleteImpact(folderId)
        fileCount = impact.fileCount
        subfolderCount = impact.subfolderCount
      } catch {
        showAlert('Could not check folder contents.', 'Files')
        return
      }
      const parts: string[] = []
      if (fileCount > 0) parts.push(`${fileCount} file${fileCount === 1 ? '' : 's'}`)
      if (subfolderCount > 0) parts.push(`${subfolderCount} subfolder${subfolderCount === 1 ? '' : 's'}`)
      const detail =
        fileCount === 0 && subfolderCount === 0
          ? 'This folder is empty.'
          : `This will permanently delete ${parts.join(' and ')} (including all nested items).`
      confirmMessage = `Delete folder “${name}”? ${detail} This cannot be undone.`
    } else if (parsed.some((p) => p.kind === 'folder')) {
      confirmMessage = `Delete ${parsed.length} item(s)? Folders will be removed with all nested files and subfolders. This cannot be undone.`
    } else {
      confirmMessage = `Delete ${parsed.length} file(s)? This cannot be undone.`
    }

    const ok = await showConfirm(confirmMessage, {
      title: 'Delete items',
      variant: 'danger',
      confirmLabel: 'Delete',
    })
    if (!ok) return

    const deletedFileIds = new Set<string>()
    for (const p of parsed) {
      try {
        if (p.kind === 'folder') await deleteFolder(p.id)
        else {
          await deleteStoredFile(p.id)
          deletedFileIds.add(p.id)
        }
      } catch {
        showAlert('Delete failed.', 'Files')
      }
    }
    setListSelection(new Set())
    setPreviewFile((prev) => (prev && deletedFileIds.has(prev.id) ? null : prev))
    void loadListing()
    refreshGlobalSearchIfActive()
    requestFilesTreeRefresh()
  }, [listSelection, displayFolders, canManage, showConfirm, showAlert, loadListing, refreshGlobalSearchIfActive])

  const explorerLayoutToolbar = (
    <div className="flex flex-wrap items-center justify-end gap-2 border-b border-border bg-muted/30 px-2 py-1.5">
      <div className="flex items-center gap-0.5" role="group" aria-label="View layout">
        <button
          type="button"
          title="List view"
          aria-label="List view"
          aria-pressed={prefs.viewMode === 'list'}
          onClick={() => setPrefs((p) => ({ ...p, viewMode: 'list' }))}
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-foreground hover:bg-muted ${
            prefs.viewMode === 'list' ? 'border-primary bg-primary/10' : 'border-border bg-background'
          }`}
        >
          <ViewListIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Grid view"
          aria-label="Grid view"
          aria-pressed={prefs.viewMode === 'grid'}
          onClick={() => setPrefs((p) => ({ ...p, viewMode: 'grid' }))}
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-foreground hover:bg-muted ${
            prefs.viewMode === 'grid' ? 'border-primary bg-primary/10' : 'border-border bg-background'
          }`}
        >
          <ViewGridIcon className="h-4 w-4" />
        </button>
      </div>
      {prefs.viewMode === 'grid' ? (
        <div className="flex flex-wrap items-center gap-1 border-l border-border pl-2" role="group" aria-label="Thumbnail size">
          {GRID_THUMB_SIZE_OPTIONS.map((o) => {
            const Icon = GRID_THUMB_SIZE_ICONS[o.value]
            const selected = prefs.gridThumbSize === o.value
            const hint = o.maxPx > 0 ? `${o.maxPx}px max` : 'Full cell width'
            return (
              <button
                key={o.value}
                type="button"
                title={`${o.label} (${hint})`}
                aria-label={`${o.label} thumbnails`}
                aria-pressed={selected}
                onClick={() => setPrefs((p) => ({ ...p, gridThumbSize: o.value }))}
                className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-foreground hover:bg-muted ${
                  selected ? 'border-primary bg-primary/10' : 'border-border bg-background'
                }`}
              >
                <Icon className="h-4 w-4" />
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )

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
                  to={filesPathWithFolder(fileFolderNavSegment(seg))}
                  className="hover:text-primary hover:underline"
                  onClick={() => setPreviewFile(null)}
                >
                  {seg.name}
                </Link>
              </span>
            ))}
          </nav>
        </div>

        <div className="flex flex-wrap items-end gap-3 border-b border-border bg-muted/15 px-2 py-2">
          <div className="flex min-w-[200px] max-w-2xl flex-1 flex-col gap-0.5">
            <label htmlFor={searchInputId} className="text-xs font-medium text-foreground/80">
              Search library
            </label>
            <div className="relative">
              <input
                id={searchInputId}
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Name, type, or MIME — searches all accessible folders"
                autoComplete="off"
                className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-sm text-foreground placeholder:text-foreground/40"
                aria-label="Search library"
              />
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground/45">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </span>
            </div>
            {debouncedSearch.trim() ? (
              <p className="text-[11px] text-foreground/55">Searching everywhere you can access (not only this folder).</p>
            ) : null}
          </div>
          {hasActiveExplorerFilters ? (
            <button
              type="button"
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground hover:bg-muted"
              onClick={clearExplorerFilters}
            >
              Clear search & filters
            </button>
          ) : null}
        </div>

        {prefs.viewMode === 'list' && listSelection.size > 0 ? (
          <div
            className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-2 py-2"
            role="toolbar"
            aria-label="Selected items"
          >
            <span className="text-xs text-foreground/70">{listSelection.size} selected</span>
            <button
              type="button"
              className="rounded border border-border bg-background px-2 py-1 text-xs hover:bg-muted"
              onClick={clearListSelection}
            >
              Clear
            </button>
            <button
              type="button"
              className="rounded border border-border bg-background px-2 py-1 text-xs hover:bg-muted"
              onClick={() => void handleListDownloadSelected()}
            >
              Download
            </button>
            <button
              type="button"
              className="rounded border border-border bg-background px-2 py-1 text-xs hover:bg-muted"
              onClick={handleListEditSelected}
            >
              Edit
            </button>
            {canManage ? (
              <button
                type="button"
                className="rounded border border-destructive/50 bg-background px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                onClick={() => void handleListDeleteSelected()}
              >
                Delete
              </button>
            ) : null}
          </div>
        ) : null}

        <div
          className={`relative min-h-0 flex-1 overflow-auto p-2 ${canManage ? 'min-h-[10rem]' : ''}`}
          onDragEnter={onExplorerDragEnter}
          onDragLeave={onExplorerDragLeave}
          onDragOver={onExplorerDragOver}
          onDrop={onExplorerDrop}
          role="region"
          aria-label="Folder contents"
        >
          {canManage && dropActive ? (
            <div
              className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10"
              aria-hidden
            >
              <span className="rounded-md bg-card/95 px-4 py-2 text-sm font-medium text-foreground shadow-sm ring-1 ring-border">
                Drop files to upload
              </span>
            </div>
          ) : null}
          {showListingSpinner ? (
            <p className="text-sm text-foreground/60">Loading…</p>
          ) : rawListingEmpty ? (
            <p className="text-sm text-foreground/60">
              {isGlobalSearchMode ? (
                <>
                  No matches in the library.{' '}
                  <button
                    type="button"
                    className="text-primary underline hover:opacity-90"
                    onClick={() => {
                      setSearchQuery('')
                      setColumnFilters({})
                      setOpenFilterColumn(null)
                    }}
                  >
                    Clear search
                  </button>
                </>
              ) : (
                <>
                  This folder is empty.
                  {canManage ? (
                    <>
                      {' '}
                      Drag files here or use <span className="font-medium text-foreground/80">Upload</span> in the
                      sidebar.
                    </>
                  ) : null}
                </>
              )}
            </p>
          ) : filtersExcludedEverything ? (
            <p className="text-sm text-foreground/60">
              No items match your search or filters.{' '}
              <button
                type="button"
                className="text-primary underline hover:opacity-90"
                onClick={clearExplorerFilters}
              >
                Clear search & filters
              </button>
            </p>
          ) : prefs.viewMode === 'grid' ? (
            <div className="overflow-hidden rounded-lg border border-border">
              {explorerLayoutToolbar}
              <div className={`p-2 ${gridLayoutClassName}`}>
              {items.map((item) =>
                item.kind === 'folder' ? (
                  <button
                    key={`f-${item.row.id}`}
                    type="button"
                    className="flex h-full min-h-0 flex-col rounded-lg border border-border bg-card p-2 text-left hover:bg-muted/50"
                    onClick={() => void onOpenItem(item)}
                  >
                    <GridThumbFrame thumbMaxPx={gridThumbMaxPx}>
                      <div className="absolute inset-0 flex items-center justify-center text-amber-700/90 dark:text-amber-400/90">
                        <FolderGlyph className="h-14 w-14 shrink-0" />
                      </div>
                    </GridThumbFrame>
                    <div className="mt-1 shrink-0 truncate text-xs font-medium">{item.row.name}</div>
                    <div
                      className="line-clamp-2 shrink-0 text-[10px] text-foreground/50"
                      title={isGlobalSearchMode ? item.row.location_path ?? undefined : undefined}
                    >
                      {isGlobalSearchMode ? item.row.location_path?.trim() || '—' : '—'}
                    </div>
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
                    <GridThumb
                      fileId={item.row.id}
                      mime={item.row.mime_type}
                      filename={item.row.original_filename}
                      thumbMaxPx={gridThumbMaxPx}
                    />
                    <div className="mt-1 shrink-0 truncate text-xs font-medium" title={item.row.original_filename}>
                      {item.row.original_filename}
                    </div>
                    {isGlobalSearchMode ? (
                      <div
                        className="line-clamp-2 shrink-0 text-[10px] text-foreground/50"
                        title={item.row.location_path ?? undefined}
                      >
                        {item.row.location_path?.trim() || '—'}
                      </div>
                    ) : null}
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
            </div>
          ) : (
            <div className="rounded-lg border border-border">
              {explorerLayoutToolbar}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                <thead className="sticky top-0 z-30 border-b border-border bg-muted/40 shadow-sm">
                  <tr>
                    <th className="w-10 px-2 py-2" scope="col">
                      <input
                        ref={listSelectAllRef}
                        type="checkbox"
                        className="h-4 w-4 rounded border-border"
                        checked={allListSelected}
                        onChange={onListSelectAllClick}
                        aria-label={isGlobalSearchMode ? 'Select all matching items' : 'Select all items in this folder'}
                        title="Select all"
                      />
                    </th>
                    <th
                      className="relative min-w-0 cursor-pointer select-none px-3 py-2 font-medium hover:bg-background/50"
                      scope="col"
                      aria-sort={
                        prefs.sortBy === 'name'
                          ? prefs.sortOrder === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                      onClick={() => onHeaderSort('name')}
                      title="Sort by name"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="min-w-0">Name</span>
                        {prefs.sortBy === 'name' ? (
                          <span className="shrink-0 text-foreground/60">{prefs.sortOrder === 'asc' ? '↓' : '↑'}</span>
                        ) : null}
                        <button
                          type="button"
                          ref={(el) => {
                            filterAnchorRefs.current.name = el
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            setOpenFilterColumn((c) => (c === 'name' ? null : 'name'))
                          }}
                          className={`shrink-0 rounded p-0.5 hover:bg-background ${
                            isExplorerColumnFilterActive('name', columnFilters, distinctColumnValues)
                              ? 'text-primary'
                              : 'text-foreground/50'
                          }`}
                          title="Filter by name"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                            />
                          </svg>
                        </button>
                      </span>
                      {openFilterColumn === 'name' ? (
                        <ColumnFilterDropdown
                          columnKey="name"
                          columnLabel="Name"
                          values={distinctColumnValues.name}
                          selected={new Set(columnFilters.name ?? distinctColumnValues.name)}
                          onChange={(s) => {
                            setColumnFilters((prev) => ({ ...prev, name: Array.from(s) }))
                          }}
                          onClose={() => setOpenFilterColumn(null)}
                          tableAnchorRefs={filterAnchorRefs}
                          tableAnchorKey="name"
                        />
                      ) : null}
                    </th>
                    {isGlobalSearchMode ? (
                      <th className="hidden min-w-0 max-w-[14rem] px-3 py-2 font-medium md:table-cell" scope="col">
                        Location
                      </th>
                    ) : null}
                    <th
                      className="relative hidden min-w-0 cursor-pointer select-none px-3 py-2 font-medium hover:bg-background/50 sm:table-cell"
                      scope="col"
                      aria-sort={
                        prefs.sortBy === 'type'
                          ? prefs.sortOrder === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                      onClick={() => onHeaderSort('type')}
                      title="Sort by type"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span>Type</span>
                        {prefs.sortBy === 'type' ? (
                          <span className="shrink-0 text-foreground/60">{prefs.sortOrder === 'asc' ? '↓' : '↑'}</span>
                        ) : null}
                        <button
                          type="button"
                          ref={(el) => {
                            filterAnchorRefs.current.type = el
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            setOpenFilterColumn((c) => (c === 'type' ? null : 'type'))
                          }}
                          className={`shrink-0 rounded p-0.5 hover:bg-background ${
                            isExplorerColumnFilterActive('type', columnFilters, distinctColumnValues)
                              ? 'text-primary'
                              : 'text-foreground/50'
                          }`}
                          title="Filter by type"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                            />
                          </svg>
                        </button>
                      </span>
                      {openFilterColumn === 'type' ? (
                        <ColumnFilterDropdown
                          columnKey="type"
                          columnLabel="Type"
                          values={distinctColumnValues.type}
                          selected={new Set(columnFilters.type ?? distinctColumnValues.type)}
                          onChange={(s) => setColumnFilters((prev) => ({ ...prev, type: Array.from(s) }))}
                          onClose={() => setOpenFilterColumn(null)}
                          tableAnchorRefs={filterAnchorRefs}
                          tableAnchorKey="type"
                        />
                      ) : null}
                    </th>
                    <th
                      className="relative min-w-0 cursor-pointer select-none px-3 py-2 font-medium hover:bg-background/50"
                      scope="col"
                      aria-sort={
                        prefs.sortBy === 'size'
                          ? prefs.sortOrder === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                      onClick={() => onHeaderSort('size')}
                      title="Sort by size"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span>Size</span>
                        {prefs.sortBy === 'size' ? (
                          <span className="shrink-0 text-foreground/60">{prefs.sortOrder === 'asc' ? '↓' : '↑'}</span>
                        ) : null}
                        <button
                          type="button"
                          ref={(el) => {
                            filterAnchorRefs.current.size = el
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            setOpenFilterColumn((c) => (c === 'size' ? null : 'size'))
                          }}
                          className={`shrink-0 rounded p-0.5 hover:bg-background ${
                            isExplorerColumnFilterActive('size', columnFilters, distinctColumnValues)
                              ? 'text-primary'
                              : 'text-foreground/50'
                          }`}
                          title="Filter by size"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                            />
                          </svg>
                        </button>
                      </span>
                      {openFilterColumn === 'size' ? (
                        <ColumnFilterDropdown
                          columnKey="size"
                          columnLabel="Size"
                          values={distinctColumnValues.size}
                          selected={new Set(columnFilters.size ?? distinctColumnValues.size)}
                          onChange={(s) => setColumnFilters((prev) => ({ ...prev, size: Array.from(s) }))}
                          onClose={() => setOpenFilterColumn(null)}
                          tableAnchorRefs={filterAnchorRefs}
                          tableAnchorKey="size"
                        />
                      ) : null}
                    </th>
                    <th className="relative hidden min-w-0 px-3 py-2 font-medium md:table-cell" scope="col">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="cursor-default select-none">Uploaded by</span>
                        <button
                          type="button"
                          ref={(el) => {
                            filterAnchorRefs.current.uploader = el
                          }}
                          onClick={() => setOpenFilterColumn((c) => (c === 'uploader' ? null : 'uploader'))}
                          className={`shrink-0 rounded p-0.5 hover:bg-background ${
                            isExplorerColumnFilterActive('uploader', columnFilters, distinctColumnValues)
                              ? 'text-primary'
                              : 'text-foreground/50'
                          }`}
                          title="Filter by uploader"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                            />
                          </svg>
                        </button>
                      </span>
                      {openFilterColumn === 'uploader' ? (
                        <ColumnFilterDropdown
                          columnKey="uploader"
                          columnLabel="Uploaded by"
                          values={distinctColumnValues.uploader}
                          selected={new Set(columnFilters.uploader ?? distinctColumnValues.uploader)}
                          onChange={(s) => setColumnFilters((prev) => ({ ...prev, uploader: Array.from(s) }))}
                          onClose={() => setOpenFilterColumn(null)}
                          tableAnchorRefs={filterAnchorRefs}
                          tableAnchorKey="uploader"
                        />
                      ) : null}
                    </th>
                    <th
                      className="relative hidden min-w-0 cursor-pointer select-none px-3 py-2 font-medium hover:bg-background/50 lg:table-cell"
                      scope="col"
                      aria-sort={
                        prefs.sortBy === 'date'
                          ? prefs.sortOrder === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                      onClick={() => onHeaderSort('date')}
                      title="Sort by date"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span>Date</span>
                        {prefs.sortBy === 'date' ? (
                          <span className="shrink-0 text-foreground/60">{prefs.sortOrder === 'asc' ? '↓' : '↑'}</span>
                        ) : null}
                        <button
                          type="button"
                          ref={(el) => {
                            filterAnchorRefs.current.date = el
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            setOpenFilterColumn((c) => (c === 'date' ? null : 'date'))
                          }}
                          className={`shrink-0 rounded p-0.5 hover:bg-background ${
                            isExplorerColumnFilterActive('date', columnFilters, distinctColumnValues)
                              ? 'text-primary'
                              : 'text-foreground/50'
                          }`}
                          title="Filter by date"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                            />
                          </svg>
                        </button>
                      </span>
                      {openFilterColumn === 'date' ? (
                        <ColumnFilterDropdown
                          columnKey="date"
                          columnLabel="Date"
                          values={distinctColumnValues.date}
                          selected={new Set(columnFilters.date ?? distinctColumnValues.date)}
                          onChange={(s) => setColumnFilters((prev) => ({ ...prev, date: Array.from(s) }))}
                          onClose={() => setOpenFilterColumn(null)}
                          tableAnchorRefs={filterAnchorRefs}
                          tableAnchorKey="date"
                        />
                      ) : null}
                    </th>
                    <th className="sticky right-0 z-20 w-36 min-w-[9rem] border-l border-border bg-muted/40 px-2 py-2 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) =>
                    item.kind === 'folder' ? (
                      <tr
                        key={`f-${item.row.id}`}
                        className={`border-b border-border/80 ${listSelection.has(`folder:${item.row.id}`) ? 'bg-muted/35' : ''}`}
                      >
                        <td className="w-10 px-2 py-2 align-middle">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-border"
                            checked={listSelection.has(`folder:${item.row.id}`)}
                            onChange={() => toggleListKey(`folder:${item.row.id}`)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`Select folder ${item.row.name}`}
                          />
                        </td>
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
                        {isGlobalSearchMode ? (
                          <td
                            className="hidden max-w-[14rem] truncate px-3 py-2 text-foreground/70 md:table-cell"
                            title={item.row.location_path ?? undefined}
                          >
                            {item.row.location_path?.trim() || '—'}
                          </td>
                        ) : null}
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
                      <tr
                        key={item.row.id}
                        className={`border-b border-border/80 ${listSelection.has(`file:${item.row.id}`) ? 'bg-muted/35' : ''}`}
                      >
                        <td className="w-10 px-2 py-2 align-middle">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-border"
                            checked={listSelection.has(`file:${item.row.id}`)}
                            onChange={() => toggleListKey(`file:${item.row.id}`)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`Select file ${item.row.original_filename}`}
                          />
                        </td>
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
                            <span className="inline-flex min-w-0 items-center gap-1.5">
                              {!fileSupportsInlinePreview(item.row.mime_type) ? (
                                <FileTypeGlyphIcon
                                  mime={item.row.mime_type}
                                  filename={item.row.original_filename}
                                  className="h-4 w-4 shrink-0 text-foreground/70"
                                />
                              ) : null}
                              <span className="sm:hidden">{truncateTableFilename(item.row.original_filename)}</span>
                              <span className="hidden truncate sm:inline">{item.row.original_filename}</span>
                            </span>
                          </button>
                        </td>
                        {isGlobalSearchMode ? (
                          <td
                            className="hidden max-w-[14rem] truncate px-3 py-2 text-foreground/70 md:table-cell"
                            title={item.row.location_path ?? undefined}
                          >
                            {item.row.location_path?.trim() || '—'}
                          </td>
                        ) : null}
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
          refreshGlobalSearchIfActive()
          requestFilesTreeRefresh()
        }}
        onDeleted={({ id, parentId }) => {
          setFolderEditTarget(null)
          const openHit = folderId ? findFolderInTreeByParam(tree, folderId) : null
          const viewingDeleted = openHit?.id === id
          if (viewingDeleted) {
            let nextKey: string | null = null
            if (parentId) {
              const pNode = findFolderInTreeByParam(tree, parentId)
              nextKey = pNode ? fileFolderNavSegment(pNode) : parentId
            }
            setSearchParams(nextKey ? { folder: nextKey } : {})
            setPreviewFile(null)
          }
          void loadListing()
          refreshGlobalSearchIfActive()
          requestFilesTreeRefresh()
        }}
      />
      <BulkFileUploadApplyModal
        open={bulkApplyTargets !== null && bulkApplyTargets.length > 0}
        files={bulkApplyTargets ?? []}
        canManageAcl={canManageAcl}
        canCreateFolder={canManage}
        onClose={() => setBulkApplyTargets(null)}
        onApplied={() => {
          void loadListing()
          refreshGlobalSearchIfActive()
          requestFilesTreeRefresh()
        }}
      />
      <FileEditModal
        open={editTarget !== null}
        file={editTarget}
        canManageAcl={canManageAcl}
        canDelete={canManage}
        canCreateFolder={canManage}
        onClose={() => setEditTarget(null)}
        onSaved={(row) => {
          setPreviewFile((p) => (p?.id === row.id ? row : p))
          void loadListing()
          refreshGlobalSearchIfActive()
        }}
        onDeleted={(id) => {
          setPreviewFile((p) => (p?.id === id ? null : p))
          setEditTarget((t) => (t?.id === id ? null : t))
          void loadListing()
          refreshGlobalSearchIfActive()
        }}
      />
    </div>
  )
}
