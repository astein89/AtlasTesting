import { useEffect, useId, useMemo, useState } from 'react'
import {
  createFolder,
  getFolderTree,
  type FileFolderTreeNode,
} from '@/api/files'
import { NewFolderModal, type NewFolderSubmitPayload } from '@/components/files/NewFolderModal'
import { useAlertConfirm } from '@/contexts/AlertConfirmContext'
import { requestFilesTreeRefresh } from '@/lib/filesTreeRefresh'

function flattenFolderOptions(
  nodes: FileFolderTreeNode[],
  prefix = ''
): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = []
  for (const n of nodes) {
    const label = prefix ? `${prefix} / ${n.name}` : n.name
    out.push({ id: n.id, label })
    if (n.children?.length) out.push(...flattenFolderOptions(n.children, label))
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
}

export function RestoreFileToFolderModal({
  open,
  filename,
  folderTree,
  initialFolderId,
  canCreateFolder = false,
  canManageAcl = false,
  onFolderTreeUpdated,
  onConfirm,
  onCancel,
}: {
  open: boolean
  filename: string
  folderTree: FileFolderTreeNode[]
  /** Pre-select folder id when still available */
  initialFolderId?: string | null
  canCreateFolder?: boolean
  /** When true, new folders can include custom visibility (same as Files explorer). */
  canManageAcl?: boolean
  onFolderTreeUpdated?: (tree: FileFolderTreeNode[]) => void
  onConfirm: (folderId: string | null) => void
  onCancel: () => void
}) {
  const { showAlert } = useAlertConfirm()
  const folderSelectId = useId()
  const options = useMemo(() => flattenFolderOptions(folderTree), [folderTree])
  const [value, setValue] = useState<string>('')
  const [createFolderOpen, setCreateFolderOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    if (initialFolderId && options.some((o) => o.id === initialFolderId)) {
      setValue(initialFolderId)
    } else {
      setValue('')
    }
    // `options` omitted: tree refresh after "New folder" must not reset the picker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFolderId])

  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !createFolderOpen) onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onCancel, createFolderOpen])

  useEffect(() => {
    if (!open) setCreateFolderOpen(false)
  }, [open])

  const handleCreateFolder = async (payload: NewFolderSubmitPayload): Promise<boolean> => {
    try {
      const row = await createFolder(payload.parentId, payload.name.trim(), {
        ...(canManageAcl && payload.allowedRoleSlugs !== undefined
          ? { allowedRoleSlugs: payload.allowedRoleSlugs }
          : {}),
      })
      const t = await getFolderTree()
      onFolderTreeUpdated?.(t)
      requestFilesTreeRefresh()
      setValue(row.id)
      return true
    } catch {
      showAlert('Could not create folder (duplicate name?).', 'Files')
      return false
    }
  }

  if (!open) return null

  return (
    <>
      <NewFolderModal
        open={createFolderOpen}
        defaultParentId={value === '' ? null : value}
        canManageAcl={canManageAcl}
        onClose={() => setCreateFolderOpen(false)}
        onCreate={handleCreateFolder}
      />
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onClick={createFolderOpen ? undefined : onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="restore-file-modal-title"
    >
      <div
        className="flex w-full max-w-md flex-col rounded-xl border border-border bg-card p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="restore-file-modal-title" className="text-lg font-semibold text-foreground">
          Restore to folder
        </h2>
        <p className="mt-2 text-sm text-foreground/80">
          The original folder for <span className="font-medium text-foreground">“{filename}”</span> is no longer
          available. Choose where to restore the file.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={folderSelectId} className="block text-sm font-medium text-foreground">
            Folder
          </label>
          {canCreateFolder ? (
            <button
              type="button"
              onClick={() => setCreateFolderOpen(true)}
              className="text-sm font-medium text-primary hover:underline"
            >
              New folder…
            </button>
          ) : null}
        </div>
        <select
          id={folderSelectId}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
        >
          <option value="">Library root (no folder)</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(value === '' ? null : value)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Restore
          </button>
        </div>
      </div>
    </div>
    </>
  )
}
