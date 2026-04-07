export type FileAclRow = {
  uploaded_by: string
  allowed_role_slugs: string | null
  /** Legacy column; ignored for access checks (role-only ACL). */
  required_permission?: string | null
}

export type FolderAclRow = {
  allowed_role_slugs: string | null
  created_by: string | null
}

export type FileUserContext = {
  id: string
  roles: string[]
  permissions: string[]
}

export type StoredFileAccessRow = {
  uploaded_by: string
  allowed_role_slugs: string | null
  folder_id: string | null
  /** 1 = use folder ACL chain; 0 = use only `allowed_role_slugs` on the file. */
  inherit_folder_acl: number | null | undefined
}

/**
 * Per-file ACL: **role slugs only**. If `allowed_role_slugs` is non-empty, the user must have
 * at least one matching role slug. Empty/unset = any user with `module.files`. Uploader and `*` always pass.
 */
export function fileAccessibleToUser(row: FileAclRow, user: FileUserContext): boolean {
  if (user.permissions.includes('*')) return true
  if (row.uploaded_by === user.id) return true
  const raw = row.allowed_role_slugs?.trim()
  if (!raw) return true
  try {
    const slugs = JSON.parse(raw) as unknown
    if (!Array.isArray(slugs) || slugs.length === 0) return true
    const set = new Set(user.roles.map((r) => String(r).trim()).filter(Boolean))
    return slugs.some((s) => typeof s === 'string' && set.has(s.trim()))
  } catch {
    return true
  }
}

/**
 * Folder ACL: same role rules; folder **creator** may always open (like file uploader).
 */
export function folderAccessibleToUser(row: FolderAclRow, user: FileUserContext): boolean {
  if (user.permissions.includes('*')) return true
  if (row.created_by && row.created_by === user.id) return true
  const raw = row.allowed_role_slugs?.trim()
  if (!raw) return true
  try {
    const slugs = JSON.parse(raw) as unknown
    if (!Array.isArray(slugs) || slugs.length === 0) return true
    const set = new Set(user.roles.map((r) => String(r).trim()).filter(Boolean))
    return slugs.some((s) => typeof s === 'string' && set.has(s.trim()))
  } catch {
    return true
  }
}

/** Each inner array is one folder level: user must match **at least one** slug per level (AND across levels). */
export function userMatchesAllFolderAclLayers(layers: string[][], user: FileUserContext): boolean {
  if (layers.length === 0) return true
  if (user.permissions.includes('*')) return true
  const roleSet = new Set(user.roles.map((r) => String(r).trim()).filter(Boolean))
  return layers.every((layer) => layer.some((s) => roleSet.has(s)))
}

/**
 * Stored file access: uploader / `*` always; if `inherit_folder_acl` is off, only file ACL applies;
 * if on (default), `folderAclLayers` from the folder chain replaces file `allowed_role_slugs` for the check.
 */
export function storedFileAccessibleToUser(
  row: StoredFileAccessRow,
  user: FileUserContext,
  folderAclLayers: string[][]
): boolean {
  if (user.permissions.includes('*')) return true
  if (row.uploaded_by === user.id) return true

  const useInherit =
    row.inherit_folder_acl === undefined || row.inherit_folder_acl === null || row.inherit_folder_acl === 1

  if (!useInherit) {
    return fileAccessibleToUser(
      { uploaded_by: row.uploaded_by, allowed_role_slugs: row.allowed_role_slugs },
      user
    )
  }

  return userMatchesAllFolderAclLayers(folderAclLayers, user)
}
