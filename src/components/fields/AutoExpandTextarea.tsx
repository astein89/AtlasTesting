import { useRef, useEffect } from 'react'

interface AutoExpandTextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'style'> {
  className?: string
  minRows?: number
}

export function AutoExpandTextarea({
  value,
  onChange,
  className,
  minRows = 4,
  ...rest
}: AutoExpandTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, minRows * 24)}px`
  }, [value, minRows])

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      rows={minRows}
      className={className}
      style={{ resize: 'vertical', minHeight: `${minRows * 24}px` }}
      {...rest}
    />
  )
}
