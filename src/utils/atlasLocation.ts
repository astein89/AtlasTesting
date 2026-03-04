/** Atlas Location format: S-{LEVEL}-{AISLE}-{LANE}-{SIDE}-{POSITION}
 * LEVEL=01-05, AISLE=A1-A5, LANE=01-90, SIDE=L|R, POSITION=01-10
 */

export interface AtlasLocationParts {
  level: number   // 1-5
  aisle: string  // A1-A5
  lane: number   // 1-90
  side: 'L' | 'R'
  position: number  // 1-10
}

export const LEVELS = [1, 2, 3, 4, 5]
export const AISLES = ['A1', 'A2', 'A3', 'A4', 'A5']
export const LANES = Array.from({ length: 90 }, (_, i) => i + 1)
export const SIDES = ['L', 'R'] as const
export const POSITIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

const SCHEME_REGEX = /^S-(\d{1,2})-(A[1-5])-(\d{1,2})-(L|R)-(\d{1,2})$/i

export function parseAtlasLocation(value: string): AtlasLocationParts | null {
  if (!value || typeof value !== 'string') return null
  const m = value.trim().match(SCHEME_REGEX)
  if (!m) return null
  const level = parseInt(m[1], 10)
  const lane = parseInt(m[3], 10)
  const position = parseInt(m[5], 10)
  if (level < 1 || level > 5 || lane < 1 || lane > 90 || position < 1 || position > 10) return null
  if (!AISLES.includes(m[2].toUpperCase())) return null
  return {
    level,
    aisle: m[2].toUpperCase(),
    lane,
    side: m[4].toUpperCase() === 'L' ? 'L' : 'R',
    position,
  }
}

export function formatAtlasLocation(parts: AtlasLocationParts): string {
  return `S-${String(parts.level).padStart(2, '0')}-${parts.aisle}-${String(parts.lane).padStart(2, '0')}-${parts.side}-${String(parts.position).padStart(2, '0')}`
}

export function formatPartialAtlasLocation(parts: Partial<AtlasLocationParts>): string {
  if (!parts.level) return 'S-'
  let s = `S-${String(parts.level).padStart(2, '0')}`
  if (!parts.aisle) return s
  s += `-${parts.aisle}`
  if (parts.lane == null) return s
  s += `-${String(parts.lane).padStart(2, '0')}`
  if (!parts.side) return s
  s += `-${parts.side}`
  if (parts.position == null) return s
  s += `-${String(parts.position).padStart(2, '0')}`
  return s
}

export function isValidAtlasLocation(value: string): boolean {
  return parseAtlasLocation(value) !== null
}
