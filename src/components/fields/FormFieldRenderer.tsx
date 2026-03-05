import { AutoExpandTextarea } from './AutoExpandTextarea'
import { AtlasLocationInput } from './AtlasLocationInput'
import { FractionInput } from './FractionInput'
import { ImageInput } from './ImageInput'
import { SelectInput } from './SelectInput'
import { parseFractionScale } from '../../utils/fraction'
import { getStatusOptions } from '../../types'
import type { DataField } from '../../types'

export function renderFormField(
  f: DataField,
  value: string | number | boolean,
  onChange: (key: string, val: string | number | boolean) => void,
  options?: { disabled?: boolean }
) {
  const disabled = options?.disabled ?? false
  const inputClass = `w-full rounded border border-border bg-background px-3 py-2 text-foreground ${disabled ? 'cursor-not-allowed opacity-70' : ''}`

  if (f.type === 'number') {
    return (
      <input
        type="number"
        value={Number(value) || ''}
        onChange={(e) => onChange(f.key, parseFloat(e.target.value) || 0)}
        className={inputClass}
        disabled={disabled}
      />
    )
  }
  if (f.type === 'boolean') {
    return (
      <input
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(f.key, e.target.checked)}
        className="h-4 w-4"
        disabled={disabled}
      />
    )
  }
  if (f.type === 'longtext') {
    return (
      <AutoExpandTextarea
        value={String(value ?? '')}
        onChange={(e) => onChange(f.key, e.target.value)}
        minRows={6}
        className={inputClass}
        disabled={disabled}
      />
    )
  }
  if (f.type === 'atlas_location') {
    return (
      <div className={disabled ? 'pointer-events-none opacity-70' : ''}>
        <AtlasLocationInput
          value={String(value ?? '')}
          onChange={(v) => onChange(f.key, v)}
          className="w-full"
        />
      </div>
    )
  }
  if (f.type === 'fraction') {
    const content = (
      <FractionInput
        value={Number(value) || 0}
        onChange={(v) => onChange(f.key, v)}
        defaultScale={parseFractionScale(f.config?.fractionScale)}
        className="w-full"
      />
    )
    return disabled ? <div className="pointer-events-none opacity-70">{content}</div> : content
  }
  if (f.type === 'image') {
    return (
      <div className={disabled ? 'pointer-events-none opacity-70' : ''}>
        <ImageInput
          value={(value as string | string[]) ?? (f.config?.imageMultiple ? [] : '')}
          onChange={(v) => onChange(f.key, v)}
          multiple={f.config?.imageMultiple ?? false}
          className="w-full"
        />
      </div>
    )
  }
  if (f.type === 'select') {
    const content = (
      <SelectInput
        value={String(value ?? '')}
        onChange={(v) => onChange(f.key, v)}
        options={f.config?.options || []}
        className="w-full"
      />
    )
    return disabled ? <div className="pointer-events-none opacity-70">{content}</div> : content
  }
  if (f.type === 'status') {
    const statusVal = String(value ?? '')
    const content = (
      <SelectInput
        value={statusVal}
        onChange={(v) => onChange(f.key, v)}
        options={getStatusOptions(f)}
        className="w-full"
        valueColor={f.config?.statusColors?.[statusVal]}
        optionColors={f.config?.statusColors}
      />
    )
    return disabled ? <div className="pointer-events-none opacity-70">{content}</div> : content
  }
  return (
    <input
      type="text"
      value={String(value ?? '')}
      onChange={(e) => onChange(f.key, e.target.value)}
      className={inputClass}
      disabled={disabled}
    />
  )
}
