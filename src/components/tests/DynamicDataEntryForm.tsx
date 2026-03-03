import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
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
          if (f.type === 'number') {
            acc[f.key] = z.number({ required_error: 'Required' })
          } else if (f.type === 'boolean') {
            acc[f.key] = z.boolean()
          } else {
            acc[f.key] = z.string().min(1, 'Required')
          }
        } else {
          if (f.type === 'number')
            acc[f.key] = z.preprocess(
              (v) => (typeof v === 'number' && isNaN(v) ? undefined : v),
              z.number().optional()
            )
          else if (f.type === 'boolean') acc[f.key] = z.boolean().optional()
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
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const handleFormSubmit = (data: FormData) => {
    const config = fields.reduce((acc, f) => {
      acc[f.key] = data[f.key]
      return acc
    }, {} as Record<string, string | number | boolean>)

    let status = 'pass'
    for (const f of fields) {
      const val = config[f.key]
      const cfg = f.config || {}
      if (f.type === 'number' && typeof val === 'number') {
        if (cfg.min != null && val < cfg.min) status = 'fail'
        if (cfg.max != null && val > cfg.max) status = 'fail'
      }
      if (f.type === 'select' && cfg.options?.length && val === 'Fail') status = 'fail'
    }
    onSubmit(config, status)
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
            {f.type === 'select' && (
              <select
                id={f.key}
                {...register(f.key)}
                className="min-h-[44px] w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              >
                <option value="">-- Select --</option>
                {(f.config?.options || []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
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
