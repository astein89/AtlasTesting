import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'

const markdownShell =
  'max-w-none text-sm leading-relaxed text-foreground [&_p]:mb-3 [&_p:last-child]:mb-0 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mb-1.5 [&_h3]:text-lg [&_h3]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-background [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em] [&_pre]:mb-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border [&_pre]:bg-background [&_pre]:p-3 [&_pre]:text-xs [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-foreground/80 [&_hr]:my-4 [&_hr]:border-border'

interface HomeIntroMarkdownProps {
  content: string
}

export function HomeIntroMarkdown({ content }: HomeIntroMarkdownProps) {
  if (!content.trim()) return null

  return (
    <div className={markdownShell}>
      <ReactMarkdown
        components={{
          a({ href, children, ...props }) {
            const h = href ?? ''
            if (h.startsWith('/') && !h.startsWith('//')) {
              return (
                <Link to={h} {...props}>
                  {children}
                </Link>
              )
            }
            return (
              <a href={h} target="_blank" rel="noopener noreferrer" {...props}>
                {children}
              </a>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
