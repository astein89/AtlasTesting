import { useState, useRef, useEffect } from 'react'
import type { FieldConfig } from '../../types'

const INVALID_CHAR_WARNING_MS = 2500

/** Filter value: remove spaces if disallowSpaces, strip any char in unallowedChars */
export function filterTextValue(
  value: string,
  config?: Pick<FieldConfig, 'textDisallowSpaces' | 'textUnallowedChars' | 'textCase'>
): string {
  let out = value
  if (config?.textDisallowSpaces) {
    out = out.replace(/\s/g, '')
  }
  const unallowed = config?.textUnallowedChars
  if (unallowed && unallowed.length > 0) {
    const set = new Set(unallowed)
    out = out.split('').filter((c) => !set.has(c)).join('')
  }
  if (config?.textCase === 'upper') {
    out = out.toUpperCase()
  } else if (config?.textCase === 'lower') {
    out = out.toLowerCase()
  }
  return out
}

interface MaskedTextInputProps {
  value: string
  onChange: (value: string) => void
  config?: Pick<FieldConfig, 'textDisallowSpaces' | 'textUnallowedChars' | 'textPatternMask' | 'textCase'>
  minLength?: number
  maxLength?: number
  className?: string
  disabled?: boolean
  placeholder?: string
  overrideValidation?: boolean
}

/**
 * Text input with optional pattern hint and filters (disallow spaces, unallowed chars).
 * Exact length / mask enforcement is handled via minLength/maxLength + field validation.
 */
export function MaskedTextInput({
  value,
  onChange,
  config,
  minLength,
  maxLength,
  className,
  disabled,
  placeholder,
  overrideValidation = false,
}: MaskedTextInputProps) {
  const pattern = config?.textPatternMask?.trim()
  const effectivePlaceholder = placeholder || pattern || undefined
  const [invalidCharWarning, setInvalidCharWarning] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
  }, [])

  const handleChange = (raw: string) => {
    // First apply generic filters (no spaces / unallowed chars / case), unless override is on.
    const base = filterTextValue(raw, overrideValidation ? { textCase: config?.textCase } : config)

    // When override is on, skip pattern and length limits so user can enter anything.
    if (overrideValidation) {
      onChange(base)
      return
    }

    // If we have a pattern, treat anything that is not a-z / A-Z / 0-9 as separators,
    // and map only alphanumerics into the pattern slots (@, #, *) in order.
    let nextValue = base
    if (pattern) {
      const maskChars = pattern.split('')
      const slotsOnly = base.replace(/[^A-Za-z0-9]/g, '')
      const out: string[] = []
      let slotIndex = 0

      const takeNextMatching = (predicate: (ch: string) => boolean): string | null => {
        while (slotIndex < slotsOnly.length) {
          const ch = slotsOnly[slotIndex++]
          if (predicate(ch)) return ch
        }
        return null
      }

      for (const m of maskChars) {
        if (m === '@' || m === 'a') {
          const ch = takeNextMatching((c) => /[A-Za-z]/.test(c))
          if (ch == null) break
          out.push(ch)
        } else if (m === '#' || m === '0') {
          const ch = takeNextMatching((c) => /[0-9]/.test(c))
          if (ch == null) break
          out.push(ch)
        } else if (m === '*') {
          const ch = takeNextMatching((c) => /[A-Za-z0-9]/.test(c))
          if (ch == null) break
          out.push(ch)
        } else {
          // Literal from the pattern becomes part of the value.
          out.push(m)
        }
      }

      nextValue = out.join('')
    }

    const limited = maxLength ? nextValue.slice(0, maxLength) : nextValue
    // Only warn when we actually removed a character (not when we only changed case).
    const filterRejected = base.length < raw.length
    const slotCharsRaw = base.replace(/[^A-Za-z0-9]/g, '').length
    const slotCharsLimited = limited.replace(/[^A-Za-z0-9]/g, '').length
    // Pattern rejected = we dropped a char that didn't match slot type (not just maxLength truncation).
    const patternRejected =
      !!pattern && limited === nextValue && slotCharsRaw > slotCharsLimited
    if (filterRejected || patternRejected) {
      setInvalidCharWarning(true)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => {
        setInvalidCharWarning(false)
        timeoutRef.current = null
      }, INVALID_CHAR_WARNING_MS)
    }
    onChange(limited)
  }

  let remaining: number | undefined
  if (typeof minLength === 'number' && minLength > 0) {
    if (pattern) {
      const slotCount = pattern
        .split('')
        .filter((ch) => ch === '@' || ch === '#' || ch === '*' || ch === '0' || ch === 'a').length
      const slotChars = value.replace(/[^A-Za-z0-9]/g, '')
      const filled = Math.min(slotChars.length, slotCount)
      remaining = Math.max(0, minLength - filled)
    } else {
      remaining = Math.max(0, minLength - value.length)
    }
  }

  return (
    <div className="flex flex-col">
      <input
        type="text"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        className={className}
        disabled={disabled}
        minLength={minLength}
        maxLength={pattern ? undefined : maxLength}
        placeholder={effectivePlaceholder}
        aria-invalid={minLength != null && value.length < minLength}
      />
      {remaining !== undefined && remaining > 0 && (
        <span className="mt-1 text-xs text-foreground/60">
          {remaining} character{remaining === 1 ? '' : 's'} remaining
        </span>
      )}
      {invalidCharWarning && (
        <span className="mt-1 text-xs text-red-500">Invalid character; only allowed characters are accepted.</span>
      )}
    </div>
  )
}
