import { Fragment, createContext, isValidElement, useContext, useMemo } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import type { WikiHeading } from '@/lib/wikiHeadings'
import { appMarkdownRemarkPlugins } from '@/lib/appMarkdownRemarkPlugins'
import { MermaidBlock } from './MermaidBlock'

/** Block quotes: high contrast bar + card background so they don’t blend into body text. */
const wikiBlockquoteCls =
  'my-4 rounded-r-lg border-l-[3px] border-primary/55 bg-card py-3 pl-4 pr-3 text-foreground shadow-sm dark:border-primary/45 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:!mb-2 [&_ol]:!mb-2 [&_ul]:!mt-2 [&_ol]:!mt-2'

/** Fenced code: scrollable, mono, distinct surface from body. */
const wikiPreCls =
  'mb-4 max-h-[min(70vh,48rem)] overflow-auto rounded-lg border border-border bg-card p-4 font-mono text-[13px] leading-relaxed tracking-[0.01em] text-foreground shadow-sm dark:bg-card/80'

const wikiPreInnerCodeCls =
  'block min-w-full max-w-none bg-transparent p-0 font-mono text-[13px] font-normal leading-relaxed tracking-[0.01em] text-inherit'

/** Inline `` `...` ``: tight horizontal padding so the pill doesn’t add a visible gap after the token. */
const wikiInlineCodeCls =
  'rounded border border-border/80 bg-card py-px pl-[0.2em] pr-[0.125em] align-middle font-mono text-[0.85em] font-medium leading-normal text-foreground dark:border-border'

/** List gutters / nested markers live in `index.css` (`.wiki-md-body`). */
const markdownShell =
  'wiki-md-body max-w-none text-sm leading-relaxed text-foreground [&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mb-1.5 [&_h3]:text-lg [&_h3]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_hr]:my-4 [&_hr]:border-border'

/** True while rendering `<code>` that is a child of our `<pre>` (fenced / indented blocks). */
const WikiCodeInPreContext = createContext(false)

/** True for descendants of `<li>` (HAST `node.parent` is often missing on `p`, so margins were wrong). */
const WikiInListItemContext = createContext(false)

/** Plain text from markdown code node children (avoids `String([object Object])` when not a raw string). */
function reactNodeToPlainText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(reactNodeToPlainText).join('')
  if (isValidElement(node)) {
    const { type, props } = node
    if (type === 'br') return '\n'
    if (type === 'img') {
      const alt = String((props as { alt?: string }).alt ?? '')
      return alt || ' '
    }
    return reactNodeToPlainText((props as { children?: ReactNode }).children as ReactNode)
  }
  return ''
}

/** Concatenate all HAST text nodes (fence body lives here; React `children` can be lossy in edge cases). */
function extractTextFromHastTree(node: unknown): string {
  if (node == null || typeof node !== 'object') return ''
  const n = node as { type?: string; value?: string; children?: unknown[] }
  if (n.type === 'text' && typeof n.value === 'string') return n.value
  if (!Array.isArray(n.children)) return ''
  return n.children.map((c) => extractTextFromHastTree(c)).join('')
}

/** Preferred raw string for fenced blocks passed to inner Markdown. */
function rawFenceString(children: ReactNode, hastNode: unknown): string {
  const fromHast = extractTextFromHastTree(hastNode)
  if (fromHast.length > 0) return fromHast
  return reactNodeToPlainText(children)
}

/** Trim edges and cap blank runs so stray newlines don’t become empty/extra paragraphs. */
function sanitizeMdEmbedSource(raw: string): string {
  let s = raw.replace(/\r\n/g, '\n')
  const lines = s.split('\n')
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
  while (lines.length > 0 && lines[0].trim() === '') lines.shift()
  s = lines.join('\n')
  return s.replace(/\n{3,}/g, '\n\n')
}

/**
 * Trim blank lines at start/end, remove shared leading spaces on non-empty lines (dedent),
 * and strip trailing whitespace on each line so fences don’t show accidental padding.
 */
function normalizeFenceBody(raw: string): string {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  while (lines.length > 0 && lines[0].trim() === '') lines.shift()
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
  if (lines.length === 0) return ''
  let min = Infinity
  for (const line of lines) {
    if (!line.trim()) continue
    min = Math.min(min, /^ */.exec(line)?.[0].length ?? 0)
  }
  if (!Number.isFinite(min) || min === 0) {
    return lines.map((l) => l.replace(/\s+$/, '')).join('\n')
  }
  return lines
    .map((line) => (line.trim() ? line.slice(min).replace(/\s+$/, '') : ''))
    .join('\n')
}

