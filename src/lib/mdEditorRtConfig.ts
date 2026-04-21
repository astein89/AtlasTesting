import markdownItAttrs from 'markdown-it-attrs'
import { config } from 'md-editor-rt'

/** Allowed on any element via `{...}` (security); matches md-editor-rt XSS img allowlist where relevant. */
const MARKDOWN_IT_ATTR_ALLOWLIST = [
  'width',
  'height',
  'class',
  'id',
  'loading',
  'decoding',
  'title',
] as const

/**
 * Interactive GFM task lists in md-editor-rt preview (split view).
 * Default taskList plugin uses disabled inputs unless `enabled: true`.
 *
 * **Image sizing:** `![](/path/to.png){width=400}` (markdown-it-attrs).
 *
 * **Plugin order:** `markdown-it-image-figures` only wraps a paragraph when its inline token has a
 * *single* child (the image). Curly attrs start as a second inline text token (`{width=400}`), so if
 * figures runs *before* attrs, conversion to `<figure>` is skipped and pixel widths can look wrong
 * next to `max-width:100%` / layout. Register **attrs immediately before** the `image` plugin so
 * `curly_attributes` runs before `image_figures` (both hook `before('linkify')`).
 */
config({
  markdownItPlugins: (plugins) => {
    const mapped = plugins.map((p) =>
      p.type === 'taskList' ? { ...p, options: { ...p.options, enabled: true } } : p
    )
    const attrsEntry = {
      type: 'attrs',
      plugin: markdownItAttrs,
      options: {
        allowedAttributes: [...MARKDOWN_IT_ATTR_ALLOWLIST],
      },
    }
    const imageIdx = mapped.findIndex((p) => p.type === 'image')
    if (imageIdx === -1) {
      return [...mapped, attrsEntry]
    }
    return [...mapped.slice(0, imageIdx), attrsEntry, ...mapped.slice(imageIdx)]
  },
})
