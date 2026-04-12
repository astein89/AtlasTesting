import { api } from './client'

export type RoleOption = { slug: string; label: string }

/** Role slugs for file ACL picker (`files.manage` or full admin). */
export async function getRolesForFileAcl(): Promise<RoleOption[]> {
  const { data } = await api.get<RoleOption[]>('/roles/acl-picker')
  return data
}

export type FileSortBy = 'name' | 'date' | 'size' | 'type'
export type SortOrder = 'asc' | 'desc'

export type FileFolderRow = {
  id: string
  parent_id: string | null
  name: string
  created_at: string | null
  allowed_role_slugs: string | null
  created_by: string | null
  /** Present on `/files/search` hits: parent folder path label. */
  location_path?: string | null
}

export type FileFolderTreeNode = FileFolderRow & { children: FileFolderTreeNode[] }

export type StoredFileRow = {
  id: string
  original_filename: string
  storage_filename: string
  mime_type: string | null
  size_bytes: number | null
  uploaded_by: string
  created_at: string | null
  folder_id: string | null
  allowed_role_slugs: string | null
  /** Unused; always null (role-only ACL). */
  required_permission?: string | null
  /** When true (1), visibility follows folder (and ancestor folder) role settings. */
  inherit_folder_acl?: number | null
  uploaded_by_username?: string | null
  /** ISO timestamp when soft-deleted; absent = active. */
  deleted_at?: string | null
  /** Last folder before `folder_id` was cleared (e.g. parent folder deleted). */
  recycle_original_folder_id?: string | null
  /** Saved display path when that folder was deleted (server). */
  recycle_original_folder_label?: string | null
  /** Present on `/files/search` hits: folder path where the file lives. */
  location_path?: string | null
}

export async function getFolderTree(): Promise<FileFolderTreeNode[]> {
  const { data } = await api.get<FileFolderTreeNode[]>('/files/folders/tree')
  return data
}

export async function listChildFolders(parentId: string | null): Promise<FileFolderRow[]> {
  const { data } = await api.get<FileFolderRow[]>('/files/folders', {
    params: parentId ? { parentId } : {},
  })
  return data
}

export async function createFolder(
  parentId: string | null,
  name: string,
  options?: { allowedRoleSlugs?: string[] | null }
): Promise<FileFolderRow> {
  const { data } = await api.post<FileFolderRow>('/files/folders', {
    parentId,
    name,
    ...(options?.allowedRoleSlugs !== undefined ? { allowedRoleSlugs: options.allowedRoleSlugs } : {}),
  })
  return data
}

export async function updateFolder(
  folderId: string,
  body: { name?: string; parentId?: string | null; allowedRoleSlugs?: string[] | null }
): Promise<FileFolderRow> {
  const { data } = await api.patch<FileFolderRow>(`/files/folders/${encodeURIComponent(folderId)}`, body)
  return data
}

export async function deleteFolder(folderId: string): Promise<void> {
  await api.delete(`/files/folders/${encodeURIComponent(folderId)}`)
}

export type FolderDeleteImpact = { fileCount: number; subfolderCount: number }

export async function getFolderDeleteImpact(folderId: string): Promise<FolderDeleteImpact> {
  const { data } = await api.get<FolderDeleteImpact>(
    `/files/folders/${encodeURIComponent(folderId)}/delete-impact`
  )
  return data
}

export async function listStoredFiles(params: {
  folderId: string | null
  sortBy: FileSortBy
  order: SortOrder
}): Promise<StoredFileRow[]> {
  const { data } = await api.get<StoredFileRow[]>('/files', {
    params: {
      folderId: params.folderId ?? undefined,
      sortBy: params.sortBy,
      order: params.order,
    },
  })
  return data
}

export async function searchLibraryFiles(params: {
  q: string
  sortBy: FileSortBy
  order: SortOrder
  signal?: AbortSignal
}): Promise<{ folders: FileFolderRow[]; files: StoredFileRow[] }> {
  const { data } = await api.get<{ folders: FileFolderRow[]; files: StoredFileRow[] }>('/files/search', {
    params: { q: params.q, sortBy: params.sortBy, order: params.order },
    signal: params.signal,
  })
  return data
}

export type UploadFileOptions = {
  folderId?: string | null
  allowedRoleSlugs?: string[]
}

