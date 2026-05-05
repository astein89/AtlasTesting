import { useEffect, useState, type ReactNode } from 'react'
import { appModules, type AppModule } from '@/config/modules'
import { HomeModuleCardIcon } from '@/components/home/HomeModuleCardIcon'
import { patchModuleCardOverride } from '@/lib/moduleCardPresentation'
import type { ModuleCardOverride } from '@/types/homePage'

function IconChoiceTile({
  label,
  selected,
  onSelect,
  children,
}: {
  label: string
  selected: boolean
  onSelect: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex flex-col items-center justify-center gap-2 rounded-lg border p-3 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card ${
        selected
          ? 'border-primary bg-primary/10 shadow-sm'
          : 'border-border bg-background/60 hover:bg-background'
      }`}
    >
      <span className="flex shrink-0 items-center justify-center" aria-hidden>
        {children}
      </span>
      <span className="line-clamp-2 min-h-[2rem] text-[11px] font-medium leading-snug text-foreground sm:text-xs">
        {label}
      </span>
    </button>
  )
}

export function ModuleCardOverrideModal({
  open,
  module,
  overrides,
  onClose,
  onApply,
}: {
  open: boolean
  module: AppModule | null
  overrides: Record<string, ModuleCardOverride>
  onClose: () => void
  onApply: (next: Record<string, ModuleCardOverride>) => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [iconModuleId, setIconModuleId] = useState('')

  useEffect(() => {
    if (!open || !module) return
    const o = overrides[module.id]
    setTitle(o?.title ?? '')
    setDescription(o?.description ?? '')
    setIconModuleId(o?.iconModuleId ?? '')
  }, [open, module, overrides])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !module) return null

  const previewIcon = iconModuleId.trim() || module.id

  const handleSave = () => {
    onApply(
      patchModuleCardOverride(overrides, module.id, {
        title,
        description,
        iconModuleId,
      })
    )
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4" role="presentation">
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg"
        role="dialog"
        onClick={(e) => e.stopPropagation()}
        aria-modal="true"
        aria-labelledby="module-card-edit-title"
      >
        <div className="shrink-0 border-b border-border px-5 py-4">
          <h2 id="module-card-edit-title" className="text-lg font-semibold text-foreground">
            Edit module card
          </h2>
          <p className="mt-1 text-sm text-foreground/70">
            Home hub only. Leave fields blank to use the app default.
          </p>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-background/50 px-3 py-2">
            <HomeModuleCardIcon moduleId={previewIcon} />
            <span className="text-sm font-medium text-foreground">{module.path}</span>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground" htmlFor="mco-title">
              Title
            </label>
            <input
              id="mco-title"
              type="text"
              value={title}
              placeholder={module.title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground/40"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground" htmlFor="mco-desc">
              Description
            </label>
            <textarea
              id="mco-desc"
              rows={3}
              value={description}
              placeholder={module.description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground/40"
            />
          </div>
          <fieldset>
            <legend className="mb-2 block text-sm font-medium text-foreground">Icon</legend>
            <p className="mb-3 text-xs text-foreground/55">
              Choose a tile style. The card still navigates to this module’s routes.
            </p>
            <div
              role="radiogroup"
              aria-label="Module card icon"
              className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4"
            >
              <IconChoiceTile
                label={`Default (${module.title})`}
                selected={iconModuleId === ''}
                onSelect={() => setIconModuleId('')}
              >
                <HomeModuleCardIcon moduleId={module.id} />
              </IconChoiceTile>
              {appModules.map((preset) => (
                <IconChoiceTile
                  key={preset.id}
                  label={preset.title}
                  selected={iconModuleId === preset.id}
                  onSelect={() => setIconModuleId(preset.id)}
                >
                  <HomeModuleCardIcon moduleId={preset.id} />
                </IconChoiceTile>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-background"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
