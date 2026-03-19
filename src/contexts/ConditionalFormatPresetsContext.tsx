import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { useUserPreference } from '../hooks/useUserPreference'
import {
  DEFAULT_CF_PRESETS_CONFIG,
  deserializeCfPresets,
  serializeCfPresets,
  type CfPresetsConfig,
} from '../lib/conditionalFormatPresets'

type Ctx = {
  presets: CfPresetsConfig
  setPresets: (v: CfPresetsConfig | ((prev: CfPresetsConfig) => CfPresetsConfig)) => void
  resetPresetsToDefaults: () => void
}

const ConditionalFormatPresetsContext = createContext<Ctx | null>(null)

export function ConditionalFormatPresetsProvider({ children }: { children: ReactNode }) {
  const [presets, setPresets] = useUserPreference<CfPresetsConfig>(
    'cf-conditional-format-presets',
    DEFAULT_CF_PRESETS_CONFIG,
    serializeCfPresets,
    deserializeCfPresets
  )

  const resetPresetsToDefaults = useCallback(() => {
    setPresets({ ...DEFAULT_CF_PRESETS_CONFIG, fill: [...DEFAULT_CF_PRESETS_CONFIG.fill], text: [...DEFAULT_CF_PRESETS_CONFIG.text] })
  }, [setPresets])

  const value = useMemo(
    () => ({
      presets,
      setPresets,
      resetPresetsToDefaults,
    }),
    [presets, setPresets, resetPresetsToDefaults]
  )

  return (
    <ConditionalFormatPresetsContext.Provider value={value}>
      {children}
    </ConditionalFormatPresetsContext.Provider>
  )
}

export function useConditionalFormatPresets(): Ctx {
  const ctx = useContext(ConditionalFormatPresetsContext)
  if (!ctx) {
    throw new Error('useConditionalFormatPresets must be used within ConditionalFormatPresetsProvider')
  }
  return ctx
}