/** react-markdown passes HAST `node` (passNode); class sometimes only lives on `node.properties`. */
function codeLanguageClass(className: string | undefined, node: unknown): string {
  if (className) return className
  if (!node || typeof node !== 'object' || !('properties' in node)) return ''
  const props = (node as { properties?: { className?: string | string[] | (string | number)[] } }).properties
  const c = props?.className
  if (c == null) return ''
  if (Array.isArray(c)) return c.map(String).join(' ')
  return String(c)
}

function parseFenceLang(className: string | undefined, node: unknown): string | undefined {
  const cls = codeLanguageClass(className, node)
  const m = /language-([\w-]+)/.exec(cls)
  return m?.[1]?.toLowerCase()
}

/** True when this hast node sits under a `<li>` (loose list items wrap content in `<p>`). */
function isHastUnderListItem(node: unknown): boolean {
  let current: unknown = node
  for (let i = 0; i < 16 && current && typeof current === 'object'; i++) {
    const el = current as { type?: string; tagName?: string; parent?: unknown }
    if (el.type === 'element' && el.tagName === 'li') return true
    current = el.parent
  }
  return false
}

/** Walk HAST parents when linked (not always set on `node` passed to components). */
function isHastCodeInsidePre(node: unknown): boolean {
  let current: unknown = node
  for (let i = 0; i < 8 && current && typeof current === 'object'; i++) {
    const el = current as { type?: string; tagName?: string; parent?: unknown }
    if (el.type === 'element' && el.tagName === 'pre') return true
    current = el.parent
  }
  return false
}

/**
 * Fenced `code` vs inline `` `...` ``:
 * - Plain ` ``` ` fences have no `language-*` class; HAST `parent` is often missing on `node`.
 * - Without another signal, multiline bodies were mis-rendered as inline `<code>` (broken spacing).
 * - `WikiCodeInPreContext` from our `pre` is the reliable indicator.
 */
function isFenceCode(
  className: string | undefined,
  node: unknown,
  renderedInsidePre: boolean
): boolean {
  if (renderedInsidePre) return true
  if (isHastCodeInsidePre(node)) return true
  const cls = codeLanguageClass(className, node)
  return /\blanguage-[\w-]+\b/.test(cls)
}

function stripIgnorableWhitespaceNodes(nodes: ReactNode[]): ReactNode[] {
  return nodes.filter((ch) => !(typeof ch === 'string' && !/\S/.test(ch)))
}

function flattenPreChildren(children: ReactNode): ReactNode[] {
  const out: ReactNode[] = []
  const visit = (n: ReactNode): void => {
    if (n == null || n === false) return
    if (Array.isArray(n)) {
      for (const x of n) visit(x)
      return
    }
    if (isValidElement(n) && n.type === Fragment) {
      visit(n.props.children as ReactNode)
      return
    }
    out.push(n)
  }
  visit(children)
  return out
}

function isMermaidElement(node: ReactNode): node is ReactElement<{ chart?: string }> {
  if (!isValidElement(node)) return false
  const chart = (node.props as { chart?: string }).chart
  return typeof chart === 'string'
}

function isMarkdownEmbedElement(node: ReactNode): node is ReactElement<{ source?: string }> {
  if (!isValidElement(node)) return false
  const source = (node.props as { source?: string }).source
  return typeof source === 'string'
}

function WikiMarkdownPre({
  children,
  className,
}: {
  children?: ReactNode
  className?: string
}) {
  const flat = flattenPreChildren(children)
  for (const ch of flat) {
    if (isMermaidElement(ch)) return ch
    if (isMarkdownEmbedElement(ch)) return ch
  }
  const cleaned = stripIgnorableWhitespaceNodes(flat)
  const inner = cleaned.length > 0 ? cleaned : children
  return (
    <WikiCodeInPreContext.Provider value={true}>
      <pre className={['whitespace-pre', wikiPreCls, className].filter(Boolean).join(' ')}>{inner}</pre>
    </WikiCodeInPreContext.Provider>
  )
}

function WikiMarkdownCode({
  className,
  children,
  node,
}: {
  className?: string
  children?: ReactNode
  node?: unknown
}) {
  const inPre = useContext(WikiCodeInPreContext)
  if (!isFenceCode(className, node, inPre)) {
    return (
      <code className={[wikiInlineCodeCls, className].filter(Boolean).join(' ')}>{children}</code>
    )
  }
  const lang = parseFenceLang(className, node)
  if (lang === 'mermaid') {
    const text = normalizeFenceBody(reactNodeToPlainText(children))
    return <MermaidBlock chart={text} />
  }
  if (lang === 'md' || lang === 'markdown') {
    const raw = rawFenceString(children, node).replace(/\r\n/g, '\n').replace(/\n$/, '')
    return <MarkdownEmbed source={sanitizeMdEmbedSource(raw)} />
  }
  const body = normalizeFenceBody(reactNodeToPlainText(children))
  return (
    <code className={['whitespace-pre', wikiPreInnerCodeCls, className].filter(Boolean).join(' ')}>
      {body}
    </code>
  )
}

