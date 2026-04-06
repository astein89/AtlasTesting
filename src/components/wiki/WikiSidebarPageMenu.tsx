import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'

function MenuDotsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M12 8a2 2 0 100-4 2 2 0 000 4zm0 2a2 2 0 110 4 2 2 0 010-4zm0 6a2 2 0 110 4 2 2 0 010-4z" />
    </svg>
  )
}

function menuBtnClass(open: boolean): string {
  return `flex h-11 w-9 shrink-0 items-center justify-center rounded border border-transparent text-foreground/50 transition-colors duration-150 sm:h-8 sm:w-8 ${
    open
      ? 'border-border bg-[var(--dropdown-list)] text-foreground'
      : 'cursor-pointer opacity-100 hover:border-border hover:bg-[var(--dropdown-list)] hover:text-foreground sm:opacity-0 sm:group-hover/wiki-row:opacity-100 sm:group-focus-within/wiki-row:opacity-100'
  }`
}

type WikiSidebarPageMenuProps = {
  pagePath: string
  onAddPage: () => void
  onAddSection: () => void
  onUpload: () => void
  onEdit: () => void
  onSettings: () => void
  onMove: () => void
  onDelete: () => void
}

function MenuPanel({
  pagePath,
  onClose,
  onAddPage,
  onAddSection,
  onUpload,
  onEdit,
  onSettings,
  onMove,
  onDelete,
  triggerRef,
}: WikiSidebarPageMenuProps & {
  onClose: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  useLayoutEffect(() => {
    const trigger = triggerRef.current
    const panel = ref.current
    if (!trigger || !panel) return

    panel.style.maxHeight = ''
    panel.style.overflowY = ''

    const r = trigger.getBoundingClientRect()
    const margin = 8
    const gap = 6
    const vw = window.innerWidth
    const vh = window.innerHeight
    const maxH = vh - 2 * margin

    let left = Math.max(margin, r.right - panel.offsetWidth)
    if (left + panel.offsetWidth > vw - margin) {
      left = Math.max(margin, vw - margin - panel.offsetWidth)
    }

    let ph = panel.offsetHeight
    if (ph > maxH) {
      panel.style.maxHeight = `${maxH}px`
      panel.style.overflowY = 'auto'
      ph = panel.offsetHeight
    }

    const belowStart = r.bottom + gap
    const fitsBelow = ph <= vh - margin - belowStart
    const fitsAbove = ph <= r.top - gap - margin

    let top: number
    if (fitsBelow) {
      top = belowStart
    } else if (fitsAbove) {
      top = r.top - gap - ph
    } else {
      panel.style.maxHeight = `${maxH}px`
      panel.style.overflowY = 'auto'
      ph = panel.offsetHeight
      top = Math.max(margin, Math.min(belowStart, vh - margin - ph))
    }

    if (top + ph > vh - margin) {
      top = Math.max(margin, vh - margin - ph)
    }
    if (top < margin) {
      top = margin
    }

    setPlacement({ top, left })
  }, [triggerRef])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t)) return
      if (ref.current && !ref.current.contains(t)) onClose()
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [onClose, triggerRef])

  /** Close when sidebar or window scrolls so the menu does not float away from the trigger. */
  useEffect(() => {
    const onScrollOrResize = () => onClose()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [onClose])

  const itemBase =
    'block w-full cursor-pointer px-2.5 py-2 text-left text-[13px] font-medium leading-snug transition-colors duration-150'
  /** Use `--dropdown-list` so hover is visible (primary ≈ foreground in light theme; /opacity on hex vars is weak). */
  const itemNeutral = `${itemBase} text-foreground hover:bg-[var(--dropdown-list)] active:bg-[var(--border)]`
  const itemDanger = `${itemBase} text-red-600 hover:bg-red-50 active:bg-red-100/80 dark:text-red-400 dark:hover:bg-red-950/45 dark:active:bg-red-950/65`

  const panel = (
    <div
      ref={ref}
      role="menu"
      aria-label={`Actions for ${pagePath}`}
      className="fixed z-[200] w-[min(12.5rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-border bg-card shadow-lg shadow-black/10 dark:shadow-black/40"
      style={{ top: placement.top, left: placement.left }}
    >
      <div className="border-b border-border px-2.5 py-1.5">
        <p className="truncate font-mono text-[11px] leading-tight text-foreground/55" title={pagePath}>
          {pagePath}
        </p>
      </div>
      <div className="py-1" role="group" aria-label="Create">
        <button type="button" role="menuitem" className={itemNeutral} onClick={() => { onAddPage(); onClose() }}>
          New page
        </button>
        <button type="button" role="menuitem" className={itemNeutral} onClick={() => { onAddSection(); onClose() }}>
          New section
        </button>
        <button type="button" role="menuitem" className={itemNeutral} onClick={() => { onUpload(); onClose() }}>
          Upload markdown…
        </button>
      </div>
      <div className="mx-2 h-px bg-border" role="separator" />
      <div className="py-1" role="group" aria-label="This page">
        <button type="button" role="menuitem" className={itemNeutral} onClick={() => { onEdit(); onClose() }}>
          Edit
        </button>
        <button type="button" role="menuitem" className={itemNeutral} onClick={() => { onSettings(); onClose() }}>
          Settings
        </button>
        <button type="button" role="menuitem" className={itemNeutral} onClick={() => { onMove(); onClose() }}>
          Move…
        </button>
      </div>
      <div className="mx-2 h-px bg-border" role="separator" />
      <div className="py-1" role="group" aria-label="Danger">
        <button
          type="button"
          role="menuitem"
          className={itemDanger}
          onClick={() => {
            onDelete()
            onClose()
          }}
        >
          Remove page
        </button>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(panel, document.body) : null
}

export function WikiSidebarPageMenu(props: WikiSidebarPageMenuProps) {
  const { pagePath } = props
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  const toggle = useCallback(() => {
    setOpen((prev) => !prev)
  }, [])

  const close = useCallback(() => setOpen(false), [])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title="Page actions"
        aria-label={`Actions for ${pagePath}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          toggle()
        }}
        className={menuBtnClass(open)}
      >
        <MenuDotsIcon />
      </button>
      {open ? (
        <MenuPanel {...props} onClose={close} triggerRef={btnRef} />
      ) : null}
    </>
  )
}
