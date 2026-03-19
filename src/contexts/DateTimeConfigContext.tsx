import { createContext, useContext } from 'react'
import { useDateTimeConfig } from '../hooks/useDateTimeConfig'
import { setDateTimeConfig } from '../lib/dateTimeConfig'
import type { DateTimeConfig } from '../lib/dateTimeConfig'

type DateTimeConfigContextValue = [DateTimeConfig, (c: DateTimeConfig | ((prev: DateTimeConfig) => DateTimeConfig)) => void]

const DateTimeConfigContext = createContext<DateTimeConfigContextValue | null>(null)

export function useDateTimeConfigContext(): DateTimeConfigContextValue {
  const value = useContext(DateTimeConfigContext)
  if (!value) throw new Error('useDateTimeConfigContext must be used within DateTimeConfigProvider')
  return value
}

export function DateTimeConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useDateTimeConfig()
  // Keep global in sync so formatDate/formatDateTime (used across the app) see the latest config.
  // Doing this during render ensures children get the correct config when they call getDateTimeConfig().
  setDateTimeConfig(config)
  return (
    <DateTimeConfigContext.Provider value={[config, setConfig]}>
      {children}
    </DateTimeConfigContext.Provider>
  )
}
