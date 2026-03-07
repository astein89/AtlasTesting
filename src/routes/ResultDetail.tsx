import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api/client'
import { formatDateTime } from '../lib/dateTimeConfig'
import {
  buildFormRowsFromOrder,
  normalizeFormLayoutOrder,
  SPAN_TO_COLS,
  type LayoutRow,
} from '../utils/formLayout'
import { formatFieldValue } from '../utils/formatFieldValue'
import type { DataField, TestPlan, TimerValue } from '../types'

interface Record {
  id: string
  testPlanId: string
  planName: string
  recordedAt: string
  enteredBy: string
  enteredByName?: string
  status: string
  data: Record<string, string | number | boolean | string[] | TimerValue>
}

const FORM_GRID_COLS = 6

function getDisplayVal(
  record: Record,
  key: string,
  field?: DataField
): string {
  const v = record.data[key]
  if (field) return formatFieldValue(field, v)
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number') return String(v)
  return String(v ?? '—')
}

export function ResultDetail() {
  const { id } = useParams<{ id: string }>()
  const [record, setRecord] = useState<Record | null>(null)
  const [plan, setPlan] = useState<TestPlan | null>(null)
  const [fields, setFields] = useState<DataField[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    api
      .get<Record>(`/records/${id}`)
      .then((r) => {
        setRecord(r.data)
        return r.data
      })
      .catch(() => {
        setRecord(null)
        setPlan(null)
        setFields([])
      })
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    if (!record?.testPlanId) return
    api
      .get<TestPlan>(`/test-plans/${record.testPlanId}`)
      .then((r) => {
        setPlan(r.data)
        const fieldIds = r.data.fieldIds?.length ? r.data.fieldIds : []
        if (fieldIds.length === 0) {
          setFields([])
          return
        }
        return Promise.allSettled(
          fieldIds.map((fid: string) =>
            api.get<DataField>(`/fields/${fid}`).then((fr) => fr.data)
          )
        )
      })
      .then((settled) => {
        if (settled) {
          const f = settled
            .filter((r): r is PromiseFulfilledResult<DataField> => r.status === 'fulfilled' && r.value != null)
            .map((r) => r.value)
          setFields(f)
        }
      })
      .catch(() => {
        setPlan(null)
        setFields([])
      })
  }, [record?.testPlanId])

  if (loading || !record) return <p className="text-foreground/60">Loading...</p>

  const formLayoutOrder = normalizeFormLayoutOrder(plan?.formLayoutOrder, fields)
  const formRows: LayoutRow[] = buildFormRowsFromOrder(fields, formLayoutOrder)

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">
          {record.planName} – {formatDateTime(record.recordedAt)}
        </h1>
        <Link
          to="/results"
          className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
        >
          Back to Results
        </Link>
      </div>
      <div className="space-y-4 rounded-lg border border-border bg-card p-6">
        <div className="flex gap-4">
          <span className="text-foreground/60">
            Entered by: {record.enteredByName ?? record.enteredBy}
          </span>
        </div>
        <div>
          <h2 className="mb-3 font-medium text-foreground">Data</h2>
          {formRows.length === 0 ? (
            <p className="text-sm text-foreground/60">No fields configured for this plan.</p>
          ) : (
            <div className="space-y-3">
              {formRows.map((row, ri) =>
                Array.isArray(row) ? (
                  <div
                    key={ri}
                    className="grid gap-3 sm:gap-4"
                    style={{
                      gridTemplateColumns: `repeat(${FORM_GRID_COLS}, minmax(0, 1fr))`,
                    }}
                  >
                    {row.map(({ field, span }) => (
                      <div
                        key={field.id}
                        className="min-w-0 rounded bg-background p-3"
                        style={{
                          gridColumn: `span ${SPAN_TO_COLS[span]}`,
                        }}
                      >
                        <dt className="mb-0.5 text-xs font-medium text-foreground/60">
                          {field.label}
                        </dt>
                        <dd className="font-medium text-foreground">
                          {field.type === 'image' ? (
                            (() => {
                              const v = record.data[field.key]
                              const paths = (Array.isArray(v) ? v : v ? [v] : []).filter(
                                (p): p is string => typeof p === 'string' && p.length > 0
                              )
                              if (paths.length === 0) return '—'
                              const toUrl = (p: string) =>
                                p.startsWith('http') ? p : `${window.location.origin}${p.startsWith('/') ? '' : '/'}${p}`
                              return (
                                <div className="mt-1 flex flex-wrap gap-2">
                                  {paths.map((path, i) => (
                                    <a
                                      key={i}
                                      href={toUrl(path)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="block overflow-hidden rounded-lg border border-border bg-background"
                                    >
                                      <img
                                        src={toUrl(path)}
                                        alt={field.config?.imageTag ? `${field.config.imageTag} ${i + 1}` : `Photo ${i + 1}`}
                                        className="h-24 w-24 object-cover"
                                      />
                                    </a>
                                  ))}
                                </div>
                              )
                            })()
                          ) : field.type === 'longtext' ? (
                            <span className="whitespace-pre-wrap break-words">
                              {getDisplayVal(record, field.key, field)}
                            </span>
                          ) : (
                            getDisplayVal(record, field.key, field)
                          )}
                        </dd>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div key={ri} className="border-t-2 border-border" />
                )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
