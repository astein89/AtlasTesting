import { Navigate, useParams } from 'react-router-dom'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { WIKI_PREFIX } from '@/lib/appPaths'
import { WikiPageEdit } from './WikiPageEdit'
import { WikiPageView } from './WikiPageView'

/** Splat under `/wiki/*`: view page or `.../edit` for editor. `/wiki/edit` edits root `index.md`. */
export function WikiCatchAll() {
  const { '*': splat = '' } = useParams()

  if (!splat) {
    return <Navigate to={WIKI_PREFIX} replace />
  }

  const trail = splat.replace(/\/$/, '')

  /** Reserves `/wiki/edit`; a root page `edit.md` would not be reachable at that URL. */
  if (trail === 'edit') {
    return (
      <PermissionGuard permission="wiki.edit">
        <WikiPageEdit pagePath="index" />
      </PermissionGuard>
    )
  }

  if (trail === 'index') {
    return <Navigate to={WIKI_PREFIX} replace />
  }

  if (trail.endsWith('/edit')) {
    const pagePath = trail.slice(0, -5).replace(/\/$/, '')
    return (
      <PermissionGuard permission="wiki.edit">
        <WikiPageEdit pagePath={pagePath} />
      </PermissionGuard>
    )
  }

  return <WikiPageView pagePath={trail} />
}
