import type { AppModule } from '@/config/modules'
import { appModules } from '@/config/modules'

/** Default order (must match server `HOME_MODULE_IDS`). */
export const DEFAULT_HOME_MODULE_ORDER: string[] = appModules.map((m) => m.id)

const KNOWN_IDS = new Set(DEFAULT_HOME_MODULE_ORDER)

/** Merge saved order with current modules: unknown ids dropped; new modules appended in default order. */
export function mergeHomeModuleOrder(saved: string[] | undefined): string[] {
  if (!saved?.length) return [...DEFAULT_HOME_MODULE_ORDER]
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of saved) {
    if (typeof id !== 'string' || !id.trim()) continue
    const t = id.trim()
    if (!KNOWN_IDS.has(t) || seen.has(t)) continue
    out.push(t)
    seen.add(t)
  }
  for (const id of DEFAULT_HOME_MODULE_ORDER) {
    if (!seen.has(id)) out.push(id)
  }
  return out
}

/** Sort visible modules for the home hub cards. */
export function sortHomeModules(modules: AppModule[], moduleOrder: string[] | undefined): AppModule[] {
  const order = mergeHomeModuleOrder(moduleOrder)
  const idx = (id: string) => {
    const i = order.indexOf(id)
    return i === -1 ? 999 : i
  }
  return [...modules].sort((a, b) => idx(a.id) - idx(b.id))
}
