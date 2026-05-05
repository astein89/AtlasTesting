import { v4 as uuidv4 } from 'uuid'

/**
 * Matches server `genDCA` in `server/routes/amr.ts` so preview codes align with rack-move behavior.
 */
export function genDcaCode(kind: string): string {
  const d = new Date()
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const r = uuidv4().replace(/-/g, '').slice(0, 8)
  return `DCA-${kind}-${y}${m}${day}-${r}`
}

/** Mission code shape used when the client leaves mission code empty on the server — preview with kind `RM`. */
export function previewRackMoveMissionCode(): string {
  return genDcaCode('RM')
}
