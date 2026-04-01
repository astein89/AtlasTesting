import { createContext } from 'react'

/** Register a nested overlay (e.g. Atlas location picker) so browser Back dismisses it before the parent modal. */
export type RegisterAtlasPickerHistory = (onClose: () => void) => () => void

export const ModalNestedHistoryContext = createContext<RegisterAtlasPickerHistory | null>(null)
