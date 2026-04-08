import { create } from 'zustand'

/** Matches public `GET /home` branding fields; drives navbar icon and document favicon. */
export const useSiteBrandingStore = create<{
  siteFaviconPath: string | null
  homeBrandingRevision: number
  setFromHomePayload: (data: {
    siteFaviconPath?: string | null
    homeBrandingRevision?: number | null
  }) => void
}>((set) => ({
  siteFaviconPath: null,
  homeBrandingRevision: 0,
  setFromHomePayload: (data) =>
    set({
      siteFaviconPath:
        typeof data.siteFaviconPath === 'string' && data.siteFaviconPath.trim()
          ? data.siteFaviconPath.trim()
          : null,
      homeBrandingRevision:
        typeof data.homeBrandingRevision === 'number' ? data.homeBrandingRevision : 0,
    }),
}))
