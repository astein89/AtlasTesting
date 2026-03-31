import type { ConditionalFormatRule, TimerValue } from '../types'
import type { FormulaData } from './formulaEvaluator'
import { evaluateFormula } from './formulaEvaluator'

/** Subset of a rule used only for condition evaluation (CF + plan Status Conditionals). */
export type ConditionMatchRule = Pick<
  ConditionalFormatRule,
  'mode' | 'formula' | 'standardOp' | 'standardValue' | 'standardValue2'
>

function toNum(v: unknown): number {
  if (v === null || v === undefined) return Number.NaN
  if (typeof v === 'number' && !Number.isNaN(v)) return v
  if (typeof v === 'boolean') return v ? 1 : 0
  const s = String(v).trim()
  if (s === '') return Number.NaN
  const n = Number(s)
  return Number.isNaN(n) ? Number.NaN : n
}

function cellStr(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map(String).join(', ')
  if (typeof v === 'object' && v !== null && 'totalElapsedMs' in v) {
    const t = v as TimerValue
    return String((t.totalElapsedMs ?? 0) + (t.startedAt ? Date.now() - new Date(t.startedAt).getTime() : 0))
  }
  return String(v)
}

function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === 'boolean') return false
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object' && 'totalElapsedMs' in (v as object)) return false
  return String(v).trim() === ''
}

function formulaTruthy(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (v === null || v === undefined) return false
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v)
  const s = String(v).toLowerCase()
  if (s === 'true' || s === '1') return true
  if (s === 'false' || s === '0' || s === '') return false
  return toNum(v) !== 0
}

function matchStandard(rule: ConditionMatchRule, cellRaw: unknown): boolean {
  const op = rule.standardOp ?? 'eq'
  if (op === 'blank') return isBlank(cellRaw)
  if (op === 'not_blank') return !isBlank(cellRaw)

  const a = cellStr(cellRaw)
  const b = (rule.standardValue ?? '').trim()
  const b2 = (rule.standardValue2 ?? '').trim()

  switch (op) {
    case 'eq':
      return a === b
    case 'neq':
      return a !== b
    case 'contains':
      return a.toLowerCase().includes(b.toLowerCase())
    case 'not_contains':
      return !a.toLowerCase().includes(b.toLowerCase())
    case 'begins_with':
      return a.toLowerCase().startsWith(b.toLowerCase())
    case 'ends_with':
      return a.toLowerCase().endsWith(b.toLowerCase())
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
    case 'between': {
      const n = toNum(cellRaw)
      const x = toNum(b)
      const y = toNum(b2)
      if (Number.isNaN(n) || Number.isNaN(x)) return false
      if (op === 'gt') return n > x
      if (op === 'gte') return n >= x
      if (op === 'lt') return n < x
      if (op === 'lte') return n <= x
      if (Number.isNaN(y)) return false
      const lo = Math.min(x, y)
      const hi = Math.max(x, y)
      return n >= lo && n <= hi
    }
    default:
      return false
  }
}

/** Compare one cell to a standard op + value(s) (shared by CF and status conditionals). */
export function matchStandardCell(
  op: ConditionMatchRule['standardOp'] | undefined,
  standardValue: string | undefined,
  standardValue2: string | undefined,
  cellRaw: unknown
): boolean {
  return matchStandard(
    { mode: 'standard', standardOp: op ?? 'eq', standardValue, standardValue2 },
    cellRaw
  )
}

/**
 * True if this rule’s condition matches the row (formula or standard on `fieldKey`’s cell).
 * Does not handle fallback / appliesToOthers — callers treat those separately.
 */
export function conditionalRuleConditionMatches(
  rule: ConditionMatchRule,
  fieldKey: string,
  data: FormulaData
): boolean {
  if (rule.mode === 'formula' && rule.formula?.trim()) {
    try {
      const r = evaluateFormula(rule.formula.trim(), data)
      return formulaTruthy(r)
    } catch {
      return false
    }
  }
  if (rule.mode === 'standard') {
    return matchStandardCell(rule.standardOp, rule.standardValue, rule.standardValue2, data[fieldKey])
  }
  return false
}
