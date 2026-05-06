import type { AsyncDbWrapper } from '../db/schema.js'

/** External refs (fleet location codes) that have `bypass_pallet_check` enabled on `amr_stands`. */
export async function externalRefsBypassingPalletCheck(
  db: AsyncDbWrapper,
  refs: string[]
): Promise<Set<string>> {
  const trimmed = [...new Set(refs.map((r) => String(r).trim()).filter(Boolean))]
  if (trimmed.length === 0) return new Set()
  const placeholders = trimmed.map(() => '?').join(', ')
  const rows = (await db
    .prepare(
      `SELECT external_ref FROM amr_stands WHERE external_ref IN (${placeholders}) AND bypass_pallet_check = 1`
    )
    .all(...trimmed)) as Array<{ external_ref?: string }>
  const out = new Set<string>()
  for (const r of rows) {
    const ref = typeof r.external_ref === 'string' ? r.external_ref.trim() : ''
    if (ref) out.add(ref)
  }
  return out
}
