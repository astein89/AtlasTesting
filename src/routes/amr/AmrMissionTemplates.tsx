import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  createMultistopMission,
  getAmrMissionTemplate,
  getAmrSettings,
  getAmrStands,
  listAmrMissionTemplates,
  postStandPresence,
  type AmrMissionTemplateListItem,
} from '@/api/amr'
import type { AmrStandPickerRow } from '@/components/amr/AmrStandPickerModal'
import {
  AmrDestinationOccupiedConfirmBody,
  AmrDestinationOccupiedConfirmFooterRetry,
} from '@/components/amr/AmrDestinationOccupiedConfirmBody'
import {
  AmrPickupAbsentConfirmBody,
  AmrPickupAbsentConfirmFooterRetry,
} from '@/components/amr/AmrPickupAbsentConfirmBody'
import { AmrMissionTemplateEditorModal } from '@/components/amr/AmrMissionTemplateEditorModal'
import { amrPath } from '@/lib/appPaths'
import { useAuthStore } from '@/store/authStore'
import { useAlertConfirm } from '@/contexts/AlertConfirmContext'
import { useAmrMissionNewModal } from '@/contexts/AmrMissionNewModalContext'
import { templatePayloadToMultistopBody, validateMissionTemplatePayloadForCreate } from '@/utils/amrMissionTemplate'
import {
  shouldWarnFirstSegmentDropOccupied,
  shouldWarnFirstStopPickupAbsent,
} from '@/utils/amrPalletPresenceSanity'
import {
  normalizeAmrStandLocationType,
  standRefsNonStandWaypoint,
  standRefsSkippingHyperionOccupancy,
} from '@/utils/amrStandLocationType'

function apiErrorMessage(e: unknown): string {
  const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
  if (typeof msg === 'string' && msg.trim()) return msg
  if (e instanceof Error) return e.message
  return 'Something went wrong.'
}

