import { useUserPreference } from '@/hooks/useUserPreference'
import { WikiMarkdownEditorClassic } from '@/components/wiki/WikiMarkdownEditorClassic'
import { WikiMarkdownEditorMdRt } from '@/components/wiki/WikiMarkdownEditorMdRt'
import {
  WIKI_MD_ENGINE_PREF_KEY,
  type WikiMarkdownEditorLayout,
  type WikiMarkdownEngine,
} from '@/components/wiki/wikiMarkdownEditorTypes'

export type { WikiMarkdownEditorLayout, WikiMarkdownEngine }
export { WIKI_MD_ENGINE_PREF_KEY } from '@/components/wiki/wikiMarkdownEditorTypes'

export function WikiMarkdownEditor({
  value,
  onChange,
  disabled,
  historyResetKey,
  layout = 'page',
  onToolbarSave,
}: {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  historyResetKey?: string
  layout?: WikiMarkdownEditorLayout
  onToolbarSave?: (markdown: string) => void | Promise<void>
}) {
  const [engine] = useUserPreference<WikiMarkdownEngine>(WIKI_MD_ENGINE_PREF_KEY, 'md-editor-rt')

  if (engine === 'classic') {
    return (
      <WikiMarkdownEditorClassic
        value={value}
        onChange={onChange}
        disabled={disabled}
        historyResetKey={historyResetKey}
        layout={layout}
      />
    )
  }

  return (
    <WikiMarkdownEditorMdRt
      value={value}
      onChange={onChange}
      disabled={disabled}
      historyResetKey={historyResetKey}
      layout={layout}
      onToolbarSave={onToolbarSave}
    />
  )
}
