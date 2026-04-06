import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react'
import { get, search as emojiSearch } from 'node-emoji'

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
  try {
    return emojiSearch(new RegExp(escaped, 'i')).slice(0, 120)
  } catch {
    return []
  }
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
  const searchId = useId()

  const results = useMemo(() => safeEmojiSearch(query), [query])

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

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Insert emoji"
      aria-modal="true"
      className="absolute left-0 top-full z-50 mt-1 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-border bg-card py-2 shadow-lg dark:bg-card"
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
      <p className="border-t border-border px-3 py-1.5 text-[10px] text-foreground/50">
        Inserts GitHub-style shortcodes (rendered as emoji in preview).
      </p>
    </div>
  )
}
