import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { AtlasLocationInput } from '../fields/AtlasLocationInput'
import { FractionInput } from '../fields/FractionInput'
import { ImageInput } from '../fields/ImageInput'
import { SelectInput } from '../fields/SelectInput'
import { parseFractionScale } from '../../utils/fraction'
import { getStatusOptions } from '../../types'
import type { DataField } from '../../types'

interface DynamicDataEntryFormProps {
  fields: DataField[]
  onSubmit: (data: Record<string, string | number | boolean>, status: string) => void
  isSubmitting?: boolean
}

export function DynamicDataEntryForm({
  fields,
  onSubmit,
  isSubmitting = false,
}: DynamicDataEntryFormProps) {
  const schema = z.object(
    fields.reduce(
      (acc, f) => {
        const cfg = f.config || {}
        if (cfg.required) {
          if (f.type === 'number' || f.type === 'fraction') {
            acc[f.key] = z.number({ required_error: 'Required' })
          } else if (f.type === 'boolean') {
            acc[f.key] = z.boolean()
          } else if (f.type === 'image') {
            acc[f.key] = z.union([z.string().min(1), z.array(z.string()).min(1)])
          } else {
            acc[f.key] = z.string().min(1, 'Required')
          }
        } else {
          if (f.type === 'number' || f.type === 'fraction')
            acc[f.key] = z.preprocess(
              (v) => (typeof v === 'number' && isNaN(v) ? undefined : v),
              z.number().optional()
            )
          else if (f.type === 'boolean') acc[f.key] = z.boolean().optional()
          else if (f.type === 'image') acc[f.key] = z.union([z.string(), z.array(z.string())]).optional()
          else if (f.type === 'longtext') acc[f.key] = z.string().optional()
          else acc[f.key] = z.string().optional()
        }
        return acc
      },
      {} as Record<string, z.ZodTypeAny>
    )
  )

  type FormData = z.infer<typeof schema>

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const handleFormSubmit = (data: FormData) => {
    const config = fields.reduce((acc, f) => {
      acc[f.key] = data[f.key]
      return acc
    }, {} as Record<string, string | number | boolean>)
    onSubmit(config, 'partial')
  }

  return (
    <form
      onSubmit={handleSubmit(handleFormSubmit)}
      className="flex flex-col gap-6 pb-24 md:pb-4"
    >
      <div className="space-y-4">
        {fields.map((f) => (
          <div key={f.id} className="flex flex-col gap-1">
            <label
              htmlFor={f.key}
              className="text-sm font-medium text-foreground min-h-[44px] flex items-center"
            >
              {f.label}
              {(f.config?.required ?? false) && (
                <span className="ml-1 text-red-500">*</span>
              )}
            </label>
            {f.type === 'number' && (
              <input
                id={f.key}
                type="number"
                {...register(f.key, { valueAsNumber: true })}
                min={f.config?.min}
                max={f.config?.max}
                inputMode="decimal"
                className="min-h-[44px] w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              />
            )}
            {f.type === 'text' && (
              <input
                id={f.key}
                type="text"
                {...register(f.key)}
                className="min-h-[44px] w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              />
            )}
            {f.type === 'longtext' && (
              <textarea
                id={f.key}
                {...register(f.key)}
                rows={6}
                className="min-h-[120px] w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              />
            )}
            {f.type === 'boolean' && (
              <label className="flex min-h-[44px] cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  {...register(f.key)}
                  className="h-5 w-5 rounded border-border"
                />
                <span className="text-foreground">Yes</span>
              </label>
            )}
            {f.type === 'datetime' && (
              <input
                id={f.key}
                type="datetime-local"
                {...register(f.key)}
                className="min-h-[44px] w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              />
            )}
            {f.type === 'atlas_location' && (
              <AtlasLocationInput
                value={String(watch(f.key) ?? '')}
                onChange={(v) => setValue(f.key, v)}
                className="w-full"
              />
            )}
            {f.type === 'fraction' && (
              <FractionInput
                value={Number(watch(f.key)) || 0}
                onChange={(v) => setValue(f.key, v)}
                defaultScale={parseFractionScale(f.config?.fractionScale)}
                className="w-full"
              />
            )}
            {f.type === 'image' && (
              <ImageInput
                value={(watch(f.key) as string | string[]) ?? (f.config?.imageMultiple ? [] : '')}
                onChange={(v) => setValue(f.key, v)}
                multiple={f.config?.imageMultiple ?? false}
                className="w-full"
              />
            )}
            {f.type === 'select' && (
              <SelectInput
                value={String(watch(f.key) ?? '')}
                onChange={(v) => setValue(f.key, v)}
                options={f.config?.options || []}
                placeholder="(Select)"
                className="w-full"
              />
            )}
            {f.type === 'status' && (
              <SelectInput
                value={String(watch(f.key) ?? '')}
                onChange={(v) => setValue(f.key, v)}
                options={getStatusOptions(f)}
                placeholder="(Select)"
                className="w-full"
                valueColor={f.config?.statusColors?.[String(watch(f.key) ?? '')]}
                optionColors={f.config?.statusColors}
              />
            )}
            {errors[f.key] && (
              <p className="text-sm text-red-500">
                {(errors[f.key] as { message?: string })?.message}
              </p>
            )}
          </div>
        ))}
      </div>
      <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-card p-4 md:static md:border-0 md:bg-transparent md:p-0">
        <button
          type="submit"
          disabled={isSubmitting}
          className="min-h-[44px] w-full rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50 md:w-auto"
        >
          {isSubmitting ? 'Saving...' : 'Submit'}
        </button>
      </div>
    </form>
  )
}