function WikiMarkdownLi({
  children,
  className,
}: {
  children?: ReactNode
  className: string
}) {
  return (
    <WikiInListItemContext.Provider value={true}>
      <li className={className}>{children}</li>
    </WikiInListItemContext.Provider>
  )
}

function WikiMarkdownP({
  children,
  node,
  variant,
}: {
  children?: ReactNode
  node?: unknown
  variant: 'main' | 'embed'
}) {
  const fromCtx = useContext(WikiInListItemContext)
  const inLi = fromCtx || isHastUnderListItem(node)
  if (variant === 'embed') {
    if (inLi) {
      return (
        <p className="!m-0 !mb-0 text-sm !leading-snug [&:not(:last-child)]:!mb-2 [&:empty]:hidden">
          {children}
        </p>
      )
    }
    return (
      <p className="!m-0 text-sm !leading-snug [&:not(:last-child)]:!mb-2 [&:empty]:hidden">{children}</p>
    )
  }
  if (inLi) {
    return (
      <p className="mb-0 text-sm leading-snug [&:not(:last-child)]:mb-2 [&:empty]:hidden">{children}</p>
    )
  }
  return <p className="mb-3 text-sm leading-relaxed last:mb-0 [&:empty]:hidden">{children}</p>
}

function createWikiMarkdownComponents(consumeHeadingId: () => string | undefined) {
  const headingProps = { className: 'scroll-mt-24', tabIndex: -1 as const }

  return {
    h1({ children }: { children?: ReactNode }) {
      const id = consumeHeadingId()
      return (
        <h1 id={id} {...headingProps}>
          {children}
        </h1>
      )
    },
    h2({ children }: { children?: ReactNode }) {
      const id = consumeHeadingId()
      return (
        <h2 id={id} {...headingProps}>
          {children}
        </h2>
      )
    },
    h3({ children }: { children?: ReactNode }) {
      const id = consumeHeadingId()
      return (
        <h3 id={id} {...headingProps}>
          {children}
        </h3>
      )
    },
    blockquote({ children }: { children?: ReactNode }) {
      return <blockquote className={wikiBlockquoteCls}>{children}</blockquote>
    },
    p(props: { children?: ReactNode; node?: unknown }) {
      return <WikiMarkdownP {...props} variant="main" />
    },
    li({ children }: { children?: ReactNode }) {
      return <WikiMarkdownLi className="my-0 ps-0 leading-snug">{children}</WikiMarkdownLi>
    },
    ul({ children, className }: { children?: ReactNode; className?: string }) {
      const inner = stripIgnorableWhitespaceNodes(flattenPreChildren(children))
      return (
        <ul
          className={['mb-3 list-outside py-0 text-sm leading-snug last:mb-0 marker:text-foreground/80', className]
            .filter(Boolean)
            .join(' ')}
        >
          {inner.length > 0 ? inner : children}
        </ul>
      )
    },
    ol({ children }: { children?: ReactNode }) {
      const inner = stripIgnorableWhitespaceNodes(flattenPreChildren(children))
      return (
        <ol className="mb-3 list-outside py-0 text-sm leading-snug last:mb-0 marker:text-foreground/80">
          {inner.length > 0 ? inner : children}
        </ol>
      )
    },
    table({ children }: { children?: ReactNode }) {
      return (
        <div className="my-3 w-full max-w-full overflow-x-auto">
          <table className="w-full min-w-[12rem] border-collapse border border-border text-sm">{children}</table>
        </div>
      )
    },
    thead({ children }: { children?: ReactNode }) {
      return (
        <thead className="border-b-2 border-neutral-400 bg-neutral-200 dark:border-neutral-600 dark:bg-neutral-800 [&_th]:border-neutral-300 dark:[&_th]:border-neutral-700">
          {children}
        </thead>
      )
    },
    tbody({ children }: { children?: ReactNode }) {
      return <tbody className="bg-background">{children}</tbody>
    },
    tr({ children }: { children?: ReactNode }) {
      return <tr className="border-border">{children}</tr>
    },
    th({ children }: { children?: ReactNode }) {
      return (
        <th className="border border-neutral-300 px-2 py-2 text-left text-xs font-semibold tracking-wide text-foreground dark:border-neutral-700">
          {children}
        </th>
      )
    },
    td({ children }: { children?: ReactNode }) {
      return <td className="border border-border px-2 py-1.5 align-top text-sm">{children}</td>
    },
    pre({ children }: { children?: ReactNode }) {
      return <WikiMarkdownPre>{children}</WikiMarkdownPre>
    },
    a({ href, children, ...props }: { href?: string; children?: ReactNode }) {
      const h = href ?? ''
      if (h.startsWith('/') && !h.startsWith('//')) {
        return (
          <Link to={h} {...props}>
            {children}
          </Link>
        )
      }
      return (
        <a href={h} target="_blank" rel="noopener noreferrer" {...props}>
          {children}
        </a>
      )
    },
    code: WikiMarkdownCode,
  }
}

