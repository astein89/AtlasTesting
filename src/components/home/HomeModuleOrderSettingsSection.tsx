import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/api/client'
import { useAlertConfirm } from '@/contexts/AlertConfirmContext'
import { HomeModuleCardsSortableList } from '@/components/home/HomeModuleCardsSortableList'
import { mergeHomeModuleOrder, normalizeModulesHiddenFromHomeIds } from '@/lib/homeModuleOrder'
import { normalizeModuleCardOverrides } from '@/lib/moduleCardPresentation'
import type { HomePageConfig, ModuleCardOverride } from '@/types/homePage'

const SAVE_NOTICE_MS = 2800

function snapshotKey(order: string[], hidden: string[], overrides: Record<string, ModuleCardOverride>) {
  return JSON.stringify({ order, hidden, overrides })
}

export function HomeModuleOrderSettingsSection() {
  const { showAlert } = useAlertConfirm()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [moduleOrder, setModuleOrder] = useState<string[]>(() => mergeHomeModuleOrder(undefined))
  const [modulesHiddenFromHome, setModulesHiddenFromHome] = useState<string[]>([])
  const [moduleCardOverrides, setModuleCardOverrides] = useState<Record<string, ModuleCardOverride>>({})
  const savedRef = useRef<{ key: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveNotice, setSaveNotice] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .get<HomePageConfig>('/home')
      .then((r) => {
        if (cancelled) return
        const order = mergeHomeModuleOrder(r.data.moduleOrder)
        const hidden = normalizeModulesHiddenFromHomeIds(r.data.modulesHiddenFromHome)
        const overrides = normalizeModuleCardOverrides(r.data.moduleCardOverrides)
        setModuleOrder(order)
        setModulesHiddenFromHome(hidden)
        setModuleCardOverrides(overrides)
        savedRef.current = { key: snapshotKey(order, hidden, overrides) }
        setLoadError('')
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError('Could not load home configuration.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!saveNotice) return
    const t = window.setTimeout(() => setSaveNotice(false), SAVE_NOTICE_MS)
    return () => window.clearTimeout(t)
  }, [saveNotice])

  const dirty =
    savedRef.current != null &&
    snapshotKey(moduleOrder, modulesHiddenFromHome, moduleCardOverrides) !== savedRef.current.key

  const save = useCallback(async () => {
    setSaving(true)
    setSaveNotice(false)
    try {
      const { data } = await api.put<HomePageConfig>('/home', {
        moduleOrder,
        modulesHiddenFromHome,
        moduleCardOverrides,
      })
      const order = mergeHomeModuleOrder(data.moduleOrder)
      const hidden = normalizeModulesHiddenFromHomeIds(data.modulesHiddenFromHome)
      const overrides = normalizeModuleCardOverrides(data.moduleCardOverrides)
      setModuleOrder(order)
      setModulesHiddenFromHome(hidden)
      setModuleCardOverrides(overrides)
      savedRef.current = { key: snapshotKey(order, hidden, overrides) }
      setSaveNotice(true)
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to save'
      showAlert(msg)
    } finally {
      setSaving(false)
    }
  }, [moduleOrder, modulesHiddenFromHome, moduleCardOverrides, showAlert])

  if (loadError) {
    return <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
  }
  if (loading) {
    return <p className="text-sm text-foreground/60">Loading…</p>
  }

  return (
    <>
      <p className="mb-4 text-sm text-foreground/80">
        Same options as{' '}
        <Link to="/" className="text-primary hover:underline">
          Edit home page
        </Link>
        . Use <strong className="font-medium text-foreground">Edit</strong> on a row to change its title, description,
        and icon. The sidebar and routes are unchanged.
      </p>
      <HomeModuleCardsSortableList
        moduleOrder={moduleOrder}
        onModuleOrderChange={setModuleOrder}
        modulesHiddenFromHome={modulesHiddenFromHome}
        onToggleHideFromHome={(id) =>
          setModulesHiddenFromHome((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
          )
        }
        moduleCardOverrides={moduleCardOverrides}
        onModuleCardOverridesChange={setModuleCardOverrides}
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={saving || !dirty}
          onClick={() => void save()}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save home module settings'}
        </button>
        {saveNotice ? (
          <span
            className="text-sm font-medium text-emerald-600 dark:text-emerald-400"
            role="status"
            aria-live="polite"
          >
            Saved
          </span>
        ) : null}
      </div>
    </>
  )
}
