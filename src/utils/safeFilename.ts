/** ASCII-safe segment for download filenames (matches server rules). */
export function sanitizeFilenameSegment(raw: string): string {
  const s = String(raw || 'zone')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  return s || 'zone'
}

/** Same naming pattern as server `buildMultiZoneExportFilename`. */
export function buildMultiZoneLocationsExportFilename(
  zoneIdsInOrder: string[],
  getZoneName: (id: string) => string | undefined
): string {
  const parts = zoneIdsInOrder.map((id) => sanitizeFilenameSegment(getZoneName(id) ?? id))
  if (parts.length === 1) return `${parts[0]}-locations.csv`
  if (parts.length === 2) return `${parts[0]}-${parts[1]}-locations.csv`
  return `${parts[0]}-${parts[1]}-and-${parts.length - 2}-more-locations.csv`
}
