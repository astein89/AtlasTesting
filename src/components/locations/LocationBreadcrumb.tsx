import { Link } from 'react-router-dom'

export interface LocationBreadcrumbItem {
  label: string
  /** Omit on the current (last) segment. */
  to?: string
}

export function LocationBreadcrumb({ items }: { items: LocationBreadcrumbItem[] }) {
  if (items.length === 0) return null

  return (
    <nav className="text-sm text-foreground/70" aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && (
              <span className="select-none text-foreground/35" aria-hidden>
                /
              </span>
            )}
            {item.to ? (
              <Link to={item.to} className="text-primary hover:underline">
                {item.label}
              </Link>
            ) : (
              <span className="font-medium text-foreground">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
