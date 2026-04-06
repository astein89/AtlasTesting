# Markdown in the wiki

The wiki stores pages as **Markdown** (`.md`). This editor has a **toolbar** for common syntax and a **live preview** when enabled.

## Headings

Use `#` through `######` at the start of a line. The first heading often doubles as the page title.

**Example** (what you type):

```text
# Title
## Section
### Subsection
```

Those lines render as real headings on the page (sizes differ by level).

## Emphasis and code

- **Bold**: `**text**`
- *Italic*: `*text*`
- Inline `` `code` ``
- Fenced blocks with language tags:

**Example:**

````text
```js
const x = 1
```
````

The `js` label enables syntax highlighting in the wiki view (where supported).

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

Fences with language `md` or `markdown` are **rendered as markdown** inside the page (nested content), not shown as plain code. To document the **source** of a nested block without executing it, put that source in a **`text`** fence (or another non-markdown language). Show the **result** in a separate ` ```md ` fence.

**Source** (what you type):

````text
```md
# Nested
Some **bold** text.
```
````

**Rendered:**

```md
# Nested
Some **bold** text.
```

## Printing

From the wiki **view** (not edit), use the browser print dialog; print styles hide chrome where supported.

For more, see [Mermaid help](/wiki/guides/help-mermaid) and the [wiki index](/wiki/index).
