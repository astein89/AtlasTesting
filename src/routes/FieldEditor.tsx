import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { api } from '../api/client'
import { FRACTION_SCALES, type FractionScale } from '../utils/fraction'
import type { DataField, FieldType } from '../types'

const schema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['number', 'text', 'longtext', 'boolean', 'datetime', 'select', 'fraction', 'atlas_location', 'image']),
  config: z.record(z.unknown()).optional(),
})

type FormData = z.infer<typeof schema>

const TYPES: FieldType[] = ['number', 'text', 'longtext', 'boolean', 'datetime', 'select', 'fraction', 'atlas_location', 'image']
const TYPE_LABELS: Record<FieldType, string> = {
  number: 'Number',
  text: 'Text',
  longtext: 'Long text',
  boolean: 'Boolean',
  datetime: 'Date/time',
  select: 'Select',
  fraction: 'Fraction (inches)',
  atlas_location: 'Atlas Location',
  image: 'Image',
}

export function FieldEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isNew = id === 'new'
  const [options, setOptions] = useState<string[]>([])
  const [fractionScale, setFractionScale] = useState<FractionScale>(16)
  const [imageMultiple, setImageMultiple] = useState(false)
  const [fieldType, setFieldType] = useState<FieldType>('text')

  const {
    register,
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
  }, [typeVal])

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
          if (r.data.config?.fractionScale && FRACTION_SCALES.includes(r.data.config.fractionScale as FractionScale)) {
            setFractionScale(r.data.config.fractionScale as FractionScale)
          }
          if (r.data.config?.imageMultiple != null) setImageMultiple(r.data.config.imageMultiple)
        })
        .catch(() => navigate('/fields'))
    }
  }, [id, isNew, setValue, navigate])

  const onSubmit = async (data: FormData) => {
    const config = { ...data.config }
    if (fieldType === 'select') config.options = options.filter(Boolean)
    if (fieldType === 'fraction') config.fractionScale = fractionScale
    if (fieldType === 'image') config.imageMultiple = imageMultiple

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
  const moveOption = (from: number, to: number) => {
    if (to < 0 || to >= options.length) return
    const next = [...options]
    const [removed] = next.splice(from, 1)
    next.splice(to, 0, removed)
    setOptions(next)
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-foreground">
        {isNew ? 'New Field' : 'Edit Field'}
      </h1>
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
        <div>
          <label className="block text-sm font-medium text-foreground">Type</label>
          <select
            {...register('type')}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        {fieldType === 'fraction' && (
          <div>
            <label className="block text-sm font-medium text-foreground">
              Fraction scale
            </label>
            <p className="mt-1 mb-2 text-xs text-foreground/60">
              Denominator for inch fractions (128ths finest, halves coarsest).
            </p>
            <select
              value={fractionScale}
              onChange={(e) => setFractionScale(Number(e.target.value) as FractionScale)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
            >
              {FRACTION_SCALES.map((s) => (
                <option key={s} value={s}>
                  {s === 2 ? 'Halves (½)' : `${s}ths (1/${s})`}
                </option>
              ))}
            </select>
          </div>
        )}
        {fieldType === 'image' && (
          <div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={imageMultiple}
                onChange={(e) => setImageMultiple(e.target.checked)}
              />
              <span className="text-sm text-foreground">Allow multiple photos</span>
            </label>
          </div>
        )}
        {fieldType === 'select' && (
          <div>
            <label className="block text-sm font-medium text-foreground">
              Options (drag to reorder)
            </label>
            <p className="mt-1 mb-2 text-xs text-foreground/60">
              Use ↑↓ to sort and arrange options.
            </p>
            <div className="mt-2 space-y-2">
              {options.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => moveOption(i, i - 1)}
                      disabled={i === 0}
                      className="rounded p-1 text-foreground/60 hover:bg-background disabled:opacity-30"
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveOption(i, i + 1)}
                      disabled={i === options.length - 1}
                      className="rounded p-1 text-foreground/60 hover:bg-background disabled:opacity-30"
                      title="Move down"
                    >
                      ↓
                    </button>
                  </div>
                  <input
                    value={opt}
                    onChange={(e) => updateOption(i, e.target.value)}
                    className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                  />
                  <button
                    type="button"
                    onClick={() => removeOption(i)}
                    className="rounded-lg px-3 text-red-500 hover:bg-red-500/10"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addOption}
                className="rounded-lg border border-border px-3 py-1 text-sm text-foreground hover:bg-background"
              >
                + Add option
              </button>
            </div>
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
                if (!confirm('Delete this field? This may affect tests using it.')) return
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
