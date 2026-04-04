import { useMemo, useState } from 'react'
import { publicAsset } from '@/lib/basePath'
import { externalFaviconCandidateUrls } from '@/lib/linkFavicon'

function MailGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
    </svg>
  )
}

function LinkGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622a4.5 4.5 0 00-6.364-6.364l-1.757 1.757a4.5 4.5 0 001.242 7.244" />
    </svg>
  )
}

const iconWrapClass =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/80 bg-background text-foreground/45'

/** Icon shown on home link cards: remote site favicon, app icon for in-app paths, or placeholders. */
export function HomeLinkCardFavicon({ href }: { href: string }) {
  const h = href.trim()

  const candidates = useMemo(() => {
    if (h.startsWith('mailto:')) return [] as string[]
    const ext = externalFaviconCandidateUrls(h)
    const fallback = publicAsset('icon.png')
    if (ext.length > 0) return [...ext, fallback]
    return [fallback]
  }, [h])

  const [index, setIndex] = useState(0)

  if (h.startsWith('mailto:')) {
    return (
      <div className={iconWrapClass} title="Email link">
        <MailGlyph className="h-5 w-5" />
      </div>
    )
  }

  if (index >= candidates.length) {
    return (
      <div className={iconWrapClass} title="Link">
        <LinkGlyph className="h-5 w-5" />
      </div>
    )
  }

  return (
    <img
      key={`${candidates[index]}-${index}`}
      src={candidates[index]}
      alt=""
      className="h-9 w-9 shrink-0 rounded-md border border-border/80 bg-background object-contain"
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setIndex((i) => i + 1)}
    />
  )
}
