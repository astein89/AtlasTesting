import { useEffect, useRef } from 'react'
import IMask from 'imask'
import type { FieldConfig } from '../../types'

/** Filter value: remove spaces if disallowSpaces, strip any char in unallowedChars */
export function filterTextValue(
  value: string,
  config?: Pick<FieldConfig, 'textDisallowSpaces' | 'textUnallowedChars'>
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
  return out
}

interface MaskedTextInputProps {
  value: string
  onChange: (value: string) => void
  config?: Pick<FieldConfig, 'textDisallowSpaces' | 'textUnallowedChars' | 'textPatternMask'>
  minLength?: number
  maxLength?: number
  className?: string
  disabled?: boolean
  placeholder?: string
}

/**
 * Text input with optional imask pattern and optional filters (disallow spaces, unallowed chars).
 * Use type="text" per imask docs.
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
}: MaskedTextInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const maskRef = useRef<ReturnType<typeof IMask> | null>(null)
  const valueRef = useRef(value)
  valueRef.current = value
  const pattern = config?.textPatternMask?.trim()

  useEffect(() => {
    if (!pattern || !inputRef.current) {
      maskRef.current = null
      return
    }
    const currentValue = valueRef.current
    const filtered = filterTextValue(currentValue, config)
    const limited = maxLength ? filtered.slice(0, maxLength) : filtered
    maskRef.current = IMask(inputRef.current, {
      mask: pattern,
      lazy: false,
    })
    maskRef.current.unmaskedValue = limited
    maskRef.current.on('accept', () => {
      const v = maskRef.current?.unmaskedValue ?? ''
      const filtered2 = filterTextValue(v, config)
      const final = maxLength ? filtered2.slice(0, maxLength) : filtered2
      onChange(final)
    })
    return () => {
      maskRef.current?.destroy()
      maskRef.current = null
    }
  }, [pattern]) // eslint-disable-line react-hooks/exhaustive-deps -- mask option only

  useEffect(() => {
    const mask = maskRef.current
    if (!mask) return
    const filtered = filterTextValue(value, config)
    const limited = maxLength ? filtered.slice(0, maxLength) : filtered
    if (mask.unmaskedValue !== limited) {
      mask.unmaskedValue = limited
    }
  }, [value, config?.textDisallowSpaces, config?.textUnallowedChars, maxLength])

  const handleChange = (raw: string) => {
    const filtered = filterTextValue(raw, config)
    const limited = maxLength ? filtered.slice(0, maxLength) : filtered
    onChange(limited)
  }

  if (pattern) {
    return (
      <input
        ref={inputRef}
        type="text"
        className={className}
        disabled={disabled}
        minLength={minLength}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-invalid={minLength != null && value.length < minLength}
      />
    )
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => handleChange(e.target.value)}
      className={className}
      disabled={disabled}
      minLength={minLength}
      maxLength={maxLength}
      placeholder={placeholder}
      aria-invalid={minLength != null && value.length < minLength}
    />
  )
}
