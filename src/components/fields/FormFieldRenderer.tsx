import { AutoExpandTextarea } from './AutoExpandTextarea'
import { AtlasLocationInput } from './AtlasLocationInput'
import { FractionInput } from './FractionInput'
import { ImageInput } from './ImageInput'
import { MaskedTextInput, filterTextValue } from './MaskedTextInput'
import { SelectInput } from './SelectInput'
import { TimerInput } from './TimerInput'
import { parseFractionScale } from '../../utils/fraction'
import { parseTimerValue } from '../../utils/timer'
import { formatFieldValue } from '../../utils/formatFieldValue'
import { getStatusOptions } from '../../types'
import type { DataField, FieldConfig } from '../../types'
import type { TimerValue } from '../../types'
import type { DateTimeDisplayKind } from '../../lib/dateTimeConfig'

export function renderFormField(
  f: DataField,
  value: string | number | boolean | string[] | TimerValue,
  onChange: (key: string, val: string | number | boolean | string[] | TimerValue) => void,
  options?: { disabled?: boolean; uploadNamePrefix?: string; compact?: boolean }
) {
  const disabled = options?.disabled ?? false
  const compact = options?.compact ?? false
  const inputClass = compact
    ? `w-full min-w-0 rounded border border-border bg-background px-2 py-1 text-sm text-foreground ${disabled ? 'cursor-not-allowed opacity-70' : ''}`
    : `w-full rounded border border-border bg-background px-3 py-2 text-foreground ${disabled ? 'cursor-not-allowed opacity-70' : ''}`

  if (f.type === 'number') {
    const numVal = value === '' || value == null ? '' : Number(value)
    const displayVal = numVal === '' || !Number.isFinite(numVal) ? '' : numVal
    const decimals = typeof f.config?.decimalPlaces === 'number' && f.config.decimalPlaces >= 0 ? f.config.decimalPlaces : undefined
    const step = decimals != null ? (decimals === 0 ? '1' : String(10 ** -decimals)) : 'any'
    return (
      <input
        type="number"
        value={displayVal}
        step={step}
        min={typeof f.config?.min === 'number' ? f.config.min : undefined}
        max={typeof f.config?.max === 'number' ? f.config.max : undefined}
        onChange={(e) => {
          const raw = e.target.value
          if (raw === '') {
            onChange(f.key, '')
            return
          }
          let n = parseFloat(raw)
          if (!Number.isFinite(n)) {
            onChange(f.key, '')
            return
          }
          if (decimals != null) n = Number(n.toFixed(decimals))
          onChange(f.key, n)
        }}
        className={inputClass}
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
      const filtered = filterTextValue(raw, f.config)
      return maxLen ? filtered.slice(0, maxLen) : filtered
    }
    return (
      <AutoExpandTextarea
        value={String(value ?? '')}
        onChange={(e) => onChange(f.key, filter(e.target.value))}
        minRows={compact ? 2 : 6}
        minLength={minLen}
        maxLength={maxLen}
        className={inputClass}
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
        />
      </div>
    )
  }
  if (f.type === 'fraction') {
    const content = (
      <FractionInput
        value={Number(value) || 0}
        onChange={(v) => onChange(f.key, v)}
        defaultScale={parseFractionScale(f.config?.fractionScale)}
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
    const parsed = raw ? new Date(raw) : null
    const valid = parsed && !Number.isNaN(parsed.getTime())
    const displayKind: DateTimeDisplayKind =
      (f.config as FieldConfig | undefined)?.dateTimeDisplay ?? 'dateTime'

    if (displayKind === 'shortDate' || displayKind === 'longDate') {
      const valueForInput = valid
        ? `${parsed!.getFullYear()}-${String(parsed!.getMonth() + 1).padStart(2, '0')}-${String(parsed!.getDate()).padStart(2, '0')}`
        : ''
      return (
        <input
          type="date"
          value={valueForInput}
          onChange={(e) => {
            const v = e.target.value
            if (!v) {
              onChange(f.key, '')
              return
            }
            const d = new Date(v + 'T00:00:00')
            onChange(f.key, Number.isNaN(d.getTime()) ? '' : d.toISOString())
          }}
          className={inputClass}
          disabled={disabled}
        />
      )
    }
    if (displayKind === 'shortTime' || displayKind === 'longTime') {
      const valueForInput = valid
        ? displayKind === 'longTime'
          ? `${String(parsed!.getHours()).padStart(2, '0')}:${String(parsed!.getMinutes()).padStart(2, '0')}:${String(parsed!.getSeconds()).padStart(2, '0')}`
          : `${String(parsed!.getHours()).padStart(2, '0')}:${String(parsed!.getMinutes()).padStart(2, '0')}`
        : ''
      const setNow = () => {
        const now = new Date()
        const ref = new Date(1970, 0, 1, now.getHours(), now.getMinutes(), now.getSeconds(), 0)
        onChange(f.key, ref.toISOString())
      }
      return (
        <div className="flex min-w-0 items-center gap-2">
          <input
            type="time"
            value={valueForInput}
            step={displayKind === 'longTime' ? 1 : 60}
            onChange={(e) => {
              const v = e.target.value
              if (!v) {
                onChange(f.key, '')
                return
              }
              const [h, m, s] = v.split(':').map(Number)
              const ref = new Date(1970, 0, 1, h ?? 0, m ?? 0, s ?? 0, 0)
              onChange(f.key, ref.toISOString())
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
    const valueForInput = valid
      ? `${parsed!.getFullYear()}-${String(parsed!.getMonth() + 1).padStart(2, '0')}-${String(parsed!.getDate()).padStart(2, '0')}T${String(parsed!.getHours()).padStart(2, '0')}:${String(parsed!.getMinutes()).padStart(2, '0')}`
      : ''
    return (
      <input
        type="datetime-local"
        value={valueForInput}
        onChange={(e) => {
          const v = e.target.value
          if (!v) {
            onChange(f.key, '')
            return
          }
          const d = new Date(v)
          onChange(f.key, Number.isNaN(d.getTime()) ? '' : d.toISOString())
        }}
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
      maxLength={maxLen}
      className={inputClass}
      disabled={disabled}
    />
  )
}
