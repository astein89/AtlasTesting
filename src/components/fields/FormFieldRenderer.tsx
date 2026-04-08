import { useState, useRef, useEffect } from 'react'
import { AutoExpandTextarea } from './AutoExpandTextarea'
import { AtlasLocationInput } from './AtlasLocationInput'
import { FractionInput } from './FractionInput'
import { WeightInput } from './WeightInput'
import { ImageInput } from './ImageInput'
import { MaskedTextInput, filterTextValue } from './MaskedTextInput'
import { SelectInput } from './SelectInput'
import { RadioInput } from './RadioInput'
import { CheckboxGroupInput } from './CheckboxGroupInput'
import { TimerInput } from './TimerInput'
import { parseFractionScale } from '../../utils/fraction'
import { parseTimerValue } from '../../utils/timer'
import { formatFieldValue } from '../../utils/formatFieldValue'
import { getStatusOptions } from '../../types'
import type { DataField, FieldConfig } from '../../types'
import type { TimerValue } from '../../types'
import {
  dateInputValueToIsoOrNowIfToday,
  dateTimeLocalValueToIso,
  isoToDateInputValue,
  isoToDateTimeLocalValue,
  isoToTimeInputValue,
  timeInputValueToIso,
  type DateTimeDisplayKind,
} from '../../lib/dateTimeConfig'

const INVALID_CHAR_WARNING_MS = 2500

/** Format a number for input display without scientific notation (e.g. 1e+22 → full digits). */
function formatNumberForDisplay(n: number, decimals: number | undefined): string {
  if (!Number.isFinite(n)) return ''
  const str = n.toString()
  if (!str.includes('e') && !str.includes('E')) {
    return str
  }
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  const [mantissa, expStr] = str.replace('-', '').split(/[eE]/)
  const exp = parseInt(expStr, 10)
  const [intPart, decPart = ''] = mantissa.split('.')
  const digits = intPart + decPart
  const decimalOffset = decPart.length
  const newExp = exp - decimalOffset
  if (newExp >= 0) {
    return sign + digits + '0'.repeat(newExp)
  }
  const pos = digits.length + newExp
  if (pos <= 0) {
    return sign + '0.' + '0'.repeat(-pos) + digits
  }
  const whole = digits.slice(0, pos)
  const frac = digits.slice(pos)
  const rounded = decimals != null ? frac.slice(0, decimals) : frac
  return sign + whole + (rounded ? '.' + rounded : '')
}

function filterNumericInput(raw: string): string {
  let out = raw.replace(/[^0-9.-]/g, '')
  const minusCount = (out.match(/-/g) || []).length
  if (minusCount > 0) {
    if (!out.startsWith('-')) out = out.replace(/-/g, '')
    else if (minusCount > 1) out = '-' + out.slice(1).replace(/-/g, '')
  }
  const dotIndex = out.indexOf('.')
  if (dotIndex >= 0 && out.indexOf('.', dotIndex + 1) >= 0) {
    out = out.slice(0, dotIndex + 1) + out.slice(dotIndex + 1).replace(/\./g, '')
  }
  return out
}

function NumberFieldInput({
  fieldKey,
  value,
  onChange,
  decimals,
  enforceDecimals,
  min,
  max,
  inputClass,
  disabled,
}: {
  fieldKey: string
  value: string | number
  onChange: (key: string, val: string | number) => void
  decimals: number | undefined
  /** When true with decimals, round stored value to decimals on every change */
  enforceDecimals: boolean
  min: number | undefined
  max: number | undefined
  inputClass: string
  disabled: boolean
}) {
  const [invalidCharWarning, setInvalidCharWarning] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
  }, [])

  const numVal = value === '' || value == null ? '' : Number(value)
  const displayVal =
    numVal === '' || !Number.isFinite(numVal)
      ? ''
      : formatNumberForDisplay(
          numVal as number,
          enforceDecimals && decimals != null ? decimals : undefined
        )

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    const filtered = filterNumericInput(raw)
    if (raw !== filtered) {
      setInvalidCharWarning(true)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => {
        setInvalidCharWarning(false)
        timeoutRef.current = null
      }, INVALID_CHAR_WARNING_MS)
    }
    if (filtered === '' || filtered === '-') {
      onChange(fieldKey, '')
      return
    }
    let n = parseFloat(filtered)
    if (!Number.isFinite(n)) {
      onChange(fieldKey, '')
      return
    }
    if (min != null && n < min) n = min
    if (max != null && n > max) n = max
    if (enforceDecimals && decimals != null && decimals >= 0) {
      n = Number(n.toFixed(decimals))
    }
    onChange(fieldKey, n)
  }

  return (
    <div className="flex flex-col">
      <input
        type="text"
        inputMode="decimal"
        value={displayVal}
        onChange={handleChange}
        className={inputClass}
        disabled={disabled}
        aria-valuemin={min}
        aria-valuemax={max}
      />
      {invalidCharWarning && (
        <span className="mt-1 text-xs text-red-500">Only numbers, decimal point, and minus are allowed.</span>
      )}
    </div>
  )
}

