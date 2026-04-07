import type { FileFolderRow, FileFolderTreeNode } from '@/api/files'

export function findPathToFolder(
  nodes: FileFolderTreeNode[],
  targetId: string | null
): FileFolderRow[] | null {
  if (targetId === null) return []
  const walk = (ns: FileFolderTreeNode[], acc: FileFolderRow[]): FileFolderRow[] | null => {
    for (const n of ns) {
      const row: FileFolderRow = {
        id: n.id,
        parent_id: n.parent_id,
        name: n.name,
        created_at: n.created_at,
        allowed_role_slugs: n.allowed_role_slugs ?? null,
        created_by: n.created_by ?? null,
      }
      if (n.id === targetId) return [...acc, row]
      const sub = walk(n.children, [...acc, row])
      if (sub) return sub
    }
    return null
  }
  return walk(nodes, [])
}

export function FolderTreeNav({
  nodes,
  currentFolderId,
  onSelect,
}: {
  nodes: FileFolderTreeNode[]
  currentFolderId: string | null
  onSelect: (id: string | null) => void
}) {
  return (
    <ul className="space-y-0.5 text-sm">
      <li>
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`w-full rounded-md px-2 py-1.5 text-left hover:bg-muted ${
            currentFolderId === null ? 'bg-primary/15 font-medium text-primary' : ''
          }`}
        >
          All files
        </button>
      </li>
      {nodes.map((n) => (
        <FolderTreeBranch key={n.id} node={n} depth={0} currentFolderId={currentFolderId} onSelect={onSelect} />
      ))}
    </ul>
  )
}

function FolderTreeBranch({
  node,
  depth,
  currentFolderId,
  onSelect,
}: {
  node: FileFolderTreeNode
  depth: number
  currentFolderId: string | null
  onSelect: (id: string | null) => void
}) {
  const active = currentFolderId === node.id
  return (
    <li>
      <button
        type="button"
        style={{ paddingLeft: depth * 12 + 8 }}
        onClick={() => onSelect(node.id)}
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
              currentFolderId={currentFolderId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}
