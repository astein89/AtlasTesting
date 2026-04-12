import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  listWikiRecyclePages,
  permanentlyDeleteWikiRecyclePage,
  restoreWikiRecyclePage,
  type WikiRecycleListItem,
} from '@/api/wiki'
import { useAlertConfirm } from '@/contexts/AlertConfirmContext'
import { WIKI_PREFIX } from '@/lib/appPaths'
import { requestWikiPagesRefresh } from '@/lib/wikiPagesRefresh'
import { formatDateTime } from '@/lib/dateTimeConfig'
import { formatRecycleAutoDeleteLabel, remainingPurgesUntilAutoDelete } from '@/lib/recyclePurgeRemaining'

export function WikiRecycleBin() {
  const { showAlert, showConfirm } = useAlertConfirm()
  const [rows, setRows] = useState<WikiRecycleListItem[]>([])
  const [retentionDays, setRetentionDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { items, retentionDays: rd } = await listWikiRecyclePages()
      setRows(items)
      setRetentionDays(rd)
    } catch {
      setRows([])
      showAlert('Could not load wiki recycle bin.')
    } finally {
      setLoading(false)
    }
  }, [showAlert])

  useEffect(() => {
    void load()
  }, [load])

  const setBusy = (key: string, on: boolean) => {
    setPending((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const onRestore = async (storageRel: string) => {
    setBusy(storageRel, true)
    try {
      await restoreWikiRecyclePage(storageRel)
      requestWikiPagesRefresh()
      await load()
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Restore failed'
      showAlert(msg)
    } finally {
      setBusy(storageRel, false)
    }
  }

  const onPermanent = async (row: WikiRecycleListItem) => {
    const label = row.title?.trim() || row.wikiPath
    const ok = await showConfirm(`Permanently delete “${label}”? This cannot be undone.`, {
      title: 'Delete permanently',
      variant: 'danger',
    })
    if (!ok) return
    setBusy(row.storageRel, true)
    try {
      await permanentlyDeleteWikiRecyclePage(row.storageRel)
      requestWikiPagesRefresh()
      await load()
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Delete failed'
      showAlert(msg)
    } finally {
      setBusy(row.storageRel, false)
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col px-1">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Wiki recycle bin</h1>
          <p className="mt-1 text-sm text-foreground/70">
            Restore pages or delete them forever. Older items are removed automatically based on retention in
            Settings.
          </p>
        </div>
        <Link to={WIKI_PREFIX} className="text-sm font-medium text-primary hover:underline">
          ← Back to wiki
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-foreground/60">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-foreground/70">No pages in the recycle bin.</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
              <tr className="border-b border-border">
                <th className="px-3 py-2 font-medium text-foreground">Page</th>
                <th className="px-3 py-2 font-medium text-foreground">Path</th>
                <th className="px-3 py-2 font-medium text-foreground">Deleted</th>
                <th
                  className="whitespace-nowrap px-3 py-2 font-medium text-foreground"
                  title="After this many nightly purge runs, the page may be removed permanently."
                >
                  Auto-delete in
                </th>
                <th className="px-3 py-2 text-right font-medium text-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.storageRel} className="border-b border-border/80 hover:bg-muted/30">
                  <td className="max-w-[min(24rem,45vw)] truncate px-3 py-2 font-medium text-foreground">
                    {r.title?.trim() || r.wikiPath}
                  </td>
                  <td className="font-mono text-xs text-foreground/80 px-3 py-2">{r.wikiPath}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-foreground/75">
                    {formatDateTime(new Date(r.deletedAt))}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-foreground/80">
                    {formatRecycleAutoDeleteLabel(remainingPurgesUntilAutoDelete(r.deletedAt, retentionDays))}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button
                      type="button"
                      disabled={pending.has(r.storageRel)}
                      onClick={() => void onRestore(r.storageRel)}
                      className="mr-2 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                    >
                      Restore
                    </button>
                    <button
                      type="button"
                      disabled={pending.has(r.storageRel)}
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
