import remarkBreaks from 'remark-breaks'
import remarkEmoji from 'remark-emoji'
import remarkGfm from 'remark-gfm'

/**
 * Single remark pipeline for all app Markdown surfaces (wiki, home, files preview, editor preview).
 * GFM + soft breaks + `:shortcode:` emoji — no per-surface drift.
 */
export const appMarkdownRemarkPlugins = [remarkGfm, remarkBreaks, remarkEmoji]
