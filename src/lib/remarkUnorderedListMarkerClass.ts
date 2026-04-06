import type { List, Root } from 'mdast'
import { visit } from 'unist-util-visit'

/** First line of an unordered list: optional indent, then - * or + */
const LIST_LINE_MARKER_RE = /^(\s*)([-*+])\s/

/**
 * Tags each unordered List with `data.hProperties.class` so the renderer can style
 * `-` lists with hyphen markers instead of discs (`*` / `+` keep normal bullets).
 */
export function remarkUnorderedListMarkerClass() {
  return (tree: Root, file: { value: unknown }) => {
    const raw = file.value
    const src = typeof raw === 'string' ? raw : new TextDecoder().decode(raw as ArrayBuffer)
    const lines = src.split(/\r?\n/)

    visit(tree, 'list', (node: List) => {
      if (node.ordered) return
      const lineIndex = (node.position?.start?.line ?? 0) - 1
      if (lineIndex < 0) return
      const line = lines[lineIndex] ?? ''
      const m = LIST_LINE_MARKER_RE.exec(line)
      if (!m) return
      const marker = m[2]
      node.data ??= {}
      const h = (node.data.hProperties ??= {}) as Record<string, string>
      if (marker === '-') {
        h.class = 'wiki-ul-marker-dash'
      } else if (marker === '*') {
        h.class = 'wiki-ul-marker-star'
      } else {
        h.class = 'wiki-ul-marker-plus'
      }
    })
  }
}
