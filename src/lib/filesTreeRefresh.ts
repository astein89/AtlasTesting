/** Dispatched after folder create/delete so Sidebar + explorer refresh the tree. */
export const FILES_TREE_REFRESH_EVENT = 'atlas-files-tree-refresh'

export function requestFilesTreeRefresh(): void {
  window.dispatchEvent(new CustomEvent(FILES_TREE_REFRESH_EVENT))
}
