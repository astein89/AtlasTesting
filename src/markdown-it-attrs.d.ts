declare module 'markdown-it-attrs' {
  export interface MarkdownItAttrsOptions {
    leftDelimiter?: string
    rightDelimiter?: string
    /** Empty = allow all (unsafe); prefer a whitelist. */
    allowedAttributes?: (string | RegExp)[]
  }
  function markdownItAttrs(md: unknown, options?: MarkdownItAttrsOptions): void
  export default markdownItAttrs
}
