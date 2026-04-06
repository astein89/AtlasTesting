import { Link } from 'react-router-dom'
import { WIKI_PREFIX, wikiPageUrl } from '@/lib/appPaths'

/** Last path segment as a short title (e.g. `my-page` → `My page`). */
export function humanizePathForTitle(pagePath: string): string {
  const parts = pagePath.split('/').filter(Boolean)
  let seg = parts.length ? parts[parts.length - 1] : ''
  if (parts.length === 1 && seg === 'index') return 'Home'
  if (seg === 'index' && parts.length >= 2) seg = parts[parts.length - 2]!
  if (!seg) return 'Wiki'
  if (seg === 'guides') return 'Wiki Guide'
  return seg
    .split('-')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ''))
    .filter(Boolean)
    .join(' ')
}

/** Wiki hub link plus each segment (links to prefix; last segment plain text). */
export function WikiBreadcrumbs({ pagePath }: { pagePath: string }) {
  const parts = pagePath.split('/').filter(Boolean)

  if (parts.length === 1 && parts[0] === 'index') {
    return (
      <nav aria-label="Page location" className="text-sm text-foreground/80">
        <ol className="flex flex-wrap items-center gap-x-1 gap-y-1">
          <li className="min-w-0 shrink-0">
            <Link to={WIKI_PREFIX} className="text-primary hover:underline">
              Wiki
            </Link>
          </li>
          <li className="flex min-w-0 max-w-full items-center gap-1">
            <span className="shrink-0 text-foreground/35 select-none" aria-hidden>
              /
            </span>
            <span className="min-w-0 truncate font-medium text-foreground">Home</span>
          </li>
        </ol>
      </nav>
    )
  }

  return (
    <nav aria-label="Page location" className="text-sm text-foreground/80">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1">
        <li className="min-w-0 shrink-0">
          <Link to={WIKI_PREFIX} className="text-primary hover:underline">
            Wiki
          </Link>
        </li>
        {parts.map((_, i) => {
          const pathSoFar = parts.slice(0, i + 1).join('/')
          const isLast = i === parts.length - 1
          const label = humanizePathForTitle(pathSoFar)
          return (
            <li key={pathSoFar} className="flex min-w-0 max-w-full items-center gap-1">
              <span className="shrink-0 text-foreground/35 select-none" aria-hidden>
                /
              </span>
              {isLast ? (
                <span className="min-w-0 truncate font-medium text-foreground">{label}</span>
              ) : (
                <Link
                  to={wikiPageUrl(pathSoFar)}
                  className="min-w-0 truncate text-primary hover:underline"
                >
                  {label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
