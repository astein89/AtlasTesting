import { useEffect, useState, useRef } from 'react'
import { useAuthStore } from '../../store/authStore'
import { useAlertConfirm } from '../../contexts/AlertConfirmContext'
import { getBasePath } from '../../lib/basePath'

interface ImageInputProps {
  value: string | string[]
  onChange: (value: string | string[]) => void
  multiple?: boolean
  /** Optional tag/label for this image field (e.g. "Before", "Defect photo") */
  tag?: string
  /** Prefix for uploaded filename: key_field + image_tag (client adds _MMDDYYHHMMSS) */
  uploadNamePrefix?: string
  className?: string
}

/** MMDDYYHHMMSS for filenames */
function formatTimestamp(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const yy = String(d.getFullYear() % 100).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${mm}${dd}${yy}${hh}${min}${ss}`
}

function sanitizePrefix(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 150) || 'image'
}

function toArray(v: string | string[]): string[] {
  if (Array.isArray(v)) return v
  return v ? [v] : []
}

function fromArray(arr: string[], multiple: boolean): string | string[] {
  if (multiple) return arr
  return arr[0] ?? ''
}

const MAX_DIM = 1200
const JPEG_QUALITY = 0.85

async function compressImage(file: File): Promise<File> {
  if (file.size < 500 * 1024) return file
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let w = img.width
      let h = img.height
      if (w > MAX_DIM || h > MAX_DIM) {
        if (w > h) {
          h = Math.round((h * MAX_DIM) / w)
          w = MAX_DIM
        } else {
          w = Math.round((w * MAX_DIM) / h)
          h = MAX_DIM
        }
      }
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(file)
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        (blob) => {
          if (blob) {
            const name = file.name.replace(/\.[^.]+$/i, '.jpg')
            resolve(new File([blob], name, { type: 'image/jpeg' }))
          } else {
            resolve(file)
          }
        },
        'image/jpeg',
        JPEG_QUALITY
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(file)
    }
    img.src = url
  })
}

export function ImageInput({
  value,
  onChange,
  multiple = false,
  tag,
  uploadNamePrefix,
  className = '',
}: ImageInputProps) {
  const { showAlert } = useAlertConfirm()
  const [uploading, setUploading] = useState(false)
  const [fullScreenPath, setFullScreenPath] = useState<string | null>(null)
  const [removeIdx, setRemoveIdx] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const paths = toArray(value)

  const url = (p: string) => {
    if (p.startsWith('http')) return p
    const path = p.startsWith('/') ? p : '/' + p
    return `${window.location.origin}${getBasePath()}${path}`
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) return
    setUploading(true)
    try {
      const formData = new FormData()
      const prefix = uploadNamePrefix ? sanitizePrefix(uploadNamePrefix) : 'image'
      const timestamp = formatTimestamp()
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const compressed = /^image\/(jpeg|jpg|png|webp)$/i.test(file.type)
          ? await compressImage(file)
          : file
        const baseName = files.length > 1 ? `${prefix}_${timestamp}_${i}` : `${prefix}_${timestamp}`
        const ext = file.name.match(/\.[^.]+$/i)?.[0]?.toLowerCase() || '.jpg'
        const named = new File([compressed], `${baseName}${ext}`, { type: compressed.type })
        formData.append('images', named)
      }
      const token = useAuthStore.getState().accessToken
      const { status, data } = await new Promise<{ status: number; data: { paths?: string[]; error?: string } }>(
        (resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.open('POST', `${window.location.origin}${getBasePath()}/api/upload`)
          xhr.withCredentials = true
          if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
          xhr.onload = () => {
            try {
              const parsed = JSON.parse(xhr.responseText || '{}') as { paths?: string[]; error?: string }
              resolve({ status: xhr.status, data: parsed })
            } catch {
              resolve({ status: xhr.status, data: {} })
            }
          }
          xhr.onerror = () => reject(new Error('Network error'))
          xhr.ontimeout = () => reject(new Error('Upload timed out'))
          xhr.timeout = 60000
          xhr.send(formData)
        }
      )
      if (status < 200 || status >= 300) throw new Error(data.error || 'Upload failed')
      const uploadedPaths = data.paths ?? []
      const next = multiple ? [...paths, ...uploadedPaths] : (uploadedPaths[0] ?? '')
      onChange(next)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      showAlert(msg)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  useEffect(() => {
    if (!fullScreenPath) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullScreenPath(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [fullScreenPath])

  const confirmRemove = (idx: number) => setRemoveIdx(idx)
  const doRemove = () => {
    if (removeIdx == null) return
    const next = paths.filter((_, i) => i !== removeIdx)
    onChange(fromArray(next, multiple))
    setRemoveIdx(null)
  }

  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/gif,image/webp,image/heic"
        multiple={multiple}
        onChange={handleFile}
        className="hidden"
      />
      <div className="flex flex-wrap gap-2">
        {paths.map((p, i) => (
          <div key={`${p}-${i}`} className="relative">
            <button
              type="button"
              onClick={() => setFullScreenPath(p)}
              className="block w-full text-left"
            >
              <img
                src={url(p)}
                alt=""
                className="h-20 w-20 cursor-pointer rounded-lg border border-border object-cover bg-background"
              />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                confirmRemove(i)
              }}
              className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-border bg-background text-foreground/60 hover:bg-card disabled:opacity-50"
        >
          {uploading ? '…' : '+'}
        </button>
      </div>
      <p className="mt-1 text-xs text-foreground/60">
        {tag ? (
          <span className="font-medium text-foreground/80">{tag}</span>
        ) : null}
        {tag ? ' · ' : null}
        {multiple ? 'Tap + to add photos' : 'Tap + to add photo'}
      </p>

      {removeIdx != null && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
          <div
            className="w-full max-w-sm rounded-xl border border-border bg-card p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-4 text-foreground">Remove this photo?</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRemoveIdx(null)}
                className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={doRemove}
                className="rounded-lg bg-red-500 px-4 py-2 text-white hover:bg-red-600"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {fullScreenPath && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-4">
          <img
            src={url(fullScreenPath)}
            alt=""
            className="max-h-full max-w-full cursor-pointer object-contain"
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setFullScreenPath(null)
            }}
            className="absolute right-4 top-4 rounded-full bg-white/20 p-2 text-white hover:bg-white/30"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
