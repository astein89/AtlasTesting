import { normalizeOptionLayout, optionLayoutClasses, type OptionFieldLayout } from '../../utils/optionFieldLayout'

export type RadioLayout = OptionFieldLayout

interface RadioInputProps {
  value: string
  onChange: (value: string) => void
  options: string[]
  className?: string
  name?: string
  layout?: RadioLayout
}

export function RadioInput({
  value,
  onChange,
  options,
  className = '',
  name = 'radio-select',
  layout = 'horizontal',
}: RadioInputProps) {
  const resolved = normalizeOptionLayout(layout)
  const { className: layoutClass, style } = optionLayoutClasses(resolved)
  return (
    <div className={`min-w-0 ${layoutClass} ${className}`} style={style} role="radiogroup">
      {options.filter(Boolean).map((opt) => (
        <label key={opt} className="flex cursor-pointer items-center gap-2">
          <input
            type="radio"
            name={name}
            checked={value === opt}
            onChange={() => onChange(opt)}
            className="h-4 w-4 border-border text-primary"
          />
          <span className="min-w-0 text-sm text-foreground">{opt}</span>
        </label>
      ))}
    </div>
  )
}
