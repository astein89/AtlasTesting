import { AppMarkdown } from '@/components/markdown/AppMarkdown'

interface HomeIntroMarkdownProps {
  content: string
}

export function HomeIntroMarkdown({ content }: HomeIntroMarkdownProps) {
  if (!content.trim()) return null

  return <AppMarkdown content={content} />
}
