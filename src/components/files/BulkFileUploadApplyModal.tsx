import { useEffect, useId, useMemo, useState } from 'react'
import {
  createFolder,
  getFolderTree,
  getRolesForFileAcl,
  updateStoredFile,
  type FileFolderTreeNode,
  type RoleOption,
  type StoredFileRow,
} from '@/api/files'
import { NewFolderModal, type NewFolderSubmitPayload } from '@/components/files/NewFolderModal'
import { useAlertConfirm } from '@/contexts/AlertConfirmContext'
import { flatFolderSelectOptions } from '@/lib/filesFolderOptions'
import { requestFilesTreeRefresh } from '@/lib/filesTreeRefresh'

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

/**
 * After uploading multiple files: one step to set folder and visibility for all rows.
 * Display names stay as the uploaded filenames (no per-file rename).
 */
export function BulkFileUploadApplyModal({
  open,
  files,
  canManageAcl,
  canCreateFolder = false,
  onClose,
  onApplied,
}: {
  open: boolean
  files: StoredFileRow[]
  canManageAcl: boolean
  canCreateFolder?: boolean
  onClose: () => void
  onApplied: () => void
}) {
  const { showAlert } = useAlertConfirm()
  const titleId = useId()
  const folderSelectId = useId()
  const inheritFolderId = useId()
  const [targetFolderId, setTargetFolderId] = useState<string | null>(null)
  const [inheritFromFolder, setInheritFromFolder] = useState(true)
  const [folderTree, setFolderTree] = useState<FileFolderTreeNode[]>([])
  const [foldersLoading, setFoldersLoading] = useState(false)
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([])
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [createFolderOpen, setCreateFolderOpen] = useState(false)

  const first = files[0]

  useEffect(() => {
    if (!open || !first) return
    setTargetFolderId(first.folder_id)
    const inh =
      first.inherit_folder_acl === undefined ||
      first.inherit_folder_acl === null ||
      first.inherit_folder_acl === 1
    setInheritFromFolder(inh)
    setSelectedSlugs(parseStoredSlugs(first.allowed_role_slugs))
  }, [open, first?.id, first?.folder_id, first?.allowed_role_slugs, first?.inherit_folder_acl, first])

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
      if (e.key !== 'Escape' || saving || createFolderOpen) return
      onClose()
    }
    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose, saving, createFolderOpen])

  useEffect(() => {
    if (!open) setCreateFolderOpen(false)
  }, [open])

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

  const apply = async () => {
    if (files.length === 0) return
    setSaving(true)
    try {
      const sortedRoles = [...new Set(selectedSlugs)].sort()
      for (const f of files) {
        await updateStoredFile(f.id, {
          folderId: targetFolderId,
          ...(canManageAcl
            ? {
                inheritFolderAcl: inheritFromFolder,
                allowedRoleSlugs: inheritFromFolder ? null : sortedRoles.length > 0 ? sortedRoles : null,
              }
            : {}),
        })
      }
      onApplied()
      onClose()
    } catch {
      showAlert('Could not update all files.', 'Files')
    } finally {
      setSaving(false)
    }
  }

  const handleCreateFolder = async (payload: NewFolderSubmitPayload): Promise<boolean> => {
    try {
      const row = await createFolder(payload.parentId, payload.name.trim(), {
        ...(canManageAcl && payload.allowedRoleSlugs !== undefined
          ? { allowedRoleSlugs: payload.allowedRoleSlugs }
          : {}),
      })
      const t = await getFolderTree()
      setFolderTree(t)
      requestFilesTreeRefresh()
      setTargetFolderId(row.id)
      return true
    } catch {
      showAlert('Could not create folder (duplicate name?).', 'Files')
      return false
    }
  }

  if (!open || files.length === 0) return null

  const n = files.length
  const previewRows = files.slice(0, 12)
  const extra = n > 12 ? n - 12 : 0

  return (
    <>
      <NewFolderModal
        open={createFolderOpen}
        defaultParentId={targetFolderId}
        canManageAcl={canManageAcl}
        onClose={() => setCreateFolderOpen(false)}
        onCreate={handleCreateFolder}
      />
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
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
            Set location and permissions
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex h-11 min-w-[44px] shrink-0 items-center justify-center rounded-lg text-foreground/70 hover:bg-background hover:text-foreground disabled:opacity-50"
            aria-label="Close"
          >
            <span className="text-2xl leading-none" aria-hidden>
              ×
            </span>
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
          <p className="text-foreground/80">
            <span className="font-medium text-foreground">{n}</span> files uploaded. Names match the files on your
            device.
          </p>
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-foreground/50">Files</div>
            <ul className="max-h-32 list-inside list-disc overflow-y-auto text-xs text-foreground/90">
              {previewRows.map((f) => (
                <li key={f.id} className="truncate" title={f.original_filename}>
                  {f.original_filename}
                </li>
              ))}
            </ul>
            {extra > 0 ? (
              <p className="mt-1 text-xs text-foreground/60">+{extra} more</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor={folderSelectId} className="block font-medium text-foreground">
                Folder
              </label>
              {canCreateFolder ? (
                <button
                  type="button"
                  disabled={saving || foldersLoading}
                  onClick={() => setCreateFolderOpen(true)}
                  className="text-sm font-medium text-primary hover:underline disabled:opacity-50"
                >
                  New folder…
                </button>
              ) : null}
            </div>
            <select
              id={folderSelectId}
              value={targetFolderId ?? ''}
              onChange={(e) => setTargetFolderId(e.target.value === '' ? null : e.target.value)}
              disabled={saving || foldersLoading}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground disabled:opacity-60"
            >
              <option value="">Files (root)</option>
              {flatFolderSelectOptions(folderTree).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            {foldersLoading ? (
              <p className="text-xs text-foreground/60">Loading folders…</p>
            ) : null}
          </div>

          {canManageAcl ? (
            <div>
              <span className="mb-1 block text-sm font-medium text-foreground">Visible to roles</span>
              <label className="mb-3 flex cursor-pointer items-start gap-2 text-sm text-foreground">
                <input
                  id={inheritFolderId}
                  type="checkbox"
                  className="mt-0.5 rounded border-border"
                  checked={inheritFromFolder}
                  disabled={saving}
                  onChange={(e) => setInheritFromFolder(e.target.checked)}
                />
                <span>
                  <span className="font-medium">Match folder (default)</span>
                  <span className="mt-0.5 block text-xs text-foreground/60">
                    Uses each file’s folder and parent folders’ role settings, or turn off to set roles for these
                    uploads only.
                  </span>
                </span>
              </label>
              {!inheritFromFolder ? (
                <>
                  <p className="mb-2 text-xs text-foreground/60">
                    Custom roles for these files only. Leave none selected to allow anyone with Files access.
                  </p>
                  <ul className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-border bg-background p-3">
                    {orphanSlugs.map((slug) => (
                      <li key={`orphan-${slug}`}>
                        <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
                          <input
                            type="checkbox"
                            className="mt-0.5 rounded border-border"
                            checked={selectedSlugs.includes(slug)}
                            disabled={saving}
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
                              disabled={saving}
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
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-3 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="min-h-[44px] min-w-[100px] rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void apply()}
            className="min-h-[44px] min-w-[100px] rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Applying…' : 'Apply to all'}
          </button>
        </div>
      </div>
    </div>
    </>
  )
}
