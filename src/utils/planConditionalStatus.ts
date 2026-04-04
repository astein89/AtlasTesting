import type {
  ConditionalStatusOptionCondition,
  ConditionalStatusStandardClause,
  DataField,
  TestPlan,
  TimerValue,
} from '../types'
import { getStatusOptions } from '../types'
import type { FormulaData } from './formulaEvaluator'
import { computeFormulaValues, getFormulaReferencedFieldKeys } from './formulaEvaluator'
import { conditionalRuleConditionMatches, matchStandardCell } from './conditionalRuleMatch'
import { randomUuid } from '@/lib/randomUuid'

/** Stored on each record’s `data` JSON; keys are status field keys (`f.key`). */
export const USER_STATUS_AUTOMATION_LOCK_KEY = '__userLockedStatus' as const

/** Placeholder row id in `conditionalStatusRuleOrder` until the user picks a status (not a real option label). */
export const STATUS_CONDITIONAL_PENDING_PREFIX = '__sc_pending:' as const

export function isPendingStatusConditionalRow(label: string): boolean {
  return typeof label === 'string' && label.startsWith(STATUS_CONDITIONAL_PENDING_PREFIX)
}

export function makePendingStatusConditionalRowId(): string {
  return `${STATUS_CONDITIONAL_PENDING_PREFIX}${randomUuid()}`
}

export type UserStatusLockMap = Record<string, true>

function isTimerLike(v: unknown): v is TimerValue {
  return typeof v === 'object' && v !== null && 'totalElapsedMs' in v
}

/** True when status field value is empty for automation purposes. */
export function isStatusValueBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'boolean') return false
  if (Array.isArray(value)) return value.length === 0
  if (isTimerLike(value)) return false
  return String(value).trim() === ''
}

function normalizeStatusToOption(value: string, field: DataField): string {
  const options = getStatusOptions(field)
  const trimmed = value.trim()
  const exact = options.find((o) => o === trimmed)
  if (exact !== undefined) return exact
  const ci = options.find((o) => o.toLowerCase() === trimmed.toLowerCase())
  return ci !== undefined ? ci : trimmed
}

/** Plan has a non-empty condition for this status option. */
export function planStatusConditionIsConfigured(
  cond: ConditionalStatusOptionCondition | null | undefined
): boolean {
  if (!cond) return false
  if (cond.mode === 'formula') return (cond.formula?.trim() ?? '').length > 0
  if (cond.mode === 'standard') {
    if (cond.standardClauses?.length) {
      return cond.standardClauses.every((c) => c.fieldKey?.trim() && c.op)
    }
    if (!cond.standardOp) return false
    if (cond.standardFieldKey2?.trim()) return !!cond.standardOp2
    return true
  }
  return false
}

/** Normalize legacy one/two-clause fields into a clause list (for evaluation and editor). */
export function normalizeStatusStandardClauses(
  cond: ConditionalStatusOptionCondition | null | undefined,
  defaultStatusFieldKey: string
): ConditionalStatusStandardClause[] {
  if (!cond || cond.mode !== 'standard') return []
  if (cond.standardClauses?.length) {
    return cond.standardClauses.map((c, i) => ({
      combine: i === 0 ? undefined : c.combine === 'or' ? 'or' : 'and',
      fieldKey: (c.fieldKey ?? '').trim() || defaultStatusFieldKey,
      op: c.op ?? 'eq',
      value: c.value,
      value2: c.value2,
    }))
  }
  if (!cond.standardOp) return []
  const c1: ConditionalStatusStandardClause = {
    fieldKey: cond.standardFieldKey?.trim() || defaultStatusFieldKey,
    op: cond.standardOp,
    value: cond.standardValue,
    value2: cond.standardValue2,
  }
  if (!cond.standardFieldKey2?.trim()) return [c1]
  return [
    c1,
    {
      combine: cond.standardLogicalOp === 'or' ? 'or' : 'and',
      fieldKey: cond.standardFieldKey2.trim(),
      op: cond.standardOp2 ?? 'eq',
      value: cond.standardValueB,
      value2: cond.standardValue2B,
    },
  ]
}

