import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getFolderTree,
  listRecycledFiles,
  permanentlyDeleteStoredFile,
  restoreStoredFile,
  type FileFolderTreeNode,
  type StoredFileRow,
} from '@/api/files'
import { RestoreFileToFolderModal } from '@/components/files/RestoreFileToFolderModal'
import { useAlertConfirm } from '@/contexts/AlertConfirmContext'
import { useAuthStore } from '@/store/authStore'
import { formatDateTime } from '@/lib/dateTimeConfig'
import { FILES_PREFIX } from '@/lib/appPaths'
import { FILES_TREE_REFRESH_EVENT } from '@/lib/filesTreeRefresh'
import { formatRecycleAutoDeleteLabel, remainingPurgesUntilAutoDelete } from '@/lib/recyclePurgeRemaining'

function flattenFolderLabels(nodes: FileFolderTreeNode[], acc: Map<string, string>, prefix = ''): void {
  for (const n of nodes) {
    const label = prefix ? `${prefix} / ${n.name}` : n.name
    acc.set(n.id, label)
    if (n.children?.length) flattenFolderLabels(n.children, acc, label)
  }
}

/** Folder column: current tree path, else remembered path when folder was deleted, else id. */
function recycleRowFolderLabel(r: StoredFileRow, folderMap: Map<string, string>): string {
  const primary = r.folder_id?.trim() || r.recycle_original_folder_id?.trim() || null
  if (!primary) return 'Library root'
  const fromTree = folderMap.get(primary)
  if (fromTree) return fromTree
  const remembered = r.recycle_original_folder_label?.trim()
  if (remembered) return remembered
  return primary
}

function needsRestoreFolderPicker(row: StoredFileRow, folderIds: Set<string>): boolean {
  const fid = row.folder_id?.trim() || ''
  const rem = row.recycle_original_folder_id?.trim() || ''
  if (!fid && !rem) return false
  if (fid && folderIds.has(fid)) return false
  if (rem && folderIds.has(rem)) return false
  return true
}

export function FilesRecycleBin() {
  const hasPermission = useAuthStore((s) => s.hasPermission)
  const canManage = hasPermission('files.manage')
  const canManageAcl = canManage || hasPermission('*')
  const { showAlert, showConfirm } = useAlertConfirm()
  const [rows, setRows] = useState<StoredFileRow[]>([])
  const [retentionDays, setRetentionDays] = useState(30)
  const [tree, setTree] = useState<FileFolderTreeNode[]>([])
  const [folderMap, setFolderMap] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [pickRow, setPickRow] = useState<StoredFileRow | null>(null)

  const folderIds = useMemo(() => new Set(folderMap.keys()), [folderMap])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [recycled, folderTree] = await Promise.all([listRecycledFiles(), getFolderTree()])
      const m = new Map<string, string>()
      flattenFolderLabels(folderTree, m)
      setFolderMap(m)
      setTree(folderTree)
      setRows(recycled.items)
      setRetentionDays(recycled.retentionDays)
    } catch {
      setRows([])
      showAlert('Could not load recycle bin.')
    } finally {
      setLoading(false)
    }
  }, [showAlert])

  useEffect(() => {
    void load()
  }, [load])

  const [pending, setPending] = useState<Set<string>>(new Set())

  const setBusy = (id: string, on: boolean) => {
    setPending((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const runRestore = async (row: StoredFileRow, withFolder?: { folderId: string | null }) => {
    setBusy(row.id, true)
    try {
      if (withFolder) {
        await restoreStoredFile(row.id, { folderId: withFolder.folderId })
      } else {
        await restoreStoredFile(row.id)
      }
      window.dispatchEvent(new Event(FILES_TREE_REFRESH_EVENT))
      await load()
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Restore failed'
      showAlert(msg)
    } finally {
      setBusy(row.id, false)
    }
  }

  const onRestoreClick = (row: StoredFileRow) => {
    if (needsRestoreFolderPicker(row, folderIds)) {
      setPickRow(row)
      return
    }
    void runRestore(row)
  }

  const confirmRestoreToFolder = (folderId: string | null) => {
    if (!pickRow) return
    const row = pickRow
    setPickRow(null)
    void runRestore(row, { folderId })
  }

  const onPermanent = async (row: StoredFileRow) => {
    const ok = await showConfirm(`Permanently delete “${row.original_filename}”? This cannot be undone.`, {
      title: 'Delete permanently',
      variant: 'danger',
    })
    if (!ok) return
    setBusy(row.id, true)
    try {
      await permanentlyDeleteStoredFile(row.id)
      window.dispatchEvent(new Event(FILES_TREE_REFRESH_EVENT))
      await load()
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Delete failed'
      showAlert(msg)
    } finally {
      setBusy(row.id, false)
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <RestoreFileToFolderModal
        key={pickRow?.id ?? 'closed'}
        open={pickRow !== null}
        filename={pickRow?.original_filename ?? ''}
        folderTree={tree}
        initialFolderId={pickRow?.recycle_original_folder_id?.trim() || pickRow?.folder_id?.trim() || undefined}
        canCreateFolder={canManage}
        canManageAcl={canManageAcl}
        onFolderTreeUpdated={(t) => {
          const m = new Map<string, string>()
          flattenFolderLabels(t, m)
          setFolderMap(m)
          setTree(t)
        }}
        onConfirm={confirmRestoreToFolder}
        onCancel={() => setPickRow(null)}
      />
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 px-0.5">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Recycle bin</h1>
          <p className="mt-1 text-sm text-foreground/70">
            Restore files or remove them permanently. Items older than the retention period are removed automatically
            each night.
          </p>
        </div>
        <Link
          to={FILES_PREFIX}
          className="text-sm font-medium text-primary hover:underline"
        >
          ← Back to files
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-foreground/60">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-foreground/70">No files in the recycle bin.</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
              <tr className="border-b border-border">
                <th className="px-3 py-2 font-medium text-foreground">Name</th>
                <th className="px-3 py-2 font-medium text-foreground">Folder</th>
                <th className="px-3 py-2 font-medium text-foreground">Deleted</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium text-foreground" title="After this many nightly purge runs, the item may be removed permanently.">
                  Auto-delete in
                </th>
                <th className="px-3 py-2 text-right font-medium text-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/80 hover:bg-muted/30">
                  <td className="max-w-[min(28rem,40vw)] truncate px-3 py-2 font-medium text-foreground">
                    {r.original_filename}
                  </td>
                  <td className="px-3 py-2 text-foreground/80">
                    {recycleRowFolderLabel(r, folderMap)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-foreground/75">
                    {r.deleted_at ? formatDateTime(new Date(r.deleted_at)) : '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-foreground/80">
                    {formatRecycleAutoDeleteLabel(
                      r.deleted_at
                        ? remainingPurgesUntilAutoDelete(r.deleted_at, retentionDays)
                        : null
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button
                      type="button"
                      disabled={pending.has(r.id)}
                      onClick={() => onRestoreClick(r)}
                      className="mr-2 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                    >
                      Restore
                    </button>
                    <button
                      type="button"
                      disabled={pending.has(r.id)}
                      onClick={() => void onPermanent(r)}
                      className="rounded-md border border-red-500/40 bg-background px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
                    >
                      Delete forever
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