export async function uploadStoredFile(file: File, options?: UploadFileOptions): Promise<StoredFileRow> {
  const form = new FormData()
  form.append('file', file)
  if (options?.folderId) form.append('folderId', options.folderId)
  if (options?.allowedRoleSlugs?.length) {
    form.append('allowedRoleSlugs', JSON.stringify(options.allowedRoleSlugs))
  }
  const { data } = await api.post<StoredFileRow>('/files', form, {
    transformRequest: [
      (body, headers) => {
        if (body instanceof FormData) {
          delete headers['Content-Type']
        }
        return body
      },
    ],
  })
  return data
}

export async function updateStoredFile(
  id: string,
  body: {
    folderId?: string | null
    allowedRoleSlugs?: string[] | null
    /** When true, `allowedRoleSlugs` on the file row is ignored for access; folder chain applies. */
    inheritFolderAcl?: boolean
    /** Display name only; does not change stored blob or `storage_filename`. */
    originalFilename?: string
  }
): Promise<StoredFileRow> {
  const { data } = await api.put<StoredFileRow>(`/files/${encodeURIComponent(id)}`, body)
  return data
}

function parseFilenameFromContentDisposition(cd: string | undefined): string | null {
  if (!cd) return null
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)
  if (star) {
    try {
      return decodeURIComponent(star[1].trim())
    } catch {
      return star[1].trim()
    }
  }
  const quoted = /filename="([^"]+)"/i.exec(cd)
  if (quoted) return quoted[1]
  const plain = /filename=([^;]+)/i.exec(cd)
  if (plain) return plain[1].trim().replace(/^"|"$/g, '')
  return null
}

export async function fetchFileViewBlob(fileId: string): Promise<{ blob: Blob; mime: string }> {
  const res = await api.get<Blob>(`/files/${encodeURIComponent(fileId)}/view`, {
    responseType: 'blob',
  })
  const raw = res.headers['content-type'] as string | undefined
  const mime = (raw?.split(';')[0] ?? 'application/octet-stream').trim()
  return { blob: res.data, mime }
}

export async function downloadStoredFile(fileId: string): Promise<void> {
  const res = await api.get<Blob>(`/files/${encodeURIComponent(fileId)}/download`, {
    responseType: 'blob',
  })
  const cd = res.headers['content-disposition'] as string | undefined
  const name = parseFilenameFromContentDisposition(cd) ?? 'download'
  const blob = res.data
  const objectUrl = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = name
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

/** Download folder (and subfolders) as a .zip of files the current user may access. */
export async function downloadFolderArchive(folderId: string): Promise<void> {
  const res = await api.get<Blob>(`/files/folders/${encodeURIComponent(folderId)}/download`, {
    responseType: 'blob',
    timeout: 300_000,
  })
  const cd = res.headers['content-disposition'] as string | undefined
  const name = parseFilenameFromContentDisposition(cd) ?? 'folder.zip'
  const blob = res.data
  const objectUrl = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = name
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export async function deleteStoredFile(fileId: string): Promise<void> {
  await api.delete(`/files/${encodeURIComponent(fileId)}`)
}

export async function listRecycledFiles(): Promise<{ items: StoredFileRow[]; retentionDays: number }> {
  const { data } = await api.get<{ items: StoredFileRow[]; retentionDays: number }>('/files/recycle')
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    retentionDays: typeof data?.retentionDays === 'number' ? data.retentionDays : 30,
  }
}

export async function restoreStoredFile(id: string, opts?: { folderId: string | null }): Promise<StoredFileRow> {
  const { data } = await api.post<StoredFileRow>(
    `/files/${encodeURIComponent(id)}/restore`,
    opts !== undefined ? { folderId: opts.folderId } : {}
  )
  return data
}

export async function permanentlyDeleteStoredFile(id: string): Promise<void> {
  await api.delete(`/files/${encodeURIComponent(id)}/permanent`)
}

export function previewCategory(mime: string | null | undefined): 'image' | 'pdf' | 'text' | 'markdown' | 'csv' | 'other' {
  const m = (mime || '').toLowerCase()
  if (m.startsWith('image/')) return 'image'
  if (m === 'application/pdf') return 'pdf'
  if (m === 'text/markdown' || m.endsWith('/markdown')) return 'markdown'
  if (m === 'text/csv' || m === 'application/csv') return 'csv'
  if (m.startsWith('text/')) return 'text'
  return 'other'
}
