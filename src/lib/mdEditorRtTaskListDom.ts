/**
 * md-editor-rt task-list clicks use `checkbox.parentElement.dataset.line` (see hooks Ye).
 * `data-line` from markdown-it often sits on `<li>` while the checkbox lives under `<p>`,
 * so the handler bails after preventDefault() and markdown never updates.
 * Run after each preview HTML build so the direct parent carries the line index.
 */
export function patchTaskListCheckboxDataLine(root: HTMLElement | null): void {
  if (!root) return
  root.querySelectorAll<HTMLInputElement>('input.task-list-item-checkbox').forEach((input) => {
    const direct = input.parentElement
    if (direct?.hasAttribute('data-line')) return
    const host = input.closest('[data-line]')
    const line = host?.getAttribute('data-line')
    if (line && direct) direct.setAttribute('data-line', line)
  })
}
