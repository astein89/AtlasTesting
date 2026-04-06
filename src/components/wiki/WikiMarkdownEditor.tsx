import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { WikiMarkdown } from '@/components/wiki/WikiMarkdown'
import { WikiEmojiPicker } from '@/components/wiki/WikiEmojiPicker'
import { WikiEditorHelpModal } from '@/components/wiki/WikiEditorHelpModal'
import { parseWikiHeadings } from '@/lib/wikiHeadings'

const PREVIEW_STORAGE_KEY = 'wiki.editor.showPreview'

function readInitialPreview(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const v = localStorage.getItem(PREVIEW_STORAGE_KEY)
    if (v === '1') return true
    if (v === '0') return false
  } catch {
    /* ignore */
  }
  return window.matchMedia('(min-width: 1024px)').matches
}

function persistPreview(visible: boolean) {
  try {
    localStorage.setItem(PREVIEW_STORAGE_KEY, visible ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function lineBounds(text: string, pos: number): { start: number; end: number } {
  const start = text.lastIndexOf('\n', Math.max(0, pos - 1)) + 1
  const nl = text.indexOf('\n', pos)
  const end = nl === -1 ? text.length : nl
  return { start, end }
}

function selectionLineBlock(text: string, a: number, b: number): { blockStart: number; blockEnd: number } {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  const { start: blockStart } = lineBounds(text, lo)
  const { end: blockEnd } = lineBounds(text, Math.max(0, hi - 1))
  return { blockStart, blockEnd }
}

const LIST_LINE_RE = /^(\s*)((?:[-*])|(?:\d+\.))\s*(.*)$/
const QUOTE_LINE_RE = /^(\s*)(> )\s*(.*)$/

/** Leading-space columns (tabs = 4 cols) for depth math. */
function listIndentColumns(indent: string): number {
  let cols = 0
  for (const ch of indent) {
    if (ch === '\t') cols += 4
    else if (ch === ' ') cols += 1
  }
  return cols
}

/**
 * List nesting depth for marker rotation (bullets) / UI. Uses 4-space steps (CommonMark-friendly);
 * legacy 2-space indents count as one level via ceil(cols/4).
 */
function listIndentDepth(indent: string): number {
  const cols = listIndentColumns(indent)
  if (cols === 0) return 0
  return Math.ceil(cols / 4)
}

/** Top level `-`, first nest `*`, then alternate (matches typical markdown editors). */
function bulletMarkerForDepth(depth: number): '-' | '*' {
  return depth % 2 === 0 ? '-' : '*'
}

/** Indent / outdent every line in [blockStart, blockEnd) with literal tab characters. */
function indentLineBlock(
  text: string,
  blockStart: number,
  blockEnd: number,
  shift: boolean
): { next: string; selStart: number; selEnd: number } {
  const block = text.slice(blockStart, blockEnd)
  const lines = block.split('\n')
  if (shift) {
    const dedented = lines.map((ln) => {
      if (ln.startsWith('\t')) return ln.slice(1)
      if (ln.startsWith('    ')) return ln.slice(4)
      if (ln.startsWith('  ')) return ln.slice(2)
      if (ln.startsWith(' ')) return ln.slice(1)
      return ln
    })
    const mapped = dedented.join('\n')
    const next = text.slice(0, blockStart) + mapped + text.slice(blockEnd)
    return { next, selStart: blockStart, selEnd: blockStart + mapped.length }
  }
  const indented = lines.map((ln) => `\t${ln}`).join('\n')
  const next = text.slice(0, blockStart) + indented + text.slice(blockEnd)
  return { next, selStart: blockStart, selEnd: blockStart + indented.length }
}

function isListOrQuoteLine(line: string): boolean {
  if (line === '') return false
  return LIST_LINE_RE.test(line) || QUOTE_LINE_RE.test(line)
}

/**
 * Indent/outdent a markdown list line by 4 spaces (CommonMark list nesting). Blockquotes still use 2.
 * Returns null if the line is not a list or quote.
 */
function indentMarkdownListOrQuoteLine(line: string, shift: boolean): string | null {
  if (line === '') return null
  const listM = LIST_LINE_RE.exec(line)
  if (listM) {
    const [, indent, marker, rest] = listM
    const restNorm = rest.replace(/^\s*/, '')
    if (shift) {
      if (!indent) return line
      let newIndent = indent
      if (newIndent.endsWith('    ')) newIndent = newIndent.slice(0, -4)
      else if (newIndent.endsWith('  ')) newIndent = newIndent.slice(0, -2)
      else if (newIndent.endsWith('\t')) newIndent = newIndent.slice(0, -1)
      else if (newIndent.endsWith(' ')) newIndent = newIndent.slice(0, -1)
      else return line
      const depthOut = listIndentDepth(newIndent)
      let newMarker = marker
      if (/^[-*]$/.test(marker)) {
        newMarker = bulletMarkerForDepth(depthOut)
      }
      return `${newIndent}${newMarker} ${restNorm}`
    }
    const newIndent = `${indent}    `
    const depthIn = listIndentDepth(newIndent)
    let newMarker = marker
    if (/^\d+\.$/.test(marker)) {
      newMarker = '1.'
    } else if (/^[-*]$/.test(marker)) {
      newMarker = bulletMarkerForDepth(depthIn)
    }
    return `${newIndent}${newMarker} ${restNorm}`
  }
  const quoteM = QUOTE_LINE_RE.exec(line)
  if (quoteM) {
    const [, indent, gt, rest] = quoteM
    if (shift) {
      if (!indent) return line
      let newIndent = indent
      if (newIndent.endsWith('  ')) newIndent = newIndent.slice(0, -2)
      else if (newIndent.endsWith('\t')) newIndent = newIndent.slice(0, -1)
      else if (newIndent.endsWith(' ')) newIndent = newIndent.slice(0, -1)
      else return line
      return `${newIndent}${gt}${rest}`
    }
    return `${indent}  ${gt}${rest}`
  }
  return null
}

/** Map a caret/selection offset after replacing oldBlock with newBlock at blockStart (same number of lines). */
function mapPosInBlock(blockStart: number, oldBlock: string, newBlock: string, pos: number): number {
  if (pos <= blockStart) return pos
  const oldEnd = blockStart + oldBlock.length
  if (pos >= oldEnd) return pos + (newBlock.length - oldBlock.length)
  const rel = pos - blockStart
  const oldLines = oldBlock.split('\n')
  const newLines = newBlock.split('\n')
  let accOld = 0
  let accNew = 0
  for (let i = 0; i < oldLines.length; i++) {
    const oLine = oldLines[i]!
    const nLine = newLines[i] ?? oLine
    const lineEndOld = accOld + oLine.length
    if (rel <= lineEndOld) {
      const offset = rel - accOld
      return blockStart + accNew + offset + (nLine.length - oLine.length)
    }
    accOld = lineEndOld + 1
    accNew += nLine.length + 1
  }
  return pos
}

/** When every non-empty line is a list or quote: adjust nesting; otherwise return null. */
function tryIndentListQuoteBlock(
  text: string,
  blockStart: number,
  blockEnd: number,
  shift: boolean,
  selStart: number,
  selEnd: number
): { next: string; selStart: number; selEnd: number } | null {
  const block = text.slice(blockStart, blockEnd)
  const lines = block.split('\n')
  const nonEmpty = lines.filter((l) => l !== '')
  if (nonEmpty.length === 0) return null
  if (!nonEmpty.every((l) => isListOrQuoteLine(l))) return null
  const mappedLines = lines.map((ln) => {
    if (ln === '') return ln
    return indentMarkdownListOrQuoteLine(ln, shift) ?? ln
  })
  const mapped = mappedLines.join('\n')
  if (mapped === block) return null
  const next = text.slice(0, blockStart) + mapped + text.slice(blockEnd)
  return {
    next,
    selStart: mapPosInBlock(blockStart, block, mapped, selStart),
    selEnd: mapPosInBlock(blockStart, block, mapped, selEnd),
  }
}

/**
 * When Enter is pressed at end of a list or blockquote line: insert the next marker,
 * or remove an empty item and exit the list/quote (Typora-style).
 */
function listOrQuoteEnter(text: string, sel: number): { next: string; selStart: number; selEnd: number } | null {
  const { start: lineStart, end: lineEnd } = lineBounds(text, sel)
  if (sel !== lineEnd) return null

  const line = text.slice(lineStart, lineEnd)
  const listM = LIST_LINE_RE.exec(line)
  if (listM) {
    const [, indent, marker, rest] = listM
    if (rest.trim() === '') {
      const next = text.slice(0, lineStart) + text.slice(lineEnd)
      return { next, selStart: lineStart, selEnd: lineStart }
    }
    let nextMarker = marker
    if (/^\d+\.$/.test(marker)) {
      nextMarker = `${parseInt(marker.slice(0, -1), 10) + 1}.`
    }
    const insert = `\n${indent}${nextMarker} `
    const next = text.slice(0, sel) + insert + text.slice(sel)
    const pos = sel + insert.length
    return { next, selStart: pos, selEnd: pos }
  }

  const quoteM = QUOTE_LINE_RE.exec(line)
  if (quoteM) {
    const [, indent, gt, rest] = quoteM
    if (rest.trim() === '') {
      const next = text.slice(0, lineStart) + text.slice(lineEnd)
      return { next, selStart: lineStart, selEnd: lineStart }
    }
    const insert = `\n${indent}${gt}`
    const next = text.slice(0, sel) + insert + text.slice(sel)
    const pos = sel + insert.length
    return { next, selStart: pos, selEnd: pos }
  }

  return null
}

function setHeadingLevel(
  text: string,
  selStart: number,
  selEnd: number,
  level: 1 | 2 | 3
): { next: string; selStart: number; selEnd: number } {
  const { start, end } = lineBounds(text, selStart)
  const line = text.slice(start, end)
  const body = line.replace(/^#{1,6}\s*/, '')
  const newLine = `${'#'.repeat(level)} ${body}`
  const next = text.slice(0, start) + newLine + text.slice(end)
  const delta = newLine.length - line.length
  return { next, selStart: selStart + delta, selEnd: selEnd + delta }
}

function toggleLinePrefix(
  text: string,
  selStart: number,
  selEnd: number,
  prefix: string
): { next: string; selStart: number; selEnd: number } {
  const { blockStart, blockEnd } = selectionLineBlock(text, selStart, selEnd)
  const block = text.slice(blockStart, blockEnd)
  const lines = block.split(/\r?\n/)
  const nonEmpty = lines.filter((ln) => ln !== '')
  /** Strip only when every non-empty line already has the prefix (not when the block is all blank lines). */
  const allHave = nonEmpty.length > 0 && nonEmpty.every((ln) => ln.startsWith(prefix))
  const mapped = lines
    .map((ln) => {
      if (allHave) {
        if (ln.startsWith(prefix)) return ln.slice(prefix.length)
        return ln
      }
      if (ln === '') return prefix
      if (!ln.startsWith(prefix)) return prefix + ln
      return ln
    })
    .join('\n')
  const next = text.slice(0, blockStart) + mapped + text.slice(blockEnd)
  return { next, selStart: blockStart + mapped.length, selEnd: blockStart + mapped.length }
}

type ToolBtnProps = {
  label: string
  title: string
  onClick: () => void
  disabled?: boolean
}

function ToolBtn({ label, title, onClick, disabled }: ToolBtnProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="min-h-8 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground hover:bg-foreground/[0.04] disabled:opacity-45 dark:hover:bg-foreground/[0.07]"
    >
      {label}
    </button>
  )
}

export function WikiMarkdownEditor({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
}) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const emojiToolbarBtnRef = useRef<HTMLButtonElement>(null)
  const [showPreview, setShowPreview] = useState(readInitialPreview)
  const [helpOpen, setHelpOpen] = useState(false)
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)

  const headings = useMemo(() => parseWikiHeadings(value), [value])

  useEffect(() => {
    if (disabled) setEmojiPickerOpen(false)
  }, [disabled])

  const focusAndSelect = (start: number, end: number) => {
    const ta = taRef.current
    if (!ta) return
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(start, end)
    })
  }

  const withValue = useCallback(
    (editor: (t: string, s: number, e: number) => { next: string; selStart: number; selEnd: number }) => {
      const ta = taRef.current
      const s = ta?.selectionStart ?? value.length
      const e = ta?.selectionEnd ?? value.length
      const { next, selStart, selEnd } = editor(value, s, e)
      onChange(next)
      focusAndSelect(selStart, selEnd)
    },
    [value, onChange]
  )

  const wrapSelection = (before: string, after: string) => {
    withValue((t, s, e) => {
      const sel = t.slice(s, e)
      const next = t.slice(0, s) + before + sel + after + t.slice(e)
      const innerStart = s + before.length
      const innerEnd = innerStart + sel.length
      return sel ? { next, selStart: innerStart, selEnd: innerEnd } : { next, selStart: s + before.length, selEnd: s + before.length }
    })
  }

  const insertSnippet = (snippet: string, cursorOffset: number) => {
    withValue((t, s, e) => {
      const next = t.slice(0, s) + snippet + t.slice(e)
      const pos = s + cursorOffset
      return { next, selStart: pos, selEnd: pos }
    })
  }

  const setPreview = (visible: boolean) => {
    persistPreview(visible)
    setShowPreview(visible)
  }

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (disabled) return
      if (e.nativeEvent.isComposing) return

      if (e.key === 'Tab') {
        e.preventDefault()
        const ta = e.currentTarget
        const start = ta.selectionStart
        const end = ta.selectionEnd
        const blockStart =
          start === end ? lineBounds(value, start).start : selectionLineBlock(value, start, end).blockStart
        const blockEnd =
          start === end ? lineBounds(value, start).end : selectionLineBlock(value, start, end).blockEnd
        const listResult = tryIndentListQuoteBlock(value, blockStart, blockEnd, e.shiftKey, start, end)
        if (listResult) {
          onChange(listResult.next)
          requestAnimationFrame(() => {
            ta.focus()
            ta.setSelectionRange(listResult.selStart, listResult.selEnd)
          })
          return
        }
        if (start !== end) {
          const result = indentLineBlock(value, blockStart, blockEnd, e.shiftKey)
          onChange(result.next)
          requestAnimationFrame(() => {
            ta.focus()
            ta.setSelectionRange(result.selStart, result.selEnd)
          })
          return
        }
        if (e.shiftKey) {
          const { start: lineStart } = lineBounds(value, start)
          const beforeCaret = value.slice(lineStart, start)
          let cut = 0
          if (beforeCaret.endsWith('\t')) cut = 1
          else if (beforeCaret.endsWith('    ')) cut = 4
          else if (beforeCaret.endsWith('  ')) cut = 2
          else if (beforeCaret.endsWith(' ')) cut = 1
          if (cut === 0) return
          const from = start - cut
          const next = value.slice(0, from) + value.slice(start)
          onChange(next)
          requestAnimationFrame(() => {
            ta.focus()
            ta.setSelectionRange(from, from)
          })
          return
        }
        const next = value.slice(0, start) + '\t' + value.slice(end)
        onChange(next)
        requestAnimationFrame(() => {
          ta.focus()
          const pos = start + 1
          ta.setSelectionRange(pos, pos)
        })
        return
      }

      if (e.key !== 'Enter' || e.shiftKey) return
      const ta = e.currentTarget
      if (ta.selectionStart !== ta.selectionEnd) return
      const result = listOrQuoteEnter(value, ta.selectionStart)
      if (!result) return
      e.preventDefault()
      onChange(result.next)
      requestAnimationFrame(() => {
        ta.focus()
        ta.setSelectionRange(result.selStart, result.selEnd)
      })
    },
    [disabled, onChange, value]
  )

  return (
    <div className="w-full">
      <div className="mb-2 flex flex-col gap-2 border-b border-border pb-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1">
          <ToolBtn
            label="H1"
            title="Heading 1"
            disabled={disabled}
            onClick={() => withValue((t, s, e) => setHeadingLevel(t, s, e, 1))}
          />
          <ToolBtn
            label="H2"
            title="Heading 2"
            disabled={disabled}
            onClick={() => withValue((t, s, e) => setHeadingLevel(t, s, e, 2))}
          />
          <ToolBtn
            label="H3"
            title="Heading 3"
            disabled={disabled}
            onClick={() => withValue((t, s, e) => setHeadingLevel(t, s, e, 3))}
          />
          <span className="mx-0.5 w-px self-stretch bg-border" aria-hidden />
          <ToolBtn label="Bold" title="Bold" disabled={disabled} onClick={() => wrapSelection('**', '**')} />
          <ToolBtn label="Italic" title="Italic" disabled={disabled} onClick={() => wrapSelection('*', '*')} />
          <ToolBtn
            label="Code"
            title="Inline code"
            disabled={disabled}
            onClick={() => wrapSelection('`', '`')}
          />
          <ToolBtn
            label="Link"
            title="Insert link"
            disabled={disabled}
            onClick={() =>
              withValue((t, s, e) => {
                const snippet = '[text](url)'
                const next = t.slice(0, s) + snippet + t.slice(e)
                return { next, selStart: s + 1, selEnd: s + 5 }
              })
            }
          />
          <span className="mx-0.5 w-px self-stretch bg-border" aria-hidden />
          <ToolBtn
            label="• List"
            title="Bullet list"
            disabled={disabled}
            onClick={() => withValue((t, s, e) => toggleLinePrefix(t, s, e, '- '))}
          />
          <ToolBtn
            label="1. List"
            title="Numbered list"
            disabled={disabled}
            onClick={() =>
              withValue((t, s, e) => {
                const { blockStart, blockEnd } = selectionLineBlock(t, s, e)
                const block = t.slice(blockStart, blockEnd)
                const lines = block.split(/\r?\n/)
                const nonEmpty = lines.filter((ln) => ln !== '')
                const allNumbered =
                  nonEmpty.length > 0 && nonEmpty.every((ln) => /^\d+\.\s/.test(ln))
                const mapped = lines
                  .map((ln) => {
                    if (allNumbered) {
                      if (ln === '') return ln
                      return ln.replace(/^\d+\.\s+/, '')
                    }
                    if (ln === '') return '1. '
                    const stripped = ln.replace(/^[-*]\s+/, '')
                    return `1. ${stripped}`
                  })
                  .join('\n')
                const next = t.slice(0, blockStart) + mapped + t.slice(blockEnd)
                return { next, selStart: blockStart + mapped.length, selEnd: blockStart + mapped.length }
              })
            }
          />
          <ToolBtn
            label="Quote"
            title="Blockquote"
            disabled={disabled}
            onClick={() => withValue((t, s, e) => toggleLinePrefix(t, s, e, '> '))}
          />
          <ToolBtn
            label="HR"
            title="Horizontal rule"
            disabled={disabled}
            onClick={() => insertSnippet('\n\n---\n\n', '\n\n---\n\n'.length)}
          />
          <ToolBtn
            label="Table"
            title="Insert Markdown table"
            disabled={disabled}
            onClick={() =>
              withValue((t, s, e) => {
                const sn = '\n\n| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |\n'
                const next = t.slice(0, s) + sn + t.slice(e)
                const hdrStart = s + 4
                const hdrEnd = hdrStart + 'Column 1'.length
                return { next, selStart: hdrStart, selEnd: hdrEnd }
              })
            }
          />
          <ToolBtn
            label="``` "
            title="Code block"
            disabled={disabled}
            onClick={() => {
              const sn = '\n```\n\n```\n'
              insertSnippet(sn, '\n```\n\n'.length)
            }}
          />
          <ToolBtn
            label="md"
            title="Markdown embed (```md … ```, rendered in preview)"
            disabled={disabled}
            onClick={() => {
              const sn = '\n```md\n\n```\n'
              insertSnippet(sn, '\n```md\n\n'.length)
            }}
          />
          <span className="mx-0.5 w-px self-stretch bg-border" aria-hidden />
          <div className="relative inline-flex self-center">
            <button
              ref={emojiToolbarBtnRef}
              type="button"
              disabled={disabled}
              onClick={() => setEmojiPickerOpen((o) => !o)}
              className="min-h-8 rounded-md border border-border bg-background px-2 py-1 text-base leading-none hover:bg-foreground/[0.04] disabled:opacity-45 dark:hover:bg-foreground/[0.07]"
              title="Insert emoji (:shortcode:)"
              aria-label="Insert emoji"
              aria-expanded={emojiPickerOpen}
              aria-haspopup="dialog"
            >
              <span aria-hidden>😀</span>
            </button>
            <WikiEmojiPicker
              open={emojiPickerOpen}
              anchorRef={emojiToolbarBtnRef}
              onClose={() => setEmojiPickerOpen(false)}
              onPick={(shortcode) => insertSnippet(shortcode, shortcode.length)}
            />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setHelpOpen(true)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-background text-sm font-semibold text-foreground hover:bg-foreground/[0.04] disabled:opacity-45 dark:hover:bg-foreground/[0.07]"
            title="Editor help (Markdown & Mermaid)"
            aria-label="Editor help"
          >
            ?
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setPreview(!showPreview)}
            className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium ${
              showPreview
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-background text-foreground hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.07]'
            } disabled:opacity-45`}
            aria-pressed={showPreview}
          >
            {showPreview ? 'Hide preview' : 'Show preview'}
          </button>
        </div>
      </div>

      <div
        className={
          showPreview
            ? 'flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-4'
            : 'flex flex-col'
        }
      >
        <div className={showPreview ? 'min-h-[min(50vh,28rem)] w-full min-w-0 flex-1' : 'w-full'}>
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            rows={showPreview ? 22 : 28}
            spellCheck
            className="h-[min(70vh,40rem)] w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none ring-primary focus:ring-2 disabled:opacity-60 lg:h-[calc(100vh-14rem)] lg:min-h-[20rem]"
            aria-label="Markdown source"
          />
        </div>
        {showPreview ? (
          <div
            className="wiki-editor-preview max-h-[min(50vh,28rem)] w-full overflow-auto rounded-lg border border-border bg-card p-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-8rem)] lg:w-[calc(50%-0.5rem)] lg:max-w-xl xl:max-w-2xl"
            aria-label="Live preview"
          >
            {value.trim() ? (
              <WikiMarkdown content={value} headings={headings} />
            ) : (
              <p className="text-sm text-foreground/50">Nothing to preview yet.</p>
            )}
          </div>
        ) : null}
      </div>
      <WikiEditorHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}
