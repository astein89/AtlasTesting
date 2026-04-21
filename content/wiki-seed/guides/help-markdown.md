# Markdown in the wiki

The wiki stores pages as **Markdown** (`.md`). When you **read** a page, the **preview** while editing, and **Print / PDF** all use the same **md-editor-rt** rendering pipeline, so headings, code, diagrams, and tables match what readers see.

## Editor choice

Under **Admin → Settings**, open **Markdown editor**:

- **Rich editor (md-editor-rt)** (default) — CodeMirror-based editor with a full toolbar. Switch **split** view or **preview-only** from the toolbar. **Save** in the toolbar matches the page save; **Ctrl+S** / **⌘+S** works while the editor is focused. **Print / PDF** opens a print-ready preview, then use your browser to print or save as PDF.
- **Classic** — Textarea with a compact toolbar and a **side preview**; that preview still uses the **same** renderer as published pages.

## While editing (Rich editor)

- Use the toolbar for formatting, **emoji**, and other shortcuts; they insert or wrap Markdown for you.
- Preview is not a separate “approximate” view — it is the same pipeline as the live wiki page.

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

- **Editing** — Use **Print / PDF** on the rich editor toolbar (same preview modal as below).
- **Reading** an article — Use **Print or save as PDF** in the page header for the same flow: a formatted preview, then your browser’s print dialog to print or save as PDF.

For more, see [Mermaid help](/wiki/guides/help-mermaid) and the [wiki index](/wiki/index).