export function AmrMissionTemplates() {
  const navigate = useNavigate()
  const newMissionModal = useAmrMissionNewModal()
  const { showConfirm } = useAlertConfirm()
  const canManage = useAuthStore((s) => s.hasPermission('amr.missions.manage'))
  const [rows, setRows] = useState<AmrMissionTemplateListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorTemplateId, setEditorTemplateId] = useState<string | null>(null)
  const [creatingId, setCreatingId] = useState<string | null>(null)
  const [createConfirmTemplateId, setCreateConfirmTemplateId] = useState<string | null>(null)
  const standsCacheRef = useRef<AmrStandPickerRow[] | null>(null)

  const load = useCallback(() => {
    setErr(null)
    void listAmrMissionTemplates()
      .then((templates) =>
        setRows(
          templates.map((t) => ({
            ...t,
            stopLines: t.stopLines ?? [],
            robotIds: t.robotIds ?? [],
          }))
        )
      )
      .catch((e) => setErr(apiErrorMessage(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const openTemplateInNewMission = useCallback(
    (templateId: string) => {
      const search = `?template=${encodeURIComponent(templateId)}`
      if (newMissionModal) {
        newMissionModal.openNewMission({ search })
        navigate(amrPath('missions'), { replace: true })
      } else {
        navigate(`${amrPath('missions', 'new')}${search}`)
      }
    },
    [navigate, newMissionModal]
  )

  const ensureStands = useCallback(async (): Promise<AmrStandPickerRow[]> => {
    if (standsCacheRef.current) return standsCacheRef.current
    const rows = await getAmrStands()
    const mapped = rows.map((r) => ({
      id: String(r.id),
      external_ref: String(r.external_ref ?? ''),
      zone: r.zone != null ? String(r.zone) : '',
      location_label: String(r.location_label ?? ''),
      orientation: String(r.orientation ?? '0'),
      location_type: normalizeAmrStandLocationType((r as { location_type?: unknown }).location_type),
    }))
    standsCacheRef.current = mapped
    return mapped
  }, [])

  useEffect(() => {
    if (!canManage) return
    void ensureStands()
  }, [canManage, ensureStands])

  const createMissionFromTemplate = useCallback(
    async (templateId: string, options?: { openOverviewAfter?: boolean }): Promise<boolean> => {
      if (!canManage) return false
      const openOverviewAfter = options?.openOverviewAfter === true
      setCreatingId(templateId)
      setErr(null)
      try {
        const [stands, t, fleetSettings] = await Promise.all([
          ensureStands(),
          getAmrMissionTemplate(templateId),
          getAmrSettings(),
        ])
        const v = validateMissionTemplatePayloadForCreate(t.payload)
        if (!v.ok) {
          setErr(v.message)
          return false
        }
        if (fleetSettings.missionCreateStandPresenceSanityCheck !== false) {
          const legsForCheck = t.payload.legs.map((leg) => ({
            position: leg.position,
            putDown: leg.putDown,
          }))
          const uniquePresenceRefs = [
            ...new Set(legsForCheck.map((l) => l.position.trim()).filter(Boolean)),
          ].sort()
          if (uniquePresenceRefs.length > 0) {
            try {
              const nonStand = standRefsNonStandWaypoint(stands)
              const queryRefs = uniquePresenceRefs.filter((r) => !nonStand.has(r))
              const presenceBatch =
                queryRefs.length > 0 ? await postStandPresence(queryRefs) : ({} as Record<string, boolean>)
              const bypassRefs = standRefsSkippingHyperionOccupancy(stands)
              const pickupWarn = shouldWarnFirstStopPickupAbsent(legsForCheck, presenceBatch, bypassRefs)
              if (pickupWarn.shouldWarn) {
                const pr = pickupWarn.pickupRef.trim()
                const okPickup = await showConfirm(
                  <AmrPickupAbsentConfirmBody pickupRef={pickupWarn.pickupRef} />,
                  {
                    title: pr ? `No pallet at pickup — ${pr}` : 'No pallet at pickup',
                    confirmLabel: 'Create mission anyway',
                    footerExtra: <AmrPickupAbsentConfirmFooterRetry />,
                    omitFooterCancel: true,
                  }
                )
                if (!okPickup) return false
              }
              const { shouldWarn, destinationRef } = shouldWarnFirstSegmentDropOccupied(
                legsForCheck,
                presenceBatch,
                bypassRefs
              )
              if (shouldWarn) {
                const destTitle = destinationRef.trim()
                const ok = await showConfirm(
                  <AmrDestinationOccupiedConfirmBody destinationRef={destinationRef} />,
                  {
                    title: destTitle ? `Destination not empty — ${destTitle}` : 'Destination not empty',
                    confirmLabel: 'Create mission anyway',
                    footerExtra: <AmrDestinationOccupiedConfirmFooterRetry />,
                    omitFooterCancel: true,
                  }
                )
                if (!ok) return false
              }
            } catch {
              /* Hyperion unset / network — do not block create */
            }
          }
        }
        const body = templatePayloadToMultistopBody(t.payload, stands)
        const data = (await createMultistopMission(body)) as { multistopSessionId?: unknown }
        const sid =
          typeof data.multistopSessionId === 'string' ? data.multistopSessionId.trim() : ''
        if (openOverviewAfter) {
          if (sid) {
            navigate(
              `${amrPath('missions')}?${new URLSearchParams({ multistopSummary: sid }).toString()}`
            )
          } else {
            navigate(amrPath('missions'))
          }
        }
        return true
      } catch (e) {
        setErr(apiErrorMessage(e))
        return false
      } finally {
        setCreatingId(null)
      }
    },
    [canManage, ensureStands, navigate, showConfirm]
  )

  const createConfirmTemplate = createConfirmTemplateId
    ? rows.find((x) => x.id === createConfirmTemplateId)
    : undefined
  const createConfirmName = createConfirmTemplate?.name?.trim() || 'this template'

  const createConfirmBusy = Boolean(
    createConfirmTemplateId && creatingId !== null && creatingId === createConfirmTemplateId
  )

  useEffect(() => {
    if (!createConfirmTemplateId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !createConfirmBusy) setCreateConfirmTemplateId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [createConfirmTemplateId, createConfirmBusy])

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      {createConfirmTemplateId ? (
        <div className="fixed inset-0 z-[100] flex min-h-0 items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Close dialog"
            disabled={createConfirmBusy}
            onClick={() => {
              if (!createConfirmBusy) setCreateConfirmTemplateId(null)
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="amr-template-create-confirm-title"
            className="relative z-10 flex min-w-0 w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
              <h2
                id="amr-template-create-confirm-title"
                className="min-w-0 flex-1 text-lg font-semibold tracking-tight text-foreground"
              >
                Create mission
              </h2>
              <button
                type="button"
                disabled={createConfirmBusy}
                onClick={() => setCreateConfirmTemplateId(null)}
                className="shrink-0 rounded-lg p-2 text-foreground/70 hover:bg-background hover:text-foreground disabled:opacity-50"
                aria-label="Close"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p
              className="min-w-0 truncate px-4 py-3 text-sm text-foreground sm:px-5"
              title={`Start a mission from “${createConfirmName}” now?`}
            >
              Start a mission from “{createConfirmName}” now?
            </p>
            <div className="flex shrink-0 flex-nowrap items-center justify-end gap-1.5 overflow-x-auto border-t border-border px-3 py-3 sm:gap-2 sm:px-5">
              <button
                type="button"
                disabled={createConfirmBusy}
                className="inline-flex min-h-[40px] shrink-0 items-center rounded-lg border border-border px-2.5 text-sm hover:bg-background disabled:opacity-50 sm:min-h-[44px] sm:px-4"
                onClick={() => setCreateConfirmTemplateId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={createConfirmBusy}
                className="inline-flex min-h-[40px] shrink-0 items-center rounded-lg border border-zinc-200 bg-white px-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-100 sm:min-h-[44px] sm:px-4"
                onClick={() => {
                  const id = createConfirmTemplateId
                  if (!id) return
                  void createMissionFromTemplate(id, { openOverviewAfter: true }).then((ok) => {
                    if (ok) setCreateConfirmTemplateId(null)
                  })
                }}
              >
                {createConfirmBusy ? 'Submitting…' : 'Create and show'}
              </button>
              <button
                type="button"
                disabled={createConfirmBusy}
                className="inline-flex min-h-[40px] shrink-0 items-center rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 text-sm font-medium text-foreground hover:bg-amber-500/15 disabled:opacity-50 dark:border-amber-500/35 sm:min-h-[44px] sm:px-4"
                onClick={() => {
                  const id = createConfirmTemplateId
                  if (!id) return
                  void createMissionFromTemplate(id, { openOverviewAfter: false }).then((ok) => {
                    if (ok) setCreateConfirmTemplateId(null)
                  })
                }}
              >
                {createConfirmBusy ? 'Submitting…' : 'Create mission'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <AmrMissionTemplateEditorModal
        open={editorOpen}
        templateId={editorTemplateId}
        onClose={() => {
          setEditorOpen(false)
          setEditorTemplateId(null)
        }}
        onSaved={() => {
          load()
          setEditorOpen(false)
          setEditorTemplateId(null)
        }}
        onDeleted={() => {
          load()
          setEditorOpen(false)
          setEditorTemplateId(null)
        }}
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Mission templates</h1>
          <p className="mt-1 text-sm text-foreground/70">
            Shared routes you can load on{' '}
            <Link className="text-primary underline" to={amrPath('missions', 'new')}>
              New mission
            </Link>
            . {canManage ? 'Anyone with AMR access can load; managers can edit this list.' : null}
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            className="inline-flex min-h-[44px] shrink-0 items-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-100"
            onClick={() => {
              setEditorTemplateId(null)
              setEditorOpen(true)
            }}
          >
            New template
          </button>
        ) : null}
      </div>

      {err ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-950 dark:text-red-50">
          {err}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-foreground/60">Loading templates…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-foreground/70">
          No templates yet. Create a mission and use <strong>Save as template</strong>, or ask a mission manager to add
          one.
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <li key={r.id}>
              <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-colors hover:border-primary/45">
                <div className="flex flex-1 flex-col p-4">
                  <div className="min-w-0 space-y-2">
                    <span className="line-clamp-2 text-base font-semibold leading-snug text-foreground">{r.name}</span>
                    {r.stopLines.length > 0 ? (
                      <div className="space-y-0.5 font-mono text-[11px] leading-snug text-foreground/90 sm:text-xs">
                        {r.stopLines.map((line, i) => (
                          <div
                            key={`${r.id}-line-${i}`}
                            className={
                              line.trimStart().startsWith('+')
                                ? 'text-foreground/55 italic'
                                : 'truncate'
                            }
                            title={line}
                          >
                            {line}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {r.robotIds.length > 0 ? (
                      <p className="text-[11px] leading-snug text-foreground/75 sm:text-xs">
                        <span className="font-medium text-foreground/85">Robots </span>
                        <span className="break-words">{r.robotIds.join(', ')}</span>
                      </p>
                    ) : null}
                  </div>
                </div>
                <div
                  className="flex flex-nowrap items-stretch gap-1 border-t border-border bg-muted/20 px-2 py-2 sm:gap-1.5 sm:px-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  {canManage ? (
                    <button
                      type="button"
                      className="inline-flex min-h-[40px] min-w-0 flex-1 items-center justify-center rounded-lg border border-border px-1 text-[11px] font-medium leading-tight text-foreground hover:bg-background sm:text-xs"
                      onClick={() => {
                        setEditorTemplateId(r.id)
                        setEditorOpen(true)
                      }}
                    >
                      <span className="truncate">Edit</span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="inline-flex min-h-[40px] min-w-0 flex-1 items-center justify-center rounded-lg border border-zinc-200 bg-white px-1 text-[11px] font-medium leading-tight text-zinc-900 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-100 sm:text-xs"
                    onClick={() => openTemplateInNewMission(r.id)}
                  >
                    <span className="truncate">Open</span>
                  </button>
                  {canManage ? (
                    <button
                      type="button"
                      disabled={creatingId !== null}
                      className="inline-flex min-h-[40px] min-w-0 flex-1 items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/10 px-1 text-[11px] font-medium leading-tight text-foreground hover:bg-amber-500/15 disabled:opacity-50 dark:border-amber-500/35 sm:text-xs"
                      onClick={() => setCreateConfirmTemplateId(r.id)}
                    >
                      <span className="truncate">{creatingId === r.id ? 'Creating…' : 'Create'}</span>
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
