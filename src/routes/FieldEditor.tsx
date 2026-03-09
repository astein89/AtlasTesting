import React, { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { api } from '../api/client'
import { DraggableOptionList } from '../components/ui/DraggableOptionList'
import { PopupSelect } from '../components/ui/PopupSelect'
import { FRACTION_SCALES, type FractionScale } from '../utils/fraction'
import { validateFormula, getFormulaTokensForHighlight, getFormulaReferencedFieldKeys, evaluateFormula, getFieldsReferencingKey } from '../utils/formulaEvaluator'
import type { DataField, FieldType, TestPlan } from '../types'
import { STATUS_OPTIONS } from '../types'
import { formatDateTime, DATE_TIME_DISPLAY_OPTIONS, getExampleForDateTimeDisplay, type DateTimeDisplayKind } from '../lib/dateTimeConfig'
import { useAlertConfirm } from '../contexts/AlertConfirmContext'

const schema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['number', 'text', 'longtext', 'boolean', 'datetime', 'select', 'status', 'fraction', 'atlas_location', 'image', 'timer', 'formula']),
  config: z.record(z.unknown()).optional(),
})

type FormData = z.infer<typeof schema>

const TYPES: FieldType[] = ['number', 'text', 'longtext', 'boolean', 'datetime', 'select', 'status', 'fraction', 'atlas_location', 'image', 'timer', 'formula']

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
  select: 'Select',
  status: 'Status',
  fraction: 'Fraction (inches)',
  atlas_location: 'Atlas Location',
  image: 'Image',
  timer: 'Timer',
  formula: 'Formula',
}

