# Markdown in the wiki

The wiki stores pages as **Markdown** (`.md`). This editor has a **toolbar** for common syntax and a **live preview** when enabled.

## Headings

Use `#` through `######` at the start of a line. The first heading often doubles as the page title.

```markdown
# Title
## Section
### Subsection
```

## Emphasis and code

- **Bold**: `**text**`
- *Italic*: `*text*`
- Inline `` `code` ``
- Fenced blocks with language tags:

````markdown
```js
const x = 1
```
````

## Links

- External: `[label](https://example.com)`
- Same app (wiki): `[Other page](/wiki/guides/getting-started)`

Paths are **without** `content/wiki` — use URL style under `/wiki/…`.

## Lists and quotes

- Unordered: `-` or `*` at line start
- Ordered: `1.` `2.` …
- Blockquote: lines starting with `>`

**Enter** at the end of a list or quote line continues the block; on an empty item it exits (like a word processor).

## Horizontal rule

A line with `---` on its own creates a divider.

## Embedding another markdown file

Use a fenced block with language `md` or `markdown` to render nested markdown inside a page:

````markdown
```md
# Nested
Some **bold** text.
```
````

## Printing

From the wiki **view** (not edit), use the browser print dialog; print styles hide chrome where supported.

For more, see [Mermaid help](/wiki/guides/help-mermaid) and the [wiki index](/wiki/index).
