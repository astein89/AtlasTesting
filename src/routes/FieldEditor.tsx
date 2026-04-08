import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useParams, useNavigate } from 'react-router-dom'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { api } from '../api/client'
import { DraggableOptionList } from '../components/ui/DraggableOptionList'
import { PopupSelect } from '../components/ui/PopupSelect'
import { RadioInput } from '../components/fields/RadioInput'
import { CheckboxGroupInput } from '../components/fields/CheckboxGroupInput'
import { FRACTION_SCALES, type FractionScale } from '../utils/fraction'
import { validateFormula, getFormulaTokensForHighlight, getFormulaReferencedFieldKeys, evaluateFormula, getFieldsReferencingKey } from '../utils/formulaEvaluator'
import type { ConditionalFormatRule, DataField, FieldType, TestPlan } from '../types'
import { STATUS_OPTIONS } from '../types'
import {
  getCfStandardOpChoices,
  getCfStandardValuePlaceholder,
} from '../lib/conditionalFormatStandardOps'
import {
  dateInputValueToIso,
  dateTimeLocalValueToIso,
  formatDateTime,
  DATE_TIME_DISPLAY_OPTIONS,
  getExampleForDateTimeDisplay,
  isoToDateInputValue,
  isoToDateTimeLocalValue,
  isoToTimeInputValue,
  timeInputValueToIso,
  type DateTimeDisplayKind,
} from '../lib/dateTimeConfig'
import { useAlertConfirm } from '../contexts/AlertConfirmContext'
import { testingPath } from '../lib/appPaths'
import { useConditionalFormatPresets } from '../contexts/ConditionalFormatPresetsContext'
import { anyPlanConditionalStatusRulesTouchField } from '../utils/planConditionalStatus'

const schema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum([
    'number',
    'text',
    'longtext',
    'boolean',
    'datetime',
    'select',
    'radio_select',
    'checkbox_select',
    'status',
    'fraction',
    'weight',
    'atlas_location',
    'image',
    'timer',
    'formula',
  ]),
  config: z.record(z.unknown()).optional(),
})

type FormData = z.infer<typeof schema>

const TYPES: FieldType[] = [
  'number',
  'text',
  'longtext',
  'boolean',
  'datetime',
  'select',
  'radio_select',
  'checkbox_select',
  'status',
  'fraction',
  'weight',
  'atlas_location',
  'image',
  'timer',
  'formula',
]

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

const TYPE_LABELS: Record<FieldType, string> = {
  number: 'Number',
  text: 'Text',
  longtext: 'Long text',
  boolean: 'Boolean',
  datetime: 'Date/time',
  select: 'Select (Dropdown)',
  radio_select: 'Select (Radio)',
  checkbox_select: 'Select (Checkboxes)',
  status: 'Status',
  fraction: 'Dimension',
  weight: 'Weight',
  atlas_location: 'Atlas Location',
  image: 'Image',
  timer: 'Timer',
  formula: 'Formula',
}

const FIELD_KEY_MAX_LEN = 64

/** Safe field key fragment: lowercase [a-z0-9_], derived from label (for APIs / formulas). */
function suggestFieldKeyFromLabel(label: string): string {
  const s = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
  if (!s) return 'field'
  return s.slice(0, FIELD_KEY_MAX_LEN)
}

function normalizeCfHex(s: string): string {
  let t = s.trim().toLowerCase()
  if (!t.startsWith('#')) t = `#${t.replace(/^#/, '')}`
  const m3 = /^#([0-9a-f]{3})$/.exec(t)
  if (m3) {
    const x = m3[1]
    t = `#${x[0]}${x[0]}${x[1]}${x[1]}${x[2]}${x[2]}`
  }
  return t
}

function cfHexMatches(a: string, b: string): boolean {
  return normalizeCfHex(a) === normalizeCfHex(b)
}

