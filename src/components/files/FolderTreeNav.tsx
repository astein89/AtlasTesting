import type { FileFolderRow, FileFolderTreeNode } from '@/api/files'
import { fileFolderNavSegment } from '@/lib/filesUrl'

export function folderParamMatchesRow(row: Pick<FileFolderRow, 'id' | 'slug'>, param: string): boolean {
  if (row.id === param) return true
  const s = row.slug?.trim()
  return !!s && s.toLowerCase() === param.toLowerCase()
}

export function findFolderInTreeByParam(
  nodes: FileFolderTreeNode[],
  param: string | null
): FileFolderTreeNode | null {
  if (param == null || !String(param).trim()) return null
  const p = param.trim()
  const walk = (ns: FileFolderTreeNode[]): FileFolderTreeNode | null => {
    for (const n of ns) {
      if (folderParamMatchesRow(n, p)) return n
      const sub = walk(n.children ?? [])
      if (sub) return sub
    }
    return null
  }
  return walk(nodes)
}

export function findPathToFolder(
  nodes: FileFolderTreeNode[],
  targetKey: string | null
): FileFolderRow[] | null {
  if (targetKey === null) return []
  const walk = (ns: FileFolderTreeNode[], acc: FileFolderRow[]): FileFolderRow[] | null => {
    for (const n of ns) {
      const row: FileFolderRow = {
        id: n.id,
        parent_id: n.parent_id,
        slug: n.slug,
        name: n.name,
        created_at: n.created_at,
        allowed_role_slugs: n.allowed_role_slugs ?? null,
        created_by: n.created_by ?? null,
      }
      if (folderParamMatchesRow(row, targetKey)) return [...acc, row]
      const sub = walk(n.children ?? [], [...acc, row])
      if (sub) return sub
    }
    return null
  }
  return walk(nodes, [])
}

export function FolderTreeNav({
  nodes,
  currentFolderKey,
  onSelect,
}: {
  nodes: FileFolderTreeNode[]
  /** `folder` query value (slug or UUID), or null for library root. */
  currentFolderKey: string | null
  onSelect: (navKey: string | null) => void
}) {
  return (
    <ul className="space-y-0.5 text-sm">
      <li>
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`w-full rounded-md px-2 py-1.5 text-left hover:bg-muted ${
            currentFolderKey === null ? 'bg-primary/15 font-medium text-primary' : ''
          }`}
        >
          All files
        </button>
      </li>
      {nodes.map((n) => (
        <FolderTreeBranch key={n.id} node={n} depth={0} currentFolderKey={currentFolderKey} onSelect={onSelect} />
      ))}
    </ul>
  )
}

function FolderTreeBranch({
  node,
  depth,
  currentFolderKey,
  onSelect,
}: {
  node: FileFolderTreeNode
  depth: number
  currentFolderKey: string | null
  onSelect: (navKey: string | null) => void
}) {
  const active =
    currentFolderKey != null &&
    (node.id === currentFolderKey ||
      (node.slug?.trim() && node.slug.trim().toLowerCase() === currentFolderKey.toLowerCase()))
  return (
    <li>
      <button
        type="button"
        style={{ paddingLeft: depth * 12 + 8 }}
        onClick={() => onSelect(fileFolderNavSegment(node))}
        className={`w-full rounded-md px-2 py-1.5 text-left hover:bg-muted ${
          active ? 'bg-primary/15 font-medium text-primary' : ''
        }`}
      >
        {node.name}
      </button>
      {node.children?.length ? (
        <ul className="mt-0.5 space-y-0.5 border-l border-border/60 pl-1">
          {node.children.map((c) => (
            <FolderTreeBranch
              key={c.id}
              node={c}
              depth={depth + 1}
              currentFolderKey={currentFolderKey}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}
