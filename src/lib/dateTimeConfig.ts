import { format as dateFnsFormat } from 'date-fns'

/** User-configurable date/time format strings (date-fns format tokens) */
export interface DateTimeConfig {
  /** Date-only display (e.g. plan run range) */
  dateFormat: string
  /** Time-only display */
  timeFormat: string
  /** Date and time (e.g. recordedAt) */
  dateTimeFormat: string
}

export const DEFAULT_DATE_TIME_CONFIG: DateTimeConfig = {
  dateFormat: 'MMM d, yyyy',
  timeFormat: 'HH:mm',
  dateTimeFormat: 'MM/dd/yyyy HH:mm',
}

/** Preset configs users can pick from */
export const DATE_TIME_PRESETS: { label: string; value: DateTimeConfig }[] = [
  { label: 'US (MM/dd/yyyy, 24h)', value: { dateFormat: 'MMM d, yyyy', timeFormat: 'HH:mm', dateTimeFormat: 'MM/dd/yyyy HH:mm' } },
  { label: 'US (MM/dd/yyyy, 12h)', value: { dateFormat: 'MMM d, yyyy', timeFormat: 'h:mm a', dateTimeFormat: 'MM/dd/yyyy h:mm a' } },
  { label: 'UK (dd/MM/yyyy, 24h)', value: { dateFormat: 'd MMM yyyy', timeFormat: 'HH:mm', dateTimeFormat: 'dd/MM/yyyy HH:mm' } },
  { label: 'UK (dd/MM/yyyy, 12h)', value: { dateFormat: 'd MMM yyyy', timeFormat: 'h:mm a', dateTimeFormat: 'dd/MM/yyyy h:mm a' } },
  { label: 'ISO (yyyy-MM-dd, 24h)', value: { dateFormat: 'yyyy-MM-dd', timeFormat: 'HH:mm', dateTimeFormat: 'yyyy-MM-dd HH:mm' } },
]

let currentConfig: DateTimeConfig = { ...DEFAULT_DATE_TIME_CONFIG }

export function getDateTimeConfig(): DateTimeConfig {
  return currentConfig
}

export function setDateTimeConfig(config: DateTimeConfig): void {
  currentConfig = { ...config }
}

/**
 * Format a Date or ISO string for date-only display using current config.
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return ''
  return dateFnsFormat(d, getDateTimeConfig().dateFormat)
}

/**
 * Format a Date or ISO string for time-only display using current config.
 */
export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return ''
  return dateFnsFormat(d, getDateTimeConfig().timeFormat)
}

/**
 * Format a Date or ISO string for date+time display using current config.
 */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return ''
  return dateFnsFormat(d, getDateTimeConfig().dateTimeFormat)
}

/**
 * Format using a specific config (e.g. when config not yet synced to global).
 */
export function formatDateTimeWithConfig(date: Date | string, config: DateTimeConfig): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return ''
  return dateFnsFormat(d, config.dateTimeFormat)
}

export function formatDateWithConfig(date: Date | string, config: DateTimeConfig): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return ''
  return dateFnsFormat(d, config.dateFormat)
}

/** Display kind for a datetime field: what part of the value to show */
export type DateTimeDisplayKind = 'shortDate' | 'longDate' | 'dateTime' | 'longTime' | 'shortTime'

/** date-fns format string for each display kind. dateTime uses app config. */
export function getFormatForDateTimeDisplay(kind: DateTimeDisplayKind): string {
  switch (kind) {
    case 'shortDate':
      return 'M/d/yyyy'
    case 'longDate':
      return 'MMMM d, yyyy'
    case 'dateTime':
      return getDateTimeConfig().dateTimeFormat
    case 'longTime':
      return 'h:mm:ss a'
    case 'shortTime':
      return 'h:mm a'
    default:
      return getDateTimeConfig().dateTimeFormat
  }
}

/** Sample date used for examples (March 15, 2025, 2:30:45 PM) */
const EXAMPLE_DATE = new Date('2025-03-15T14:30:45')

/** Example formatted string for a display kind (for dropdown labels) */
export function getExampleForDateTimeDisplay(kind: DateTimeDisplayKind): string {
  const formatStr = getFormatForDateTimeDisplay(kind)
  return dateFnsFormat(EXAMPLE_DATE, formatStr)
}

/** Labels for the datetime display kind dropdown */
export const DATE_TIME_DISPLAY_OPTIONS: { value: DateTimeDisplayKind; label: string }[] = [
  { value: 'shortDate', label: 'Short date' },
  { value: 'longDate', label: 'Long date' },
  { value: 'dateTime', label: 'Date and time' },
  { value: 'longTime', label: 'Long time' },
  { value: 'shortTime', label: 'Short time' },
]
