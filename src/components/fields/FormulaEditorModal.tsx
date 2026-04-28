import { useEffect, useMemo, useRef, useState } from 'react'
import {
  validateFormula,
  getFormulaTokensForHighlight,
  getFormulaReferencedFieldKeys,
  evaluateFormula,
} from '../../utils/formulaEvaluator'
import type { DataField } from '../../types'

const FORMULA_PAREN_COLORS = [
  'text-red-600 dark:text-red-400',
  'text-blue-600 dark:text-blue-400',
  'text-emerald-600 dark:text-emerald-400',
  'text-amber-600 dark:text-amber-400',
  'text-violet-600 dark:text-violet-400',
  'text-cyan-600 dark:text-cyan-400',
  'text-orange-600 dark:text-orange-400',
  'text-pink-600 dark:text-pink-400',
]

export interface FormulaEditorModalProps {
  open: boolean
  initialValue: string
  availableFields: DataField[]
  onClose: () => void
  onSave: (formula: string) => void
  /** Extra class for overlay (default z-[70]) */
  overlayClassName?: string
}

/**
 * Full-screen formula editor: syntax highlight, validation, field insert, test evaluate — same UX as Field Editor / conditional formatting.
 */
export function FormulaEditorModal({
  open,
  initialValue,
  availableFields,
  onClose,
  onSave,
  overlayClassName = 'z-[70]',
}: FormulaEditorModalProps) {
  const [draft, setDraft] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  const [testData, setTestData] = useState<Record<string, string>>({})
  const [testResult, setTestResult] = useState<string | number | boolean | null | undefined>(undefined)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const highlightRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (open) {
      setDraft(initialValue)
      setHelpOpen(false)
      setTestData({})
      setTestResult(undefined)
    }
  }, [open, initialValue])

  const syncScroll = () => {
    const ta = textareaRef.current
    const hl = highlightRef.current
    if (ta && hl) {
      hl.scrollTop = ta.scrollTop
      hl.scrollLeft = ta.scrollLeft
    }
  }

  const validation = useMemo(() => validateFormula(draft), [draft])
  const validationError = open && !validation.valid ? validation.error ?? null : null
  const errorDraftStart =
    validation.errorStart != null && validation.errorEnd != null
      ? (draft.search(/\S/) ?? draft.length) + validation.errorStart
      : null
  const errorDraftEnd =
    validation.errorStart != null && validation.errorEnd != null
      ? (draft.search(/\S/) ?? draft.length) + validation.errorEnd
      : null
  const highlightSegments = useMemo(() => getFormulaTokensForHighlight(draft), [draft])
  const referencedKeys = useMemo(() => getFormulaReferencedFieldKeys(draft), [draft])
  const parenPairIndices = useMemo(() => {
    const out: (number | undefined)[] = []
    let depth = 0
    for (const seg of highlightSegments) {
      if (seg.text === '(') {
        out.push(depth)
        depth++
      } else if (seg.text === ')') {
        depth--
        out.push(depth >= 0 ? depth : undefined)
      } else {
        out.push(undefined)
      }
    }
    return out
  }, [highlightSegments])

  if (!open) return null

  return (
    <div className={`fixed inset-0 ${overlayClassName} flex items-center justify-center bg-black/50 p-4`}>
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg">
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col p-4">
            <div className="mb-2 flex items-center gap-2">
              <label className="text-sm font-medium text-foreground">Formula</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setHelpOpen((v) => !v)}
                  className="flex h-5 w-5 items-center justify-center rounded-full border border-border bg-muted/50 text-xs text-foreground/70 hover:bg-muted hover:text-foreground"
                  title="Formula help"
                  aria-label="Formula help"
                >
                  ?
                </button>
                {helpOpen && (
                  <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
                    <div
                      className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between border-b border-border px-4 py-3">
                        <h2 className="text-lg font-semibold text-foreground">Formula reference</h2>
                        <button
                          type="button"
                          onClick={() => setHelpOpen(false)}
                          className="rounded p-1 text-foreground/70 hover:bg-muted hover:text-foreground"
                          aria-label="Close"
                        >
                          ×
                        </button>
                      </div>
                      <div className="flex-1 space-y-6 overflow-auto p-4 text-sm text-foreground/90">
                        <section>
                          <h3 className="mb-1 font-medium text-foreground">Reference fields</h3>
                          <p className="mb-2">
                            Use <code className="rounded bg-muted px-1 font-mono text-xs">[fieldKey]</code> for another
                            field&apos;s value. Click a field in the list to insert it.
                          </p>
                        </section>
                        <section>
                          <h3 className="mb-1 font-medium text-foreground">Operators</h3>
                          <p className="text-foreground/80">
                            Arithmetic: + − * / · Compare: = &lt; &gt; &lt;= &gt;= &lt;&gt; · Text: &amp; · Group: ( )
                          </p>
                        </section>
                        <section>
                          <h3 className="mb-2 font-medium text-foreground">Functions</h3>
                          <p className="text-foreground/80">
                            IF, LET, TEXT, NUMBER, ROUND, ABS, SUM, CONCAT, LEN — same as data field formulas.
                          </p>
                        </section>
                        <section>
                          <h3 className="mb-1 font-medium text-foreground">Blank (empty) values</h3>
                          <p className="text-foreground/80">
                            Use <code className="rounded bg-muted px-1 font-mono text-xs">BLANK()</code> for an intentional
                            blank. <code className="rounded bg-muted px-1 font-mono text-xs">NULL()</code> is the same
                            (SQL-style alias). There is no bare <code className="font-mono text-xs">NULL</code> or{' '}
                            <code className="font-mono text-xs">null</code> keyword — always use the parentheses. Empty
                            field references <code className="font-mono text-xs">[key]</code> also evaluate as blank when
                            the cell is empty.
                          </p>
                        </section>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div
              className={`relative flex min-h-[200px] flex-1 flex-col overflow-hidden rounded-lg border ${
                validationError ? 'border-red-500' : 'border-border'
              }`}
            >
              <div
                ref={highlightRef}
                className="absolute inset-0 overflow-auto whitespace-pre-wrap break-words bg-background px-3 py-2 font-mono text-sm leading-normal"
                aria-hidden
              >
                {highlightSegments.length > 0 ? (
                  highlightSegments.map((seg, idx) => {
                    const isError =
                      errorDraftStart != null &&
                      errorDraftEnd != null &&
                      seg.end > errorDraftStart &&
                      seg.start < errorDraftEnd
                    const spanClass =
                      seg.type === 'ref'
                        ? 'text-blue-600 dark:text-blue-400'
                        : seg.type === 'number'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : seg.type === 'string'
                            ? 'text-amber-600 dark:text-amber-400'
                            : seg.type === 'op'
                              ? seg.text === '(' || seg.text === ')'
                                ? (() => {
                                    const pi = parenPairIndices[idx]
                                    return pi !== undefined
                                      ? FORMULA_PAREN_COLORS[pi % FORMULA_PAREN_COLORS.length] + ' font-medium'
                                      : 'text-red-500 font-medium'
                                  })()
                                : 'text-foreground/90'
                              : seg.type === 'id'
                                ? 'font-medium text-violet-600 dark:text-violet-400'
                                : seg.type === 'unknown'
                                  ? 'text-red-500'
                                  : seg.type === 'ws'
                                    ? 'text-foreground'
                                    : 'text-foreground'
                    return (
                      <span
                        key={idx}
                        className={
                          isError ? 'rounded border-b-2 border-red-500 bg-red-500/20 px-0.5' : spanClass
                        }
                      >
                        {seg.text}
                      </span>
                    )
                  })
                ) : (
                  <span className="text-foreground/50">{'\u00A0'}</span>
                )}
              </div>
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onScroll={syncScroll}
                placeholder='e.g. [Score] > 80 AND [Result] = "Pass"'
                className="absolute inset-0 min-h-full w-full resize-none overflow-auto bg-transparent px-3 py-2 font-mono text-sm leading-normal whitespace-pre-wrap break-words text-transparent caret-foreground selection:bg-primary/20 placeholder:text-foreground/50 focus:outline-none"
                style={{ WebkitTextFillColor: 'transparent' }}
                spellCheck={false}
              />
            </div>
            {validationError && (
              <p className="mt-1.5 text-sm text-red-500" role="alert">
                {validationError}
              </p>
            )}
            <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3">
              <p className="mb-2 text-sm font-medium text-foreground">Test with sample data</p>
              {referencedKeys.length === 0 ? (
                <p className="text-xs text-foreground/60">
                  Reference fields in the formula (e.g. [fieldKey]) to enter test values and evaluate.
                </p>
              ) : (
                <>
                  <div className="space-y-2">
                    {referencedKeys.map((key) => {
                      const field = availableFields.find((f) => f.key === key)
                      const label = field?.label || key
                      return (
                        <div key={key} className="flex items-center gap-2">
                          <label className="w-32 shrink-0 truncate text-xs text-foreground/80" title={key}>
                            {label}:
                          </label>
                          <input
                            type="text"
                            value={testData[key] ?? ''}
                            onChange={(e) => setTestData((prev) => ({ ...prev, [key]: e.target.value }))}
                            placeholder={field?.type === 'number' ? '0' : 'value'}
                            className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-sm text-foreground"
                          />
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        const data: Record<string, string | number> = {}
                        for (const key of referencedKeys) {
                          const raw = testData[key] ?? ''
                          const field = availableFields.find((f) => f.key === key)
                          if (field?.type === 'number') {
                            const n = Number(raw)
                            data[key] = raw === '' ? '' : Number.isFinite(n) ? n : 0
                          } else {
                            data[key] = raw
                          }
                        }
                        try {
                          const result = evaluateFormula(draft, data)
                          setTestResult(result)
                        } catch {
                          setTestResult(undefined)
                        }
                      }}
                      className="rounded border border-border bg-background px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                    >
                      Evaluate
                    </button>
                    {testResult !== undefined && (
                      <span className="text-sm text-foreground/80">
                        Result:{' '}
                        <strong className="font-mono text-foreground">
                          {testResult === null || testResult === ''
                            ? '(blank)'
                            : String(testResult)}
                        </strong>
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="flex w-56 shrink-0 flex-col border-l border-border bg-muted/20">
            <p className="border-b border-border p-2 text-sm font-medium text-foreground">Insert field</p>
            <ul className="flex-1 space-y-1 overflow-auto p-2">
              {availableFields.length === 0 ? (
                <li className="text-xs text-foreground/60">No fields on this plan. Use [fieldKey] manually.</li>
              ) : (
                availableFields.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => {
                        const ref = `[${f.key}]`
                        const ta = textareaRef.current
                        if (ta) {
                          const start = ta.selectionStart
                          const end = ta.selectionEnd
                          const before = draft.slice(0, start)
                          const after = draft.slice(end)
                          setDraft(before + ref + after)
                          setTimeout(() => {
                            ta.focus()
                            ta.setSelectionRange(before.length + ref.length, before.length + ref.length)
                          }, 0)
                        } else {
                          setDraft((prev) => prev + ref)
                        }
                      }}
                      className="w-full rounded px-2 py-1.5 text-left text-sm text-foreground hover:bg-background"
                    >
                      {f.label || f.key}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-4">
          <button
            type="button"
            onClick={() => {
              setHelpOpen(false)
              onClose()
            }}
            className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              setHelpOpen(false)
              onSave(draft)
            }}
            className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
            disabled={!!validationError}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
