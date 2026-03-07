import { useEffect } from 'react'
import { useUserPreference } from './useUserPreference'
import {
  type DateTimeConfig,
  DEFAULT_DATE_TIME_CONFIG,
  setDateTimeConfig,
} from '../lib/dateTimeConfig'

const PREF_KEY = 'atlas-date-time-config'

function serialize(c: DateTimeConfig): string {
  return JSON.stringify(c)
}

function deserialize(s: string): DateTimeConfig {
  const parsed = JSON.parse(s) as unknown
  if (parsed && typeof parsed === 'object' && 'dateFormat' in parsed && 'timeFormat' in parsed && 'dateTimeFormat' in parsed) {
    return {
      dateFormat: String((parsed as DateTimeConfig).dateFormat),
      timeFormat: String((parsed as DateTimeConfig).timeFormat),
      dateTimeFormat: String((parsed as DateTimeConfig).dateTimeFormat),
    }
  }
  return DEFAULT_DATE_TIME_CONFIG
}

export function useDateTimeConfig(): [DateTimeConfig, (c: DateTimeConfig | ((prev: DateTimeConfig) => DateTimeConfig)) => void] {
  const [config, setConfig] = useUserPreference<DateTimeConfig>(
    PREF_KEY,
    DEFAULT_DATE_TIME_CONFIG,
    serialize,
    deserialize
  )

  useEffect(() => {
    setDateTimeConfig(config)
  }, [config])

  return [config, setConfig]
}