function statusStandardConditionMatches(
  cond: ConditionalStatusOptionCondition,
  statusField: DataField,
  data: FormulaData
): boolean {
  const clauses = normalizeStatusStandardClauses(cond, statusField.key)
  if (clauses.length === 0) return false
  let acc = matchStandardCell(clauses[0].op, clauses[0].value, clauses[0].value2, data[clauses[0].fieldKey])
  for (let i = 1; i < clauses.length; i++) {
    const c = clauses[i]
    const m = matchStandardCell(c.op, c.value, c.value2, data[c.fieldKey])
    const join = c.combine === 'or' ? 'or' : 'and'
    acc = join === 'or' ? acc || m : acc && m
  }
  return acc
}

function getRulesMapForField(
  plan: TestPlan | null | undefined,
  fieldId: string
): Record<string, ConditionalStatusOptionCondition | null | undefined> | undefined {
  return plan?.conditionalStatusRules?.[fieldId]
}

/**
 * First status option in field order with a configured plan condition that matches `data`.
 */
export function getFirstMatchingPlanStatusOption(
  field: DataField,
  plan: TestPlan | null | undefined,
  data: FormulaData
): string | undefined {
  if (field.type !== 'status' || field.config?.formula) return undefined
  const map = getRulesMapForField(plan, field.id)
  if (!map) return undefined
  const canonical = getStatusOptions(field)
  const explicitOrder = plan?.conditionalStatusRuleOrder?.[field.id]
  const iterable =
    explicitOrder !== undefined
      ? explicitOrder.filter((l) => canonical.includes(l) && !isPendingStatusConditionalRow(l))
      : canonical
  for (const opt of iterable) {
    const cond = map[opt]
    if (!planStatusConditionIsConfigured(cond)) continue
    const matches =
      cond!.mode === 'formula'
        ? conditionalRuleConditionMatches(
            {
              mode: 'formula',
              formula: cond!.formula,
              standardOp: cond!.standardOp,
              standardValue: cond!.standardValue,
              standardValue2: cond!.standardValue2,
            },
            field.key,
            data
          )
        : statusStandardConditionMatches(cond!, field, data)
    if (matches) {
      return normalizeStatusToOption(opt, field)
    }
  }
  return undefined
}

/** Status fields where plan rules match a value different from the computed row (after formulas). */
export function getPendingConditionalStatusUpdates(
  fields: DataField[],
  plan: TestPlan | null | undefined,
  data: FormulaData
): Array<{
  fieldKey: string
  fieldLabel: string
  currentValue: string
  suggestedValue: string
}> {
  const wf = computeFormulaValues(fields, data)
  const out: Array<{
    fieldKey: string
    fieldLabel: string
    currentValue: string
    suggestedValue: string
  }> = []
  for (const f of fields) {
    if (f.type !== 'status' || f.config?.formula) continue
    if (!plan?.conditionalStatusRules?.[f.id]) continue
    const suggested = getFirstMatchingPlanStatusOption(f, plan, wf)
    if (suggested === undefined) continue
    const cur = normalizeStatusToOption(String(wf[f.key] ?? '').trim(), f)
    const sug = normalizeStatusToOption(suggested, f)
    if (cur === sug) continue
    out.push({
      fieldKey: f.key,
      fieldLabel: f.label || f.key,
      currentValue: cur,
      suggestedValue: sug,
    })
  }
  return out
}

function readLockMap(data: FormulaData): UserStatusLockMap {
  const raw = data[USER_STATUS_AUTOMATION_LOCK_KEY]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || isTimerLike(raw)) return {}
  const out: UserStatusLockMap = {}
  for (const [k, v] of Object.entries(raw as unknown as Record<string, unknown>)) {
    if (v === true) out[k] = true
  }
  return out
}

