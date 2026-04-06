import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import emojilib from 'emojilib'
import { get } from 'node-emoji'

const POPULAR_NAMES = [
  '+1',
  '-1',
  'thumbsup',
  'thumbsdown',
  'heart',
  'fire',
  'rocket',
  'eyes',
  'smile',
  'tada',
  'sparkles',
  'star',
  'white_check_mark',
  'x',
  'warning',
  'bug',
  '100',
  'thinking',
  'pray',
  'clap',
  'raised_hands',
  'muscle',
  'grinning',
  'joy',
  'laughing',
  'wink',
  'sweat_smile',
  'triumph',
  'cry',
  'coffee',
  'memo',
  'book',
  'bulb',
  'zap',
  'gift',
  'trophy',
]

function safeEmojiSearch(query: string): { name: string; emoji: string }[] {
  const t = query.trim()
  if (!t) {
    return POPULAR_NAMES.map((name) => ({ name, emoji: get(name) ?? '' })).filter((x) => x.emoji)
  }
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let re: RegExp
  try {
    re = new RegExp(escaped, 'i')
  } catch {
    return []
  }
  /**
   * `node-emoji` search() rebuilds RegExp from `.source` and drops flags, so case-insensitive
   * queries never matched. We filter `emojilib` keys directly (same data source as node-emoji).
   */
  const out: { name: string; emoji: string }[] = []
  for (const name of Object.keys(emojilib.lib)) {
    if (!re.test(name)) continue
    const char = emojilib.lib[name as keyof typeof emojilib.lib]?.char
    if (char) out.push({ name, emoji: char })
    if (out.length >= 120) break
  }
  return out
}

export type WikiEmojiPickerProps = {
  open: boolean
  onClose: () => void
  onPick: (shortcode: string) => void
  /** Toolbar control that opens the picker — excluded from outside-close so toggle works. */
  anchorRef?: RefObject<HTMLElement | null>
}

export function WikiEmojiPicker({ open, onClose, onPick, anchorRef }: WikiEmojiPickerProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [placement, setPlacement] = useState({ top: 0, left: 0 })
  const searchId = useId()

  const results = useMemo(() => safeEmojiSearch(query), [query])

  const updatePlacement = useCallback(() => {
    const anchor = anchorRef?.current
    const panel = panelRef.current
    if (!open || !anchor || !panel) return

    panel.style.maxHeight = ''
    panel.style.overflowY = ''

    const r = anchor.getBoundingClientRect()
    const margin = 8
    const gap = 6
    const vw = window.innerWidth
    const vh = window.innerHeight

    let left = r.left
    const pw = panel.offsetWidth
    if (left + pw > vw - margin) {
      left = vw - margin - pw
    }
    if (left < margin) {
      left = margin
    }

    let top = r.bottom + gap
    const ph = panel.offsetHeight
    if (top + ph > vh - margin) {
      const above = r.top - ph - gap
      if (above >= margin) {
        top = above
      } else {
        top = margin
        const maxH = vh - 2 * margin
        if (ph > maxH) {
          panel.style.maxHeight = `${maxH}px`
          panel.style.overflowY = 'auto'
        }
      }
    }

    if (top + panel.offsetHeight > vh - margin) {
      top = Math.max(margin, vh - margin - panel.offsetHeight)
    }
    if (top < margin) {
      top = margin
    }

    setPlacement({ top, left })
  }, [open, anchorRef])

  useLayoutEffect(() => {
    if (!open) return
    updatePlacement()
  }, [open, updatePlacement, query, results.length])

  useEffect(() => {
    if (!open) return
    const onMove = () => updatePlacement()
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open, updatePlacement])

  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }
    const t = requestAnimationFrame(() => searchRef.current?.focus())
    return () => cancelAnimationFrame(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t)) return
      if (anchorRef?.current?.contains(t)) return
      onClose()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, onClose, anchorRef])

  if (!open) return null

  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Insert emoji"
      aria-modal="true"
      className="fixed z-[200] w-[min(20rem,calc(100vw-1rem))] rounded-lg border border-border bg-card py-2 shadow-lg dark:bg-card"
      style={{ top: placement.top, left: placement.left }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="px-2 pb-2">
        <label htmlFor={searchId} className="sr-only">
          Search emoji by name
        </label>
        <input
          id={searchId}
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search… (e.g. smile, fire)"
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none ring-primary focus:ring-2"
        />
      </div>
      <div className="max-h-56 overflow-y-auto px-2">
        {results.length === 0 ? (
          <p className="px-1 py-4 text-center text-xs text-foreground/60">No matches.</p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-1">
            {results.map(({ name, emoji }) => (
              <li key={name}>
                <button
                  type="button"
                  title={`:${name}:`}
                  aria-label={`Insert ${emoji} ${name}`}
                  className="flex h-9 w-full items-center justify-center rounded-md text-lg leading-none hover:bg-foreground/[0.08] focus:bg-foreground/[0.08] focus:outline-none focus:ring-2 focus:ring-primary"
                  onClick={() => {
                    onPick(`:${name}:`)
                    onClose()
                  }}
                >
                  <span aria-hidden>{emoji}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(panel, document.body) : null
}