export function FieldEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const navState = (location.state as { fromPlan?: boolean; ownerTestPlanId?: string | null; returnTo?: string; createdInlinePlanId?: string } | null) ?? {}
  const isNew = id === 'new'
  const { showAlert, showConfirm } = useAlertConfirm()
  const { presets: cfPresets } = useConditionalFormatPresets()
  const [keyEditable, setKeyEditable] = useState(false)
  /** New field only: label edits sync key until user edits the key. */
  const newFieldKeyManualRef = useRef(false)
  const [options, setOptions] = useState<string[]>([])
  const [fractionScale, setFractionScale] = useState<FractionScale>(16)
  const [fractionUnit, setFractionUnit] = useState<'in' | 'mm'>('in')
  const [fractionEntryUnit, setFractionEntryUnit] = useState<'in' | 'mm'>('in')
  const [weightUnit, setWeightUnit] = useState<'kg' | 'g' | 'lb' | 'oz'>('lb')
  const [weightEntryUnit, setWeightEntryUnit] = useState<'kg' | 'g' | 'lb' | 'oz'>('lb')
  const [imageMultiple, setImageMultiple] = useState(false)
  const [imageTag, setImageTag] = useState('')
  const [statusColors, setStatusColors] = useState<Record<string, string>>({})
  const [integerDigits, setIntegerDigits] = useState<number | ''>('')
  const [decimalPlaces, setDecimalPlaces] = useState<number | ''>('')
  const [decimalPlacesMode, setDecimalPlacesMode] = useState<'display' | 'enforce'>('display')
  const [numberFormat, setNumberFormat] = useState<'number' | 'percent' | 'currency' | 'fraction'>('number')
  const [thousandsSeparator, setThousandsSeparator] = useState(false)
  const [negativeStyle, setNegativeStyle] = useState<'minus' | 'parentheses'>('minus')
  const [currencySymbol, setCurrencySymbol] = useState('')
  const [formulaFractionScale, setFormulaFractionScale] = useState<FractionScale | ''>('')
  const [numberMin, setNumberMin] = useState<number | ''>('')
  const [numberMax, setNumberMax] = useState<number | ''>('')
  const [minLength, setMinLength] = useState<number | ''>('')
  const [maxLength, setMaxLength] = useState<number | ''>('')
  const [textDisallowSpaces, setTextDisallowSpaces] = useState(false)
  const [textUnallowedChars, setTextUnallowedChars] = useState('')
  const [textPatternMask, setTextPatternMask] = useState('')
  const [textCase, setTextCase] = useState<'none' | 'upper' | 'lower'>('none')
  const [dateTimeDisplay, setDateTimeDisplay] = useState<DateTimeDisplayKind>('dateTime')
  const [radioLayoutPreset, setRadioLayoutPreset] = useState<string>('auto')
  const [radioLayoutCustom, setRadioLayoutCustom] = useState<number>(5)
  const [checkboxLayoutPreset, setCheckboxLayoutPreset] = useState<string>('auto')
  const [checkboxLayoutCustom, setCheckboxLayoutCustom] = useState<number>(5)
  const [fieldType, setFieldType] = useState<FieldType>('text')
  const [statusUseFormula, setStatusUseFormula] = useState(false)
  const [formulaModalOpen, setFormulaModalOpen] = useState(false)
  const [formulaDraft, setFormulaDraft] = useState('')
  const [formulaHelpOpen, setFormulaHelpOpen] = useState(false)
  const [formulaModalContext, setFormulaModalContext] = useState<'field' | 'status' | 'conditionalFormatting' | null>(null)
  const [cfFormulaEditingRuleId, setCfFormulaEditingRuleId] = useState<string | null>(null)
  const [cfRules, setCfRules] = useState<ConditionalFormatRule[]>([])
  const [cfHelpOpen, setCfHelpOpen] = useState(false)
  const [cfCfPopover, setCfCfPopover] = useState<{ ruleId: string; kind: 'fill' | 'text' } | null>(null)
  const [ownerPlanId, setOwnerPlanId] = useState<string | null>(navState.ownerTestPlanId ?? null)
  const [ownerPlanName, setOwnerPlanName] = useState<string | null>(null)
  const [formulaTestData, setFormulaTestData] = useState<Record<string, string>>({})
  const [formulaTestResult, setFormulaTestResult] = useState<string | number | boolean | null | undefined>(undefined)
  const [availableFieldsForFormula, setAvailableFieldsForFormula] = useState<DataField[]>([])
  const formulaTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const formulaHighlightRef = useRef<HTMLDivElement | null>(null)
  const formulaHelpRef = useRef<HTMLDivElement | null>(null)

  const syncFormulaScroll = () => {
    const ta = formulaTextareaRef.current
    const hl = formulaHighlightRef.current
    if (ta && hl) {
      hl.scrollTop = ta.scrollTop
      hl.scrollLeft = ta.scrollLeft
    }
  }

  const formulaValidation = React.useMemo(() => validateFormula(formulaDraft), [formulaDraft])
  const formulaValidationError = formulaModalOpen && !formulaValidation.valid ? formulaValidation.error ?? null : null
  const formulaErrorDraftStart =
    formulaValidation.errorStart != null && formulaValidation.errorEnd != null
      ? (formulaDraft.search(/\S/) ?? formulaDraft.length) + formulaValidation.errorStart
      : null
  const formulaErrorDraftEnd =
    formulaValidation.errorStart != null && formulaValidation.errorEnd != null
      ? (formulaDraft.search(/\S/) ?? formulaDraft.length) + formulaValidation.errorEnd
      : null
  const formulaHighlightSegments = React.useMemo(
    () => getFormulaTokensForHighlight(formulaDraft),
    [formulaDraft]
  )
  const formulaReferencedKeys = React.useMemo(
    () => getFormulaReferencedFieldKeys(formulaDraft),
    [formulaDraft]
  )
  const formulaParenPairIndices = React.useMemo(() => {
    const out: (number | undefined)[] = []
    let depth = 0
    for (const seg of formulaHighlightSegments) {
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
  }, [formulaHighlightSegments])

  const {
    register,
    control,
    handleSubmit,
    setValue,
    watch,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { key: '', label: '', type: 'text' },
  })

  const keyReg = register('key')
  const labelReg = register('label')

  const typeVal = watch('type')

  useEffect(() => {
    if (isNew) newFieldKeyManualRef.current = false
  }, [isNew])

  const cfStandardOpChoices = useMemo(
    () => getCfStandardOpChoices(fieldType, dateTimeDisplay),
    [fieldType, dateTimeDisplay]
  )

  const cfValuePh = getCfStandardValuePlaceholder(fieldType, dateTimeDisplay)

  /** Which native control to use for conditional-format comparison values on datetime fields. */
  const cfDatetimeValueKind = useMemo(() => {
    if (fieldType !== 'datetime') return 'text' as const
    if (dateTimeDisplay === 'shortDate' || dateTimeDisplay === 'longDate') return 'date' as const
    if (dateTimeDisplay === 'shortTime') return 'timeShort' as const
    if (dateTimeDisplay === 'longTime') return 'timeLong' as const
    return 'dateTimeLocal' as const
  }, [fieldType, dateTimeDisplay])

  useEffect(() => {
    if (fieldType !== 'datetime') return
    const allowed = new Set(cfStandardOpChoices.map((c) => c.value))
    setCfRules((prev) => {
      let changed = false
      const next = prev.map((r) => {
        if (r.mode !== 'standard' || !r.standardOp || allowed.has(r.standardOp)) return r
        changed = true
        return { ...r, standardOp: 'eq' as ConditionalFormatRule['standardOp'] }
      })
      return changed ? next : prev
    })
  }, [fieldType, dateTimeDisplay, cfStandardOpChoices])

  useEffect(() => {
    if (typeVal) setFieldType(typeVal as FieldType)
    if (typeVal === 'status') setOptions((prev) => (prev.length ? prev : [...STATUS_OPTIONS]))
    if (typeVal === 'select' || typeVal === 'radio_select' || typeVal === 'checkbox_select')
      setOptions((prev) => (prev.length ? prev : ['']))
  }, [typeVal])

  const onSubmit = async (data: FormData) => {
    const config = { ...data.config }
    if (fieldType === 'select' || fieldType === 'radio_select' || fieldType === 'checkbox_select')
      config.options = options.map((o) => (o == null ? '' : String(o)))
    if (fieldType === 'radio_select') {
      config.radioLayout =
        radioLayoutPreset === 'custom'
          ? radioLayoutCustom
          : radioLayoutPreset === 'auto'
            ? 'auto'
            : Number(radioLayoutPreset)
    }
    if (fieldType === 'checkbox_select') {
      config.checkboxLayout =
        checkboxLayoutPreset === 'custom'
          ? checkboxLayoutCustom
          : checkboxLayoutPreset === 'auto'
            ? 'auto'
            : Number(checkboxLayoutPreset)
    }
    if (fieldType === 'fraction') {
      config.fractionScale = fractionScale
      config.unit = fractionUnit
      if (fractionEntryUnit !== fractionUnit) config.entryUnit = fractionEntryUnit
      else if ('entryUnit' in config) delete config.entryUnit
    }
    if (fieldType === 'weight') {
      config.unit = weightUnit
      if (weightEntryUnit !== weightUnit) config.entryUnit = weightEntryUnit
      else if ('entryUnit' in config) delete config.entryUnit
    }
    if (fieldType === 'image') {
      config.imageMultiple = imageMultiple
      config.imageTag = imageTag.trim()
    }
    if (fieldType === 'status') {
      config.options = options.map((o) => (o == null ? '' : String(o)))
      config.statusColors = statusColors
      if (statusUseFormula) {
        const statusFormula = (getValues('config') as { formula?: string })?.formula?.trim()
        if (statusFormula) config.formula = statusFormula
      } else if ('formula' in config) delete config.formula
    }
    if (fieldType === 'number') {
      if (integerDigits === '') delete config.integerDigits
      else config.integerDigits = integerDigits
      if (decimalPlaces === '') {
        delete config.decimalPlaces
        delete config.decimalPlacesMode
      } else {
        config.decimalPlaces = decimalPlaces
        config.decimalPlacesMode = decimalPlacesMode
      }
      config.numberFormat = numberFormat
      config.thousandsSeparator = thousandsSeparator
      config.negativeStyle = negativeStyle
      config.currencySymbol = currencySymbol.trim()
      if (numberMin === '') delete config.min
      else config.min = numberMin
      if (numberMax === '') delete config.max
      else config.max = numberMax
    }
    if (fieldType === 'text' || fieldType === 'longtext') {
      if (textDisallowSpaces) config.textDisallowSpaces = true
      config.textUnallowedChars = textUnallowedChars.trim()
      if (textCase === 'upper' || textCase === 'lower') config.textCase = textCase
      else delete config.textCase
      if (fieldType === 'text') {
        const mask = textPatternMask.trim()
        config.textPatternMask = mask
        if (mask) {
          // Enforce pattern mask based on number of slots (@, #, *, 0, a).
          const slotCount = mask
            .split('')
            .filter((ch) => ch === '@' || ch === '#' || ch === '*' || ch === '0' || ch === 'a').length
          if (slotCount > 0) {
            config.minLength = slotCount
            delete config.maxLength
          }
        } else {
          // No pattern mask: use explicit min/max length inputs.
          if (minLength === '') delete config.minLength
          else config.minLength = minLength
          if (maxLength === '') delete config.maxLength
          else config.maxLength = maxLength
        }
      } else {
        // longtext never uses pattern mask; use explicit min/max.
        if (minLength === '') delete config.minLength
        else config.minLength = minLength
        if (maxLength === '') delete config.maxLength
        else config.maxLength = maxLength
      }
    }
    if (fieldType === 'datetime') {
      config.dateTimeDisplay = dateTimeDisplay
      if ('dateTimeFormat' in config) delete config.dateTimeFormat
    }
    if (fieldType === 'formula') {
      config.formula = (getValues('config') as { formula?: string })?.formula ?? ''
      if (numberFormat === 'fraction') config.fractionScale = formulaFractionScale || 16
      else if ('fractionScale' in config) delete config.fractionScale
      if (decimalPlaces === '') {
        delete config.decimalPlaces
        delete config.decimalPlacesMode
      } else {
        config.decimalPlaces = decimalPlaces
        config.decimalPlacesMode = decimalPlacesMode
      }
      if (integerDigits === '') delete config.integerDigits
      else config.integerDigits = integerDigits
      config.numberFormat = numberFormat === 'fraction' ? 'number' : numberFormat
      config.thousandsSeparator = thousandsSeparator
      config.negativeStyle = negativeStyle
      config.currencySymbol = currencySymbol.trim()
    }

    const cfClean = cfRules
      .filter((r) => {
        if (r.mode === 'formula') return (r.formula?.trim() ?? '').length > 0
        if (r.mode === 'standard') return !!r.standardOp
        // 'fallback' has no condition – keep it as long as it has some formatting
        const hasBg = !!r.backgroundColor?.trim()
        const hasTxt = !!r.textColor?.trim()
        const hasBold = r.fontBold === true
        return hasBg || hasTxt || hasBold
      })
      .map((r) => ({
        ...r,
        id: r.id || `cf-${Math.random().toString(36).slice(2)}`,
      }))
    if (cfClean.length > 0) config.conditionalFormatting = cfClean
    else delete config.conditionalFormatting

    try {
      if (isNew) {
        const { data: created } = await api.post<{ id: string }>('/fields', {
          ...data,
          config,
          // For new fields, respect the current ownerPlanId selection (plan-specific vs global)
          ownerTestPlanId: ownerPlanId,
        })
        if (navState.fromPlan && navState.returnTo) {
          const url = new URL(navState.returnTo, window.location.origin)
          url.searchParams.set('newFieldId', created.id)
          navigate(url.pathname + url.search, {
            replace: true,
            state: {
              returnTo: navState.returnTo.startsWith(testingPath('test-plans'))
                ? testingPath('test-plans')
                : undefined,
              createdInline: !!navState.createdInlinePlanId,
              newFieldId: created.id,
            },
          })
        } else {
          navigate(testingPath('fields'))
        }
      } else {
        await api.put(`/fields/${id}`, {
          ...data,
          config,
          ownerTestPlanId: ownerPlanId,
        })
        if (navState.fromPlan && navState.returnTo) {
          navigate(navState.returnTo, { replace: true })
        } else {
          navigate(testingPath('fields'))
        }
      }
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      showAlert(err || 'Failed to save')
    }
  }

  const addOption = () => setOptions((o) => [...o, ''])
  const updateOption = (i: number, v: string) =>
    setOptions((o) => {
      const n = [...o]
      n[i] = v
      return n
    })
  const removeOption = (i: number) =>
    setOptions((o) => o.filter((_, j) => j !== i))

  const [fieldMeta, setFieldMeta] = useState<{
    createdAt?: string | null
    updatedAt?: string | null
    createdByName?: string | null
    updatedByName?: string | null
  } | null>(null)

  useEffect(() => {
    if (!isNew && id) {
      setKeyEditable(false)
      api
        .get<DataField>(`/fields/${id}`)
        .then((r) => {
          setValue('key', r.data.key)
          setValue('label', r.data.label)
          setValue('type', r.data.type)
          setValue('config', r.data.config || {})
          if (Array.isArray(r.data.config?.options)) {
            setOptions(r.data.config.options.map((o) => (o == null ? '' : String(o))))
          }
          if (r.data.type === 'status' && (!r.data.config?.options || !Array.isArray(r.data.config.options) || r.data.config.options.length === 0))
            setOptions([...STATUS_OPTIONS])
          const applyLayout = (
            L: unknown,
            setPreset: (s: string) => void,
            setCustom: (n: number) => void
          ) => {
            if (L === 'vertical') {
              setPreset('1')
            } else if (L === 'horizontal' || L === 'auto') {
              setPreset('auto')
            } else {
              const n = typeof L === 'number' ? L : parseInt(String(L), 10)
              if (Number.isFinite(n) && n >= 1) {
                const clamped = Math.min(24, Math.max(1, n))
                if (clamped >= 1 && clamped <= 4) {
                  setPreset(String(clamped))
                } else {
                  setPreset('custom')
                  setCustom(clamped)
                }
              }
            }
          }
          if (r.data.type === 'radio_select' && r.data.config?.radioLayout !== undefined) {
            applyLayout(r.data.config.radioLayout, setRadioLayoutPreset, setRadioLayoutCustom)
          }
          if (r.data.type === 'checkbox_select' && r.data.config?.checkboxLayout !== undefined) {
            applyLayout(r.data.config.checkboxLayout, setCheckboxLayoutPreset, setCheckboxLayoutCustom)
          }
          if (r.data.config?.fractionScale && FRACTION_SCALES.includes(r.data.config.fractionScale as FractionScale)) {
            setFractionScale(r.data.config.fractionScale as FractionScale)
          }
          if (r.data.type === 'fraction' && (r.data.config?.unit === 'mm' || r.data.config?.unit === 'in')) {
            setFractionUnit(r.data.config.unit as 'in' | 'mm')
          }
          if (r.data.type === 'fraction' && (r.data.config?.entryUnit === 'mm' || r.data.config?.entryUnit === 'in')) {
            setFractionEntryUnit(r.data.config.entryUnit as 'in' | 'mm')
          } else if (r.data.type === 'fraction') {
            setFractionEntryUnit(r.data.config?.unit === 'mm' || r.data.config?.unit === 'in' ? (r.data.config.unit as 'in' | 'mm') : 'in')
          }
          if (r.data.type === 'weight' && typeof r.data.config?.unit === 'string') {
            const u = r.data.config.unit
            if (u === 'kg' || u === 'g' || u === 'lb' || u === 'oz') {
              setWeightUnit(u)
            }
          }
          if (r.data.type === 'weight' && typeof r.data.config?.entryUnit === 'string') {
            const eu = r.data.config.entryUnit
            if (eu === 'kg' || eu === 'g' || eu === 'lb' || eu === 'oz') {
              setWeightEntryUnit(eu)
            }
          } else if (r.data.type === 'weight') {
            const u = r.data.config?.unit
            setWeightEntryUnit(u === 'kg' || u === 'g' || u === 'lb' || u === 'oz' ? u : 'lb')
          }
          if (r.data.config?.imageMultiple != null) setImageMultiple(r.data.config.imageMultiple)
          setImageTag(r.data.config?.imageTag != null ? String(r.data.config.imageTag) : '')
          if (r.data.config?.statusColors && typeof r.data.config.statusColors === 'object') {
            setStatusColors(r.data.config.statusColors as Record<string, string>)
          }
          if (r.data.type === 'status') {
            setStatusUseFormula(!!(r.data.config?.formula))
          }
          if (r.data.type === 'number' || r.data.type === 'formula') {
            setIntegerDigits(r.data.config?.integerDigits ?? '')
            setDecimalPlaces(r.data.config?.decimalPlaces ?? '')
            const m = r.data.config?.decimalPlacesMode
            setDecimalPlacesMode(m === 'enforce' ? 'enforce' : 'display')
            if (r.data.type === 'formula' && r.data.config?.fractionScale != null && FRACTION_SCALES.includes(r.data.config.fractionScale as FractionScale)) {
              setNumberFormat('fraction')
              setFormulaFractionScale(r.data.config.fractionScale as FractionScale)
            } else {
              setNumberFormat((r.data.config?.numberFormat as 'number' | 'percent' | 'currency') ?? 'number')
              setFormulaFractionScale('')
            }
            setThousandsSeparator(r.data.config?.thousandsSeparator === true)
            setNegativeStyle((r.data.config?.negativeStyle as 'minus' | 'parentheses') ?? 'minus')
            setCurrencySymbol(typeof r.data.config?.currencySymbol === 'string' ? r.data.config.currencySymbol : '')
          }
          setOwnerPlanId(r.data.ownerTestPlanId ?? null)
          if (r.data.ownerTestPlanId) {
            api
              .get<TestPlan>(`/test-plans/${r.data.ownerTestPlanId}`)
              .then((resp) => setOwnerPlanName(resp.data.name))
              .catch(() => setOwnerPlanName(null))
          } else {
            setOwnerPlanName(null)
          }
          setNumberMin(r.data.config?.min != null ? (r.data.config.min as number) : '')
          setNumberMax(r.data.config?.max != null ? (r.data.config.max as number) : '')
          setMinLength(r.data.config?.minLength != null ? (r.data.config.minLength as number) : '')
          setMaxLength(r.data.config?.maxLength != null ? (r.data.config.maxLength as number) : '')
          if (r.data.config?.textDisallowSpaces === true) setTextDisallowSpaces(true)
          setTextUnallowedChars(typeof r.data.config?.textUnallowedChars === 'string' ? r.data.config.textUnallowedChars : '')
          setTextPatternMask(typeof r.data.config?.textPatternMask === 'string' ? r.data.config.textPatternMask : '')
          if (r.data.config?.textCase === 'upper' || r.data.config?.textCase === 'lower') {
            setTextCase(r.data.config.textCase)
          } else {
            setTextCase('none')
          }
          if (r.data.type === 'datetime') {
            const kind = r.data.config?.dateTimeDisplay
            setDateTimeDisplay(
              kind === 'shortDate' || kind === 'longDate' || kind === 'dateTime' || kind === 'longTime' || kind === 'shortTime'
                ? kind
                : 'dateTime'
            )
          }
          setFieldMeta({
            createdAt: r.data.createdAt,
            updatedAt: r.data.updatedAt,
            createdByName: r.data.createdByName,
            updatedByName: r.data.updatedByName,
          })
          const cf = r.data.config?.conditionalFormatting
          if (Array.isArray(cf) && cf.length > 0) {
            setCfRules(
              cf.map((row: unknown) => {
                const o = row as Record<string, unknown>
                const rawMode = o.mode === 'formula' || o.mode === 'standard' || o.mode === 'fallback' ? o.mode : 'standard'
                const legacyFallback = o.appliesToOthers === true && rawMode !== 'fallback'
                return {
                  id: String(o.id ?? `cf-${Math.random().toString(36).slice(2)}`),
                  mode: legacyFallback ? 'fallback' : (rawMode as 'formula' | 'standard' | 'fallback'),
                  formula: typeof o.formula === 'string' ? o.formula : '',
                  standardOp: (o.standardOp as ConditionalFormatRule['standardOp']) ?? 'eq',
                  standardValue: typeof o.standardValue === 'string' ? o.standardValue : '',
                  standardValue2: typeof o.standardValue2 === 'string' ? o.standardValue2 : '',
                  backgroundColor: typeof o.backgroundColor === 'string' ? o.backgroundColor : '',
                  textColor: typeof o.textColor === 'string' ? o.textColor : '',
                  fontBold: o.fontBold === true,
                }
              })
            )
          } else {
            setCfRules([])
          }
        })
        .catch(() => navigate(testingPath('fields')))
    }
  }, [id, isNew, setValue, navigate])

  useEffect(() => {
    if (isNew) setCfRules([])
  }, [isNew])

  useEffect(() => {
    if (cfCfPopover == null) return
    const attr =
      cfCfPopover.kind === 'fill' ? 'data-cf-fill-anchor' : 'data-cf-text-anchor'
    const onDown = (e: MouseEvent) => {
      const el = document.querySelector(`[${attr}="${cfCfPopover.ruleId}"]`)
      if (el?.contains(e.target as Node)) return
      setCfCfPopover(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [cfCfPopover])

  const formatAudit = (date: string | null | undefined, name: string | null | undefined) => {
    if (!date && !name) return null
    const d = date ? formatDateTime(date) : ''
    const n = name ?? ''
    return n && d ? `${n} (${d})` : n || d
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-foreground">
        {isNew ? 'New Field' : 'Edit Field'}
      </h1>
      {!isNew && fieldMeta && (fieldMeta.createdAt || fieldMeta.updatedAt) && (
        <div className="mb-4 rounded-lg border border-border bg-card p-4 text-sm text-foreground/70">
          {fieldMeta.createdAt && (
            <p>Created: {formatAudit(fieldMeta.createdAt, fieldMeta.createdByName)}</p>
          )}
          {fieldMeta.updatedAt && (
            <p>Last edited: {formatAudit(fieldMeta.updatedAt, fieldMeta.updatedByName)}</p>
          )}
        </div>
      )}
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="max-w-md space-y-4 rounded-lg border border-border bg-card p-6"
      >
        <>
          {navState.ownerTestPlanId && (
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                {ownerPlanId && (
                  <span className="inline-flex items-center rounded-full border border-yellow-500 bg-yellow-100 px-2 py-0.5 font-semibold uppercase tracking-wide text-[10px] text-yellow-900 dark:border-yellow-400 dark:bg-yellow-500/30 dark:text-yellow-50">
                    Plan-specific
                  </span>
                )}
                <span className="text-foreground/70">
                  {ownerPlanId ? (
                    <>
                      Owner plan:{' '}
                      <span className="font-medium">{ownerPlanName ?? ownerPlanId}</span>
                    </>
                  ) : (
                    <span className="font-medium text-foreground/80">Global field</span>
                  )}
                </span>
              </div>
              <button
                type="button"
                onClick={() =>
                  setOwnerPlanId((prev) =>
                    prev ? null : navState.ownerTestPlanId ?? null
                  )
                }
                className="shrink-0 rounded border border-yellow-600 bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-900 hover:bg-yellow-200 dark:border-yellow-400 dark:bg-yellow-700/60 dark:text-yellow-50 dark:hover:bg-yellow-600/70"
                title={
                  ownerPlanId
                    ? 'Convert this field to global so it can be reused in other test plans.'
                    : 'Limit this field to this test plan only.'
                }
              >
                {ownerPlanId ? 'Make global' : 'Limit to this plan'}
              </button>
            </div>
          )}
          {isNew ? (
            <>
              <div>
                <label className="block text-sm font-medium text-foreground">Label</label>
                <input
                  {...labelReg}
                  onChange={(e) => {
                    labelReg.onChange(e)
                    if (!newFieldKeyManualRef.current) {
                      setValue('key', suggestFieldKeyFromLabel(e.target.value), {
                        shouldValidate: true,
                        shouldDirty: true,
                      })
                    }
                  }}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                />
                {errors.label && (
                  <p className="mt-1 text-sm text-red-500">{errors.label.message}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground">Key</label>
                <input
                  {...keyReg}
                  onChange={(e) => {
                    newFieldKeyManualRef.current = true
                    keyReg.onChange(e)
                  }}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
                  spellCheck={false}
                  autoCapitalize="off"
                />
                {errors.key && (
                  <p className="mt-1 text-sm text-red-500">{errors.key.message}</p>
                )}
              </div>
            </>
          ) : (
            <>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-sm font-medium text-foreground">Key</label>
                  {!keyEditable && (
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await showConfirm(
                          'Changing the key can affect existing data. Record data will be migrated to the new key when you save. Continue?',
                          { title: 'Change field key', confirmLabel: 'Change key', variant: 'default' }
                        )
                        if (ok) setKeyEditable(true)
                      }}
                      className="shrink-0 text-sm text-foreground/80 hover:text-foreground hover:underline"
                    >
                      Change key
                    </button>
                  )}
                </div>
                <input
                  {...keyReg}
                  disabled={!keyEditable}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground disabled:opacity-60 disabled:cursor-not-allowed"
                />
                {errors.key && (
                  <p className="mt-1 text-sm text-red-500">{errors.key.message}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground">Label</label>
                <input {...labelReg} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground" />
                {errors.label && (
                  <p className="mt-1 text-sm text-red-500">{errors.label.message}</p>
                )}
              </div>
            </>
          )}
        </>
        <Controller
          name="type"
          control={control}
          render={({ field }) => (
            <PopupSelect
              label="Type"
              value={field.value}
              onChange={field.onChange}
              options={[...TYPES].sort((a, b) => TYPE_LABELS[a].localeCompare(TYPE_LABELS[b])).map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
            />
          )}
        />
        {fieldType === 'number' && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground">Minimum</label>
                <p className="mt-1 mb-1 text-xs text-foreground/60">Optional</p>
                <input
                  type="number"
                  value={numberMin === '' ? '' : numberMin}
                  onChange={(e) => setNumberMin(e.target.value === '' ? '' : parseFloat(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                  placeholder="(none)"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground">Maximum</label>
                <p className="mt-1 mb-1 text-xs text-foreground/60">Optional</p>
                <input
                  type="number"
                  value={numberMax === '' ? '' : numberMax}
                  onChange={(e) => setNumberMax(e.target.value === '' ? '' : parseFloat(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                  placeholder="(none)"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground">Integer digits (max)</label>
                <p className="mt-1 mb-1 text-xs text-foreground/60">Optional</p>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={integerDigits === '' ? '' : integerDigits}
                  onChange={(e) => setIntegerDigits(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground">Decimal places</label>
                <p className="mt-1 mb-1 text-xs text-foreground/60">Optional. Used for rounding (see below).</p>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={decimalPlaces === '' ? '' : decimalPlaces}
                  onChange={(e) => setDecimalPlaces(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                />
                {decimalPlaces !== '' && (
                  <div className="mt-2 space-y-1">
                    <label className="block text-xs font-medium text-foreground/80">Rounding</label>
                    <label
                      className="flex cursor-pointer items-center gap-2"
                      title="Tables & read-only use this precision; entry keeps full precision"
                    >
                      <input
                        type="radio"
                        name="decimalPlacesModeNum"
                        checked={decimalPlacesMode === 'display'}
                        onChange={() => setDecimalPlacesMode('display')}
                        className="h-4 w-4"
                      />
                      <span className="text-sm text-foreground">
                        Display only
                      </span>
                    </label>
                    <label
                      className="flex cursor-pointer items-center gap-2"
                      title="Round on entry; stored value matches decimal places"
                    >
                      <input
                        type="radio"
                        name="decimalPlacesModeNum"
                        checked={decimalPlacesMode === 'enforce'}
                        onChange={() => setDecimalPlacesMode('enforce')}
                        className="h-4 w-4"
                      />
                      <span className="text-sm text-foreground">
                        Enforce
                      </span>
                    </label>
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground">Format</label>
                <p className="mt-1 mb-1 text-xs text-foreground/60">Excel-style</p>
                <PopupSelect
                  label=""
                  value={numberFormat}
                  onChange={(v) => setNumberFormat(v as 'number' | 'percent' | 'currency')}
                  options={[
                    { value: 'number', label: 'Number' },
                    { value: 'percent', label: 'Percent' },
                    { value: 'currency', label: 'Currency' },
                  ]}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground">Negative numbers</label>
                <p className="mt-1 mb-1 text-xs text-foreground/60">Display style</p>
                <PopupSelect
                  label=""
                  value={negativeStyle}
                  onChange={(v) => setNegativeStyle(v as 'minus' | 'parentheses')}
                  options={[
                    { value: 'minus', label: '-1234' },
                    { value: 'parentheses', label: '(1234)' },
                  ]}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={thousandsSeparator}
                  onChange={(e) => setThousandsSeparator(e.target.checked)}
                />
                <span className="text-sm text-foreground">Use thousands separator (1,234.56)</span>
              </label>
            </div>
            {numberFormat === 'currency' && (
              <div>
                <label className="block text-sm font-medium text-foreground">Currency symbol</label>
                <p className="mt-1 mb-1 text-xs text-foreground/60">Optional</p>
                <input
                  type="text"
                  value={currencySymbol}
                  onChange={(e) => setCurrencySymbol(e.target.value)}
                  className="mt-1 w-full max-w-[120px] rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                  placeholder="$"
                />
              </div>
            )}
          </>
        )}
        {fieldType === 'datetime' && (
          <div>
            <label className="block text-sm font-medium text-foreground">Display as</label>
            <p className="mt-1 mb-1 text-xs text-foreground/60">
              How this date/time field is shown in tables and cards. Date and time uses the format from Administration → Settings.
            </p>
            <PopupSelect
              label=""
              value={dateTimeDisplay}
              onChange={(v) => setDateTimeDisplay(v as DateTimeDisplayKind)}
              options={DATE_TIME_DISPLAY_OPTIONS.map((o) => ({
                value: o.value,
                label: `${o.label} (e.g. ${getExampleForDateTimeDisplay(o.value)})`,
              }))}
            />
          </div>
        )}
        {fieldType === 'fraction' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground">Storage unit</label>
              <p className="mt-1 mb-1 text-xs text-foreground/60">
                Unit used for display and export. Values are saved in this unit.
              </p>
              <PopupSelect
                label=""
                value={fractionUnit}
                onChange={(v) => setFractionUnit((v as 'in' | 'mm') || 'in')}
                options={[
                  { value: 'in', label: 'Inches (in)' },
                  { value: 'mm', label: 'Millimetres (mm)' },
                ]}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground">Entry unit</label>
              <p className="mt-1 mb-1 text-xs text-foreground/60">
                Default unit when opening the keypad. Display and export use the storage unit above.
              </p>
              <PopupSelect
                label=""
                value={fractionEntryUnit}
                onChange={(v) => setFractionEntryUnit((v as 'in' | 'mm') || 'in')}
                options={[
                  { value: 'in', label: 'Inches (in)' },
                  { value: 'mm', label: 'Millimetres (mm)' },
                ]}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground">Fraction scale</label>
              <p className="mt-1 mb-1 text-xs text-foreground/60">
                Denominator for inch fractions (128ths finest, halves coarsest).
              </p>
              <PopupSelect
                label=""
                value={String(fractionScale)}
                onChange={(v) => setFractionScale(Number(v) as FractionScale)}
                options={FRACTION_SCALES.map((s) => ({
                  value: String(s),
                  label: s === 2 ? 'Halves (½)' : `${s}ths (1/${s})`,
                }))}
              />
            </div>
          </div>
        )}
        {fieldType === 'weight' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground">Storage unit</label>
              <p className="mt-1 mb-1 text-xs text-foreground/60">
                Unit used for display and export. Values are saved in this unit.
              </p>
              <PopupSelect
                label=""
                value={weightUnit}
                onChange={(v) => setWeightUnit((v as 'kg' | 'g' | 'lb' | 'oz') || 'kg')}
                options={[
                  { value: 'kg', label: 'Kilograms (kg)' },
                  { value: 'g', label: 'Grams (g)' },
                  { value: 'lb', label: 'Pounds (lb)' },
                  { value: 'oz', label: 'Ounces (oz)' },
                ]}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground">Entry unit</label>
              <p className="mt-1 mb-1 text-xs text-foreground/60">
                Default unit when opening the weight input. Display and export use the storage unit above.
              </p>
              <PopupSelect
                label=""
                value={weightEntryUnit}
                onChange={(v) => setWeightEntryUnit((v as 'kg' | 'g' | 'lb' | 'oz') || 'kg')}
                options={[
                  { value: 'kg', label: 'Kilograms (kg)' },
                  { value: 'g', label: 'Grams (g)' },
                  { value: 'lb', label: 'Pounds (lb)' },
                  { value: 'oz', label: 'Ounces (oz)' },
                ]}
              />
            </div>
          </div>
        )}
        {(fieldType === 'text' || fieldType === 'longtext') && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground">Min character length</label>
                <p className="mt-1 mb-1 text-xs text-foreground/60">Optional</p>
                <input
                  type="number"
                  min={0}
                  value={minLength === '' ? '' : minLength}
                  onChange={(e) => setMinLength(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                  placeholder="(none)"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground">Max character length</label>
                <p className="mt-1 mb-1 text-xs text-foreground/60">Optional</p>
                <input
                  type="number"
                  min={1}
                  value={maxLength === '' ? '' : maxLength}
                  onChange={(e) => setMaxLength(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                  placeholder="(none)"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground">Letter case</label>
              <p className="mt-1 mb-1 text-xs text-foreground/60">Optional; convert letters as the user types.</p>
              <select
                value={textCase}
                onChange={(e) =>
                  setTextCase(
                    e.target.value === 'upper' || e.target.value === 'lower' ? e.target.value : 'none'
                  )
                }
                className="mt-1 w-full max-w-xs rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              >
                <option value="none">None</option>
                <option value="upper">UPPERCASE</option>
                <option value="lower">lowercase</option>
              </select>
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={textDisallowSpaces}
                onChange={(e) => setTextDisallowSpaces(e.target.checked)}
              />
              <span className="text-sm text-foreground">Disallow spaces</span>
            </label>
            <div>
              <label className="block text-sm font-medium text-foreground">Unallowed characters</label>
              <p className="mt-1 mb-1 text-xs text-foreground/60">List characters that must not appear (e.g. @#$)</p>
              <input
                type="text"
                value={textUnallowedChars}
                onChange={(e) => setTextUnallowedChars(e.target.value)}
                className="mt-1 w-full max-w-xs rounded-lg border border-border bg-background px-3 py-2 text-foreground font-mono"
                placeholder="(none)"
              />
            </div>
            {fieldType === 'text' && (
              <div>
                <label className="block text-sm font-medium text-foreground">Pattern mask</label>
                <p className="mt-1 mb-1 text-xs text-foreground/60">
                  Use @ for letters, # for numbers, * for letters or numbers. Any other character is taken literally.
                </p>
                <input
                  type="text"
                  value={textPatternMask}
                  onChange={(e) => setTextPatternMask(e.target.value)}
                  className="mt-1 w-full max-w-md rounded-lg border border-border bg-background px-3 py-2 text-foreground font-mono"
                  placeholder="e.g. 000-000 or +{7}(000)000-00-00"
                />
              </div>
            )}
          </div>
        )}
        {fieldType === 'image' && (
          <div className="space-y-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={imageMultiple}
                onChange={(e) => setImageMultiple(e.target.checked)}
              />
              <span className="text-sm text-foreground">Allow multiple photos</span>
            </label>
            <div>
              <label className="block text-sm font-medium text-foreground">Image tag</label>
              <p className="mt-1 mb-1 text-xs text-foreground/60">Optional label (e.g. Before, Defect photo)</p>
              <input
                type="text"
                value={imageTag}
                onChange={(e) => setImageTag(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                placeholder="(none)"
              />
            </div>
          </div>
        )}
        {fieldType === 'status' && (
          <>
            <div>
              <label className="block text-sm font-medium text-foreground">
                Status options
              </label>
              <p className="mt-1 mb-1 text-xs text-foreground/60">
                Drag to reorder. Add or remove statuses below.
              </p>
              <DraggableOptionList
                items={options}
                onReorder={setOptions}
                renderRow={(opt, i) => (
                  <div className="flex min-w-0 items-center gap-2">
                    <input
                      value={opt}
                      onChange={(e) => updateOption(i, e.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                      placeholder="Status name"
                    />
                    <button
                      type="button"
                      onClick={() => removeOption(i)}
                      className="shrink-0 rounded-lg px-3 text-red-500 hover:bg-red-500/10"
                    >
                      Remove
                    </button>
                  </div>
                )}
                onAdd={addOption}
                addLabel="+ Add status"
                onBulkAdd={(items) => setOptions((prev) => [...prev, ...items.filter((x) => !prev.includes(x))])}
                bulkAddLabel="Bulk add statuses"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground">
                Status colors (optional)
              </label>
              <p className="mt-1 mb-1 text-xs text-foreground/60">
                Set a color for each status to show in the data view.
              </p>
              <div className="mt-2 space-y-2">
                {options.filter(Boolean).map((opt) => (
                  <div key={opt} className="flex items-center gap-3">
                    <input
                      type="color"
                      value={statusColors[opt] ?? '#94a3b8'}
                      onChange={(e) =>
                        setStatusColors((prev) => ({ ...prev, [opt]: e.target.value }))
                      }
                      className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent p-0"
                      title={opt}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{opt}</span>
                    {(statusColors[opt] ?? '').length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setStatusColors((prev) => {
                          const next = { ...prev }
                          delete next[opt]
                          return next
                        })
                      }
                      className="text-xs text-foreground/60 hover:text-foreground"
                    >
                      Clear
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
            <label className="mt-4 flex items-center gap-2">
              <input
                type="checkbox"
                checked={statusUseFormula}
                onChange={(e) => setStatusUseFormula(e.target.checked)}
              />
              <span className="text-sm font-medium text-foreground">Use formula</span>
            </label>
            <p className="mt-1 mb-1 text-xs text-foreground/60">
              When on, status is computed from other fields and cannot be edited per record.
            </p>
            {statusUseFormula && (
            <div className="mt-2">
              <div className="flex items-center gap-2">
                <pre className="min-h-9 flex-1 rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-sm text-foreground whitespace-pre-wrap break-all">
                  {(watch('config') as { formula?: string })?.formula || '(no formula)'}
                </pre>
                <button
                  type="button"
                  onClick={() => {
                    setFormulaDraft((watch('config') as { formula?: string })?.formula ?? '')
                    setFormulaModalContext('status')
                    setCfFormulaEditingRuleId(null)
                    setFormulaModalOpen(true)
                    setFormulaHelpOpen(false)
                    setFormulaTestData({})
                    setFormulaTestResult(undefined)
                    api.get<DataField[]>('/fields').then((r) => {
                      const currentKey = getValues('key')
                      setAvailableFieldsForFormula(r.data.filter((f) => f.key !== currentKey))
                    }).catch(() => setAvailableFieldsForFormula([]))
                  }}
                  className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-background"
                >
                  Edit formula
                </button>
              </div>
            </div>
            )}
        </>
        )}
        {(fieldType === 'formula' || formulaModalOpen) && (
          <div className="space-y-4" style={fieldType !== 'formula' ? { marginBottom: 0, paddingBottom: 0 } : undefined}>
            {fieldType === 'formula' && (
            <div>
              <label className="block text-sm font-medium text-foreground">Formula</label>
              <p className="mt-1 mb-1 text-xs text-foreground/60">
                Value is computed from other fields. Use [fieldKey] to reference a field.
              </p>
              <div className="flex items-center gap-2">
                <pre className="min-h-9 flex-1 rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-sm text-foreground whitespace-pre-wrap break-all">
                  {(watch('config') as { formula?: string })?.formula || '(no formula)'}
                </pre>
                <button
                  type="button"
                  onClick={() => {
                    setFormulaDraft((watch('config') as { formula?: string })?.formula ?? '')
                    setFormulaModalContext('field')
                    setCfFormulaEditingRuleId(null)
                    setFormulaModalOpen(true)
                    setFormulaHelpOpen(false)
                    setFormulaTestData({})
                    setFormulaTestResult(undefined)
                    api.get<DataField[]>('/fields').then((r) => {
                      const currentKey = getValues('key')
                      setAvailableFieldsForFormula(r.data.filter((f) => f.key !== currentKey))
                    }).catch(() => setAvailableFieldsForFormula([]))
                  }}
                  className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-background"
                >
                  Edit formula
                </button>
              </div>
            </div>
            )}
            {fieldType === 'formula' && (
            <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground">Integer digits (max)</label>
                <p className="mt-1 mb-1 text-xs text-foreground/60">Optional display width</p>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={integerDigits === '' ? '' : integerDigits}
                  onChange={(e) => setIntegerDigits(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground">Decimal places</label>
                <p className="mt-1 mb-1 text-xs text-foreground/60">Optional; rounds numeric result for display</p>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={decimalPlaces === '' ? '' : decimalPlaces}
                  onChange={(e) => setDecimalPlaces(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                />
                {decimalPlaces !== '' && (
                  <div className="mt-2 space-y-1">
                    <label className="block text-xs font-medium text-foreground/80">Rounding</label>
                    <label
                      className="flex cursor-pointer items-center gap-2"
                      title="Tables & read-only; result keeps full precision internally"
                    >
                      <input
                        type="radio"
                        name="decimalPlacesModeFormula"
                        checked={decimalPlacesMode === 'display'}
                        onChange={() => setDecimalPlacesMode('display')}
                        className="h-4 w-4"
                      />
                      <span className="text-sm text-foreground">
                        Display only
                      </span>
                    </label>
                    <label
                      className="flex cursor-pointer items-center gap-2"
                      title="Round formula result to this many decimal places"
                    >
                      <input
                        type="radio"
                        name="decimalPlacesModeFormula"
                        checked={decimalPlacesMode === 'enforce'}
                        onChange={() => setDecimalPlacesMode('enforce')}
                        className="h-4 w-4"
                      />
                      <span className="text-sm text-foreground">
                        Enforce
                      </span>
                    </label>
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground">Format</label>
                <p className="mt-1 mb-1 text-xs text-foreground/60">Excel-style or fraction</p>
                <PopupSelect
                  label=""
                  value={numberFormat}
                  onChange={(v) => {
                    const next = v as 'number' | 'percent' | 'currency' | 'fraction'
                    setNumberFormat(next)
                    if (next === 'fraction' && formulaFractionScale === '') setFormulaFractionScale(16)
                  }}
                  options={[
                    { value: 'number', label: 'Number' },
                    { value: 'percent', label: 'Percent' },
                    { value: 'currency', label: 'Currency' },
                    { value: 'fraction', label: 'Fraction' },
                  ]}
                />
              </div>
              {numberFormat === 'fraction' ? (
                <div>
                  <label className="block text-sm font-medium text-foreground">Fraction scale</label>
                  <p className="mt-1 mb-1 text-xs text-foreground/60">Round to nearest (e.g. 16ths for inches)</p>
                  <PopupSelect
                    label=""
                    value={String(formulaFractionScale || 16)}
                    onChange={(v) => setFormulaFractionScale(Number(v) as FractionScale)}
                    options={FRACTION_SCALES.map((s) => ({
                      value: String(s),
                      label: s === 2 ? 'Halves (½)' : s === 4 ? '4ths (¼)' : `${s}ths (1/${s})`,
                    }))}
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-foreground">Negative numbers</label>
                  <p className="mt-1 mb-1 text-xs text-foreground/60">Display style</p>
                  <PopupSelect
                    label=""
                    value={negativeStyle}
                    onChange={(v) => setNegativeStyle(v as 'minus' | 'parentheses')}
                    options={[
                      { value: 'minus', label: '-1234' },
                      { value: 'parentheses', label: '(1234)' },
                    ]}
                  />
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={thousandsSeparator}
                  onChange={(e) => setThousandsSeparator(e.target.checked)}
                />
                <span className="text-sm text-foreground">Use thousands separator (1,234.56)</span>
              </label>
            </div>
            {numberFormat === 'currency' && (
              <div>
                <label className="block text-sm font-medium text-foreground">Currency symbol</label>
                <p className="mt-1 mb-1 text-xs text-foreground/60">Optional</p>
                <input
                  type="text"
                  value={currencySymbol}
                  onChange={(e) => setCurrencySymbol(e.target.value)}
                  className="mt-1 w-full max-w-[120px] rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                  placeholder="$"
                />
              </div>
            )}
            </>
            )}
            {formulaModalOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                <div className="flex max-h-[85vh] w-full max-w-4xl rounded-lg border border-border bg-card shadow-lg flex-col overflow-hidden">
                  <div className="flex flex-1 min-h-0">
                    <div className="flex flex-1 flex-col p-4 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <label className="text-sm font-medium text-foreground">Formula</label>
                        <div className="relative" ref={formulaHelpRef}>
                          <button
                            type="button"
                            onClick={() => setFormulaHelpOpen((v) => !v)}
                            className="flex h-5 w-5 items-center justify-center rounded-full border border-border bg-muted/50 text-xs text-foreground/70 hover:bg-muted hover:text-foreground"
                            title="Formula help"
                            aria-label="Formula help"
                          >
                            ?
                          </button>
                          {formulaHelpOpen && (
                            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setFormulaHelpOpen(false)}>
                              <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-card shadow-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                                  <h2 className="text-lg font-semibold text-foreground">Formula reference</h2>
                                  <button type="button" onClick={() => setFormulaHelpOpen(false)} className="rounded p-1 text-foreground/70 hover:bg-muted hover:text-foreground" aria-label="Close">×</button>
                                </div>
                                <div className="flex-1 overflow-auto p-4 text-sm text-foreground/90 space-y-6">
                                  <section>
                                    <h3 className="font-medium text-foreground mb-1">Reference fields</h3>
                                    <p className="mb-2">Use <code className="rounded bg-muted px-1 font-mono text-xs">[fieldKey]</code> to use another field&apos;s value. The key is the field&apos;s key (e.g. <code className="rounded bg-muted px-1 font-mono text-xs">[Length]</code>, <code className="rounded bg-muted px-1 font-mono text-xs">[Width]</code>, <code className="rounded bg-muted px-1 font-mono text-xs">[Status]</code>). Click a field in the list to insert it.</p>
                                    <p className="text-foreground/70">Example: <code className="rounded bg-muted px-1 font-mono text-xs">[Length] * [Width]</code> uses the values of the Length and Width fields.</p>
                                  </section>
                                  <section>
                                    <h3 className="font-medium text-foreground mb-1">Operators</h3>
                                    <table className="w-full text-left border-collapse text-xs">
                                      <thead>
                                        <tr className="border-b border-border">
                                          <th className="py-1.5 pr-2 font-medium text-foreground">Category</th>
                                          <th className="py-1.5 pr-2 font-medium text-foreground">Symbols</th>
                                          <th className="py-1.5 text-foreground/80">Description</th>
                                        </tr>
                                      </thead>
                                      <tbody className="text-foreground/80">
                                        <tr className="border-b border-border/50"><td className="py-1.5 pr-2">Arithmetic</td><td className="py-1.5 pr-2 font-mono">+ − * /</td><td>Add, subtract, multiply, divide (numbers)</td></tr>
                                        <tr className="border-b border-border/50"><td className="py-1.5 pr-2">Text</td><td className="py-1.5 pr-2 font-mono">&amp;</td><td>Concatenate text (e.g. <code className="rounded bg-muted px-0.5 font-mono">[A] &amp; &quot; &quot; &amp; [B]</code>)</td></tr>
                                        <tr className="border-b border-border/50"><td className="py-1.5 pr-2">Compare</td><td className="py-1.5 pr-2 font-mono">= &lt; &gt; &lt;= &gt;= &lt;&gt;</td><td>Equal, less than, greater than, not equal (returns true/false)</td></tr>
                                        <tr><td className="py-1.5 pr-2">Grouping</td><td className="py-1.5 pr-2 font-mono">( )</td><td>Parentheses control order (e.g. <code className="rounded bg-muted px-0.5 font-mono">([A]+[B])*2</code>)</td></tr>
                                      </tbody>
                                    </table>
                                  </section>
                                  <section>
                                    <h3 className="font-medium text-foreground mb-2">Functions</h3>
                                    <ul className="space-y-3">
                                      <li><code className="rounded bg-muted px-1 font-mono text-xs">LET(name1, value1, name2, value2, …, result)</code><br /><span className="text-foreground/70">Define variables for multi-step calculations. Each pair is a name and its value; the last argument is the expression to return. Example: <code className="rounded bg-muted px-0.5 font-mono">LET(d, [A]-[B], ABS(d))</code></span></li>
                                      <li><code className="rounded bg-muted px-1 font-mono text-xs">IF(condition, thenVal, elseVal)</code><br /><span className="text-foreground/70">If condition is true, return thenVal; otherwise return elseVal. Example: <code className="rounded bg-muted px-0.5 font-mono">IF([Score]&gt;=80, &quot;Passed&quot;, &quot;Failed&quot;)</code></span></li>
                                      <li><code className="rounded bg-muted px-1 font-mono text-xs">TEXT(value)</code><br /><span className="text-foreground/70">Convert a value to text.</span></li>
                                      <li><code className="rounded bg-muted px-1 font-mono text-xs">NUMBER(value)</code><br /><span className="text-foreground/70">Convert text or other value to a number (non-numeric becomes 0).</span></li>
                                      <li><code className="rounded bg-muted px-1 font-mono text-xs">ROUND(num, digits)</code><br /><span className="text-foreground/70">Round num to the given number of decimal places. Example: <code className="rounded bg-muted px-0.5 font-mono">ROUND([Value], 2)</code></span></li>
                                      <li><code className="rounded bg-muted px-1 font-mono text-xs">ABS(value)</code><br /><span className="text-foreground/70">Absolute value. Example: <code className="rounded bg-muted px-0.5 font-mono">ABS([A]-[B])</code> for absolute difference.</span></li>
                                      <li><code className="rounded bg-muted px-1 font-mono text-xs">SUM(a, b, …)</code><br /><span className="text-foreground/70">Sum of all arguments (numbers). Example: <code className="rounded bg-muted px-0.5 font-mono">SUM([Q1], [Q2], [Q3])</code></span></li>
                                      <li><code className="rounded bg-muted px-1 font-mono text-xs">CONCAT(a, b, …)</code><br /><span className="text-foreground/70">Concatenate all arguments as text (no separator). Use &amp; for custom separators.</span></li>
                                      <li><code className="rounded bg-muted px-1 font-mono text-xs">LEN(text)</code><br /><span className="text-foreground/70">Number of characters in text.</span></li>
                                      <li><code className="rounded bg-muted px-1 font-mono text-xs">BLANK()</code> / <code className="rounded bg-muted px-1 font-mono text-xs">NULL()</code><br /><span className="text-foreground/70">Return an empty/blank value. <code className="rounded bg-muted px-0.5 font-mono text-[11px]">NULL()</code> is an alias for <code className="rounded bg-muted px-0.5 font-mono text-[11px]">BLANK()</code>. Use the function form — there is no bare <code className="font-mono text-[11px]">null</code> keyword.</span></li>
                                    </ul>
                                  </section>
                                  <section>
                                    <h3 className="font-medium text-foreground mb-1">Examples</h3>
                                    <ul className="list-disc pl-4 space-y-1 text-foreground/80">
                                      <li>Area: <code className="rounded bg-muted px-1 font-mono text-xs">[Length] * [Width]</code></li>
                                      <li>Full name: <code className="rounded bg-muted px-1 font-mono text-xs">[First] &amp; &quot; &quot; &amp; [Last]</code></li>
                                      <li>Pass/Fail: <code className="rounded bg-muted px-1 font-mono text-xs">IF([Score]&gt;=60, &quot;Passed&quot;, &quot;Failed&quot;)</code></li>
                                      <li>Absolute difference: <code className="rounded bg-muted px-1 font-mono text-xs">ABS([Expected]-[Actual])</code></li>
                                      <li>With variables: <code className="rounded bg-muted px-1 font-mono text-xs">LET(area, [L]*[W], perim, 2*[L]+2*[W], area &amp; &quot; / &quot; &amp; perim)</code></li>
                                    </ul>
                                  </section>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      <div
                        className={`relative min-h-[200px] flex-1 flex flex-col rounded-lg border overflow-hidden ${formulaValidationError ? 'border-red-500' : 'border-border'}`}
                      >
                        <div
                          ref={formulaHighlightRef}
                          className="absolute inset-0 overflow-auto px-3 py-2 font-mono text-sm leading-normal whitespace-pre-wrap break-words bg-background"
                          aria-hidden
                        >
                          {formulaHighlightSegments.length > 0 ? (
                            formulaHighlightSegments.map((seg, idx) => {
                              const isError =
                                formulaErrorDraftStart != null &&
                                formulaErrorDraftEnd != null &&
                                seg.end > formulaErrorDraftStart &&
                                seg.start < formulaErrorDraftEnd
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
                                              const pi = formulaParenPairIndices[idx]
                                              return pi !== undefined
                                                ? FORMULA_PAREN_COLORS[pi % FORMULA_PAREN_COLORS.length] + ' font-medium'
                                                : 'text-red-500 font-medium'
                                            })()
                                          : 'text-foreground/90'
                                        : seg.type === 'id'
                                          ? 'text-violet-600 dark:text-violet-400 font-medium'
                                          : seg.type === 'unknown'
                                            ? 'text-red-500'
                                            : seg.type === 'ws'
                                              ? 'text-foreground'
                                              : 'text-foreground'
                              return (
                                <span
                                  key={idx}
                                  className={
                                    isError ? 'bg-red-500/20 rounded px-0.5 border-b-2 border-red-500' : spanClass
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
                          ref={formulaTextareaRef}
                          value={formulaDraft}
                          onChange={(e) => setFormulaDraft(e.target.value)}
                          onScroll={syncFormulaScroll}
                          placeholder="e.g. [Length] * [Width], [A] &quot; &quot; & [B], or LET(d, [A]-[B], ABS(d))"
                          className="absolute inset-0 w-full min-h-full resize-none overflow-auto px-3 py-2 font-mono text-sm leading-normal whitespace-pre-wrap break-words bg-transparent text-transparent caret-foreground selection:bg-primary/20 placeholder:text-foreground/50 focus:outline-none"
                          style={{ WebkitTextFillColor: 'transparent' }}
                          spellCheck={false}
                        />
                      </div>
                      {formulaValidationError && (
                        <p className="mt-1.5 text-sm text-red-500" role="alert">
                          {formulaValidationError}
                        </p>
                      )}
                      <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3">
                        <p className="mb-2 text-sm font-medium text-foreground">Test with sample data</p>
                        {formulaReferencedKeys.length === 0 ? (
                          <p className="text-xs text-foreground/60">
                            Reference fields in the formula (e.g. [fieldKey]) to enter test values and evaluate.
                          </p>
                        ) : (
                          <>
                            <div className="space-y-2">
                              {formulaReferencedKeys.map((key) => {
                                const field = availableFieldsForFormula.find((f) => f.key === key)
                                const label = field?.label || key
                                return (
                                  <div key={key} className="flex items-center gap-2">
                                    <label className="w-32 shrink-0 truncate text-xs text-foreground/80" title={key}>
                                      {label}:
                                    </label>
                                    <input
                                      type="text"
                                      value={formulaTestData[key] ?? ''}
                                      onChange={(e) =>
                                        setFormulaTestData((prev) => ({ ...prev, [key]: e.target.value }))
                                      }
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
                                  for (const key of formulaReferencedKeys) {
                                    const raw = formulaTestData[key] ?? ''
                                    const field = availableFieldsForFormula.find((f) => f.key === key)
                                    if (field?.type === 'number') {
                                      const n = Number(raw)
                                      data[key] = raw === '' ? '' : Number.isFinite(n) ? n : 0
                                    } else {
                                      data[key] = raw
                                    }
                                  }
                                  try {
                                    const result = evaluateFormula(formulaDraft, data)
                                    setFormulaTestResult(result)
                                  } catch {
                                    setFormulaTestResult(undefined)
                                  }
                                }}
                                className="rounded border border-border bg-background px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                              >
                                Evaluate
                              </button>
                              {formulaTestResult !== undefined && (
                                <span className="text-sm text-foreground/80">
                                  Result:{' '}
                                  <strong className="font-mono text-foreground">
                                    {formulaTestResult === null || formulaTestResult === ''
                                      ? '(blank)'
                                      : String(formulaTestResult)}
                                  </strong>
                                </span>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="w-56 shrink-0 border-l border-border flex flex-col bg-muted/20">
                      <p className="p-2 text-sm font-medium text-foreground border-b border-border">Insert field</p>
                      <ul className="flex-1 overflow-auto p-2 space-y-1">
                        {availableFieldsForFormula.length === 0 ? (
                          <li className="text-xs text-foreground/60">No other fields. Use [fieldKey] in the formula.</li>
                        ) : (
                          availableFieldsForFormula.map((f) => (
                            <li key={f.id}>
                              <button
                                type="button"
                                onClick={() => {
                                  const ref = `[${f.key}]`
                                  const ta = formulaTextareaRef.current
                                  if (ta) {
                                    const start = ta.selectionStart
                                    const end = ta.selectionEnd
                                    const before = formulaDraft.slice(0, start)
                                    const after = formulaDraft.slice(end)
                                    setFormulaDraft(before + ref + after)
                                    setTimeout(() => {
                                      ta.focus()
                                      ta.setSelectionRange(before.length + ref.length, before.length + ref.length)
                                    }, 0)
                                  } else {
                                    setFormulaDraft((prev) => prev + ref)
                                  }
                                }}
                                className="w-full text-left rounded px-2 py-1.5 text-sm text-foreground hover:bg-background"
                              >
                                {f.label || f.key}
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 p-4 border-t border-border">
                    <button
                      type="button"
                      onClick={() => {
                        setFormulaHelpOpen(false)
                        setFormulaTestData({})
                        setFormulaTestResult(undefined)
                        setFormulaModalOpen(false)
                        setFormulaModalContext(null)
                        setCfFormulaEditingRuleId(null)
                      }}
                      className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFormulaHelpOpen(false)
                        setFormulaTestData({})
                        setFormulaTestResult(undefined)
                        if (formulaModalContext === 'conditionalFormatting' && cfFormulaEditingRuleId) {
                          setCfRules((prev) => prev.map((r) => (r.id === cfFormulaEditingRuleId ? { ...r, formula: formulaDraft } : r)))
                        } else {
                          setValue('config', { ...getValues('config'), formula: formulaDraft })
                        }
                        setFormulaModalOpen(false)
                        setFormulaModalContext(null)
                        setCfFormulaEditingRuleId(null)
                      }}
                      className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
                      disabled={!!formulaValidationError}
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        {(fieldType === 'select' || fieldType === 'radio_select' || fieldType === 'checkbox_select') && (
          <div className="space-y-4">
            {fieldType === 'radio_select' && (
              <>
                <div className="space-y-2">
                  <PopupSelect
                    label="Options per line"
                    value={radioLayoutPreset}
                    onChange={(v) => setRadioLayoutPreset(v)}
                    options={[
                      { value: '1', label: 'One per line' },
                      { value: '2', label: 'Two per line' },
                      { value: '3', label: 'Three per line' },
                      { value: '4', label: 'Four per line' },
                      { value: 'auto', label: 'Auto (wrap as needed)' },
                      { value: 'custom', label: 'Custom…' },
                    ]}
                  />
                  {radioLayoutPreset === 'custom' && (
                    <div>
                      <label className="block text-xs font-medium text-foreground/70">Custom amount per line</label>
                      <input
                        type="number"
                        min={1}
                        max={24}
                        value={radioLayoutCustom}
                        onChange={(e) => {
                          const n = e.target.value === '' ? 1 : parseInt(e.target.value, 10)
                          setRadioLayoutCustom(Number.isFinite(n) && n >= 1 ? Math.min(24, Math.max(1, n)) : 1)
                        }}
                        className="mt-1 w-24 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
                      />
                    </div>
                  )}
                </div>
                {options.some((o) => o != null && String(o).trim() !== '') && (
                  <div className="rounded-lg border border-border bg-card p-3">
                    <p className="mb-2 text-xs font-medium text-foreground/70">Preview</p>
                    <RadioInput
                      value=""
                      onChange={() => {}}
                      options={options.map((o) => (o == null ? '' : String(o)))}
                      layout={
                        radioLayoutPreset === 'custom'
                          ? radioLayoutCustom
                          : radioLayoutPreset === 'auto'
                            ? 'auto'
                            : Number(radioLayoutPreset)
                      }
                      name="field-editor-radio-preview"
                      className="w-full"
                    />
                  </div>
                )}
              </>
            )}
            {fieldType === 'checkbox_select' && (
              <>
                <div className="space-y-2">
                  <PopupSelect
                    label="Options per line"
                    value={checkboxLayoutPreset}
                    onChange={(v) => setCheckboxLayoutPreset(v)}
                    options={[
                      { value: '1', label: 'One per line' },
                      { value: '2', label: 'Two per line' },
                      { value: '3', label: 'Three per line' },
                      { value: '4', label: 'Four per line' },
                      { value: 'auto', label: 'Auto (wrap as needed)' },
                      { value: 'custom', label: 'Custom…' },
                    ]}
                  />
                  {checkboxLayoutPreset === 'custom' && (
                    <div>
                      <label className="block text-xs font-medium text-foreground/70">Custom amount per line</label>
                      <input
                        type="number"
                        min={1}
                        max={24}
                        value={checkboxLayoutCustom}
                        onChange={(e) => {
                          const n = e.target.value === '' ? 1 : parseInt(e.target.value, 10)
                          setCheckboxLayoutCustom(Number.isFinite(n) && n >= 1 ? Math.min(24, Math.max(1, n)) : 1)
                        }}
                        className="mt-1 w-24 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
                      />
                    </div>
                  )}
                </div>
                {options.some((o) => o != null && String(o).trim() !== '') && (
                  <div className="rounded-lg border border-border bg-card p-3">
                    <p className="mb-2 text-xs font-medium text-foreground/70">Preview</p>
                    <CheckboxGroupInput
                      value={[]}
                      onChange={() => {}}
                      options={options.map((o) => (o == null ? '' : String(o)))}
                      layout={
                        checkboxLayoutPreset === 'custom'
                          ? checkboxLayoutCustom
                          : checkboxLayoutPreset === 'auto'
                            ? 'auto'
                            : Number(checkboxLayoutPreset)
                      }
                      name="field-editor-checkbox-preview"
                      className="w-full"
                    />
                  </div>
                )}
              </>
            )}
            <div>
              <label className="block text-sm font-medium text-foreground">
                Options (drag to reorder)
              </label>
              <p className="mt-1 mb-2 text-xs text-foreground/60">
                Drag to reorder. Add or remove options below.
              </p>
              <DraggableOptionList
                items={options}
                onReorder={setOptions}
                renderRow={(opt, i) => (
                  <div className="flex min-w-0 items-center gap-2">
                    <input
                      value={opt}
                      onChange={(e) => updateOption(i, e.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                    />
                    <button
                      type="button"
                      onClick={() => removeOption(i)}
                      className="shrink-0 rounded-lg px-3 text-red-500 hover:bg-red-500/10"
                    >
                      Remove
                    </button>
                  </div>
                )}
                onAdd={addOption}
                addLabel="+ Add option"
                onBulkAdd={(items) => setOptions((prev) => [...prev, ...items.filter((x) => !prev.includes(x))])}
                bulkAddLabel="Bulk add options"
              />
            </div>
          </div>
        )}
        <div className="max-w-2xl space-y-3 rounded-lg border border-border bg-background/50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">Conditional formatting (data table)</h3>
            <button
              type="button"
              onClick={() => setCfHelpOpen(true)}
              className="rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-medium text-foreground hover:bg-card"
              title="How conditional formatting works"
            >
              How it works
            </button>
          </div>
          {cfHelpOpen && (
            <div
              className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
              onClick={() => setCfHelpOpen(false)}
            >
              <div
                className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-4 flex items-start justify-between gap-2">
                  <h4 className="text-base font-semibold text-foreground">Conditional formatting</h4>
                  <button
                    type="button"
                    onClick={() => setCfHelpOpen(false)}
                    className="shrink-0 rounded-lg px-2 py-1 text-sm text-foreground/70 hover:bg-background"
                  >
                    Close
                  </button>
                </div>
                <div className="space-y-3 text-sm text-foreground/80">
                  <p>
                    Excel-style rules: the <strong>first</strong> matching rule wins. Click the <strong>background
                    swatch</strong> for fill (<strong>No fill</strong> first in quick picks) or the <strong>text swatch</strong>{' '}
                    (<strong>Aa</strong> = default text; first quick pick). Swatch colors are set under{' '}
                    <strong>Administration → Settings → Conditional formatting</strong>. Optional <strong>Bold</strong>. Put the most specific
                    rule first; use <strong>Move up</strong> to reorder.
                  </p>
                  <p>
                    <strong>Formula</strong> uses the same syntax as computed fields — e.g.{' '}
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">[Status] = &quot;Fail&quot;</code>,{' '}
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">[Score] &gt; 80</code>. You can reference any
                    column in the row. Nested <code className="rounded bg-muted px-1 text-xs">IF</code> works for multiple
                    conditions.
                  </p>
                  <p>
                    <strong>Cell value</strong> compares only <em>this</em> field&apos;s value (numbers or text), using the
                    condition you pick (equals, contains, between, blank, etc.).
                  </p>
                </div>
                <div className="mt-5 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setCfHelpOpen(false)}
                    className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
                  >
                    Got it
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="space-y-3">
            {cfRules.map((rule, idx) => {
              const effectiveStandardOp: ConditionalFormatRule['standardOp'] =
                rule.mode === 'standard'
                  ? rule.standardOp &&
                    cfStandardOpChoices.some((c) => c.value === rule.standardOp)
                    ? rule.standardOp
                    : 'eq'
                  : 'eq'
              return (
              <div
                key={rule.id}
                className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-foreground/60">Rule {idx + 1}</span>
                  <select
                    value={rule.mode}
                    onChange={(e) => {
                      const mode = e.target.value as 'formula' | 'standard' | 'fallback'
                      setCfRules((prev) =>
                        prev.map((r, i) =>
                          i === idx
                            ? {
                                ...r,
                                mode,
                                // fallback has no condition: clear any existing condition inputs
                                formula: mode === 'formula' ? (r.formula ?? '') : '',
                                standardOp: mode === 'standard' ? (r.standardOp ?? 'eq') : undefined,
                                standardValue: mode === 'standard' ? (r.standardValue ?? '') : undefined,
                                standardValue2: mode === 'standard' ? (r.standardValue2 ?? '') : undefined,
                                appliesToOthers: mode === 'fallback' ? true : undefined,
                              }
                            : r
                        )
                      )
                    }}
                    className="rounded border border-border bg-background px-2 py-1 text-foreground"
                  >
                    <option value="standard">Cell value</option>
                    <option value="formula">Formula</option>
                    {idx >= 1 && <option value="fallback">Else (all other rows)</option>}
                  </select>
                  <button
                    type="button"
                    className="text-red-500 text-xs hover:underline"
                    onClick={() => setCfRules((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    Remove
                  </button>
                  {idx > 0 && (
                    <button
                      type="button"
                      className="text-xs text-foreground/70 hover:underline"
                      onClick={() =>
                        setCfRules((prev) => {
                          const n = [...prev]
                          ;[n[idx - 1], n[idx]] = [n[idx], n[idx - 1]]
                          return n
                        })
                      }
                    >
                      Move up
                    </button>
                  )}
                </div>
                {rule.mode === 'formula' ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <pre className="min-h-9 flex-1 rounded-lg border border-border bg-muted/30 px-3 py-1 font-mono text-xs text-foreground whitespace-pre-wrap break-all">
                      {(rule.formula ?? '').trim().length > 0 ? rule.formula : '(no formula)'}
                    </pre>
                    <button
                      type="button"
                      onClick={() => {
                        setFormulaModalContext('conditionalFormatting')
                        setCfFormulaEditingRuleId(rule.id)
                        setFormulaDraft(rule.formula ?? '')
                        setFormulaHelpOpen(false)
                        setFormulaTestData({})
                        setFormulaTestResult(undefined)
                        setFormulaModalOpen(true)
                        api.get<DataField[]>('/fields').then((r) => setAvailableFieldsForFormula(r.data)).catch(() => setAvailableFieldsForFormula([]))
                      }}
                      className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-background"
                    >
                      Edit formula
                    </button>
                  </div>
                ) : rule.mode === 'standard' ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={effectiveStandardOp}
                        onChange={(e) =>
                          setCfRules((prev) =>
                            prev.map((r, i) =>
                              i === idx ? { ...r, standardOp: e.target.value as ConditionalFormatRule['standardOp'] } : r
                            )
                          )
                        }
                        className="rounded border border-border bg-background px-2 py-1 text-foreground"
                      >
                        {cfStandardOpChoices.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                      {effectiveStandardOp !== 'blank' &&
                        effectiveStandardOp !== 'not_blank' &&
                        effectiveStandardOp !== 'between' &&
                        (cfDatetimeValueKind === 'date' ? (
                          <input
                            type="date"
                            value={isoToDateInputValue(rule.standardValue ?? '')}
                            onChange={(e) => {
                              const iso = dateInputValueToIso(e.target.value)
                              setCfRules((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, standardValue: iso } : r))
                              )
                            }}
                            className="min-w-[9rem] flex-1 rounded border border-border bg-background px-2 py-1 text-foreground"
                          />
                        ) : cfDatetimeValueKind === 'timeShort' ? (
                          <input
                            type="time"
                            step={60}
                            value={isoToTimeInputValue(rule.standardValue ?? '', false)}
                            onChange={(e) => {
                              const iso = timeInputValueToIso(e.target.value, false)
                              setCfRules((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, standardValue: iso } : r))
                              )
                            }}
                            className="min-w-[7rem] flex-1 rounded border border-border bg-background px-2 py-1 text-foreground"
                          />
                        ) : cfDatetimeValueKind === 'timeLong' ? (
                          <input
                            type="time"
                            step={1}
                            value={isoToTimeInputValue(rule.standardValue ?? '', true)}
                            onChange={(e) => {
                              const iso = timeInputValueToIso(e.target.value, true)
                              setCfRules((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, standardValue: iso } : r))
                              )
                            }}
                            className="min-w-[8rem] flex-1 rounded border border-border bg-background px-2 py-1 text-foreground"
                          />
                        ) : cfDatetimeValueKind === 'dateTimeLocal' ? (
                          <input
                            type="datetime-local"
                            value={isoToDateTimeLocalValue(rule.standardValue ?? '')}
                            onChange={(e) => {
                              const iso = dateTimeLocalValueToIso(e.target.value)
                              setCfRules((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, standardValue: iso } : r))
                              )
                            }}
                            className="min-w-[12rem] flex-1 rounded border border-border bg-background px-2 py-1 text-foreground"
                          />
                        ) : (
                          <input
                            type="text"
                            value={rule.standardValue ?? ''}
                            onChange={(e) =>
                              setCfRules((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, standardValue: e.target.value } : r))
                              )
                            }
                            className="min-w-[8rem] flex-1 rounded border border-border bg-background px-2 py-1 text-foreground"
                            placeholder={cfValuePh}
                          />
                        ))}
                      {effectiveStandardOp === 'between' &&
                        (cfDatetimeValueKind === 'date' ? (
                          <>
                            <input
                              type="date"
                              value={isoToDateInputValue(rule.standardValue ?? '')}
                              onChange={(e) => {
                                const iso = dateInputValueToIso(e.target.value)
                                setCfRules((prev) =>
                                  prev.map((r, i) => (i === idx ? { ...r, standardValue: iso } : r))
                                )
                              }}
                              className="min-w-[9rem] rounded border border-border bg-background px-2 py-1 text-foreground"
                              title="Start date"
                            />
                            <span>–</span>
                            <input
                              type="date"
                              value={isoToDateInputValue(rule.standardValue2 ?? '')}
                              onChange={(e) => {
                                const iso = dateInputValueToIso(e.target.value)
                                setCfRules((prev) =>
                                  prev.map((r, i) => (i === idx ? { ...r, standardValue2: iso } : r))
                                )
                              }}
                              className="min-w-[9rem] rounded border border-border bg-background px-2 py-1 text-foreground"
                              title="End date"
                            />
                          </>
                        ) : cfDatetimeValueKind === 'timeShort' ? (
                          <>
                            <input
                              type="time"
                              step={60}
                              value={isoToTimeInputValue(rule.standardValue ?? '', false)}
                              onChange={(e) => {
                                const iso = timeInputValueToIso(e.target.value, false)
                                setCfRules((prev) =>
                                  prev.map((r, i) => (i === idx ? { ...r, standardValue: iso } : r))
                                )
                              }}
                              className="min-w-[7rem] rounded border border-border bg-background px-2 py-1 text-foreground"
                              title="Start time"
                            />
                            <span>–</span>
                            <input
                              type="time"
                              step={60}
                              value={isoToTimeInputValue(rule.standardValue2 ?? '', false)}
                              onChange={(e) => {
                                const iso = timeInputValueToIso(e.target.value, false)
                                setCfRules((prev) =>
                                  prev.map((r, i) => (i === idx ? { ...r, standardValue2: iso } : r))
                                )
                              }}
                              className="min-w-[7rem] rounded border border-border bg-background px-2 py-1 text-foreground"
                              title="End time"
                            />
                          </>
                        ) : cfDatetimeValueKind === 'timeLong' ? (
                          <>
                            <input
                              type="time"
                              step={1}
                              value={isoToTimeInputValue(rule.standardValue ?? '', true)}
                              onChange={(e) => {
                                const iso = timeInputValueToIso(e.target.value, true)
                                setCfRules((prev) =>
                                  prev.map((r, i) => (i === idx ? { ...r, standardValue: iso } : r))
                                )
                              }}
                              className="min-w-[8rem] rounded border border-border bg-background px-2 py-1 text-foreground"
                              title="Start time"
                            />
                            <span>–</span>
                            <input
                              type="time"
                              step={1}
                              value={isoToTimeInputValue(rule.standardValue2 ?? '', true)}
                              onChange={(e) => {
                                const iso = timeInputValueToIso(e.target.value, true)
                                setCfRules((prev) =>
                                  prev.map((r, i) => (i === idx ? { ...r, standardValue2: iso } : r))
                                )
                              }}
                              className="min-w-[8rem] rounded border border-border bg-background px-2 py-1 text-foreground"
                              title="End time"
                            />
                          </>
                        ) : cfDatetimeValueKind === 'dateTimeLocal' ? (
                          <>
                            <input
                              type="datetime-local"
                              value={isoToDateTimeLocalValue(rule.standardValue ?? '')}
                              onChange={(e) => {
                                const iso = dateTimeLocalValueToIso(e.target.value)
                                setCfRules((prev) =>
                                  prev.map((r, i) => (i === idx ? { ...r, standardValue: iso } : r))
                                )
                              }}
                              className="min-w-[12rem] rounded border border-border bg-background px-2 py-1 text-foreground"
                              title="Start"
                            />
                            <span>–</span>
                            <input
                              type="datetime-local"
                              value={isoToDateTimeLocalValue(rule.standardValue2 ?? '')}
                              onChange={(e) => {
                                const iso = dateTimeLocalValueToIso(e.target.value)
                                setCfRules((prev) =>
                                  prev.map((r, i) => (i === idx ? { ...r, standardValue2: iso } : r))
                                )
                              }}
                              className="min-w-[12rem] rounded border border-border bg-background px-2 py-1 text-foreground"
                              title="End"
                            />
                          </>
                        ) : (
                          <>
                            <input
                              type="text"
                              value={rule.standardValue ?? ''}
                              onChange={(e) =>
                                setCfRules((prev) =>
                                  prev.map((r, i) => (i === idx ? { ...r, standardValue: e.target.value } : r))
                                )
                              }
                              className="w-20 rounded border border-border bg-background px-2 py-1 text-foreground"
                              placeholder="Min"
                              title={fieldType === 'datetime' ? cfValuePh : undefined}
                            />
                            <span>–</span>
                            <input
                              type="text"
                              value={rule.standardValue2 ?? ''}
                              onChange={(e) =>
                                setCfRules((prev) =>
                                  prev.map((r, i) => (i === idx ? { ...r, standardValue2: e.target.value } : r))
                                )
                              }
                              className="w-20 rounded border border-border bg-background px-2 py-1 text-foreground"
                              placeholder="Max"
                              title={fieldType === 'datetime' ? cfValuePh : undefined}
                            />
                          </>
                        ))}
                    </div>
                    {fieldType === 'datetime' && (
                      <p className="mt-1 w-full text-xs text-foreground/60">
                        {cfDatetimeValueKind === 'date'
                          ? 'Dates are saved at local midnight as ISO 8601 so they match how date-only fields store values.'
                          : cfDatetimeValueKind === 'timeShort' || cfDatetimeValueKind === 'timeLong'
                            ? 'Times are stored as an ISO instant on 1970-01-01 local (same as time-only fields in forms).'
                            : 'Date and time use your local values and are stored as ISO 8601, matching the data entry control.'}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-foreground/70">
                    This rule has no condition. When selected as{' '}
                    <span className="font-semibold">Else (all other rows)</span>, its formatting is applied to any
                    rows that do not match an earlier rule.
                  </p>
                )}
                <div className="flex flex-col gap-3 border-t border-border pt-2 sm:flex-row sm:flex-wrap sm:items-end">
                  <div className="flex min-w-[10rem] flex-col gap-1">
                    <span className="text-xs font-medium text-foreground/80">Background</span>
                    <div className="relative inline-block" data-cf-fill-anchor={rule.id}>
                      <button
                        type="button"
                        aria-expanded={
                          cfCfPopover?.ruleId === rule.id && cfCfPopover.kind === 'fill'
                        }
                        aria-haspopup="dialog"
                        aria-label="Choose fill color"
                        onClick={() =>
                          setCfCfPopover((p) =>
                            p?.ruleId === rule.id && p.kind === 'fill'
                              ? null
                              : { ruleId: rule.id, kind: 'fill' }
                          )
                        }
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border-2 border-border bg-background shadow-sm transition hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        {rule.backgroundColor?.trim() ? (
                          <span
                            className="block h-8 w-8 rounded-md border border-black/10 shadow-inner"
                            style={{ backgroundColor: rule.backgroundColor.trim() }}
                          />
                        ) : (
                          <span
                            className="flex h-8 w-8 flex-col items-center justify-center rounded-md border border-dashed border-foreground/30 text-[8px] font-medium leading-tight text-foreground/45 dark:border-foreground/40"
                            style={{
                              background:
                                'repeating-conic-gradient(#a1a1aa 0% 25%, #e4e4e7 0% 50%) 50% / 8px 8px',
                            }}
                            title="No fill"
                          >
                            ∅
                          </span>
                        )}
                      </button>
                      {cfCfPopover?.ruleId === rule.id && cfCfPopover.kind === 'fill' && (
                        <div
                          className="absolute left-0 top-full z-[80] mt-1 w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-3 shadow-xl"
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-foreground/50">
                            Quick picks
                          </p>
                          <div className="mb-3 flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              title="No fill"
                              onClick={() => {
                                setCfRules((prev) =>
                                  prev.map((r, i) => (i === idx ? { ...r, backgroundColor: '' } : r))
                                )
                                setCfCfPopover(null)
                              }}
                              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-2 text-[10px] font-bold text-foreground/50 shadow-sm transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary ${
                                !rule.backgroundColor?.trim()
                                  ? 'border-primary ring-2 ring-primary ring-offset-1'
                                  : 'border-border hover:border-foreground/40'
                              }`}
                              style={{
                                background:
                                  'repeating-conic-gradient(#a1a1aa 0% 25%, #e4e4e7 0% 50%) 50% / 8px 8px',
                              }}
                            >
                              ∅
                            </button>
                            {cfPresets.fill.map((p, pi) => {
                              const selected = cfHexMatches(rule.backgroundColor ?? '', p.hex)
                              return (
                                <button
                                  key={`f-${pi}-${p.hex}`}
                                  type="button"
                                  title={p.label}
                                  onClick={() => {
                                    setCfRules((prev) =>
                                      prev.map((r, i) => (i === idx ? { ...r, backgroundColor: p.hex } : r))
                                    )
                                    setCfCfPopover(null)
                                  }}
                                  className={`h-8 w-8 shrink-0 rounded-md border-2 shadow-sm transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 ${
                                    selected
                                      ? 'border-primary ring-2 ring-primary ring-offset-1'
                                      : 'border-border hover:border-foreground/40'
                                  }`}
                                  style={{ backgroundColor: p.hex }}
                                />
                              )
                            })}
                          </div>
                          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-foreground/50">
                            Custom
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="color"
                              value={
                                /^#[0-9A-Fa-f]{6}$/i.test((rule.backgroundColor ?? '').trim())
                                  ? (rule.backgroundColor ?? '').trim().toLowerCase()
                                  : '#fef08a'
                              }
                              onChange={(e) =>
                                setCfRules((prev) =>
                                  prev.map((r, i) =>
                                    i === idx ? { ...r, backgroundColor: e.target.value } : r
                                  )
                                )
                              }
                              className="h-9 w-12 cursor-pointer rounded border border-border bg-background"
                            />
                            <input
                              type="text"
                              value={rule.backgroundColor ?? ''}
                              onChange={(e) =>
                                setCfRules((prev) =>
                                  prev.map((r, i) =>
                                    i === idx ? { ...r, backgroundColor: e.target.value } : r
                                  )
                                )
                              }
                              className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground"
                              placeholder="#hex"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex min-w-[10rem] flex-col gap-1">
                    <span className="text-xs font-medium text-foreground/80">Text</span>
                    <div className="relative inline-block" data-cf-text-anchor={rule.id}>
                      <button
                        type="button"
                        aria-expanded={
                          cfCfPopover?.ruleId === rule.id && cfCfPopover.kind === 'text'
                        }
                        aria-haspopup="dialog"
                        aria-label="Choose text color"
                        onClick={() =>
                          setCfCfPopover((p) =>
                            p?.ruleId === rule.id && p.kind === 'text'
                              ? null
                              : { ruleId: rule.id, kind: 'text' }
                          )
                        }
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border-2 border-border bg-background shadow-sm transition hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        {rule.textColor?.trim() ? (
                          <span
                            className="block h-8 w-8 rounded-md border border-black/10 shadow-inner"
                            style={{ backgroundColor: rule.textColor.trim() }}
                          />
                        ) : (
                          <span
                            className="flex h-8 w-8 items-center justify-center rounded-md border border-dashed border-foreground/35 bg-muted/50 text-sm font-semibold text-foreground/55"
                            title="Default (table text)"
                          >
                            Aa
                          </span>
                        )}
                      </button>
                      {cfCfPopover?.ruleId === rule.id && cfCfPopover.kind === 'text' && (
                        <div
                          className="absolute left-0 top-full z-[80] mt-1 w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-3 shadow-xl"
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-foreground/50">
                            Quick picks
                          </p>
                          <div className="mb-3 flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              title="Default (inherit table text)"
                              onClick={() => {
                                setCfRules((prev) =>
                                  prev.map((r, i) => (i === idx ? { ...r, textColor: '' } : r))
                                )
                                setCfCfPopover(null)
                              }}
                              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-2 text-xs font-bold text-foreground/55 shadow-sm transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary ${
                                !rule.textColor?.trim()
                                  ? 'border-primary ring-2 ring-primary ring-offset-1'
                                  : 'border-border bg-muted/50 hover:border-foreground/40'
                              }`}
                            >
                              Aa
                            </button>
                            {cfPresets.text.map((p, pi) => {
                              const selected = cfHexMatches(rule.textColor ?? '', p.hex)
                              return (
                                <button
                                  key={`t-${pi}-${p.hex}`}
                                  type="button"
                                  title={p.label}
                                  onClick={() => {
                                    setCfRules((prev) =>
                                      prev.map((r, i) => (i === idx ? { ...r, textColor: p.hex } : r))
                                    )
                                    setCfCfPopover(null)
                                  }}
                                  className={`h-8 w-8 shrink-0 rounded-md border-2 shadow-sm transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 ${
                                    selected
                                      ? 'border-primary ring-2 ring-primary ring-offset-1'
                                      : 'border-border hover:border-foreground/40'
                                  }`}
                                  style={{ backgroundColor: p.hex }}
                                />
                              )
                            })}
                          </div>
                          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-foreground/50">
                            Custom
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="color"
                              value={
                                /^#[0-9A-Fa-f]{6}$/i.test((rule.textColor ?? '').trim())
                                  ? (rule.textColor ?? '').trim().toLowerCase()
                                  : '#b91c1c'
                              }
                              onChange={(e) =>
                                setCfRules((prev) =>
                                  prev.map((r, i) =>
                                    i === idx ? { ...r, textColor: e.target.value } : r
                                  )
                                )
                              }
                              className="h-9 w-12 cursor-pointer rounded border border-border bg-background"
                            />
                            <input
                              type="text"
                              value={rule.textColor ?? ''}
                              onChange={(e) =>
                                setCfRules((prev) =>
                                  prev.map((r, i) =>
                                    i === idx ? { ...r, textColor: e.target.value } : r
                                  )
                                )
                              }
                              className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground"
                              placeholder="#hex"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={rule.fontBold === true}
                      onChange={(e) =>
                        setCfRules((prev) => prev.map((r, i) => (i === idx ? { ...r, fontBold: e.target.checked } : r)))
                      }
                      className="h-4 w-4 rounded border-border"
                    />
                    Bold
                  </label>
                </div>
              </div>
              )
            })}
            <button
              type="button"
              onClick={() =>
                setCfRules((prev) => [
                  ...prev,
                  {
                    id: `cf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                    mode: 'standard',
                    standardOp: 'gt',
                    standardValue: '0',
                    backgroundColor: '',
                    textColor: '',
                    fontBold: false,
                    appliesToOthers: false,
                  },
                ])
              }
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-background"
            >
              + Add conditional format rule
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {isSubmitting ? 'Saving...' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (navState.fromPlan && navState.returnTo) {
                navigate(navState.returnTo, { replace: true })
              } else {
                navigate(testingPath('fields'))
              }
            }}
            className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
          >
            Cancel
          </button>
          {!isNew && (
            <button
              type="button"
              onClick={async () => {
                if (!id) return
                const key = getValues('key')
                if (!key?.trim()) return
                const [allFieldsRes, plansRes] = await Promise.all([
                  api.get<DataField[]>('/fields').then((r) => r.data),
                  api.get<TestPlan[]>('/test-plans').catch(() => ({ data: [] as TestPlan[] })),
                ])
                const allFields = allFieldsRes
                const usedBy = getFieldsReferencingKey(key, allFields.filter((f) => f.id !== id))
                if (usedBy.length > 0) {
                  const names = usedBy.map((f) => f.label || f.key).join(', ')
                  showAlert(
                    `This field is used in the formula field(s): ${names}. Remove or update those formulas before deleting.`,
                    'Cannot delete field'
                  )
                  return
                }
                const plansUsingField = (plansRes.data ?? []).filter((p) => p.fieldIds?.includes(id))
                if (plansUsingField.length > 0) {
                  const names = plansUsingField.map((p) => p.name).join(', ')
                  showAlert(`Cannot delete this field. It is used in the test plan(s): ${names}. Remove it from the plan(s) first.`)
                  return
                }
                if (anyPlanConditionalStatusRulesTouchField(plansRes.data ?? [], id, key)) {
                  showAlert(
                    'Cannot delete this field. It is used in test plan Status Conditionals (as the status field or in a rule formula). Remove those rules or take the field out of the plan first.'
                  )
                  return
                }
                const ok = await showConfirm('Delete this field?', { title: 'Delete field' })
                if (!ok) return
                try {
                  await api.delete(`/fields/${id}`)
                  navigate(testingPath('fields'), { replace: true })
                } catch (e: unknown) {
                  const errObj = e as { response?: { status?: number; data?: { error?: string } } }
                  // If the field is already gone (404), treat as success and just go back to list.
                  if (errObj.response?.status === 404) {
                    navigate(testingPath('fields'), { replace: true })
                    return
                  }
                  const err = errObj.response?.data?.error
                  showAlert(err || 'Failed to delete field')
                  navigate(testingPath('fields'), { replace: true })
                }
              }}
              className="rounded-lg border border-red-500/50 px-4 py-2 text-red-500 hover:bg-red-500/10"
            >
              Delete
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