function cloneDataWithLock(data: FormulaData, lock: UserStatusLockMap): FormulaData {
  const next = { ...data }
  if (Object.keys(lock).length === 0) {
    delete (next as Record<string, unknown>)[USER_STATUS_AUTOMATION_LOCK_KEY]
  } else {
    ;(next as Record<string, unknown>)[USER_STATUS_AUTOMATION_LOCK_KEY] = { ...lock }
  }
  return next
}

/** Merge lock map: set/remove one field key. */
export function setUserStatusLockForField(
  data: FormulaData,
  fieldKey: string,
  locked: boolean
): FormulaData {
  const lock = { ...readLockMap(data) }
  if (locked) lock[fieldKey] = true
  else delete lock[fieldKey]
  return cloneDataWithLock(data, lock)
}

/**
 * After `computeFormulaValues`, update status fields from plan rules unless user-locked.
 * Does not add/remove locks (use `syncStatusAutomationLockAfterUserEdit` on user commits).
 */
export function applyPlanConditionalStatus(
  fields: DataField[],
  plan: TestPlan | null | undefined,
  data: FormulaData
): FormulaData {
  if (!plan?.conditionalStatusRules || Object.keys(plan.conditionalStatusRules).length === 0) {
    return data
  }
  const lock = readLockMap(data)
  let result: FormulaData = { ...data }
  for (const f of fields) {
    if (f.type !== 'status' || f.config?.formula) continue
    if (!plan.conditionalStatusRules[f.id]) continue
    if (lock[f.key]) continue
    const matched = getFirstMatchingPlanStatusOption(f, plan, result)
    if (matched !== undefined) {
      result = { ...result, [f.key]: matched }
    }
  }
  return result
}

/**
 * User committed `newValue` for status field `fieldKey`. Set/clear lock vs automation first-match.
 */
export function syncStatusAutomationLockAfterUserEdit(
  fields: DataField[],
  plan: TestPlan | null | undefined,
  data: FormulaData,
  fieldKey: string,
  newValue: string
): FormulaData {
  const field = fields.find((f) => f.key === fieldKey && f.type === 'status')
  if (!field || field.config?.formula) return { ...data, [fieldKey]: newValue }

  const merged = { ...data, [fieldKey]: newValue }
  if (!plan?.conditionalStatusRules?.[field.id]) {
    return setUserStatusLockForField(merged, fieldKey, false)
  }

  const afterFormulas = computeFormulaValues(fields, merged)
  const trimmed = newValue.trim()

  if (trimmed === '') {
    return setUserStatusLockForField(afterFormulas, fieldKey, false)
  }

  const matched = getFirstMatchingPlanStatusOption(field, plan, afterFormulas)
  const normalizedUser = normalizeStatusToOption(trimmed, field)

  if (matched === undefined) {
    return setUserStatusLockForField(afterFormulas, fieldKey, true)
  }
  if (normalizedUser === matched) {
    return setUserStatusLockForField(afterFormulas, fieldKey, false)
  }
  return setUserStatusLockForField(afterFormulas, fieldKey, true)
}

/** Formulas then plan conditional status (for saves, imports, table pipeline). */
export function computeRecordDataWithPlanAutomation(
  fields: DataField[],
  plan: TestPlan | null | undefined,
  data: FormulaData
): FormulaData {
  const withFormulas = computeFormulaValues(fields, data)
  return applyPlanConditionalStatus(fields, plan, withFormulas)
}

/** True if plan defines any automation rule for this status field id. */
export function planHasStatusAutomationForFieldId(
  plan: TestPlan | null | undefined,
  fieldId: string
): boolean {
  const map = plan?.conditionalStatusRules?.[fieldId]
  if (!map) return false
  return Object.values(map).some((c) => planStatusConditionIsConfigured(c))
}

