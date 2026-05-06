import { useEffect, useRef, useState } from 'react'
import { deleteAmrMissionTemplate } from '@/api/amr'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import {
  AmrMissionNewForm,
  MissionErrorBanner,
  type AmrMissionNewFormHandle,
} from '@/routes/amr/AmrMissionNew'
import { useAuthStore } from '@/store/authStore'

function apiErrorMessage(e: unknown): string {
  const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
  if (typeof msg === 'string' && msg.trim()) return msg
  if (e instanceof Error) return e.message
  return 'Something went wrong.'
}

export function AmrMissionTemplateEditorModal({
  open,
  onClose,
  templateId,
  onSaved,
  onDeleted,
}: {
  open: boolean
  onClose: () => void
  /** `null` = create a new template; string id = edit */
  templateId: string | null
  onSaved?: () => void
  /** After successful delete (editor closes via parent). */
  onDeleted?: () => void
}) {
  const formRef = useRef<AmrMissionNewFormHandle>(null)
  const canAmrApiDebug = useAuthStore((s) => s.hasPermission('amr.tools.dev'))
  const [missionError, setMissionError] = useState('')
  const [clearErrorsNonce, setClearErrorsNonce] = useState(0)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)

  useEffect(() => {
    if (!open) {
      setMissionError('')
      setClearErrorsNonce(0)
      setDeleteConfirmOpen(false)
      setDeleteBusy(false)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !deleteConfirmOpen) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, deleteConfirmOpen])

  if (!open) return null

  const title = templateId ? 'Edit mission template' : 'New mission template'

  const confirmDelete = async () => {
    const id = templateId?.trim()
    if (!id || deleteBusy) return
    setDeleteBusy(true)
    setMissionError('')
    try {
      await deleteAmrMissionTemplate(id)
      setDeleteConfirmOpen(false)
      onDeleted?.()
    } catch (e) {
      setMissionError(apiErrorMessage(e))
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <>
      <ConfirmModal
        open={deleteConfirmOpen}
        title="Delete template"
        message="Remove this saved mission template? This cannot be undone."
        confirmLabel={deleteBusy ? 'Deleting…' : 'Delete'}
        variant="danger"
        onCancel={() => {
          if (!deleteBusy) setDeleteConfirmOpen(false)
        }}
        onConfirm={() => void confirmDelete()}
      />
      <div className="fixed inset-0 z-[62] flex min-h-0 items-stretch justify-center p-0 sm:items-center sm:p-4">
        <div className="absolute inset-0 bg-black/50" aria-hidden />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="amr-template-editor-title"
          className="relative z-10 flex h-full min-h-0 max-h-[100dvh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl sm:h-auto sm:max-h-[min(90vh,100dvh)]"
          onClick={(e) => e.stopPropagation()}
        >
        <div className="flex shrink-0 flex-nowrap items-center justify-between gap-2 border-b border-border px-3 py-2.5 sm:gap-3 sm:px-5 sm:py-3">
          <h2
            id="amr-template-editor-title"
            className="min-w-0 flex-1 truncate pr-1 text-base font-semibold tracking-tight text-foreground sm:pr-2 sm:text-lg"
          >
            {title}
          </h2>
          <div className="flex shrink-0 items-center justify-end gap-1.5 sm:gap-2">
            {canAmrApiDebug ? (
              <button
                type="button"
                className="inline-flex min-h-9 min-w-0 items-center justify-center rounded-lg border border-dashed border-red-500/45 bg-red-500/[0.06] px-2.5 text-xs text-red-700 hover:bg-red-500/10 sm:min-h-[44px] sm:px-3 sm:text-sm dark:border-red-500/35 dark:bg-red-500/[0.08] dark:text-red-300 dark:hover:bg-red-500/15 md:px-4"
                onClick={() => formRef.current?.openDebug()}
              >
                <span className="sm:hidden">Debug</span>
                <span className="hidden sm:inline">Debug…</span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg p-2 text-foreground/70 hover:bg-background hover:text-foreground"
              aria-label="Close"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <MissionErrorBanner
          flush
          message={missionError}
          onDismiss={() => {
            setMissionError('')
            setClearErrorsNonce((n) => n + 1)
          }}
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 sm:px-5">
          <AmrMissionNewForm
            ref={formRef}
            key={templateId ?? 'new'}
            variant="templateEditor"
            templateEditorId={templateId}
            initialSearch=""
            onRequestClose={onClose}
            onMissionErrorChange={setMissionError}
            clearMissionErrorsNonce={clearErrorsNonce}
            onTemplateEditorSaved={onSaved}
            onRequestDeleteTemplate={templateId ? () => setDeleteConfirmOpen(true) : undefined}
            deleteTemplateBusy={deleteBusy}
          />
        </div>
      </div>
    </div>
    </>
  )
}
