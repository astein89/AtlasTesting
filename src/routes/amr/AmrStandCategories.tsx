import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getAmrStands } from '@/api/amr'
import { AmrZoneCategoriesModal } from '@/components/amr/AmrZoneCategoriesModal'
import { amrPath } from '@/lib/appPaths'
import { useAuthStore } from '@/store/authStore'

/**
 * Dedicated page for editing zone categories. Reuses {@link AmrZoneCategoriesModal} via its
 * `inline` mode so the same DnD editor is rendered in normal page flow (no overlay/backdrop).
 */
export function AmrStandCategories() {
  const navigate = useNavigate()
  const canEdit = useAuthStore((s) => s.hasPermission('amr.settings'))
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  /**
   * Bumping `key` after Save remounts the editor so it pulls the freshly-saved settings + zone
   * counts (otherwise the inline component holds stale local state from the previous edit).
   */
  const [resetKey, setResetKey] = useState(0)

  const reloadStands = useCallback(async () => {
    setLoading(true)
    try {
      const s = await getAmrStands()
      setRows(s)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reloadStands()
  }, [reloadStands])

  const allZones = useMemo(
    () =>
      Array.from(
        new Set(
          rows
            .map((r) => String(r.zone ?? '').trim())
            .filter((z): z is string => z !== '')
        )
      ).sort((a, b) => a.localeCompare(b)),
    [rows]
  )

  const zoneStandCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of rows) {
      const z = String(r.zone ?? '').trim()
      if (!z) continue
      m[z] = (m[z] ?? 0) + 1
    }
    return m
  }, [rows])

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Zone categories</h1>
          <p className="mt-1 text-sm text-foreground/70">
            Group zones into ordered categories that the stand picker uses to organize choices.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Link
            to={amrPath('stands')}
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-background"
          >
            View stands
          </Link>
          <Link
            to={amrPath('stands', 'manage')}
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-background"
          >
            Manage stands
          </Link>
        </div>
      </div>

      {!canEdit ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          You don&apos;t have permission to change AMR settings. The categories shown here are read-only.
        </div>
      ) : null}

      <div className="rounded-xl border border-border bg-card p-4">
        {loading ? (
          <p className="text-sm text-foreground/60">Loading stands…</p>
        ) : (
          <AmrZoneCategoriesModal
            key={resetKey}
            inline
            allZones={allZones}
            zoneStandCounts={zoneStandCounts}
            onClose={() => navigate(amrPath('stands'))}
            onSaved={() => {
              setResetKey((n) => n + 1)
              void reloadStands()
            }}
          />
        )}
      </div>
    </div>
  )
}

export default AmrStandCategories
