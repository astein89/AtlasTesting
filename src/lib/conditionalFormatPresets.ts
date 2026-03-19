export interface CfColorPreset {
  hex: string
  label: string
}

export interface CfPresetsConfig {
  fill: CfColorPreset[]
  text: CfColorPreset[]
}

function isValidHex(h: string): boolean {
  const t = h.trim()
  return /^#[0-9A-Fa-f]{3}$/.test(t) || /^#[0-9A-Fa-f]{6}$/.test(t)
}

function normalizePreset(row: unknown): CfColorPreset | null {
  if (!row || typeof row !== 'object') return null
  const o = row as Record<string, unknown>
  const hex = typeof o.hex === 'string' ? o.hex.trim() : ''
  const label = typeof o.label === 'string' ? o.label.trim() : ''
  if (!isValidHex(hex)) return null
  return { hex: hex.toLowerCase().length === 4 ? expandShortHex(hex) : hex.toLowerCase(), label: label || hex }
}

function expandShortHex(h: string): string {
  const x = h.slice(1)
  if (x.length !== 3) return h.toLowerCase()
  return `#${x[0]}${x[0]}${x[1]}${x[1]}${x[2]}${x[2]}`.toLowerCase()
}

export const DEFAULT_CF_FILL_PRESETS: CfColorPreset[] = [
  { hex: '#fef08a', label: 'Yellow highlight' },
  { hex: '#fde047', label: 'Bright yellow' },
  { hex: '#fecaca', label: 'Light red' },
  { hex: '#fca5a5', label: 'Red tint' },
  { hex: '#bbf7d0', label: 'Light green' },
  { hex: '#86efac', label: 'Green tint' },
  { hex: '#bfdbfe', label: 'Light blue' },
  { hex: '#93c5fd', label: 'Blue tint' },
  { hex: '#fed7aa', label: 'Light orange' },
  { hex: '#e9d5ff', label: 'Light purple' },
  { hex: '#f3f4f6', label: 'Light gray' },
  { hex: '#ffffff', label: 'White' },
]

export const DEFAULT_CF_TEXT_PRESETS: CfColorPreset[] = [
  { hex: '#0a0a0a', label: 'Black' },
  { hex: '#171717', label: 'Near black' },
  { hex: '#b91c1c', label: 'Red' },
  { hex: '#15803d', label: 'Green' },
  { hex: '#1d4ed8', label: 'Blue' },
  { hex: '#c2410c', label: 'Orange' },
  { hex: '#7c3aed', label: 'Purple' },
  { hex: '#737373', label: 'Gray' },
  { hex: '#fafafa', label: 'Off white' },
  { hex: '#ffffff', label: 'White' },
]

export const DEFAULT_CF_PRESETS_CONFIG: CfPresetsConfig = {
  fill: DEFAULT_CF_FILL_PRESETS,
  text: DEFAULT_CF_TEXT_PRESETS,
}

export function deserializeCfPresets(s: string): CfPresetsConfig {
  try {
    const o = JSON.parse(s) as unknown
    if (!o || typeof o !== 'object') return { ...DEFAULT_CF_PRESETS_CONFIG }
    const rec = o as Record<string, unknown>
    const fillRaw = Array.isArray(rec.fill) ? rec.fill : null
    const textRaw = Array.isArray(rec.text) ? rec.text : null
    const fill =
      fillRaw !== null
        ? (fillRaw.map(normalizePreset).filter(Boolean) as CfColorPreset[])
        : [...DEFAULT_CF_FILL_PRESETS]
    const text =
      textRaw !== null
        ? (textRaw.map(normalizePreset).filter(Boolean) as CfColorPreset[])
        : [...DEFAULT_CF_TEXT_PRESETS]
    return { fill, text }
  } catch {
    return { ...DEFAULT_CF_PRESETS_CONFIG }
  }
}

export function serializeCfPresets(c: CfPresetsConfig): string {
  return JSON.stringify({
    fill: c.fill.map(({ hex, label }) => ({ hex: hex.trim(), label: label.trim() })),
    text: c.text.map(({ hex, label }) => ({ hex: hex.trim(), label: label.trim() })),
  })
}
