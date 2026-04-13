import { FILES_PREFIX } from '@/lib/appPaths'

/** Query key for the current Files folder (`/files?folder=<slug-or-uuid>`). */
export const FILES_FOLDER_QUERY = 'folder'

/** Prefer stable slug in URLs when present; otherwise folder UUID. */
export function fileFolderNavSegment(f: { id: string; slug?: string | null }): string {
  const s = f.slug?.trim()
  return s || f.id
}

/** Build `/files` URL with optional folder slug or UUID (for Link / navigate). */
export function filesPathWithFolder(folderSlugOrId: string | null | undefined): string {
  const id = typeof folderSlugOrId === 'string' ? folderSlugOrId.trim() : ''
  if (!id) return FILES_PREFIX
  return `${FILES_PREFIX}?${FILES_FOLDER_QUERY}=${encodeURIComponent(id)}`
}

/** Read folder id from `URLSearchParams` (null = library root). */
export function folderIdFromSearch(params: URLSearchParams): string | null {
  const raw = params.get(FILES_FOLDER_QUERY)?.trim()
  return raw || null
}
