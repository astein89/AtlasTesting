import { create } from 'zustand'

/** Lets the navbar open the home page editor while state/modal live in HomePage. */
export const useHomePageEditStore = create<{
  editorOpen: boolean
  setEditorOpen: (open: boolean) => void
}>((set) => ({
  editorOpen: false,
  setEditorOpen: (open) => set({ editorOpen: open }),
}))
