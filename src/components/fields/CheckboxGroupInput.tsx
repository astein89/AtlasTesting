import { normalizeOptionLayout, optionLayoutClasses, type OptionFieldLayout } from '../../utils/optionFieldLayout'

interface CheckboxGroupInputProps {
  value: string[]
  onChange: (value: string[]) => void
  options: string[]
  className?: string
  name?: string
  layout?: OptionFieldLayout
}

export function CheckboxGroupInput({
  value,
  onChange,
  options,
  className = '',
  name = 'checkbox-group',
  layout = 'auto',
}: CheckboxGroupInputProps) {
  const resolved = normalizeOptionLayout(layout)
  const { className: layoutClass, style } = optionLayoutClasses(resolved)
  const selected = new Set((value ?? []).map(String))

  const toggle = (opt: string) => {
    const next = new Set(selected)
    if (next.has(opt)) next.delete(opt)
    else next.add(opt)
    const order = options.filter((o) => o && next.has(o))
    onChange(order)
  }

  return (
    <div className={`min-w-0 ${layoutClass} ${className}`} style={style} role="group" aria-label={name}>
      {options.filter(Boolean).map((opt) => (
        <label key={opt} className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            name={name}
            checked={selected.has(opt)}
            onChange={() => toggle(opt)}
            className="h-4 w-4 rounded border-border text-primary"
          />
          <span className="min-w-0 text-sm text-foreground">{opt}</span>
        </label>
      ))}
    </div>
  )
}
