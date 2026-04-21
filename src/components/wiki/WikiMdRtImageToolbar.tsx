import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { DropdownToolbar, MdModal, en_US, prefix } from 'md-editor-rt'
import type { Themes } from 'md-editor-rt'
import { b as mdBus, R as mdReplace, U as mdUploadImage } from 'md-editor-rt/lib/es/chunks/event-bus.mjs'
import { b as mdDataUrlToFile } from 'md-editor-rt/lib/es/chunks/index2.mjs'
import { g as mdDefaultConfig } from 'md-editor-rt/lib/es/chunks/config.mjs'

type MdCropperInstance = {
  destroy(): void
  getCroppedCanvas(): HTMLCanvasElement
}

declare global {
  interface Window {
    Cropper?: new (
      element: HTMLImageElement,
      options?: { viewMode?: number; preview?: HTMLElement | null }
    ) => MdCropperInstance
  }
}

/** Lucide-style paths used by md-editor-rt’s image toolbar icon. */
function MdEditorImageIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  )
}

let clipCropper: MdCropperInstance | null = null

export const WikiMdRtImageToolbar = memo(function WikiMdRtImageToolbar({
  editorId,
  disabled,
  showToolbarName,
}: {
  editorId: string
  disabled?: boolean
  showToolbarName?: boolean
  theme?: Themes
}) {
  const toolbarWrapId = `${editorId}-toolbar-wrapper`
  const tips = en_US.toolbarTips ?? {}
  const imgTips = en_US.imgTitleItem ?? { link: 'Add image link', upload: 'Upload images', clip2upload: 'Crop and upload' }
  const linkTips = en_US.linkModalTips ?? {}
  const clipTips = en_US.clipModalTips ?? { title: 'Crop Image' }

  const [menuOpen, setMenuOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [clipOpen, setClipOpen] = useState(false)
  const [desc, setDesc] = useState('')
  const [url, setUrl] = useState('')
  const [clipImgSelected, setClipImgSelected] = useState(false)
  const [clipImgSrc, setClipImgSrc] = useState('')
  const [clipFullscreen, setClipFullscreen] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  const clipFileRef = useRef<HTMLInputElement>(null)
  const clipImgRef = useRef<HTMLImageElement>(null)
  const clipPreviewTargetRef = useRef<HTMLDivElement>(null)

  const descId = useId()
  const urlId = useId()

  const emitUpload = useCallback(
    (files: File[]) => {
      if (!files.length) return
      mdBus.emit(editorId, mdUploadImage, files)
    },
    [editorId]
  )

  const applyImageLink = useCallback(() => {
    const u = url.trim()
    if (!u) return
    mdBus.emit(editorId, mdReplace, 'image', {
      desc: desc.trim(),
      url: u,
      transform: true,
    })
    setLinkOpen(false)
    setDesc('')
    setUrl('')
  }, [desc, editorId, url])

  const openLinkModal = useCallback(() => {
    setMenuOpen(false)
    setDesc('')
    setUrl('')
    setLinkOpen(true)
  }, [])

  const pickFiles = useCallback(() => {
    setMenuOpen(false)
    fileRef.current?.click()
  }, [])

  const openClip = useCallback(() => {
    setMenuOpen(false)
    setClipImgSelected(false)
    setClipImgSrc('')
    setClipFullscreen(false)
    setClipOpen(true)
  }, [])

  useEffect(() => {
    const el = clipFileRef.current
    if (!clipOpen || !el) return
    el.onchange = () => {
      const inst = mdDefaultConfig.editorExtensions.cropper.instance
      if (inst) window.Cropper = inst
      const files = el.files
      if (!files?.length) return
      const reader = new FileReader()
      reader.onload = () => {
        setClipImgSrc(String(reader.result ?? ''))
        setClipImgSelected(true)
      }
      reader.readAsDataURL(files[0])
    }
    return () => {
      el.onchange = null
    }
  }, [clipOpen])

  useEffect(() => {
    clipCropper?.destroy?.()
    clipCropper = null
    if (!clipOpen || !clipImgSrc || !clipImgRef.current || !clipPreviewTargetRef.current) return
    const CropperCtor = window.Cropper ?? mdDefaultConfig.editorExtensions.cropper.instance
    if (!CropperCtor) return
    window.Cropper = CropperCtor
    clipCropper = new CropperCtor(clipImgRef.current, {
      viewMode: 2,
      preview: clipPreviewTargetRef.current,
    })
    return () => {
      clipCropper?.destroy?.()
      clipCropper = null
    }
  }, [clipImgSrc, clipOpen])

  useEffect(() => {
    if (!clipOpen) {
      clipCropper?.destroy?.()
      clipCropper = null
      setClipImgSelected(false)
      setClipImgSrc('')
      setClipFullscreen(false)
      if (clipFileRef.current) clipFileRef.current.value = ''
    }
  }, [clipOpen])

  const clipModalSize = clipFullscreen ? { width: '100%', height: '100%' } : { width: '668px', height: '392px' }

  const confirmCrop = useCallback(() => {
    if (!clipCropper) return
    const canvas = clipCropper.getCroppedCanvas()
    const dataUrl = canvas.toDataURL('image/png')
    const file = mdDataUrlToFile(dataUrl)
    if (file) emitUpload([file])
    clipCropper.destroy?.()
    clipCropper = null
    setClipOpen(false)
  }, [emitUpload])

  const clearClipImage = useCallback(() => {
    clipCropper?.destroy?.()
    clipCropper = null
    if (clipFileRef.current) clipFileRef.current.value = ''
    setClipImgSelected(false)
    setClipImgSrc('')
  }, [])

  const overlay = useMemo(
    () => (
      <ul className={`${prefix}-menu`} role="menu" onClick={() => setMenuOpen(false)}>
        <li
          className={`${prefix}-menu-item ${prefix}-menu-item-image`}
          role="menuitem"
          tabIndex={0}
          onClick={openLinkModal}
        >
          {imgTips.link}
        </li>
        <li
          className={`${prefix}-menu-item ${prefix}-menu-item-image`}
          role="menuitem"
          tabIndex={0}
          onClick={pickFiles}
        >
          {imgTips.upload}
        </li>
        <li
          className={`${prefix}-menu-item ${prefix}-menu-item-image`}
          role="menuitem"
          tabIndex={0}
          onClick={openClip}
        >
          {imgTips.clip2upload}
        </li>
      </ul>
    ),
    [imgTips.clip2upload, imgTips.link, imgTips.upload, openClip, openLinkModal, pickFiles]
  )

  const trigger = useMemo(
    () => (
      <button
        type="button"
        className={`${prefix}-toolbar-item${disabled ? ` ${prefix}-disabled` : ''}`}
        title={tips.image}
        aria-label={tips.image}
        disabled={disabled}
      >
        <MdEditorImageIcon className={`${prefix}-icon`} />
        {showToolbarName ? <div className={`${prefix}-toolbar-item-name`}>{tips.image}</div> : null}
      </button>
    ),
    [disabled, showToolbarName, tips.image]
  )

  return (
    <>
      <label htmlFor={`${toolbarWrapId}_wiki_upload`} className="sr-only">
        {imgTips.upload}
      </label>
      <input
        id={`${toolbarWrapId}_wiki_upload`}
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        aria-hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          emitUpload(files)
        }}
      />

      <DropdownToolbar
        title={tips.image}
        visible={menuOpen}
        onChange={setMenuOpen}
        disabled={disabled}
        overlay={overlay}
        relative={`#${toolbarWrapId}`}
      >
        {trigger}
      </DropdownToolbar>

      <MdModal title={linkTips.imageTitle ?? 'Add image'} visible={linkOpen} onClose={() => setLinkOpen(false)} width="520px">
        <div className="flex flex-col gap-3 px-2 py-1">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-foreground/80" htmlFor={descId}>
              {linkTips.descLabel ?? 'Description'}
            </label>
            <input
              id={descId}
              type="text"
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none ring-offset-background focus:ring-2 focus:ring-ring"
              placeholder={linkTips.descLabelPlaceHolder ?? ''}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-foreground/80" htmlFor={urlId}>
              {linkTips.urlLabel ?? 'URL'}
            </label>
            <input
              id={urlId}
              type="url"
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none ring-offset-background focus:ring-2 focus:ring-ring"
              placeholder={linkTips.urlLabelPlaceHolder ?? ''}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyImageLink()
              }}
            />
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              className={`${prefix}-btn`}
              onClick={() => setLinkOpen(false)}
            >
              Cancel
            </button>
            <button type="button" className={`${prefix}-btn`} onClick={applyImageLink}>
              {linkTips.buttonOK ?? 'OK'}
            </button>
          </div>
        </div>
      </MdModal>

      <MdModal
        title={clipTips.title}
        visible={clipOpen}
        onClose={() => setClipOpen(false)}
        showAdjust
        isFullscreen={clipFullscreen}
        onAdjust={(v) => setClipFullscreen(v)}
        {...clipModalSize}
      >
        <div className={`${prefix}-modal-clip`}>
          <div className={`${prefix}-form-item ${prefix}-clip`}>
            <div className={`${prefix}-clip-main`}>
              {clipImgSelected ? (
                <div className={`${prefix}-clip-cropper`}>
                  <img ref={clipImgRef} src={clipImgSrc} style={{ display: 'none' }} alt="" />
                  <button type="button" className={`${prefix}-clip-delete`} onClick={clearClipImage}>
                    ×
                  </button>
                </div>
              ) : (
                <div
                  className={`${prefix}-clip-upload`}
                  role="button"
                  tabIndex={0}
                  aria-label={imgTips.upload}
                  onClick={() => clipFileRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') clipFileRef.current?.click()
                  }}
                >
                  <MdEditorImageIcon className={`${prefix}-icon`} />
                </div>
              )}
            </div>
            <div className={`${prefix}-clip-preview`}>
              <div ref={clipPreviewTargetRef} className={`${prefix}-clip-preview-target`} />
            </div>
          </div>
          <input ref={clipFileRef} type="file" accept="image/*" className="hidden" aria-hidden />
          <div className={`${prefix}-form-item`}>
            <button type="button" className={`${prefix}-btn`} onClick={confirmCrop}>
              {linkTips.buttonOK ?? 'OK'}
            </button>
          </div>
        </div>
      </MdModal>
    </>
  )
})
