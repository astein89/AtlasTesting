import { Link } from 'react-router-dom'

const cardClass =
  'flex h-28 w-full flex-col rounded-lg border border-border bg-card p-3 transition-colors hover:bg-background'

interface HomeLinkCardProps {
  title: string
  description: string
  href: string
  /** Show destination URL under the title (e.g. custom home links). */
  showUrl?: boolean
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
    <div className="min-h-0">
      <h2 className="truncate text-base font-medium leading-tight text-foreground">{title}</h2>
      {showUrl && (
        <p className="mt-0.5 truncate font-mono text-[11px] leading-tight text-foreground/55" title={displayHref}>
          {displayHref}
        </p>
      )}
      {description.trim() ? (
        <p className="mt-1 line-clamp-3 text-xs leading-snug text-foreground/70">{description}</p>
      ) : null}
    </div>
  )
}

export function HomeLinkCard({ title, description, href, showUrl }: HomeLinkCardProps) {
  const displayHref = href.trim() || '—'

  if (isExternalHref(href)) {
    return (
      <a href={href} className={cardClass} target="_blank" rel="noopener noreferrer">
        <CardInner title={title} description={description} displayHref={displayHref} showUrl={showUrl} />
      </a>
    )
  }
  const to = href.startsWith('/') ? href : `/${href}`
  return (
    <Link to={to} className={cardClass}>
      <CardInner title={title} description={description} displayHref={displayHref} showUrl={showUrl} />
    </Link>
  )
}
