import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { api } from '../api/client'
import { DraggableOptionList } from '../components/ui/DraggableOptionList'
import { PopupSelect } from '../components/ui/PopupSelect'
import { FRACTION_SCALES, type FractionScale } from '../utils/fraction'
import type { DataField, FieldType } from '../types'
import { STATUS_OPTIONS } from '../types'

const schema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['number', 'text', 'longtext', 'boolean', 'datetime', 'select', 'status', 'fraction', 'atlas_location', 'image', 'timer']),
  config: z.record(z.unknown()).optional(),
})

type FormData = z.infer<typeof schema>

const TYPES: FieldType[] = ['number', 'text', 'longtext', 'boolean', 'datetime', 'select', 'status', 'fraction', 'atlas_location', 'image', 'timer']
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
}

export function FieldEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isNew = id === 'new'
  const [options, setOptions] = useState<string[]>([])
  const [fractionScale, setFractionScale] = useState<FractionScale>(16)
  const [imageMultiple, setImageMultiple] = useState(false)
  const [imageTag, setImageTag] = useState('')
  const [statusColors, setStatusColors] = useState<Record<string, string>>({})
  const [integerDigits, setIntegerDigits] = useState<number | ''>('')
  const [decimalPlaces, setDecimalPlaces] = useState<number | ''>('')
  const [numberMin, setNumberMin] = useState<number | ''>('')
  const [numberMax, setNumberMax] = useState<number | ''>('')
  const [minLength, setMinLength] = useState<number | ''>('')
  const [maxLength, setMaxLength] = useState<number | ''>('')
  const [fieldType, setFieldType] = useState<FieldType>('text')

  const {
    register,
    control,
    handleSubmit,
    setValue,
    watch,
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
    }
    if (fieldType === 'number') {
      if (integerDigits !== '') config.integerDigits = integerDigits
      if (decimalPlaces !== '') config.decimalPlaces = decimalPlaces
      if (numberMin !== '') config.min = numberMin
      if (numberMax !== '') config.max = numberMax
    }
    if (fieldType === 'text' || fieldType === 'longtext') {
      if (minLength !== '') config.minLength = minLength
      if (maxLength !== '') config.maxLength = maxLength
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
      alert(err || 'Failed to save')
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
          if (r.data.config?.integerDigits != null) setIntegerDigits(r.data.config.integerDigits as number)
          if (r.data.config?.decimalPlaces != null) setDecimalPlaces(r.data.config.decimalPlaces as number)
          if (r.data.config?.min != null) setNumberMin(r.data.config.min as number)
          if (r.data.config?.max != null) setNumberMax(r.data.config.max as number)
          if (r.data.config?.minLength != null) setMinLength(r.data.config.minLength as number)
          if (r.data.config?.maxLength != null) setMaxLength(r.data.config.maxLength as number)
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
    const d = date ? new Date(date).toLocaleString() : ''
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
          </>
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
          </>
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
                if (!confirm('Delete this field? This may affect test plans using it.')) return
                try {
                  await api.delete(`/fields/${id}`)
                  navigate('/fields', { replace: true })
                } catch (e: unknown) {
                  const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
                  alert(err || 'Failed to delete field')
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
