import { useEffect, useId, useMemo, useState } from 'react'
import {
  deleteFolder,
  getFolderDeleteImpact,
  getFolderTree,
  getRolesForFileAcl,
  updateFolder,
  type FileFolderRow,
  type FileFolderTreeNode,
  type RoleOption,
} from '@/api/files'

function parseStoredSlugs(json: string | null): string[] {
  if (!json) return []
  try {
    const p = JSON.parse(json) as unknown
    return Array.isArray(p)
      ? p.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean)
      : []
  } catch {
    return []
  }
}
import { useAlertConfirm } from '@/contexts/AlertConfirmContext'
import {
  findFolderNode,
  flatFolderParentSelectOptions,
  subtreeFolderIds,
} from '@/lib/filesFolderOptions'

export function FolderEditModal({
  open,
  folder,
  canManageAcl,
  canDelete,
  onClose,
  onSaved,
  onDeleted,
}: {
  open: boolean
  folder: FileFolderRow | null
  canManageAcl: boolean
  canDelete: boolean
  onClose: () => void
  onSaved: (row: FileFolderRow) => void
  onDeleted: (payload: { id: string; parentId: string | null }) => void
}) {
  const { showAlert, showConfirm } = useAlertConfirm()
  const titleId = useId()
  const nameInputId = useId()
  const parentSelectId = useId()
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState<string | null>(null)
  const [folderTree, setFolderTree] = useState<FileFolderTreeNode[]>([])
  const [foldersLoading, setFoldersLoading] = useState(false)
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([])
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const busy = saving || deleting

  useEffect(() => {
    if (!open || !folder) return
    setName(folder.name)
    setParentId(folder.parent_id)
    setSelectedSlugs(parseStoredSlugs(folder.allowed_role_slugs))
  }, [open, folder?.id, folder?.name, folder?.parent_id, folder?.allowed_role_slugs, folder])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setFoldersLoading(true)
    void getFolderTree()
      .then((t) => {
        if (!cancelled) setFolderTree(t)
      })
      .catch(() => {
        if (!cancelled) setFolderTree([])
      })
      .finally(() => {
        if (!cancelled) setFoldersLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open || !canManageAcl) {
      setRoleOptions([])
      return
    }
    let cancelled = false
    void getRolesForFileAcl()
      .then((rows) => {
        if (!cancelled) setRoleOptions(rows)
      })
      .catch(() => {
        if (!cancelled) setRoleOptions([])
      })
    return () => {
      cancelled = true
    }
  }, [open, canManageAcl])

  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy) return
      onClose()
    }
    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose, busy])

  useEffect(() => {
    if (!open) setDeleting(false)
  }, [open])

  const excludeIds = useMemo(() => {
    if (!folder) return new Set<string>()
    const node = findFolderNode(folderTree, folder.id)
    if (!node) return new Set<string>([folder.id])
    return subtreeFolderIds(node)
  }, [folder, folderTree])

  const parentOptions = useMemo(
    () => flatFolderParentSelectOptions(folderTree, excludeIds),
    [folderTree, excludeIds]
  )

  const knownSlugSet = useMemo(() => new Set(roleOptions.map((r) => r.slug)), [roleOptions])
  const orphanSlugs = useMemo(
    () => selectedSlugs.filter((s) => !knownSlugSet.has(s)),
    [selectedSlugs, knownSlugSet]
  )

  const toggleRole = (slug: string) => {
    setSelectedSlugs((prev) => {
      const has = prev.includes(slug)
      if (has) return prev.filter((s) => s !== slug)
      return [...prev, slug]
    })
  }

  if (!open || !folder) return null

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      showAlert('Enter a folder name.', 'Files')
      return
    }
    setSaving(true)
    try {
      const sortedRoles = [...new Set(selectedSlugs)].sort()
      const updated = await updateFolder(folder.id, {
        name: trimmed,
        parentId,
        ...(canManageAcl
          ? { allowedRoleSlugs: sortedRoles.length > 0 ? sortedRoles : null }
          : {}),
      })
      onSaved(updated)
      onClose()
    } catch {
      showAlert('Could not save folder (duplicate name here or invalid parent?).', 'Files')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!canDelete) return
    let fileCount = 0
    let subfolderCount = 0
    try {
      const impact = await getFolderDeleteImpact(folder.id)
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
    const ok = await showConfirm(`Delete folder “${folder.name}”? ${detail}`, {
      title: 'Delete folder',
      variant: 'danger',
      confirmLabel: 'Delete',
    })
    if (!ok) return
    setDeleting(true)
    try {
      await deleteFolder(folder.id)
      onDeleted({ id: folder.id, parentId: folder.parent_id })
      onClose()
    } catch {
      showAlert('Could not delete folder.', 'Files')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onClick={busy ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border pl-4 pr-1">
          <h2 id={titleId} className="min-w-0 flex-1 py-3 pr-2 text-lg font-semibold leading-tight text-foreground">
            Edit folder
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex h-11 min-w-[44px] shrink-0 items-center justify-center rounded-lg text-foreground/70 hover:bg-background hover:text-foreground disabled:opacity-50"
            aria-label="Close"
          >
            <span className="text-2xl leading-none" aria-hidden>
              ×
            </span>
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
          <label className="block space-y-1.5" htmlFor={nameInputId}>
            <span className="font-medium text-foreground">Name</span>
            <input
              id={nameInputId}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              autoComplete="off"
              disabled={busy}
              maxLength={200}
            />
          </label>

          <div className="space-y-1.5">
            <label htmlFor={parentSelectId} className="block font-medium text-foreground">
              Parent folder
            </label>
            <select
              id={parentSelectId}
              value={parentId ?? ''}
              onChange={(e) => setParentId(e.target.value === '' ? null : e.target.value)}
              disabled={busy || foldersLoading}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground disabled:opacity-60"
            >
              {parentOptions.map((o) => (
                <option key={o.id ?? 'root'} value={o.id ?? ''}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-foreground/60">Name may not include / or \\. Max 200 characters.</p>
            {foldersLoading ? <p className="text-xs text-foreground/60">Loading folders…</p> : null}
          </div>

          {canManageAcl ? (
            <div>
              <span className="mb-1 block text-sm font-medium text-foreground">Visible to roles</span>
              <p className="mb-2 text-xs text-foreground/60">
                Applies to this folder and, by default, all files inside (files use <strong>Match folder</strong> unless
                you set custom roles on a file). Leave none selected for anyone with Files access.
              </p>
              <ul className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-border bg-background p-3">
                {orphanSlugs.map((slug) => (
                  <li key={`orphan-${slug}`}>
                    <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        className="mt-0.5 rounded border-border"
                        checked={selectedSlugs.includes(slug)}
                        disabled={busy}
                        onChange={() => toggleRole(slug)}
                      />
                      <span>
                        {slug}{' '}
                        <span className="text-foreground/50">(not in current role list)</span>
                      </span>
                    </label>
                  </li>
                ))}
                {roleOptions.length === 0 && orphanSlugs.length === 0 ? (
                  <li className="text-sm text-foreground/60">Loading roles…</li>
                ) : (
                  roleOptions.map((r) => (
                    <li key={r.slug}>
                      <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
                        <input
                          type="checkbox"
                          className="mt-0.5 rounded border-border"
                          checked={selectedSlugs.includes(r.slug)}
                          disabled={busy}
                          onChange={() => toggleRole(r.slug)}
                        />
                        <span>
                          {r.label} <span className="text-foreground/50">({r.slug})</span>
                        </span>
                      </label>
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
          <div className="min-w-0">
            {canDelete ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmDelete()}
                className="min-h-[44px] rounded-lg px-3 text-left text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete folder'}
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="min-h-[44px] min-w-[100px] rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || foldersLoading}
              onClick={() => void save()}
              className="min-h-[44px] min-w-[100px] rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
