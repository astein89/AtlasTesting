import type { FileFolderTreeNode } from '@/api/files'

/** Depth-first paths for a folder `<select>` (tree order from API). */
export function flatFolderSelectOptions(nodes: FileFolderTreeNode[]): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = []
  const walk = (list: FileFolderTreeNode[], prefix: string) => {
    for (const n of list) {
      const label = prefix ? `${prefix} / ${n.name}` : n.name
      out.push({ id: n.id, label })
      if (n.children?.length) walk(n.children, label)
    }
  }
  walk(nodes, '')
  return out
}

export function findFolderNode(nodes: FileFolderTreeNode[], id: string): FileFolderTreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    const sub = findFolderNode(n.children, id)
    if (sub) return sub
  }
  return null
}

export function subtreeFolderIds(root: FileFolderTreeNode): Set<string> {
  const s = new Set<string>([root.id])
  for (const c of root.children) {
    for (const id of subtreeFolderIds(c)) s.add(id)
  }
  return s
}

/** Parent folder picker: root + folders not under `excludeIds` (typically this folder and descendants). */
export function flatFolderParentSelectOptions(
  tree: FileFolderTreeNode[],
  excludeIds: Set<string>
): { id: string | null; label: string }[] {
  const out: { id: string | null; label: string }[] = [{ id: null, label: 'Files (root)' }]
  const walk = (list: FileFolderTreeNode[], prefix: string) => {
    for (const n of list) {
      if (excludeIds.has(n.id)) continue
      const label = prefix ? `${prefix} / ${n.name}` : n.name
      out.push({ id: n.id, label })
      if (n.children?.length) walk(n.children, label)
    }
  }
  walk(tree, '')
  return out
}
