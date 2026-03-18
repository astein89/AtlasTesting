import type { CSSProperties } from 'react'

/** Layout for radio_select / checkbox_select: 1 = one per line, 2+ = columns, 'auto' = wrap. */
export type OptionFieldLayout = number | 'vertical' | 'horizontal' | 'auto'

export function normalizeOptionLayout(layout: OptionFieldLayout | undefined): number | 'auto' {
  if (layout === 'vertical' || layout === 1) return 1
  if (layout === 'horizontal' || layout === 'auto' || layout == null) return 'auto'
  const n = Number(layout)
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.max(1, Math.floor(n)), 24) : 'auto'
}

export function optionLayoutClasses(resolved: number | 'auto'): {
  className: string
  style: CSSProperties | undefined
} {
  if (resolved === 'auto') {
    return { className: 'flex flex-wrap gap-x-4 gap-y-2', style: undefined }
  }
  if (resolved === 1) {
    return { className: 'flex flex-col gap-y-2', style: undefined }
  }
  return {
    className: 'grid gap-x-4 gap-y-2',
    style: { gridTemplateColumns: `repeat(${resolved}, minmax(0, 1fr))` },
  }
}
