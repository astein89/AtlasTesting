import { Link } from 'react-router-dom'
import { HomeLinkCardFavicon } from '@/components/home/HomeLinkCardFavicon'
import { HomeModuleCardIcon } from '@/components/home/HomeModuleCardIcon'

const cardClass =
  'flex min-h-[5.25rem] w-full flex-row items-stretch gap-3 rounded-lg border border-border bg-card px-2.5 py-2 transition-colors hover:bg-background'

interface HomeLinkCardProps {
  title: string
  description: string
  href: string
  /** Show destination URL under the title (e.g. custom home links). */
  showUrl?: boolean
  /**
   * When set (e.g. `appModules` id), show built-in module artwork instead of resolving a favicon
   * from the path.
   */
  moduleIconId?: string
}

export function isExternalHref(href: string) {
  return /^https?:\/\//i.test(href) || href.startsWith('mailto:')
}

function CardInner({
  title,
  description,
  displayHref,
  showUrl,
}: {
  title: string
  description: string
  displayHref: string
  showUrl?: boolean
}) {
  return (
    <div className="min-h-0 min-w-0 flex-1">
      <h2 className="truncate text-sm font-medium leading-tight text-foreground sm:text-base">{title}</h2>
      {showUrl && (
        <p className="mt-0.5 truncate font-mono text-[10px] leading-tight text-foreground/55 sm:text-[11px]" title={displayHref}>
          {displayHref}
        </p>
      )}
      {description.trim() ? (
        <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-foreground/70">{description}</p>
      ) : null}
    </div>
  )
}

export function HomeLinkCard({ title, description, href, showUrl, moduleIconId }: HomeLinkCardProps) {
  const displayHref = href.trim() || '—'

  const icon = moduleIconId ? (
    <span className="flex shrink-0 items-center self-center" aria-hidden>
      <HomeModuleCardIcon moduleId={moduleIconId} />
    </span>
  ) : (
    <span className="flex shrink-0 items-center self-center" aria-hidden>
      <HomeLinkCardFavicon key={href} href={href} />
    </span>
  )

  if (isExternalHref(href)) {
    return (
      <a href={href} className={cardClass} target="_blank" rel="noopener noreferrer">
        {icon}
        <CardInner title={title} description={description} displayHref={displayHref} showUrl={showUrl} />
      </a>
    )
  }
  const to = href.startsWith('/') ? href : `/${href}`
  return (
    <Link to={to} className={cardClass}>
      {icon}
      <CardInner title={title} description={description} displayHref={displayHref} showUrl={showUrl} />
    </Link>
  )
}
