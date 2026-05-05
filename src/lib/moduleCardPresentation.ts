import { appModules, type AppModule } from '@/config/modules'
import type { ModuleCardOverride } from '@/types/homePage'

const MODULE_IDS = new Set(appModules.map((m) => m.id))

const MAX_TITLE = 120
const MAX_DESCRIPTION = 500

/** Merge API payload into a safe record (drops unknown module ids). */
export function normalizeModuleCardOverrides(
  raw: Record<string, ModuleCardOverride> | undefined | null
): Record<string, ModuleCardOverride> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, ModuleCardOverride> = {}
  for (const [k, v] of Object.entries(raw)) {
    const id = typeof k === 'string' ? k.trim() : ''
    if (!MODULE_IDS.has(id) || !v || typeof v !== 'object') continue
    const title =
      typeof v.title === 'string' ? v.title.trim().slice(0, MAX_TITLE) : undefined
    const description =
      typeof v.description === 'string' ? v.description.trim().slice(0, MAX_DESCRIPTION) : undefined
    let iconModuleId: string | undefined
    if (typeof v.iconModuleId === 'string' && v.iconModuleId.trim()) {
      const ico = v.iconModuleId.trim()
      if (MODULE_IDS.has(ico)) iconModuleId = ico
    }
    const entry: ModuleCardOverride = {}
    if (title) entry.title = title
    if (description) entry.description = description
    if (iconModuleId) entry.iconModuleId = iconModuleId
    if (Object.keys(entry).length > 0) out[id] = entry
  }
  return out
}

/** Apply partial edits to one module’s overrides (same rules as the accordion editor). */
export function patchModuleCardOverride(
  prev: Record<string, ModuleCardOverride>,
  moduleId: string,
  patch: Partial<ModuleCardOverride>
): Record<string, ModuleCardOverride> {
  const base: ModuleCardOverride = { ...(prev[moduleId] ?? {}) }
  if ('title' in patch) {
    const raw = patch.title ?? ''
    if (!raw.trim()) delete base.title
    else base.title = raw
  }
  if ('description' in patch) {
    const raw = patch.description ?? ''
    if (!raw.trim()) delete base.description
    else base.description = raw
  }
  if ('iconModuleId' in patch) {
    const i = patch.iconModuleId?.trim()
    if (i && MODULE_IDS.has(i)) base.iconModuleId = i
    else delete base.iconModuleId
  }
  const merged = { ...prev }
  if (Object.keys(base).length === 0) delete merged[moduleId]
  else merged[moduleId] = base
  return merged
}

export function resolveModuleCardForHome(
  m: AppModule,
  overrides: Record<string, ModuleCardOverride> | undefined
): { title: string; description: string; moduleIconId: string } {
  const o = overrides?.[m.id]
  const title = o?.title?.trim() ? o.title.trim() : m.title
  const description = o?.description?.trim() ? o.description.trim() : m.description
  const iconPick = o?.iconModuleId?.trim()
  const moduleIconId =
    iconPick && MODULE_IDS.has(iconPick) ? iconPick : m.id
  return { title, description, moduleIconId }
}
