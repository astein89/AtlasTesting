import { FILES_PREFIX } from '@/lib/appPaths'

/** Query key for the current Files folder (`/files?folder=<id>`). */
export const FILES_FOLDER_QUERY = 'folder'

/** Build `/files` URL with optional folder id (for Link / navigate). */
export function filesPathWithFolder(folderId: string | null | undefined): string {
  const id = typeof folderId === 'string' ? folderId.trim() : ''
  if (!id) return FILES_PREFIX
  return `${FILES_PREFIX}?${FILES_FOLDER_QUERY}=${encodeURIComponent(id)}`
}

/** Read folder id from `URLSearchParams` (null = library root). */
export function folderIdFromSearch(params: URLSearchParams): string | null {
  const raw = params.get(FILES_FOLDER_QUERY)?.trim()
  return raw || null
}
