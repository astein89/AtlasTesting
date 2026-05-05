import { useEffect } from 'react'

import type { AmrFleetSettings } from '@/api/amr'
import {
  fleetOperationPostUrl,
  type MultistopFleetTimelineResult,
  type RackMoveFleetPreviewResult,
} from '@/utils/amrRackMoveFleetPreview'

export function AmrMissionNewDebugModal({
  open,
  onClose,
  showDevPayloads = true,
  rackMoveDebugRequestUrl,
  rackMoveDebugRequest,
  usesMultistop,
  rackMoveDebugFleetSettings,
  rackMoveFleetForwardPreview,
  multistopFleetTimeline,
  rackMoveDebugLastErrorJson,
}: {
  open: boolean
  onClose: () => void
  /** When false, show permission hint only (no fleet/API payloads). */
  showDevPayloads?: boolean
  rackMoveDebugRequestUrl: string
  rackMoveDebugRequest: unknown
  usesMultistop: boolean
  rackMoveDebugFleetSettings: AmrFleetSettings | null
  rackMoveFleetForwardPreview: RackMoveFleetPreviewResult | null
  multistopFleetTimeline: MultistopFleetTimelineResult | null
  rackMoveDebugLastErrorJson: unknown | null
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[85] flex items-stretch justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="amr-new-mission-debug-title"
        className="relative z-10 flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-amber-500/35 bg-card shadow-xl sm:max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-amber-500/25 bg-amber-500/[0.08] px-4 py-3 sm:px-5 dark:bg-amber-500/[0.1]">
          <h2 id="amr-new-mission-debug-title" className="text-lg font-semibold tracking-tight text-foreground">
            Debug: rack-move / Add Stop — fleet containerIn &amp; submitMission
          </h2>
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
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 text-xs sm:px-5">
          {!showDevPayloads ? (
            <p className="text-sm leading-relaxed text-foreground/80">
              Full request/fleet debug payloads require the <span className="font-mono text-foreground">amr.tools.dev</span>{' '}
              permission. Ask an administrator if you need access.
            </p>
          ) : (
          <div className="space-y-4">
            <div>
              <p className="font-semibold text-foreground/75">1 · Browser → DC API</p>
              <p className="mt-1 font-mono text-[11px] text-foreground/70">
                Starts <span className="text-foreground/55">POST</span>{' '}
                <span className="break-all text-foreground/90">{rackMoveDebugRequestUrl}</span>
              </p>
              <p className="mt-2 font-semibold text-foreground/75">Body JSON</p>
              <pre className="mt-2 max-h-[min(36vh,320px)] overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
                {JSON.stringify(rackMoveDebugRequest, null, 2)}
              </pre>
            </div>

            <div className="border-t border-border/60 pt-3">
              <p className="font-semibold text-foreground/75">2 · DC server → fleet (sequential)</p>
              <p className="mt-1 text-foreground/60">
                All mission creates use the multistop session API: <span className="font-mono">containerIn</span> first to
                register the load, then <span className="font-mono">submitMission</span> for the first stop (segment 0;
                second call is after containerIn, not parallel). More stops: Missions → Continue.
              </p>
              {!rackMoveDebugFleetSettings ? (
                <p className="mt-2 text-foreground/55">Loading AMR settings for fleet URLs and payloads…</p>
              ) : rackMoveFleetForwardPreview == null ? (
                <p className="mt-2 text-foreground/55">Could not build fleet preview.</p>
              ) : !rackMoveFleetForwardPreview.ok ? (
                <p className="mt-2 text-red-600 dark:text-red-400">{rackMoveFleetForwardPreview.error}</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {rackMoveFleetForwardPreview.value.notes.map((n, ni) => (
                    <p key={ni} className="text-foreground/55">
                      {n}
                    </p>
                  ))}
                  {rackMoveFleetForwardPreview.value.fleetForwardSteps.map((step, i) => (
                    <div key={`${step.operation}-${i}`}>
                      <p className="font-semibold text-foreground/75">
                        2.{i + 1} · Fleet <span className="font-mono text-foreground/90">{step.operation}</span>
                      </p>
                      <p className="mt-1 font-mono text-[11px] text-foreground/70">
                        <span className="text-foreground/55">POST</span>{' '}
                        {fleetOperationPostUrl(rackMoveDebugFleetSettings, step.operation) ?? (
                          <span className="text-foreground/50">
                            (configure fleet server IP/port in AMR settings for full URL)
                          </span>
                        )}
                      </p>
                      <pre className="mt-2 max-h-[min(34vh,280px)] overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
                        {JSON.stringify(step.payload, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {usesMultistop ? (
              <div className="border-t border-border/60 pt-3">
                <p className="font-semibold text-foreground/75">
                  3 · Server → fleet timeline (create, each Continue, worker)
                </p>
                {!rackMoveDebugFleetSettings ? (
                  <p className="mt-2 text-foreground/55">Loading AMR settings for fleet URLs and timeline…</p>
                ) : multistopFleetTimeline == null ? (
                  <p className="mt-2 text-foreground/55">Timeline unavailable.</p>
                ) : !multistopFleetTimeline.ok ? (
                  <p className="mt-2 text-amber-700 dark:text-amber-400">{multistopFleetTimeline.error}</p>
                ) : (
                  <div className="mt-3 space-y-5">
                    <p className="text-foreground/60">
                      Full sequence of fleet operations the DC server performs or loops: initial{' '}
                      <span className="font-mono text-foreground/80">containerIn</span> once, then{' '}
                      <span className="font-mono text-foreground/80">submitMission</span> per stop; later stops use{' '}
                      <span className="font-mono text-foreground/80">POST …/continue</span> (optional{' '}
                      <span className="font-mono text-foreground/80">jobQuery</span>); the worker polls{' '}
                      <span className="font-mono text-foreground/80">jobQuery</span> and may call{' '}
                      <span className="font-mono text-foreground/80">containerOut</span>.
                    </p>
                    {multistopFleetTimeline.phases.map((phase) => (
                      <div key={phase.key} className="rounded-lg border border-border/80 bg-background/50 p-3">
                        <p className="font-semibold text-foreground/85">{phase.title}</p>
                        <p className="mt-1 text-[11px] leading-snug text-foreground/55">{phase.trigger}</p>
                        <div className="mt-3 space-y-4">
                          {phase.operations.map((op, oi) => (
                            <div key={`${phase.key}-${oi}`}>
                              <p className="text-foreground/80">
                                <span className="font-mono text-[11px] text-foreground/90">{op.op}</span>
                                {' — '}
                                <span className="text-[11px]">{op.description}</span>
                              </p>
                              <p className="mt-1 font-mono text-[11px] text-foreground/70">
                                <span className="text-foreground/55">POST</span>{' '}
                                {fleetOperationPostUrl(rackMoveDebugFleetSettings, op.op) ?? (
                                  <span className="text-foreground/50">
                                    (configure fleet server IP/port in AMR settings for full URL)
                                  </span>
                                )}
                              </p>
                              <pre className="mt-2 max-h-[min(30vh,240px)] overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
                                {JSON.stringify(op.payload, null, 2)}
                              </pre>
                              {op.footnote ? (
                                <p className="mt-1 text-[11px] text-foreground/50">{op.footnote}</p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {rackMoveDebugLastErrorJson != null ? (
              <div className="border-t border-border/60 pt-3">
                <p className="font-semibold text-red-600 dark:text-red-400">
                  Last DC API error response (browser ← POST)
                </p>
                <pre className="mt-2 max-h-[min(28vh,240px)] overflow-auto rounded-lg border border-red-500/30 bg-red-500/5 p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
                  {(() => {
                    try {
                      return JSON.stringify(rackMoveDebugLastErrorJson, null, 2)
                    } catch {
                      return String(rackMoveDebugLastErrorJson)
                    }
                  })()}
                </pre>
              </div>
            ) : (
              <p className="border-t border-border/60 pt-3 text-foreground/50">
                After a failed <span className="font-mono">Create mission</span>, the DC API error body appears above.
              </p>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  )
}
