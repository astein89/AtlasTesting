import { format as dateFnsFormat } from 'date-fns'
import { getDateTimeConfig, getFormatForDateTimeDisplay } from '../lib/dateTimeConfig'
import { formatDecimalAsFraction, formatDecimalAsFractionWithScale, parseFractionScale } from './fraction'
import { getElapsedMs, formatTimerMs, parseTimerValue } from './timer'
import type { DataField, FieldConfig, TimerValue } from '../types'

/** Excel-style number formatting for number/formula fields */
function formatNumberWithOptions(
  value: number,
  config?: FieldConfig
): string {
  if (!Number.isFinite(value)) return '—'
  const kind = config?.numberFormat ?? 'number'
  const decimals =
    typeof config?.decimalPlaces === 'number' && config.decimalPlaces >= 0
      ? config.decimalPlaces
      : undefined
  const thousands = config?.thousandsSeparator === true
  const negativeStyle = config?.negativeStyle ?? 'minus'
  const currencySymbol = (config?.currencySymbol ?? '').trim() || (kind === 'currency' ? '$' : '')

  let n = value
  if (kind === 'percent') n = n * 100

  const useFixedDecimals = decimals != null || kind === 'percent' || kind === 'currency'
  const dec = decimals != null ? decimals : (kind === 'percent' ? 0 : kind === 'currency' ? 2 : 0)
  const displayNum = useFixedDecimals ? Number(n.toFixed(dec)) : n
  const absVal = Math.abs(displayNum)
  const rawStr = absVal.toString()
  const [intPart, fracPart] = rawStr.split('.')
  const frac = fracPart != null ? fracPart : ''

  let intStr = intPart
  if (thousands) {
    intStr = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  }
  const numStr = frac ? `${intStr}.${frac}` : intStr

  const isNeg = value < 0
  let out: string
  if (isNeg) {
    out = negativeStyle === 'parentheses' ? `(${numStr})` : `-${numStr}`
  } else {
    out = numStr
  }

  if (kind === 'percent') return `${out}%`
  if (kind === 'currency' && currencySymbol) return `${currencySymbol}${out}`
  return out
}

/**
 * Format a raw field value for display, using the field's type and config.
 * Use for table cells, cards, read-only displays, and formula results.
 */
export function formatFieldValue(
  field: DataField,
  value: unknown
): string {
  if (value === undefined || value === null || value === '') {
    return '—'
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }
  if (typeof value === 'number') {
    if (field.type === 'fraction') {
      return Number.isFinite(value) ? formatDecimalAsFraction(value) : '—'
    }
    if (field.type === 'formula' && field.config?.fractionScale != null) {
      const scale = parseFractionScale(field.config.fractionScale)
      return formatDecimalAsFractionWithScale(value, scale)
    }
    if (field.type === 'number' || field.type === 'formula') {
      return formatNumberWithOptions(value, field.config)
    }
    return Number.isFinite(value) ? String(value) : '—'
  }
  if (field.type === 'datetime') {
    const raw = String(value)
    const d = raw ? new Date(raw) : null
    if (d && !Number.isNaN(d.getTime())) {
      const config = field.config as FieldConfig | undefined
      const formatStr = config?.dateTimeDisplay
        ? getFormatForDateTimeDisplay(config.dateTimeDisplay)
        : (config?.dateTimeFormat ?? getDateTimeConfig().dateTimeFormat)
      return dateFnsFormat(d, formatStr)
    }
    return raw || '—'
  }
  if (field.type === 'timer') {
    const t = parseTimerValue(value)
    if (t.startedAt) return 'Running'
    return formatTimerMs(getElapsedMs(t))
  }
  if (field.type === 'image') {
    const arr = Array.isArray(value) ? value : value ? [value] : []
    const tag = field.config?.imageTag ? ` · ${field.config.imageTag}` : ''
    return arr.length ? `${arr.length} photo(s)${tag}` : '—'
  }
  if (Array.isArray(value)) {
    return value.map(String).join(', ')
  }
  if (typeof value === 'object' && value !== null && 'totalElapsedMs' in value) {
    const t = value as TimerValue
    return formatTimerMs(getElapsedMs(t))
  }
  return String(value)
}
