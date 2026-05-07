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
  dateFormat: 'MM/dd/yyyy',
  timeFormat: 'HH:mm:ss',
  dateTimeFormat: 'MM/dd/yyyy HH:mm:ss',
}

/** Preset configs users can pick from */
export const DATE_TIME_PRESETS: { label: string; value: DateTimeConfig }[] = [
  { label: 'US (MM/dd/yyyy, 24h)', value: { dateFormat: 'MM/dd/yyyy', timeFormat: 'HH:mm:ss', dateTimeFormat: 'MM/dd/yyyy HH:mm:ss' } },
  { label: 'US (MM/dd/yyyy, 12h)', value: { dateFormat: 'MM/dd/yyyy', timeFormat: 'h:mm:ss a', dateTimeFormat: 'MM/dd/yyyy h:mm:ss a' } },
  { label: 'UK (dd/MM/yyyy, 24h)', value: { dateFormat: 'dd/MM/yyyy', timeFormat: 'HH:mm:ss', dateTimeFormat: 'dd/MM/yyyy HH:mm:ss' } },
  { label: 'UK (dd/MM/yyyy, 12h)', value: { dateFormat: 'dd/MM/yyyy', timeFormat: 'h:mm:ss a', dateTimeFormat: 'dd/MM/yyyy h:mm:ss a' } },
  { label: 'ISO (yyyy-MM-dd, 24h)', value: { dateFormat: 'yyyy-MM-dd', timeFormat: 'HH:mm:ss', dateTimeFormat: 'yyyy-MM-dd HH:mm:ss' } },
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

export function formatTimeWithConfig(date: Date | string, config: DateTimeConfig): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return ''
  return dateFnsFormat(d, config.timeFormat)
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

/** Stored ISO (or empty) → `yyyy-MM-dd` for `<input type="date">`. Invalid/unparseable returns `''`. */
export function isoToDateInputValue(iso: string | undefined): string {
  const raw = (iso ?? '').trim()
  if (!raw) return ''
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return ''
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
}

/** `yyyy-MM-dd` from a date picker → ISO string at local midnight (same behavior as datetime form fields). */
export function dateInputValueToIso(yyyyMmDd: string): string {
  const v = yyyyMmDd.trim()
  if (!v) return ''
  const d = new Date(`${v}T00:00:00`)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

/**
 * Like {@link dateInputValueToIso}, but if the picked calendar day is **today** (local),
 * returns `new Date().toISOString()` so choosing "today" in a date-only control includes current time.
 * Other days still store local midnight as ISO.
 */
export function dateInputValueToIsoOrNowIfToday(yyyyMmDd: string): string {
  const v = yyyyMmDd.trim()
  if (!v) return ''
  const picked = new Date(`${v}T00:00:00`)
  if (Number.isNaN(picked.getTime())) return ''
  const now = new Date()
  if (
    picked.getFullYear() === now.getFullYear() &&
    picked.getMonth() === now.getMonth() &&
    picked.getDate() === now.getDate()
  ) {
    return now.toISOString()
  }
  return picked.toISOString()
}

/** ISO (or empty) → `HH:mm` or `HH:mm:ss` for `<input type="time">`. */
export function isoToTimeInputValue(iso: string | undefined, withSeconds: boolean): string {
  const raw = (iso ?? '').trim()
  if (!raw) return ''
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return ''
  if (withSeconds) {
    return `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}:${String(parsed.getSeconds()).padStart(2, '0')}`
  }
  return `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`
}

/**
 * `HH:mm` / `HH:mm:ss` from a time picker → ISO string on 1970-01-01 local (time-only field storage).
 */
export function timeInputValueToIso(timeStr: string, withSeconds: boolean): string {
  const v = timeStr.trim()
  if (!v) return ''
  const parts = v.split(':').map((p) => Number(p))
  const h = Number.isFinite(parts[0]) ? parts[0]! : 0
  const m = Number.isFinite(parts[1]) ? parts[1]! : 0
  const s = withSeconds && parts.length > 2 && Number.isFinite(parts[2]) ? parts[2]! : 0
  const ref = new Date(1970, 0, 1, h, m, s, 0)
  return Number.isNaN(ref.getTime()) ? '' : ref.toISOString()
}

/** ISO → value for `<input type="datetime-local">` (minute precision). */
export function isoToDateTimeLocalValue(iso: string | undefined): string {
  const raw = (iso ?? '').trim()
  if (!raw) return ''
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return ''
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}T${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`
}

export function dateTimeLocalValueToIso(localVal: string): string {
  const v = localVal.trim()
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

/** Labels for the datetime display kind dropdown */
export const DATE_TIME_DISPLAY_OPTIONS: { value: DateTimeDisplayKind; label: string }[] = [
  { value: 'shortDate', label: 'Short date' },
  { value: 'longDate', label: 'Long date' },
  { value: 'dateTime', label: 'Date and time' },
  { value: 'longTime', label: 'Long time' },
  { value: 'shortTime', label: 'Short time' },
]
