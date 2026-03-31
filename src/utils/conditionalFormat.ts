import type { CSSProperties } from 'react'
import type { ConditionalFormatRule, DataField } from '../types'
import type { FormulaData } from './formulaEvaluator'
import { getContrastTextColor } from './colorContrast'
import { conditionalRuleConditionMatches } from './conditionalRuleMatch'

function ruleToCss(rule: ConditionalFormatRule): CSSProperties {
  const s: CSSProperties = {}
  const bg = rule.backgroundColor?.trim()
  const txt = rule.textColor?.trim()

  if (bg) {
    s.backgroundColor = bg
    // Automatic text color when no explicit textColor is set:
    // pick black/white based on fill so it stays readable.
    if (!txt) {
      s.color = getContrastTextColor(bg)
    }
  }
  if (txt) s.color = txt
  if (rule.fontBold) s.fontWeight = 700
  return s
}

/**
 * First matching rule wins. Uses full row `data` so formula rules can reference any [FieldKey].
 */
export function getConditionalFormatStyle(
  field: DataField,
  data: FormulaData
): CSSProperties | undefined {
  const rules = field.config?.conditionalFormatting
  if (!Array.isArray(rules) || rules.length === 0) return undefined

  let anyMatch = false
  let fallbackCss: CSSProperties | undefined

  for (const rule of rules) {
    if (!rule || !rule.id) continue
    let match = false
    if (rule.mode === 'formula' || rule.mode === 'standard') {
      match = conditionalRuleConditionMatches(rule, field.key, data)
    } else if (rule.mode === 'fallback') {
      // Fallback never matches directly; it only applies when no prior rule matched.
      match = false
    } else {
      continue
    }
    const css = ruleToCss(rule)
    if (match) {
      anyMatch = true
      if (Object.keys(css).length > 0) return css
    } else if (!anyMatch && (rule.mode === 'fallback' || rule.appliesToOthers)) {
      if (Object.keys(css).length > 0 && !fallbackCss) {
        fallbackCss = css
      }
    }
  }
  return fallbackCss
}