/**
 * Inner ` ```md ` renderer: shell’s `leading-relaxed` + `[&_p]:mb-3` apply to all descendants, so we put
 * tight `!` margins and `!leading-snug` on the actual elements.
 */
function createMarkdownEmbedInnerComponents() {
  const base = createWikiMarkdownComponents(() => undefined)
  return {
    ...base,
    strong({ children }: { children?: ReactNode }) {
      return <strong className="font-semibold text-foreground">{children}</strong>
    },
    em({ children }: { children?: ReactNode }) {
      return <em className="italic">{children}</em>
    },
    p(props: { children?: ReactNode; node?: unknown }) {
      return <WikiMarkdownP {...props} variant="embed" />
    },
    ul({ children, className }: { children?: ReactNode; className?: string }) {
      const inner = stripIgnorableWhitespaceNodes(flattenPreChildren(children))
      return (
        <ul
          className={[
            '!m-0 !mb-1 list-outside py-0 text-sm !leading-snug last:!mb-0 marker:text-foreground/80',
            className,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {inner.length > 0 ? inner : children}
        </ul>
      )
    },
    ol({ children }: { children?: ReactNode }) {
      const inner = stripIgnorableWhitespaceNodes(flattenPreChildren(children))
      return (
        <ol className="!m-0 !mb-1 list-outside py-0 text-sm !leading-snug last:!mb-0 marker:text-foreground/80">
          {inner.length > 0 ? inner : children}
        </ol>
      )
    },
    li({ children }: { children?: ReactNode }) {
      return (
        <WikiMarkdownLi className="!my-0 !ps-0 py-0 leading-snug">{children}</WikiMarkdownLi>
      )
    },
    blockquote({ children }: { children?: ReactNode }) {
      return <blockquote className={wikiBlockquoteCls}>{children}</blockquote>
    },
    hr() {
      return <hr className="!my-2 border-0 border-t border-border" />
    },
    pre({ children }: { children?: ReactNode }) {
      return <WikiMarkdownPre className="!mb-2">{children}</WikiMarkdownPre>
    },
  }
}

/** Fenced ` ```md` / ` ```markdown` body is rendered as Markdown. */
function MarkdownEmbed({ source }: { source: string }) {
  const innerComponents = useMemo(() => createMarkdownEmbedInnerComponents(), [])
  return (
    <div className="wiki-md-body wiki-md-embed isolate my-3 min-w-0 overflow-visible text-sm !leading-snug text-foreground first:mt-0 [&_h1]:!mb-1 [&_h1]:!mt-3 [&_h1]:first:!mt-0 [&_h1]:text-xl [&_h2]:!mb-1 [&_h2]:!mt-2 [&_h2]:text-lg [&_h3]:!mb-1 [&_h3]:!mt-2 [&_h3]:text-base">
      <ReactMarkdown remarkPlugins={appMarkdownRemarkPlugins} components={innerComponents} key={source}>
        {source}
      </ReactMarkdown>
    </div>
  )
}

export interface WikiMarkdownProps {
  content: string
  /** When set, headings get matching `id`s (same order as in `content`) for TOC anchors. */
  headings?: WikiHeading[]
  /** Wiki article view: mark root for print stylesheet (markdown body only). */
  wikiPrintBody?: boolean
}

export function WikiMarkdown({ content, headings = [], wikiPrintBody = false }: WikiMarkdownProps) {
  if (!content.trim()) return null

  let hi = 0
  const components = createWikiMarkdownComponents(() => {
    const h = headings[hi]
    hi += 1
    return h?.id
  })

  return (
    <div className={[wikiPrintBody ? 'wiki-print-article' : '', markdownShell].filter(Boolean).join(' ')}>
      <ReactMarkdown remarkPlugins={appMarkdownRemarkPlugins} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
