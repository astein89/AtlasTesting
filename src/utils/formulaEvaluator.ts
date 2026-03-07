import type { DataField, TimerValue } from '../types'
import { getStatusOptions } from '../types'

export type FormulaData = Record<string, string | number | boolean | string[] | TimerValue>

/**
 * Returns all field keys referenced in the expression (e.g. [key] tokens).
 * Used to enforce "cannot remove field if used in a formula."
 */
export function getFormulaReferencedFieldKeys(expression: string): string[] {
  if (!expression || typeof expression !== 'string') return []
  const keys: string[] = []
  const re = /\[([^\]]*)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(expression)) !== null) {
    const k = m[1].trim()
    if (k && !keys.includes(k)) keys.push(k)
  }
  return keys
}

/**
 * Returns fields that reference the given field key in their formula (formula or status formula).
 * Used to block deletion of a field that is used in a formula.
 */
export function getFieldsReferencingKey(fieldKey: string, allFields: DataField[]): DataField[] {
  return allFields.filter((f) => {
    if (!f.config?.formula || (f.type !== 'formula' && f.type !== 'status')) return false
    const refs = getFormulaReferencedFieldKeys(f.config.formula)
    return refs.includes(fieldKey)
  })
}

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number' && !Number.isNaN(v)) return v
  if (typeof v === 'boolean') return v ? 1 : 0
  const s = String(v).trim()
  if (s === '') return 0
  const n = Number(s)
  return Number.isNaN(n) ? 0 : n
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map(String).join(', ')
  if (typeof v === 'object' && v !== null && 'totalElapsedMs' in v) {
    const t = v as TimerValue
    const ms = t.totalElapsedMs ?? 0
    const sec = Math.floor(ms / 1000)
    const min = Math.floor(sec / 60)
    const h = Math.floor(min / 60)
    if (h > 0) return `${h}:${String(min % 60).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
    return `${min}:${String(sec % 60).padStart(2, '0')}`
  }
  return String(v)
}

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (v === null || v === undefined) return false
  const s = String(v).toLowerCase()
  if (s === 'true' || s === '1') return true
  if (s === 'false' || s === '0' || s === '') return false
  return toNum(v) !== 0
}

export interface FormulaToken {
  type: string
  value: string
  start: number
  end: number
}

/** Tokenize formula: refs [key], numbers, strings "...", identifiers, operators. Returns tokens with start/end for highlighting. */
function tokenize(expr: string): FormulaToken[] {
  const tokens: FormulaToken[] = []
  let i = 0
  const s = expr

  while (i < s.length) {
    const rest = s.slice(i)
    const ws = /^\s+/.exec(rest)
    if (ws) {
      i += ws[0].length
      continue
    }
    // [fieldKey]
    const ref = /^\[([^\]]*)\]/.exec(rest)
    if (ref) {
      const len = ref[0].length
      tokens.push({ type: 'ref', value: ref[1].trim(), start: i, end: i + len })
      i += len
      continue
    }
    // "string" or 'string'
    const str = /^["'](?:[^"']|\\["'])*["']/.exec(rest)
    if (str) {
      const len = str[0].length
      const inner = str[0].slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'")
      tokens.push({ type: 'string', value: inner, start: i, end: i + len })
      i += len
      continue
    }
    // number
    const num = /^-?\d+(?:\.\d+)?/.exec(rest)
    if (num) {
      const len = num[0].length
      tokens.push({ type: 'number', value: num[0], start: i, end: i + len })
      i += len
      continue
    }
    // <= >= <> =
    if (rest.startsWith('<=')) { tokens.push({ type: 'op', value: '<=', start: i, end: i + 2 }); i += 2; continue }
    if (rest.startsWith('>=')) { tokens.push({ type: 'op', value: '>=', start: i, end: i + 2 }); i += 2; continue }
    if (rest.startsWith('<>')) { tokens.push({ type: 'op', value: '<>', start: i, end: i + 2 }); i += 2; continue }
    // single-char ops
    if (/^[+\-*/&=<>,()]/.test(rest)) {
      tokens.push({ type: 'op', value: rest[0], start: i, end: i + 1 })
      i += 1
      continue
    }
    // identifier (function name)
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest)
    if (id) {
      const len = id[0].length
      tokens.push({ type: 'id', value: id[0], start: i, end: i + len })
      i += len
      continue
    }
    // unknown char
    tokens.push({ type: 'unknown', value: rest[0], start: i, end: i + 1 })
    i++
  }
  return tokens
}

export interface FormulaHighlightSegment {
  type: string
  start: number
  end: number
  text: string
}

/** Get segments for syntax highlighting (includes whitespace). Each segment has type, start, end, and text. */
export function getFormulaTokensForHighlight(expression: string): FormulaHighlightSegment[] {
  const tokens = tokenize(expression)
  const segments: FormulaHighlightSegment[] = []
  let pos = 0
  for (const t of tokens) {
    if (t.start > pos) {
      segments.push({ type: 'ws', start: pos, end: t.start, text: expression.slice(pos, t.start) })
    }
    segments.push({ type: t.type, start: t.start, end: t.end, text: expression.slice(t.start, t.end) })
    pos = t.end
  }
  if (pos < expression.length) {
    segments.push({ type: 'ws', start: pos, end: expression.length, text: expression.slice(pos) })
  }
  return segments
}

type Token = FormulaToken

class Parser {
  private tokens: Token[]
  private pos: number

  constructor(expr: string) {
    this.tokens = tokenize(expr)
    this.pos = 0
  }

  private peek(): Token | null {
    return this.pos < this.tokens.length ? this.tokens[this.pos] : null
  }

  private consume(): Token | null {
    if (this.pos >= this.tokens.length) return null
    return this.tokens[this.pos++]
  }

  private expectValue(): unknown {
    const t = this.consume()
    if (!t) return null
    if (t.type === 'ref') return { ref: t.value }
    if (t.type === 'number') return Number(t.value)
    if (t.type === 'string') return t.value
    return null
  }

  private parsePrimary(): unknown {
    const t = this.peek()
    if (!t) return null
    if (t.type === 'op' && t.value === '(') {
      this.consume() // (
      const inner = this.parseCompare()
      if (this.peek()?.value === ')') this.consume() // )
      return inner
    }
    if (t.type === 'ref' || t.type === 'number' || t.type === 'string') return this.expectValue()
    if (t.type === 'id') {
      const t2 = this.consume()
      if (!t2 || t2.type !== 'id') return null
      const next = this.peek()
      if (next?.value === '(') {
        this.consume() // (
        const args: unknown[] = []
        while (this.peek() && this.peek()?.value !== ')') {
          args.push(this.parseCompare())
          if (this.peek()?.value === ',') this.consume()
        }
        if (this.peek()?.value === ')') this.consume() // )
        return { fn: t2.value.toUpperCase(), args }
      }
      return { var: t2.value }
    }
    return null
  }

  private parseMul(): unknown {
    let left = this.parsePrimary()
    for (;;) {
      const op = this.peek()
      if (op?.type === 'op' && (op.value === '*' || op.value === '/')) {
        this.consume()
        const right = this.parsePrimary()
        left = { op: op.value, left, right }
      } else break
    }
    return left
  }

  private parseAdd(): unknown {
    let left = this.parseMul()
    for (;;) {
      const op = this.peek()
      if (op?.type === 'op' && (op.value === '+' || op.value === '-')) {
        this.consume()
        const right = this.parseMul()
        left = { op: op.value, left, right }
      } else break
    }
    return left
  }

  private parseConcat(): unknown {
    let left = this.parseAdd()
    for (;;) {
      const op = this.peek()
      if (op?.type === 'op' && op.value === '&') {
        this.consume()
        const right = this.parseAdd()
        left = { op: '&', left, right }
      } else break
    }
    return left
  }

  private parseCompare(): unknown {
    const left = this.parseConcat()
    const op = this.peek()
    if (op?.type === 'op' && ['=', '<', '>', '<=', '>=', '<>'].includes(op.value)) {
      this.consume()
      const right = this.parseConcat()
      return { op: op.value, left, right }
    }
    return left
  }

  parse(): unknown {
    if (this.tokens.length === 0) return null
    return this.parseCompare()
  }

  /** True if every token was consumed (no trailing garbage). */
  consumedAll(): boolean {
    return this.pos >= this.tokens.length
  }

  /** Position of first unconsumed token (for error highlighting). */
  getErrorRange(): { start: number; end: number } | null {
    if (this.pos >= this.tokens.length) return null
    const t = this.tokens[this.pos]
    return { start: t.start, end: t.end }
  }
}

function evaluateNode(
  node: unknown,
  data: FormulaData,
  visited: Set<string>,
  scope?: Record<string, unknown>
): string | number | boolean | null {
  if (node === null || node === undefined) return null
  if (typeof node === 'number') return node
  if (typeof node === 'string') return node
  if (typeof node === 'object' && node !== null && 'var' in node) {
    const name = (node as { var: string }).var
    if (scope && Object.prototype.hasOwnProperty.call(scope, name)) return scope[name] as string | number | boolean | null
    return null
  }
  if (typeof node === 'object' && node !== null && 'ref' in node) {
    const key = (node as { ref: string }).ref
    if (visited.has(key)) return null
    return (data[key] as string | number | boolean | null) ?? null
  }
  if (typeof node === 'object' && node !== null && 'fn' in node) {
    const { fn, args } = node as { fn: string; args: unknown[] }
    const ev = (n: unknown, s?: Record<string, unknown>) => evaluateNode(n, data, visited, s ?? scope)
    if (fn === 'LET') {
      if (args.length < 3 || args.length % 2 !== 1) return null
      const letScope: Record<string, unknown> = { ...scope }
      for (let i = 0; i < args.length - 1; i += 2) {
        const nameNode = args[i]
        if (typeof nameNode !== 'object' || nameNode === null || !('var' in nameNode)) return null
        const name = (nameNode as { var: string }).var
        const value = ev(args[i + 1], letScope)
        letScope[name] = value
      }
      return ev(args[args.length - 1], letScope)
    }
    const evArgs = args.map((a) => ev(a))
    switch (fn) {
      case 'BLANK':
        return null
      case 'TEXT':
        return toStr(evArgs[0] ?? null)
      case 'NUMBER':
        return toNum(evArgs[0] ?? null)
      case 'LEN':
        return toStr(evArgs[0] ?? '').length
      case 'ROUND': {
        const n = toNum(evArgs[0] ?? null)
        const d = Math.floor(toNum(evArgs[1] ?? 0))
        const mul = 10 ** Math.max(0, d)
        return Math.round(n * mul) / mul
      }
      case 'SUM': {
        let sum = 0
        for (const a of evArgs) sum += toNum(a)
        return sum
      }
      case 'CONCAT': {
        return evArgs.map((a) => toStr(a)).join('')
      }
      case 'IF': {
        const cond = toBool(evArgs[0])
        return (cond ? evArgs[1] : evArgs[2]) ?? null
      }
      case 'ABS':
        return Math.abs(toNum(evArgs[0] ?? null))
      default:
        return null
    }
  }
  if (typeof node === 'object' && node !== null && 'op' in node) {
    const { op, left, right } = node as { op: string; left: unknown; right: unknown }
    const l = evaluateNode(left, data, visited, scope)
    const r = evaluateNode(right, data, visited, scope)
    if (op === '&') return toStr(l) + toStr(r)
    if (op === '+') return toNum(l) + toNum(r)
    if (op === '-') return toNum(l) - toNum(r)
    if (op === '*') return toNum(l) * toNum(r)
    if (op === '/') {
      const den = toNum(r)
      return den === 0 ? null : toNum(l) / den
    }
    if (op === '=') return toStr(l) === toStr(r)
    if (op === '<') return toNum(l) < toNum(r)
    if (op === '>') return toNum(l) > toNum(r)
    if (op === '<=') return toNum(l) <= toNum(r)
    if (op === '>=') return toNum(l) >= toNum(r)
    if (op === '<>') return toStr(l) !== toStr(r)
  }
  return null
}

/**
 * Validate formula syntax only (no evaluation).
 * Returns { valid: true } or { valid: false, error, errorStart?, errorEnd? }.
 * errorStart/errorEnd are in trimmed expression coordinates.
 */
export function validateFormula(expression: string): {
  valid: boolean
  error?: string
  errorStart?: number
  errorEnd?: number
} {
  const t = expression.trim()
  if (!t) return { valid: true }
  try {
    const parser = new Parser(t)
    const ast = parser.parse()
    if (ast === null && tokenize(t).length > 0) {
      const range = parser.getErrorRange()
      return {
        valid: false,
        error: 'Invalid formula syntax',
        ...(range && { errorStart: range.start, errorEnd: range.end }),
      }
    }
    if (!parser.consumedAll()) {
      const range = parser.getErrorRange()
      return {
        valid: false,
        error: 'Unexpected token or trailing text',
        ...(range && { errorStart: range.start, errorEnd: range.end }),
      }
    }
    return { valid: true }
  } catch {
    return { valid: false, error: 'Invalid formula syntax' }
  }
}

/**
 * Evaluate a single formula expression with the given record data.
 * Returns string, number, boolean, or null (blank/error).
 */
export function evaluateFormula(
  expression: string,
  data: FormulaData,
  _options?: { fields?: DataField[] }
): string | number | boolean | null {
  if (!expression || typeof expression !== 'string') return null
  const trimmed = expression.trim()
  if (!trimmed) return null
  try {
    const parser = new Parser(trimmed)
    const ast = parser.parse()
    const result = evaluateNode(ast, data, new Set())
    return result === undefined ? null : result
  } catch {
    return null
  }
}

/** Fields that have a formula: type formula, or type status with config.formula */
function fieldsWithFormula(fields: DataField[]): DataField[] {
  return fields.filter(
    (f) => f.config?.formula && (f.type === 'formula' || f.type === 'status')
  )
}

/**
 * Get formula (and formula-driven status) fields in dependency order (topological sort by references).
 */
function formulaDependencyOrder(fields: DataField[]): DataField[] {
  const computedFields = fieldsWithFormula(fields)
  if (computedFields.length === 0) return []
  const keyToField = new Map(computedFields.map((f) => [f.key, f]))
  const keyToRefs = new Map<string, string[]>()
  for (const f of computedFields) {
    const refs = getFormulaReferencedFieldKeys(f.config?.formula ?? '')
    keyToRefs.set(f.key, refs)
  }
  const order: DataField[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()

  function visit(key: string) {
    if (visited.has(key)) return
    if (visiting.has(key)) return
    const refs = keyToRefs.get(key) ?? []
    visiting.add(key)
    for (const r of refs) {
      const refField = keyToField.get(r)
      if (refField) visit(refField.key)
    }
    visiting.delete(key)
    visited.add(key)
    const f = keyToField.get(key)
    if (f) order.push(f)
  }

  for (const f of computedFields) visit(f.key)
  return order
}

/**
 * Returns a new data object with all formula and formula-driven status values computed.
 * Formula and status fields with config.formula are evaluated in dependency order.
 */
export function computeFormulaValues(
  fields: DataField[],
  data: FormulaData
): FormulaData {
  const result = { ...data }
  const order = formulaDependencyOrder(fields)
  for (const f of order) {
    const expr = f.config?.formula
    if (!expr) continue
    const value = evaluateFormula(expr, result)
    if (value !== null && value !== undefined) {
      if (f.type === 'status') {
        const str = String(value).trim()
        const options = getStatusOptions(f)
        const exact = options.find((o) => o === str)
        if (exact !== undefined) {
          result[f.key] = exact
        } else {
          const match = options.find((o) => o.toLowerCase() === str.toLowerCase())
          result[f.key] = match !== undefined ? match : (options[0] ?? str)
        }
      } else {
        result[f.key] = value as string | number | boolean
      }
    }
  }
  return result
}
