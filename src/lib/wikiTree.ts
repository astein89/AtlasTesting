import type { WikiPageListItem } from '@/api/wiki'

export type WikiTreeNode = {
  segment: string
  path: string
  title?: string
  page: WikiPageListItem | null
  children: Map<string, WikiTreeNode>
}

export function buildWikiTree(pages: WikiPageListItem[]): WikiTreeNode {
  const root: WikiTreeNode = {
    segment: '',
    path: '',
    page: null,
    children: new Map(),
  }

  for (const item of pages) {
    const segments = item.path.split('/').filter(Boolean)
    if (segments.length === 0) continue

    let cur = root
    let pathSoFar = ''

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!
      pathSoFar = pathSoFar ? `${pathSoFar}/${seg}` : seg

      let next = cur.children.get(seg)
      if (!next) {
        next = {
          segment: seg,
          path: pathSoFar,
          page: null,
          children: new Map(),
        }
        cur.children.set(seg, next)
      }
      cur = next

      if (i === segments.length - 1) {
        cur.page = item
        cur.title = item.title
      }
    }
  }

  return root
}

/** Sort siblings: optional `preferredSegmentOrder` (parent’s saved order), then alphabetical for the rest. */
export function sortedTreeChildren(
  node: WikiTreeNode,
  preferredSegmentOrder?: string[] | null
): WikiTreeNode[] {
  const children = [...node.children.values()]
  if (!preferredSegmentOrder?.length) {
    return children.sort((a, b) => a.segment.localeCompare(b.segment))
  }
  const rank = new Map(preferredSegmentOrder.map((s, i) => [s, i]))
  return children.sort((a, b) => {
    const ra = rank.get(a.segment)
    const rb = rank.get(b.segment)
    if (ra !== undefined && rb !== undefined) return ra - rb
    if (ra !== undefined) return -1
    if (rb !== undefined) return 1
    return a.segment.localeCompare(b.segment)
  })
}

export function findWikiTreeNode(root: WikiTreeNode, path: string): WikiTreeNode | null {
  if (!path.trim()) return root
  const segments = path.split('/').filter(Boolean)
  let cur: WikiTreeNode | undefined = root
  for (const seg of segments) {
    cur = cur.children.get(seg)
    if (!cur) return null
  }
  return cur
}