/** Remove automation meta keys from a plain data object (e.g. CSV export). */
export function stripStatusAutomationMetaFromData<T extends Record<string, unknown>>(data: T): T {
  const { [USER_STATUS_AUTOMATION_LOCK_KEY]: _, ...rest } = data
  return rest as T
}

export function planConditionalRulesReferenceFieldKey(
  rules: TestPlan['conditionalStatusRules'] | undefined,
  fieldKey: string
): boolean {
  if (!rules) return false
  for (const byField of Object.values(rules)) {
    if (!byField || typeof byField !== 'object') continue
    for (const cond of Object.values(byField)) {
      if (!cond || typeof cond !== 'object') continue
      if (cond.mode === 'formula' && cond.formula) {
        if (getFormulaReferencedFieldKeys(cond.formula).includes(fieldKey)) return true
      }
      if (cond.mode === 'standard') {
        if (cond.standardClauses?.length) {
          for (const sc of cond.standardClauses) {
            if (typeof sc.fieldKey === 'string' && sc.fieldKey.trim() === fieldKey) return true
          }
        } else {
          if (typeof cond.standardFieldKey === 'string' && cond.standardFieldKey.trim() === fieldKey) {
            return true
          }
          if (typeof cond.standardFieldKey2 === 'string' && cond.standardFieldKey2.trim() === fieldKey) {
            return true
          }
        }
      }
    }
  }
  return false
}

export function anyPlanReferencesFieldInConditionalStatusRules(
  plans: Array<{ conditionalStatusRules?: TestPlan['conditionalStatusRules'] }>,
  fieldKey: string
): boolean {
  return plans.some((p) => planConditionalRulesReferenceFieldKey(p.conditionalStatusRules, fieldKey))
}

/** True if any plan stores Status Conditionals for this field id or references `fieldKey` in a rule formula. */
export function anyPlanConditionalStatusRulesTouchField(
  plans: Array<{ conditionalStatusRules?: TestPlan['conditionalStatusRules'] }>,
  fieldId: string,
  fieldKey: string
): boolean {
  for (const p of plans) {
    const rules = p.conditionalStatusRules
    if (!rules) continue
    const forField = rules[fieldId]
    if (forField && Object.keys(forField).length > 0) return true
    if (planConditionalRulesReferenceFieldKey(rules, fieldKey)) return true
  }
  return false
}

/**
 * Live row recompute after a single field change (table/modal). Status commits sync automation lock; other fields run formulas + plan status.
 */
export function recomputeRowDataAfterFieldEdit(
  fields: DataField[],
  plan: TestPlan | null | undefined,
  data: FormulaData,
  editedKey: string,
  editedValue: string | number | boolean | string[] | TimerValue
): FormulaData {
  const editedField = fields.find((f) => f.key === editedKey)
  const merged: FormulaData = { ...data, [editedKey]: editedValue }
  if (editedField?.type === 'status' && !editedField.config?.formula) {
    const synced = syncStatusAutomationLockAfterUserEdit(
      fields,
      plan,
      merged,
      editedKey,
      String(editedValue ?? '')
    )
    return applyPlanConditionalStatus(fields, plan, synced)
  }
  return computeRecordDataWithPlanAutomation(fields, plan, merged)
}

/**
 * Import/bulk-create: formulas, then align locks from final status values, then apply plan Status Conditionals.
 */
export function finalizeRecordDataAfterImportOrBulk(
  fields: DataField[],
  plan: TestPlan | null | undefined,
  data: FormulaData
): FormulaData {
  let x = computeFormulaValues(fields, data)
  for (const f of fields) {
    if (f.type !== 'status' || f.config?.formula) continue
    if (!planHasStatusAutomationForFieldId(plan, f.id)) continue
    x = syncStatusAutomationLockAfterUserEdit(fields, plan, x, f.key, String(x[f.key] ?? ''))
  }
  return applyPlanConditionalStatus(fields, plan, x)
}