function LongTextFieldInput({
  fieldKey,
  value,
  onChange,
  filter,
  minRows,
  minLength,
  maxLength,
  inputClass,
  disabled,
}: {
  fieldKey: string
  value: string
  onChange: (key: string, val: string) => void
  filter: (raw: string) => string
  minRows: number
  minLength: number | undefined
  maxLength: number | undefined
  inputClass: string
  disabled: boolean
}) {
  const [invalidCharWarning, setInvalidCharWarning] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
  }, [])

  return (
    <div className="flex flex-col">
      <AutoExpandTextarea
        value={value}
        onChange={(e) => {
          const raw = e.target.value
          const filtered = filter(raw)
          if (raw !== filtered) {
            setInvalidCharWarning(true)
            if (timeoutRef.current) clearTimeout(timeoutRef.current)
            timeoutRef.current = setTimeout(() => {
              setInvalidCharWarning(false)
              timeoutRef.current = null
            }, INVALID_CHAR_WARNING_MS)
          }
          onChange(fieldKey, filtered)
        }}
        minRows={minRows}
        minLength={minLength}
        maxLength={maxLength}
        className={inputClass}
        disabled={disabled}
      />
      {invalidCharWarning && (
        <span className="mt-1 text-xs text-red-500">Invalid character; only allowed characters are accepted.</span>
      )}
    </div>
  )
}

