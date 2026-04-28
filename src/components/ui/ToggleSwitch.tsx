import type { ButtonHTMLAttributes } from 'react'

type ToggleSize = 'sm' | 'md'

const sizeClass: Record<ToggleSize, { track: string; thumb: string }> = {
  /** ~ iOS small: 44×24 – thumb 18px */
  sm: {
    track: 'h-6 w-11 p-[3px]',
    thumb: 'h-[18px] w-[18px]',
  },
  md: {
    track: 'h-8 w-[3.25rem] p-[3px]',
    thumb: 'h-[22px] w-[22px]',
  },
}

export interface ToggleSwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'children' | 'role'> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  size?: ToggleSize
}

/**
 * Accessible switch: off = neutral track, on = primary. Thumb slides with `margin-inline-start: auto`.
 */
export function ToggleSwitch({
  checked,
  onCheckedChange,
  size = 'md',
  className = '',
  disabled,
  onClick,
  ...rest
}: ToggleSwitchProps) {
  const s = sizeClass[size]

  return (
    <button
      {...rest}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={[
        'inline-flex shrink-0 items-center rounded-full border transition-[background-color,border-color,opacity] duration-200 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:pointer-events-none disabled:opacity-40',
        checked
          ? 'border-border bg-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
          : 'border-neutral-300/90 bg-neutral-300 dark:border-neutral-600 dark:bg-neutral-600',
        !disabled &&
          !checked &&
          'hover:bg-neutral-400/90 dark:hover:bg-neutral-500',
        !disabled && checked && 'hover:brightness-[1.06] active:brightness-[0.96]',
        s.track,
        className,
      ].join(' ')}
      onClick={(e) => {
        onClick?.(e)
        if (!e.defaultPrevented && !disabled) onCheckedChange(!checked)
      }}
    >
      <span
        aria-hidden
        className={[
          'pointer-events-none block shrink-0 rounded-full shadow-md ring-1 transition-[margin] duration-200 ease-out',
          'will-change-[margin]',
          s.thumb,
          checked ? 'ms-auto' : '',
          checked
            ? 'bg-[var(--background)] ring-black/15 dark:bg-neutral-950 dark:ring-white/25'
            : 'bg-[var(--background)] ring-black/12 dark:bg-neutral-100 dark:ring-white/15',
        ].join(' ')}
      />
    </button>
  )
}