export function FieldEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isNew = id === 'new'
  const { showAlert, showConfirm } = useAlertConfirm()
  const [options, setOptions] = useState<string[]>([])
  const [fractionScale, setFractionScale] = useState<FractionScale>(16)
  const [imageMultiple, setImageMultiple] = useState(false)
  const [imageTag, setImageTag] = useState('')
  const [statusColors, setStatusColors] = useState<Record<string, string>>({})
  const [integerDigits, setIntegerDigits] = useState<number | ''>('')
  const [decimalPlaces, setDecimalPlaces] = useState<number | ''>('')
  const [numberFormat, setNumberFormat] = useState<'number' | 'percent' | 'currency'>('number')
  const [thousandsSeparator, setThousandsSeparator] = useState(false)
  const [negativeStyle, setNegativeStyle] = useState<'minus' | 'parentheses'>('minus')
  const [currencySymbol, setCurrencySymbol] = useState('')
  const [numberMin, setNumberMin] = useState<number | ''>('')
  const [numberMax, setNumberMax] = useState<number | ''>('')
  const [minLength, setMinLength] = useState<number | ''>('')
  const [maxLength, setMaxLength] = useState<number | ''>('')
  const [textDisallowSpaces, setTextDisallowSpaces] = useState(false)
  const [textUnallowedChars, setTextUnallowedChars] = useState('')
  const [textPatternMask, setTextPatternMask] = useState('')
  const [dateTimeDisplay, setDateTimeDisplay] = useState<DateTimeDisplayKind>('dateTime')
  const [fieldType, setFieldType] = useState<FieldType>('text')
  const [statusUseFormula, setStatusUseFormula] = useState(false)
  const [formulaModalOpen, setFormulaModalOpen] = useState(false)
  const [formulaDraft, setFormulaDraft] = useState('')
  const [formulaHelpOpen, setFormulaHelpOpen] = useState(false)
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

  const typeVal = watch('type')

  useEffect(() => {
    if (typeVal) setFieldType(typeVal as FieldType)
    if (typeVal === 'status') setOptions((prev) => (prev.length ? prev : [...STATUS_OPTIONS]))
  }, [typeVal])

  const onSubmit = async (data: FormData) => {
    const config = { ...data.config }
    if (fieldType === 'select') config.options = options.filter(Boolean)
    if (fieldType === 'fraction') config.fractionScale = fractionScale
    if (fieldType === 'image') {
      config.imageMultiple = imageMultiple
      if (imageTag.trim()) config.imageTag = imageTag.trim()
    }
    if (fieldType === 'status') {
      config.options = options.filter(Boolean)
      config.statusColors = statusColors
      if (statusUseFormula) {
        const statusFormula = (getValues('config') as { formula?: string })?.formula?.trim()
        if (statusFormula) config.formula = statusFormula
      } else if ('formula' in config) delete config.formula
    }
    if (fieldType === 'number') {
      if (integerDigits !== '') config.integerDigits = integerDigits
      if (decimalPlaces !== '') config.decimalPlaces = decimalPlaces
      config.numberFormat = numberFormat
      config.thousandsSeparator = thousandsSeparator
      config.negativeStyle = negativeStyle
      if (numberFormat === 'currency') config.currencySymbol = currencySymbol.trim() || '$'
      if (numberMin !== '') config.min = numberMin
      if (numberMax !== '') config.max = numberMax
    }
    if (fieldType === 'text' || fieldType === 'longtext') {
      if (minLength !== '') config.minLength = minLength
      if (maxLength !== '') config.maxLength = maxLength
      if (textDisallowSpaces) config.textDisallowSpaces = true
      if (textUnallowedChars.trim()) config.textUnallowedChars = textUnallowedChars.trim()
      if (fieldType === 'text' && textPatternMask.trim()) config.textPatternMask = textPatternMask.trim()
    }
    if (fieldType === 'datetime') {
      config.dateTimeDisplay = dateTimeDisplay
      if ('dateTimeFormat' in config) delete config.dateTimeFormat
    }
    if (fieldType === 'formula') {
      config.formula = (getValues('config') as { formula?: string })?.formula ?? ''
      if (decimalPlaces !== '') config.decimalPlaces = decimalPlaces
      if (integerDigits !== '') config.integerDigits = integerDigits
      config.numberFormat = numberFormat
      config.thousandsSeparator = thousandsSeparator
      config.negativeStyle = negativeStyle
      if (numberFormat === 'currency') config.currencySymbol = currencySymbol.trim() || '$'
    }

    try {
      if (isNew) {
        await api.post('/fields', { ...data, config })
      } else {
        await api.put(`/fields/${id}`, { ...data, config })
      }
      navigate('/fields')
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
      api
        .get<DataField>(`/fields/${id}`)
        .then((r) => {
          setValue('key', r.data.key)
          setValue('label', r.data.label)
          setValue('type', r.data.type)
          setValue('config', r.data.config || {})
          if (r.data.config?.options) setOptions(r.data.config.options)
          if (r.data.type === 'status' && (!r.data.config?.options || !Array.isArray(r.data.config.options) || r.data.config.options.length === 0))
            setOptions([...STATUS_OPTIONS])
          if (r.data.config?.fractionScale && FRACTION_SCALES.includes(r.data.config.fractionScale as FractionScale)) {
            setFractionScale(r.data.config.fractionScale as FractionScale)
          }
          if (r.data.config?.imageMultiple != null) setImageMultiple(r.data.config.imageMultiple)
          if (r.data.config?.imageTag != null) setImageTag(String(r.data.config.imageTag))
          if (r.data.config?.statusColors && typeof r.data.config.statusColors === 'object') {
            setStatusColors(r.data.config.statusColors as Record<string, string>)
          }
          if (r.data.type === 'status') {
            setStatusUseFormula(!!(r.data.config?.formula))
          }
          if (r.data.type === 'number' || r.data.type === 'formula') {
            setIntegerDigits(r.data.config?.integerDigits ?? '')
            setDecimalPlaces(r.data.config?.decimalPlaces ?? '')
            setNumberFormat((r.data.config?.numberFormat as 'number' | 'percent' | 'currency') ?? 'number')
            setThousandsSeparator(r.data.config?.thousandsSeparator === true)
            setNegativeStyle((r.data.config?.negativeStyle as 'minus' | 'parentheses') ?? 'minus')
            setCurrencySymbol(typeof r.data.config?.currencySymbol === 'string' ? r.data.config.currencySymbol : '')
          }
          if (r.data.config?.min != null) setNumberMin(r.data.config.min as number)
          if (r.data.config?.max != null) setNumberMax(r.data.config.max as number)
          if (r.data.config?.minLength != null) setMinLength(r.data.config.minLength as number)
          if (r.data.config?.maxLength != null) setMaxLength(r.data.config.maxLength as number)
          if (r.data.config?.textDisallowSpaces === true) setTextDisallowSpaces(true)
          if (typeof r.data.config?.textUnallowedChars === 'string') setTextUnallowedChars(r.data.config.textUnallowedChars)
          if (typeof r.data.config?.textPatternMask === 'string') setTextPatternMask(r.data.config.textPatternMask)
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
        })
        .catch(() => navigate('/fields'))
    }
  }, [id, isNew, setValue, navigate])

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
        <div>
          <label className="block text-sm font-medium text-foreground">Key</label>
          <input
            {...register('key')}
            disabled={!isNew}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground disabled:opacity-60"
          />
          {errors.key && (
            <p className="mt-1 text-sm text-red-500">{errors.key.message}</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground">Label</label>
          <input
            {...register('label')}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
          />
          {errors.label && (
            <p className="mt-1 text-sm text-red-500">{errors.label.message}</p>
          )}
        </div>
        <Controller
          name="type"
          control={control}
          render={({ field }) => (
            <PopupSelect
              label="Type"
              value={field.value}
              onChange={field.onChange}
              options={TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
            />
          )}
        />
        {fieldType === 'number' && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground">Minimum</label>
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
                <p className="mt-1 mb-1 text-xs text-foreground/60">Optional</p>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={decimalPlaces === '' ? '' : decimalPlaces}
                  onChange={(e) => setDecimalPlaces(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                />
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
            <p className="mt-1 mb-2 text-xs text-foreground/60">
              How this date/time field is shown in tables and cards. Date and time uses your Settings format.
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
          <div>
            <p className="mb-2 text-xs text-foreground/60">
              Denominator for inch fractions (128ths finest, halves coarsest).
            </p>
            <PopupSelect
              label="Fraction scale"
              value={String(fractionScale)}
              onChange={(v) => setFractionScale(Number(v) as FractionScale)}
              options={FRACTION_SCALES.map((s) => ({
                value: String(s),
                label: s === 2 ? 'Halves (½)' : `${s}ths (1/${s})`,
              }))}
            />
          </div>
        )}
        {(fieldType === 'text' || fieldType === 'longtext') && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground">Min character length</label>
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
              <p className="mt-0.5 mb-1 text-xs text-foreground/60">List characters that must not appear (e.g. @#$)</p>
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
                <p className="mt-0.5 mb-1 text-xs text-foreground/60">
                  <a href="https://imask.js.org/guide.html#masked-pattern" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">imask</a> pattern: 0=digit, a=letter, *=any; [] optional, {} fixed in value
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
              <p className="mt-0.5 mb-1 text-xs text-foreground/60">Optional label (e.g. Before, Defect photo)</p>
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
              <p className="mt-1 mb-2 text-xs text-foreground/60">
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
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground">
                Status colors (optional)
              </label>
              <p className="mt-1 mb-2 text-xs text-foreground/60">
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
            <p className="mt-0.5 mb-2 text-xs text-foreground/60">
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
                    setFormulaModalOpen(true)
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
              <p className="mt-1 mb-2 text-xs text-foreground/60">
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
                    setFormulaModalOpen(true)
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
                                      <li><code className="rounded bg-muted px-1 font-mono text-xs">BLANK()</code><br /><span className="text-foreground/70">Return an empty/blank value.</span></li>
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
                      onClick={() => { setFormulaHelpOpen(false); setFormulaTestData({}); setFormulaTestResult(undefined); setFormulaModalOpen(false) }}
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
                        setValue('config', { ...getValues('config'), formula: formulaDraft })
                        setFormulaModalOpen(false)
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
        {fieldType === 'select' && (
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
            />
          </div>
        )}
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
            onClick={() => navigate('/fields')}
            className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
          >
            Cancel
          </button>
          {!isNew && (
            <button
              type="button"
              onClick={async () => {
                const key = getValues('key')
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
                const ok = await showConfirm('Delete this field?', { title: 'Delete field' })
                if (!ok) return
                try {
                  await api.delete(`/fields/${id}`)
                  navigate('/fields', { replace: true })
                } catch (e: unknown) {
                  const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
                  showAlert(err || 'Failed to delete field')
                  navigate('/fields', { replace: true })
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