export function renderFormField(
  f: DataField,
  value: string | number | boolean | string[] | TimerValue,
  onChange: (key: string, val: string | number | boolean | string[] | TimerValue) => void,
  options?: {
    disabled?: boolean
    uploadNamePrefix?: string
    compact?: boolean
    overrideValidation?: boolean
    /** Atlas Location: inline Clear beside control (Edit record modal only; not inside picker). */
    showAtlasLocationClear?: boolean
  }
) {
  const disabled = options?.disabled ?? false
  const compact = options?.compact ?? false
  const overrideValidation = options?.overrideValidation ?? false
  const showAtlasLocationClear = options?.showAtlasLocationClear ?? false
  const inputClass = compact
    ? `w-full min-w-0 rounded border border-border bg-background px-2 py-1 text-sm text-foreground ${disabled ? 'cursor-not-allowed opacity-70' : ''}`
    : `w-full rounded border border-border bg-background px-3 py-2 text-foreground ${disabled ? 'cursor-not-allowed opacity-70' : ''}`

  if (f.type === 'number') {
    const decimals =
      typeof f.config?.decimalPlaces === 'number' && f.config.decimalPlaces >= 0
        ? f.config.decimalPlaces
        : undefined
    const enforceDecimals = f.config?.decimalPlacesMode === 'enforce' && decimals != null
    const min = typeof f.config?.min === 'number' ? f.config.min : undefined
    const max = typeof f.config?.max === 'number' ? f.config.max : undefined
    return (
      <NumberFieldInput
        fieldKey={f.key}
        value={value as string | number}
        onChange={onChange as (key: string, val: string | number) => void}
        decimals={decimals}
        enforceDecimals={enforceDecimals}
        min={min}
        max={max}
        inputClass={inputClass}
        disabled={disabled}
      />
    )
  }
  if (f.type === 'boolean') {
    return (
      <input
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(f.key, e.target.checked)}
        className="h-4 w-4"
        disabled={disabled}
      />
    )
  }
  if (f.type === 'longtext') {
    const minLen = typeof f.config?.minLength === 'number' && f.config.minLength >= 0 ? f.config.minLength : undefined
    const maxLen = typeof f.config?.maxLength === 'number' && f.config.maxLength > 0 ? f.config.maxLength : undefined
    const filter = (raw: string) => {
      if (overrideValidation) return raw
      const filtered = filterTextValue(raw, f.config)
      return maxLen ? filtered.slice(0, maxLen) : filtered
    }
    return (
      <LongTextFieldInput
        fieldKey={f.key}
        value={String(value ?? '')}
        onChange={onChange as (key: string, val: string) => void}
        filter={filter}
        minRows={compact ? 2 : 6}
        minLength={minLen}
        maxLength={maxLen}
        inputClass={inputClass}
        disabled={disabled}
      />
    )
  }
  if (f.type === 'atlas_location') {
    return (
      <div className={disabled ? 'pointer-events-none opacity-70' : ''}>
        <AtlasLocationInput
          value={String(value ?? '')}
          onChange={(v) => onChange(f.key, v)}
          className="w-full"
          showClear={showAtlasLocationClear}
        />
      </div>
    )
  }
  if (f.type === 'fraction') {
    const entryUnit = f.config?.entryUnit === 'mm' ? 'mm' : f.config?.entryUnit === 'in' ? 'in' : undefined
    const content = (
      <FractionInput
        value={Number(value) || 0}
        onChange={(v) => onChange(f.key, v)}
        defaultScale={parseFractionScale(f.config?.fractionScale)}
        storageUnit={f.config?.unit === 'mm' ? 'mm' : 'in'}
        entryUnit={entryUnit}
        className="w-full"
      />
    )
    return disabled ? <div className="pointer-events-none opacity-70">{content}</div> : content
  }
  if (f.type === 'weight') {
    const unit = typeof f.config?.unit === 'string' ? f.config.unit : 'lb'
    const storageUnit: 'kg' | 'g' | 'lb' | 'oz' =
      unit === 'kg' || unit === 'g' || unit === 'lb' || unit === 'oz' ? unit : 'lb'
    const entryUnit =
      f.config?.entryUnit === 'kg' || f.config?.entryUnit === 'g' || f.config?.entryUnit === 'lb' || f.config?.entryUnit === 'oz'
        ? f.config.entryUnit
        : undefined
    const content = (
      <WeightInput
        value={Number(value) || 0}
        onChange={(v) => onChange(f.key, v)}
        storageUnit={storageUnit}
        entryUnit={entryUnit}
        className="w-full"
      />
    )
    return disabled ? <div className="pointer-events-none opacity-70">{content}</div> : content
  }
  if (f.type === 'image') {
    return (
      <div className={disabled ? 'pointer-events-none opacity-70' : ''}>
        <ImageInput
          value={(value as string | string[]) ?? (f.config?.imageMultiple ? [] : '')}
          onChange={(v) => onChange(f.key, v)}
          multiple={f.config?.imageMultiple ?? false}
          tag={f.config?.imageTag}
          uploadNamePrefix={options?.uploadNamePrefix}
          className="w-full"
        />
      </div>
    )
  }
  if (f.type === 'select') {
    const content = (
      <SelectInput
        value={String(value ?? '')}
        onChange={(v) => onChange(f.key, v)}
        options={f.config?.options || []}
        className="w-full"
      />
    )
    return disabled ? <div className="pointer-events-none opacity-70">{content}</div> : content
  }
  if (f.type === 'radio_select') {
    const layout = f.config?.radioLayout
    const content = (
      <RadioInput
        value={String(value ?? '')}
        onChange={(v) => onChange(f.key, v)}
        options={f.config?.options || []}
        className="w-full"
        name={f.key}
        layout={layout ?? 'auto'}
      />
    )
    return disabled ? <div className="pointer-events-none opacity-70">{content}</div> : content
  }
  if (f.type === 'checkbox_select') {
    const arr = Array.isArray(value) ? (value as string[]).map(String) : value ? [String(value)] : []
    const layout = f.config?.checkboxLayout
    const content = (
      <CheckboxGroupInput
        value={arr}
        onChange={(v) => onChange(f.key, v)}
        options={f.config?.options || []}
        className="w-full"
        name={f.key}
        layout={layout ?? 'auto'}
      />
    )
    return disabled ? <div className="pointer-events-none opacity-70">{content}</div> : content
  }
  if (f.type === 'status') {
    const statusVal = String(value ?? '')
    if (f.config?.formula) {
      const color = f.config?.statusColors?.[statusVal]
      return (
        <input
          type="text"
          value={statusVal || '—'}
          readOnly
          className={`${inputClass} cursor-default`}
          disabled
          style={color ? { borderLeftColor: color, borderLeftWidth: '3px' } : undefined}
        />
      )
    }
    const content = (
      <SelectInput
        value={statusVal}
        onChange={(v) => onChange(f.key, v)}
        options={getStatusOptions(f)}
        className="w-full"
        valueColor={f.config?.statusColors?.[statusVal]}
        optionColors={f.config?.statusColors}
      />
    )
    return disabled ? <div className="pointer-events-none opacity-70">{content}</div> : content
  }
  if (f.type === 'timer') {
    const timerVal = parseTimerValue(value)
    const content = (
      <TimerInput
        value={timerVal}
        onChange={(v) => onChange(f.key, v)}
        disabled={disabled}
        className="w-full"
      />
    )
    return disabled ? <div className="pointer-events-none opacity-70">{content}</div> : content
  }
  if (f.type === 'formula') {
    const display = formatFieldValue(f, value)
    return (
      <input
        type="text"
        value={display}
        readOnly
        className={`${inputClass} cursor-default`}
        disabled
      />
    )
  }
  if (f.type === 'datetime') {
    const raw = value == null || value === '' ? '' : String(value)
    const displayKind: DateTimeDisplayKind =
      (f.config as FieldConfig | undefined)?.dateTimeDisplay ?? 'dateTime'

    if (displayKind === 'shortDate' || displayKind === 'longDate') {
      return (
        <input
          type="date"
          value={isoToDateInputValue(raw)}
          onChange={(e) => onChange(f.key, dateInputValueToIsoOrNowIfToday(e.target.value))}
          className={inputClass}
          disabled={disabled}
        />
      )
    }
    if (displayKind === 'shortTime' || displayKind === 'longTime') {
      const withSeconds = displayKind === 'longTime'
      const setNow = () => {
        const now = new Date()
        const ref = new Date(1970, 0, 1, now.getHours(), now.getMinutes(), now.getSeconds(), 0)
        onChange(f.key, ref.toISOString())
      }
      return (
        <div className="flex min-w-0 items-center gap-2">
          <input
            type="time"
            value={isoToTimeInputValue(raw, withSeconds)}
            step={withSeconds ? 1 : 60}
            onChange={(e) => {
              const v = e.target.value
              if (!v) {
                onChange(f.key, '')
                return
              }
              onChange(f.key, timeInputValueToIso(v, withSeconds))
            }}
            className={inputClass}
            disabled={disabled}
          />
          <button
            type="button"
            onClick={setNow}
            disabled={disabled}
            className="shrink-0 rounded border border-border px-2 py-1.5 text-sm text-foreground hover:bg-background disabled:opacity-50"
          >
            Now
          </button>
        </div>
      )
    }
    return (
      <input
        type="datetime-local"
        value={isoToDateTimeLocalValue(raw)}
        onChange={(e) => onChange(f.key, dateTimeLocalValueToIso(e.target.value))}
        className={inputClass}
        disabled={disabled}
      />
    )
  }
  const minLen = typeof f.config?.minLength === 'number' && f.config.minLength >= 0 ? f.config.minLength : undefined
  const maxLen = typeof f.config?.maxLength === 'number' && f.config.maxLength > 0 ? f.config.maxLength : undefined
  return (
    <MaskedTextInput
      value={String(value ?? '')}
      onChange={(v) => onChange(f.key, v)}
      config={f.config}
      minLength={minLen}
      maxLength={overrideValidation ? undefined : maxLen}
      className={inputClass}
      overrideValidation={overrideValidation}
      disabled={disabled}
    />
  )
}
