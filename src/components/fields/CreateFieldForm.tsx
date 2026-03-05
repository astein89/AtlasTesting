import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { api } from '../../api/client'
import { PopupSelect } from '../ui/PopupSelect'
import { FRACTION_SCALES, type FractionScale } from '../../utils/fraction'
import type { FieldType } from '../../types'

const schema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['number', 'text', 'longtext', 'boolean', 'datetime', 'select', 'fraction', 'atlas_location', 'image']),
})

type FormData = z.infer<typeof schema>

interface CreateFieldFormProps {
  onSave: (id: string) => void
  onCancel: () => void
}

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

export function CreateFieldForm({ onSave, onCancel }: CreateFieldFormProps) {
  const [options, setOptions] = useState<string[]>([''])
  const [fractionScale, setFractionScale] = useState<FractionScale>(16)
  const [imageMultiple, setImageMultiple] = useState(false)
  const [fieldType, setFieldType] = useState<FieldType>('text')

  const {
    register,
    control,
    handleSubmit,
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

  const moveOption = (from: number, to: number) => {
    if (to < 0 || to >= options.length) return
    const next = [...options]
    const [removed] = next.splice(from, 1)
    next.splice(to, 0, removed)
    setOptions(next)
  }

  const onSubmit = async (data: FormData) => {
    const config: Record<string, unknown> = {}
    if (fieldType === 'select') {
      config.options = options.filter(Boolean)
    }
    if (fieldType === 'fraction') {
      config.fractionScale = fractionScale
    }
    if (fieldType === 'image') {
      config.imageMultiple = imageMultiple
    }
    try {
      const { data: created } = await api.post<{ id: string }>('/fields', {
        ...data,
        config,
      })
      onSave(created.id)
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      alert(err || 'Failed to create field')
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="max-w-md space-y-4 rounded-lg border border-border bg-card p-6"
    >
      <h2 className="text-lg font-medium text-foreground">Create New Field</h2>
      <div>
        <label className="block text-sm font-medium text-foreground">Key</label>
        <input
          {...register('key')}
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
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
      {fieldType === 'select' && (
        <div>
          <label className="block text-sm font-medium text-foreground">Options</label>
          <p className="mt-1 mb-2 text-xs text-foreground/60">
            Use ↑↓ to sort and arrange options.
          </p>
          {options.map((opt, i) => (
            <div key={i} className="mt-2 flex items-center gap-2">
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
                onChange={(e) => {
                  const n = [...options]
                  n[i] = e.target.value
                  setOptions(n)
                }}
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              />
              <button
                type="button"
                onClick={() => setOptions((o) => o.filter((_, j) => j !== i))}
                className="text-red-500 hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setOptions((o) => [...o, ''])}
            className="mt-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-foreground hover:bg-background"
          >
            + Add option (new line)
          </button>
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {isSubmitting ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
