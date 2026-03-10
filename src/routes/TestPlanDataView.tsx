import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useSortableHeader } from '../hooks/useSortableHeader'
import { useUserPreference } from '../hooks/useUserPreference'
import { format, addDays } from 'date-fns'
import { formatDate, formatDateTime } from '../lib/dateTimeConfig'
import { api } from '../api/client'
import { formatDecimalAsFraction } from '../utils/fraction'
import { useAuthStore } from '../store/authStore'
import { EditRecordModal } from '../components/data/EditRecordModal'
import { AddRecordModal } from '../components/data/AddRecordModal'
import { ColumnFilterDropdown } from '../components/data/ColumnFilterDropdown'
import { ExportPlanModal } from '../components/plan/ExportPlanModal'
import { renderFormField } from '../components/fields/FormFieldRenderer'
import { SelectInput } from '../components/fields/SelectInput'
import { PopupSelect } from '../components/ui/PopupSelect'
import {
  buildFormRowsFromOrder,
  isSeparatorId,
  isSeparatorLineId,
  normalizeFormLayoutOrder,
  parseFieldEntry,
  truncateFormRowsForCompact,
} from '../utils/formLayout'
import type { DataField, TestPlan, TimerValue } from '../types'
import { getStatusOptions } from '../types'
import { getElapsedMs, formatTimerMs, parseTimerValue } from '../utils/timer'
import { getDefaultValueForField } from '../utils/fieldDefaults'
import { computeFormulaValues } from '../utils/formulaEvaluator'
import { formatFieldValue } from '../utils/formatFieldValue'
import { getContrastTextColor } from '../utils/colorContrast'
import { useAlertConfirm } from '../contexts/AlertConfirmContext'

interface Record {
  id: string
  testPlanId: string
  planName: string
  recordedAt: string
  enteredBy: string
  status: string
  data: Record<string, string | number | boolean | string[] | TimerValue>
  runId?: string
}

function getDefaultData(
  fields: DataField[],
  plan?: { fieldDefaults?: Record<string, string | number | boolean | string[] | TimerValue> } | null
): Record<string, string | number | boolean | string[] | TimerValue> {
  const defaults = plan?.fieldDefaults
  const out: Record<string, string | number | boolean | string[] | TimerValue> = {}
  for (const f of fields) {
    const planDefault = defaults?.[f.key]
    if (planDefault !== undefined && planDefault !== null) {
      if (f.type === 'number' && (typeof planDefault === 'number' || planDefault === '')) out[f.key] = planDefault
      else if (f.type === 'boolean' && typeof planDefault === 'boolean') out[f.key] = planDefault
      else if (f.type === 'select' && typeof planDefault === 'string') out[f.key] = planDefault
      else if (f.type === 'status' && typeof planDefault === 'string') out[f.key] = planDefault
      else if ((f.type === 'text' || f.type === 'longtext') && typeof planDefault === 'string') out[f.key] = planDefault
      else if (f.type === 'fraction' && typeof planDefault === 'number') out[f.key] = planDefault
      else if (f.type === 'atlas_location' && typeof planDefault === 'string') out[f.key] = planDefault
      else if (f.type === 'image') {
        if (Array.isArray(planDefault)) out[f.key] = planDefault
        else if (planDefault === '') out[f.key] = f.config?.imageMultiple ? [] : ''
      } else if (f.type === 'timer' && planDefault && typeof planDefault === 'object' && 'totalElapsedMs' in planDefault) {
        const t = planDefault as { totalElapsedMs?: number; startedAt?: string }
        if (typeof t.totalElapsedMs === 'number' && t.totalElapsedMs >= 0) {
          out[f.key] = { totalElapsedMs: t.totalElapsedMs, startedAt: typeof t.startedAt === 'string' ? t.startedAt : undefined }
        } else {
          out[f.key] = { totalElapsedMs: 0 }
        }
      } else if (f.type === 'formula') {
        out[f.key] = getDefaultValueForField(f, defaults)
      } else {
        out[f.key] = typeof planDefault === 'string' ? planDefault : String(planDefault)
      }
    } else {
      if (f.type === 'number') out[f.key] = ''
      else if (f.type === 'fraction') out[f.key] = 0
      else if (f.type === 'boolean') out[f.key] = false
      else if (f.type === 'longtext') out[f.key] = ''
      else if (f.type === 'select') out[f.key] = ''
      else if (f.type === 'status') {
        const opts = getStatusOptions(f)
        out[f.key] = opts[0] ?? 'In Progress'
      }
      else if (f.type === 'atlas_location') out[f.key] = ''
      else if (f.type === 'image') out[f.key] = f.config?.imageMultiple ? [] : ''
      else if (f.type === 'timer') out[f.key] = { totalElapsedMs: 0 }
      else if (f.type === 'formula') out[f.key] = getDefaultValueForField(f, defaults)
      else out[f.key] = ''
    }
  }
  return computeFormulaValues(fields, out)
}

export function TestPlanDataView() {
  const { planId } = useParams<{ planId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const [plan, setPlan] = useState<TestPlan | null>(null)
  const [fields, setFields] = useState<DataField[]>([])
  const [records, setRecords] = useState<Record[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [editData, setEditData] = useState<Record<string, string | number | boolean | string[] | TimerValue>>({})
  const [addData, setAddData] = useState<Record<string, string | number | boolean | string[] | TimerValue>>({})
  const [submitting, setSubmitting] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [reinstatingRun, setReinstatingRun] = useState<{ startDate: string; endDate: string } | null>(null)
  const [deletingRun, setDeletingRun] = useState<{ startDate: string; endDate: string } | null>(null)
  const [deleteArchivePending, setDeleteArchivePending] = useState<{ startDate: string; endDate: string } | null>(null)
  const [reinstateChoicePending, setReinstateChoicePending] = useState<{ startDate: string; endDate: string } | null>(null)
  const [showArchiveModal, setShowArchiveModal] = useState(false)
  const [archiveConfirmPending, setArchiveConfirmPending] = useState<{ runStart: string; runEnd: string } | null>(null)
  const [deleteRecordPending, setDeleteRecordPending] = useState<string | null>(null)
  const [showAddRowDatesModal, setShowAddRowDatesModal] = useState(false)
  const [addRowStartDate, setAddRowStartDate] = useState('')
  const [addRowEndDate, setAddRowEndDate] = useState('')
  const [archiveStartDate, setArchiveStartDate] = useState('')
  const [archiveEndDate, setArchiveEndDate] = useState('')
  const [viewingArchivedRun, setViewingArchivedRun] = useState<{ startDate: string; endDate: string } | null>(null)
  const [showExportModal, setShowExportModal] = useState(false)
  const [planInfoCollapsed, setPlanInfoCollapsed] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  type ViewMode = 'table' | 'card' | 'compact-card' | 'responsive'
  const [viewMode, setViewMode] = useUserPreference<ViewMode>('atlas-data-view-mode', 'responsive')
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    setIsMobile(mq.matches)
    const handler = () => setIsMobile(mq.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  const effectiveViewMode: 'table' | 'card' | 'compact-card' =
    viewMode === 'responsive' ? (isMobile ? 'compact-card' : 'table') : viewMode
  const showTableView = effectiveViewMode === 'table'
  const showCardView = effectiveViewMode === 'card' || effectiveViewMode === 'compact-card'
  const compactCards = effectiveViewMode === 'compact-card'
  const [columnFilters, setColumnFilters] = useState<Record<string, Set<string>>>({})
  const [openFilterColumn, setOpenFilterColumn] = useState<string | null>(null)
  const [showMobileFilterPanel, setShowMobileFilterPanel] = useState(false)
  const statusTabPrefKey = `atlas-data-status-tab-${planId ?? 'default'}`
  const [selectedStatusTab, setSelectedStatusTab] = useUserPreference(statusTabPrefKey, 'All')
  const [openColumnPicker, setOpenColumnPicker] = useState(false)
  const columnPickerAnchorRef = useRef<HTMLButtonElement | null>(null)
  const filterAnchorRefs = useRef<Record<string, HTMLElement | null>>({})
  const isAdmin = useAuthStore((s) => s.isAdmin())
  const canEditData = useAuthStore((s) => s.canEditData())
  const { showAlert } = useAlertConfirm()

  const columnsPrefKey = planId ? `atlas-data-hidden-columns-${planId}` : 'atlas-data-hidden-columns-default'
  const [hiddenColumnKeys, setHiddenColumnKeys] = useUserPreference<string[]>(columnsPrefKey, [])
  const [directTableEdit, setDirectTableEdit] = useUserPreference('atlas-direct-table-edit', false)
  const [bulkSelectMode, setBulkSelectMode] = useUserPreference('atlas-bulk-select-mode', false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBulkEditModal, setShowBulkEditModal] = useState(false)
  const [bulkDeletePending, setBulkDeletePending] = useState(false)
  const [bulkEditFieldKey, setBulkEditFieldKey] = useState<string | null>(null)
  const [bulkEditValue, setBulkEditValue] = useState<string | number | boolean | string[] | TimerValue | null>(null)
  const visibleFields = useMemo(
    () =>
      fields.filter(
        (f) => !(plan?.hiddenFieldIds ?? []).includes(f.id) && !hiddenColumnKeys.includes(f.key)
      ),
    [fields, hiddenColumnKeys, plan?.hiddenFieldIds]
  )
  const toggleColumnVisibility = (fieldKey: string) => {
    setHiddenColumnKeys((prev) =>
      prev.includes(fieldKey) ? prev.filter((k) => k !== fieldKey) : [...prev, fieldKey]
    )
  }

  const loadRecords = useCallback(() => {
    if (!planId) return
    api
      .get<Record[]>('/records', { params: { testPlanId: planId, limit: 100 } })
      .then((r) => setRecords(r.data))
      .catch(() => setRecords([]))
  }, [planId])

  const handleArchiveCurrent = useCallback(
    (startDateStr: string, endDateStr: string) => {
      if (!planId || !plan) return
      setArchiving(true)
      const startDate = startDateStr.trim() || format(new Date(), 'yyyy-MM-dd')
      const endDate = endDateStr.trim() || format(new Date(), 'yyyy-MM-dd')
      const archivedRuns = [...(plan.archivedRuns ?? []), { startDate, endDate }]
      api
        .put(`/test-plans/${planId}`, { archivedRuns, startDate: null, endDate: null })
        .then(() =>
          api.get<TestPlan>(`/test-plans/${planId}`).then((r) => {
            setPlan(r.data)
            setViewingArchivedRunAndUrl(null)
            setShowArchiveModal(false)
            loadRecords()
          })
        )
        .catch((e: unknown) => {
          const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
          showAlert(msg || 'Failed to archive')
        })
        .finally(() => setArchiving(false))
    },
    [planId, plan, loadRecords]
  )

  /** Whether the current plan period has any records (so we can offer merge vs archive current). */
  const currentPeriodHasRecords = useMemo(() => {
    const start = plan?.startDate
    const end = plan?.endDate
    const startMs = start ? new Date(start + 'T00:00:00').getTime() : -Infinity
    const endMs = end ? new Date(end + 'T23:59:59.999').getTime() : Infinity
    return records.some((r) => {
      if (r.runId) return false
      const t = new Date(r.recordedAt).getTime()
      return t >= startMs && t <= endMs
    })
  }, [records, plan?.startDate, plan?.endDate])

  const handleReinstateRun = useCallback(
    (run: { startDate: string; endDate: string }) => {
      if (!planId || !plan) return
      setReinstatingRun(run)
      const archivedRuns = (plan.archivedRuns ?? []).filter(
        (r) => !(r.startDate === run.startDate && r.endDate === run.endDate)
      )
      api
        .put(`/test-plans/${planId}`, {
          startDate: run.startDate,
          endDate: run.endDate,
          archivedRuns,
        })
        .then(() =>
          api.get<TestPlan>(`/test-plans/${planId}`).then((r) => {
            setPlan(r.data)
            setViewingArchivedRunAndUrl(null)
            setShowArchiveModal(false)
            setReinstateChoicePending(null)
            loadRecords()
          })
        )
        .catch((e: unknown) => {
          const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
          showAlert(msg || 'Failed to reinstate run')
        })
        .finally(() => setReinstatingRun(null))
    },
    [planId, plan, loadRecords]
  )

  const handleReinstateMerge = useCallback(
    (run: { startDate: string; endDate: string }) => {
      if (!planId || !plan) return
      setReinstatingRun(run)
      const mergedStart =
        [plan.startDate, run.startDate].filter(Boolean).length > 0
          ? [plan.startDate, run.startDate].filter(Boolean).sort()[0]
          : run.startDate
      const mergedEnd =
        [plan.endDate, run.endDate].filter(Boolean).length > 0
          ? [plan.endDate, run.endDate].filter(Boolean).sort().reverse()[0]
          : run.endDate
      const archivedRuns = (plan.archivedRuns ?? []).filter(
        (r) => !(r.startDate === run.startDate && r.endDate === run.endDate)
      )
      api
        .put(`/test-plans/${planId}`, {
          startDate: mergedStart,
          endDate: mergedEnd,
          archivedRuns,
        })
        .then(() =>
          api.get<TestPlan>(`/test-plans/${planId}`).then((r) => {
            setPlan(r.data)
            setViewingArchivedRunAndUrl(null)
            setShowArchiveModal(false)
            setReinstateChoicePending(null)
            loadRecords()
          })
        )
        .catch((e: unknown) => {
          const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
          showAlert(msg || 'Failed to merge')
        })
        .finally(() => setReinstatingRun(null))
    },
    [planId, plan, loadRecords]
  )

  const handleDeleteArchivedRun = useCallback(
    (run: { startDate: string; endDate: string }) => {
      if (!planId || !plan) return
      setDeletingRun(run)
      const archivedRuns = (plan.archivedRuns ?? []).filter(
        (r) => !(r.startDate === run.startDate && r.endDate === run.endDate)
      )
      api
        .put(`/test-plans/${planId}`, { archivedRuns })
        .then(() =>
          api.get<TestPlan>(`/test-plans/${planId}`).then((r) => {
            setPlan(r.data)
            if (viewingArchivedRun?.startDate === run.startDate && viewingArchivedRun?.endDate === run.endDate) {
              setViewingArchivedRunAndUrl(null)
            }
            setShowArchiveModal(false)
            loadRecords()
          })
        )
        .catch((e: unknown) => {
          const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
          showAlert(msg || 'Failed to delete archived run')
        })
        .finally(() => setDeletingRun(null))
    },
    [planId, plan, viewingArchivedRun, loadRecords]
  )

  const handleReinstateArchiveCurrent = useCallback(
    (run: { startDate: string; endDate: string }) => {
      if (!planId || !plan) return
      setReinstatingRun(run)
      const currentStart = plan.startDate ?? run.startDate
      const currentEnd = plan.endDate ?? run.endDate
      const archivedRuns = [
        ...(plan.archivedRuns ?? []).filter(
          (r) => !(r.startDate === run.startDate && r.endDate === run.endDate)
        ),
        { startDate: currentStart, endDate: currentEnd },
      ]
      api
        .put(`/test-plans/${planId}`, {
          startDate: run.startDate,
          endDate: run.endDate,
          archivedRuns,
        })
        .then(() =>
          api.get<TestPlan>(`/test-plans/${planId}`).then((r) => {
            setPlan(r.data)
            setViewingArchivedRunAndUrl(null)
            setShowArchiveModal(false)
            setReinstateChoicePending(null)
            loadRecords()
          })
        )
        .catch((e: unknown) => {
          const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
          showAlert(msg || 'Failed to reinstate')
        })
        .finally(() => setReinstatingRun(null))
    },
    [planId, plan, loadRecords]
  )

  useEffect(() => {
    if (!planId) return
    api
      .get<TestPlan>(`/test-plans/${planId}`)
      .then((r) => {
        setPlan(r.data)
        const fieldIds = r.data.fieldIds?.length ? r.data.fieldIds : []
        if (fieldIds.length === 0) {
          setFields([])
          setAddData({})
          return
        }
        return Promise.allSettled(
          fieldIds.map((fid: string) =>
            api.get<DataField>(`/fields/${fid}`).then((fr) => fr.data)
          )
        ).then((results) => {
          const f = results
            .filter((r): r is PromiseFulfilledResult<DataField> => r.status === 'fulfilled' && r.value != null)
            .map((r) => r.value)
          setFields(f)
          setAddData(getDefaultData(f, r.data))
        })
      })
      .catch(() => setPlan(null))
      .finally(() => setLoading(false))
  }, [planId])

  useEffect(() => {
    if (planId) loadRecords()
  }, [planId, loadRecords])

  useEffect(() => {
    if (!planId) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadRecords()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [planId, loadRecords])

  const POLL_INTERVAL_MS = 10_000
  useEffect(() => {
    if (!planId) return
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') loadRecords()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [planId, loadRecords])

  const runParam = searchParams.get('run')
  useEffect(() => {
    if (!plan?.archivedRuns?.length || !runParam) return
    const parts = runParam.split('_')
    if (parts.length !== 2) return
    const [startDate, endDate] = parts
    const run = plan.archivedRuns.find((r) => r.startDate === startDate && r.endDate === endDate)
    if (run) setViewingArchivedRun(run)
  }, [plan?.archivedRuns, runParam])

  const setViewingArchivedRunAndUrl = useCallback(
    (run: { startDate: string; endDate: string } | null) => {
      setViewingArchivedRun(run)
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (run) next.set('run', `${run.startDate}_${run.endDate}`)
          else next.delete('run')
          const s = next.toString()
          return s ? next : new URLSearchParams()
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

  const hasModalOpen =
    showArchiveModal ||
    !!reinstateChoicePending ||
    !!deleteArchivePending ||
    !!archiveConfirmPending ||
    !!deleteRecordPending ||
    showAddRowDatesModal ||
    showExportModal ||
    !!editingId ||
    isAdding ||
    showBulkEditModal ||
    bulkDeletePending

  const closeTopmostModal = useCallback(() => {
    if (reinstateChoicePending) {
      setReinstateChoicePending(null)
      setShowArchiveModal(true)
    } else if (deleteArchivePending) {
      setDeleteArchivePending(null)
    } else if (archiveConfirmPending) {
      setArchiveConfirmPending(null)
      setShowArchiveModal(true)
    } else if (deleteRecordPending) {
      setDeleteRecordPending(null)
    } else if (showAddRowDatesModal) {
      setShowAddRowDatesModal(false)
    } else if (showArchiveModal) {
      setShowArchiveModal(false)
    } else if (showBulkEditModal) {
      setShowBulkEditModal(false)
    } else if (bulkDeletePending) {
      setBulkDeletePending(false)
    } else if (showExportModal) {
      setShowExportModal(false)
    } else if (editingId) {
      setEditingId(null)
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.delete('editing')
        const s = next.toString()
        return s ? next : new URLSearchParams()
      })
    } else if (isAdding) {
      setIsAdding(false)
    }
  }, [
    reinstateChoicePending,
    deleteArchivePending,
    archiveConfirmPending,
    deleteRecordPending,
    showAddRowDatesModal,
    showArchiveModal,
    showBulkEditModal,
    bulkDeletePending,
    showExportModal,
    editingId,
    isAdding,
    setSearchParams,
  ])

  // ESC closes/cancels the topmost modal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeTopmostModal()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [closeTopmostModal])

  // Browser back button closes the topmost modal: push a distinct URL (#modal) when a modal opens so back pops it
  const modalHistoryPushedRef = useRef(false)
  useEffect(() => {
    if (hasModalOpen && !modalHistoryPushedRef.current) {
      modalHistoryPushedRef.current = true
      const url = window.location.pathname + window.location.search + '#modal'
      window.history.pushState({ atlasModal: true }, '', url)
    }
    if (!hasModalOpen) {
      modalHistoryPushedRef.current = false
      if (window.location.hash === '#modal') {
        window.history.replaceState(
          window.history.state,
          '',
          window.location.pathname + window.location.search
        )
      }
    }
  }, [hasModalOpen])

  const closeTopmostModalRef = useRef(closeTopmostModal)
  closeTopmostModalRef.current = closeTopmostModal
  useEffect(() => {
    const handler = () => {
      if (modalHistoryPushedRef.current) {
        modalHistoryPushedRef.current = false
        closeTopmostModalRef.current()
      }
    }
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [])

  const editingIdFromUrl = searchParams.get('editing')
  useEffect(() => {
    if (!editingIdFromUrl || records.length === 0) return
    if (editingId != null) return // already editing (e.g. opened from UI), don't overwrite
    const record = records.find((r) => r.id === editingIdFromUrl)
    if (record) {
      setEditingId(record.id)
      setEditData(computeFormulaValues(fields, record.data))
    } else {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.delete('editing')
        const s = next.toString()
        return s ? next : new URLSearchParams()
      })
    }
  }, [editingIdFromUrl, records])

  const startAdd = () => {
    if (!plan?.startDate?.trim()) {
      setAddRowStartDate(plan?.startDate || format(new Date(), 'yyyy-MM-dd'))
      setAddRowEndDate(plan?.endDate || '')
      setShowAddRowDatesModal(true)
      return
    }
    setIsAdding(true)
    if (fields.length > 0) setAddData(getDefaultData(fields, plan))
  }

  const confirmAddRowDates = useCallback(async () => {
    if (!planId || !plan) return
    const start = addRowStartDate.trim()
    if (!start) {
      showAlert('Enter a start date.')
      return
    }
    setSubmitting(true)
    try {
      const res = await api.put<TestPlan>(`/test-plans/${planId}`, {
        startDate: start,
        endDate: addRowEndDate.trim() || null,
      })
      setPlan(res.data)
      setShowAddRowDatesModal(false)
      setIsAdding(true)
      if (fields.length > 0) setAddData(getDefaultData(fields, res.data))
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      showAlert(msg || 'Failed to set dates')
    } finally {
      setSubmitting(false)
    }
  }, [planId, plan, addRowStartDate, addRowEndDate, fields])

  useEffect(() => {
    if (isAdding && fields.length > 0) {
      setAddData(getDefaultData(fields, plan))
    }
  }, [isAdding, plan, fields])

  const cancelAdd = () => setIsAdding(false)

  const saveAdd = async () => {
    if (!planId) return
    setSubmitting(true)
    try {
      // New rows always use server "now" and go to the current period, never into an archived run
      await api.post('/records', {
        testPlanId: planId,
        data: computeFormulaValues(fields, addData),
        status: 'partial',
      })
      loadRecords()
      setIsAdding(false)
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      showAlert(err || 'Failed to add data')
    } finally {
      setSubmitting(false)
    }
  }

  const startEdit = (record: Record) => {
    setEditingId(record.id)
    setEditData(computeFormulaValues(fields, record.data))
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('editing', record.id)
      return next
    })
  }

  const clearEditingParam = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('editing')
      const s = next.toString()
      return s ? next : new URLSearchParams()
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    clearEditingParam()
  }

  const deleteRecord = async (recordId: string) => {
    setSubmitting(true)
    if (editingId === recordId) {
      setEditingId(null)
      clearEditingParam()
    }
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.delete(recordId)
      return next
    })
    setRecords((prev) => prev.filter((r) => r.id !== recordId))
    try {
      await api.delete(`/records/${recordId}`)
      loadRecords()
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      loadRecords()
      if (status !== 404) showAlert(err || 'Failed to delete')
    } finally {
      setSubmitting(false)
    }
  }

  const bulkEditableFields = useMemo(
    () => fields.filter((f) => f.type !== 'image' && f.type !== 'timer' && f.type !== 'formula'),
    [fields]
  )

  const handleBulkDelete = async () => {
    const ids = [...selectedIds]
    setBulkDeletePending(false)
    setSubmitting(true)
    setSelectedIds(new Set())
    try {
      await Promise.all(ids.map((id) => api.delete(`/records/${id}`)))
      setRecords((prev) => prev.filter((r) => !ids.includes(r.id)))
      loadRecords()
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      loadRecords()
      showAlert(err || 'Failed to delete some rows')
    } finally {
      setSubmitting(false)
    }
  }

  const handleBulkEditApply = async (
    fieldKey: string,
    value: string | number | boolean | string[] | TimerValue
  ) => {
    const ids = [...selectedIds]
    const toUpdate = records.filter((r) => ids.includes(r.id))
    if (toUpdate.length === 0) return
    setSubmitting(true)
    try {
      await Promise.all(
        toUpdate.map((rec) =>
          api.put(`/records/${rec.id}`, {
            data: computeFormulaValues(fields, { ...rec.data, [fieldKey]: value }),
            status: rec.status,
          })
        )
      )
      loadRecords()
      setShowBulkEditModal(false)
      setSelectedIds(new Set())
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      showAlert(err || 'Failed to update some rows')
    } finally {
      setSubmitting(false)
    }
  }

  const saveEdit = async () => {
    if (!editingId) return
    const rec = records.find((r) => r.id === editingId)
    if (!rec) return
    setSubmitting(true)
    try {
      await api.put(`/records/${editingId}`, { data: computeFormulaValues(fields, editData), status: rec.status })
      loadRecords()
      setEditingId(null)
      clearEditingParam()
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      showAlert(err || 'Failed to save')
    } finally {
      setSubmitting(false)
    }
  }

  const updateAddField = (key: string, value: string | number | boolean | string[] | TimerValue) => {
    setAddData((d) => computeFormulaValues(fields, { ...d, [key]: value }))
  }

  const updateEditField = (key: string, value: string | number | boolean | string[] | TimerValue) => {
    setEditData((d) => computeFormulaValues(fields, { ...d, [key]: value }))
  }

  const updateRecordField = async (record: Record, key: string, value: string | number | boolean | string[] | TimerValue) => {
    const newData = computeFormulaValues(fields, { ...record.data, [key]: value })
    try {
      await api.put(`/records/${record.id}`, { data: newData, status: record.status })
      setRecords((prev) =>
        prev.map((r) => (r.id === record.id ? { ...r, data: newData } : r))
      )
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      showAlert(err || 'Failed to update')
    }
  }

  const fieldLayout = plan?.fieldLayout ?? {}
  const hasFieldLayout = Object.keys(fieldLayout).length > 0
  const recordsWithComputed = useMemo(
    () => records.map((r) => ({ ...r, data: computeFormulaValues(fields, r.data) })),
    [records, fields]
  )
  const editingRecord = recordsWithComputed.find((r) => r.id === editingId)

  /** Column width: fit label and for select/status the longest option. Approx 0.5rem per character. */
  const getColumnWidth = (f: DataField): string => {
    const labelLen = (f.label?.length ?? 0) * 0.5
    const minForLabel = Math.max(6, Math.ceil(labelLen) + 1)
    let optionLen = 0
    if (f.type === 'select' && Array.isArray(f.config?.options)) {
      optionLen = Math.max(0, ...f.config.options.map((o) => String(o).length))
    }
    if (f.type === 'status') {
      const opts = getStatusOptions(f)
      optionLen = Math.max(0, ...opts.map((o) => String(o).length))
    }
    const minForOptions = optionLen > 0 ? Math.ceil(optionLen * 0.5) + 2 : 0
    const headerControls = 3 /* space for sort indicator + filter icon */
    const fromContent = Math.max(minForLabel, minForOptions, 8) + headerControls
    switch (f.type) {
      case 'boolean':
        return '2.75rem'
      case 'number':
        return `${Math.max(6, fromContent)}rem`
      case 'fraction':
        return `${Math.max(7, fromContent)}rem`
      case 'timer':
        return '12rem'
      case 'status':
      case 'select':
        return `${fromContent}rem`
      case 'datetime':
        return `${Math.max(11, fromContent)}rem`
      case 'atlas_location':
        return `${Math.max(10, fromContent)}rem`
      case 'image':
        return '6rem'
      case 'longtext':
        return `${Math.max(14, fromContent)}rem`
      case 'text':
        return `${Math.max(10, fromContent)}rem`
      default:
        return `${Math.max(8, fromContent)}rem`
    }
  }

  type SortKey = 'date' | string
  type SortLevel = { key: SortKey; dir: 'asc' | 'desc' }
  const sortStorageKey = planId ? `automation-data-sort-${planId}` : 'automation-data-sort-default'
  const defaultSortOrder = useMemo<SortLevel[]>(
    () =>
      plan?.defaultSortOrder?.length
        ? plan.defaultSortOrder
        : [{ key: 'date', dir: 'desc' }],
    [plan?.defaultSortOrder]
  )
  const [sortOrder, setSortOrder] = useUserPreference<SortLevel[]>(
    sortStorageKey,
    defaultSortOrder,
    JSON.stringify,
    (s) => {
      try {
        const parsed = JSON.parse(s) as SortLevel[]
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      } catch {
        // ignore
      }
      return defaultSortOrder
    }
  )

  const getVal = (record: Record, key: SortKey): string | number | boolean | string[] | TimerValue => {
    if (key === 'date') return record.recordedAt
    return record.data[key] ?? ''
  }

  const isTimerVal = (v: unknown): v is TimerValue =>
    typeof v === 'object' && v !== null && 'totalElapsedMs' in v

  const compare = (aVal: string | number | boolean | string[] | TimerValue, bVal: string | number | boolean | string[] | TimerValue, dir: 'asc' | 'desc'): number => {
    if (isTimerVal(aVal) && isTimerVal(bVal)) {
      const cmp = getElapsedMs(aVal) - getElapsedMs(bVal)
      return dir === 'asc' ? cmp : -cmp
    }
    const aStr = String(aVal)
    const bStr = String(bVal)
    const numA = Number(aVal)
    const numB = Number(bVal)
    let cmp: number
    if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
      cmp = numA - numB
    } else {
      cmp = aStr.localeCompare(bStr, undefined, { sensitivity: 'base' })
    }
    return dir === 'asc' ? cmp : -cmp
  }

  /** When viewing an archived run, show only that run; otherwise show all current-run records (no date filter). */
  const displayRecords = useMemo(() => {
    if (viewingArchivedRun) {
      if (viewingArchivedRun.runId) {
        return recordsWithComputed.filter((r) => r.runId === viewingArchivedRun.runId)
      }
      const startMs = new Date(viewingArchivedRun.startDate + 'T00:00:00').getTime()
      const endMs = new Date(viewingArchivedRun.endDate + 'T23:59:59.999').getTime()
      return recordsWithComputed.filter((r) => {
        const t = new Date(r.recordedAt).getTime()
        return t >= startMs && t <= endMs
      })
    }
    return recordsWithComputed.filter((r) => !r.runId)
  }, [recordsWithComputed, plan?.archivedRuns, viewingArchivedRun])

  const sortedRecords = useMemo(() => {
    const copy = [...displayRecords]
    copy.sort((a, b) => {
      for (const { key, dir } of sortOrder) {
        const cmp = compare(getVal(a, key), getVal(b, key), dir)
        if (cmp !== 0) return cmp
      }
      return 0
    })
    return copy
  }, [displayRecords, sortOrder])

  const getDisplayVal = (record: Record, key: SortKey, field?: DataField): string => {
    const v = getVal(record, key)
    if (field) return formatFieldValue(field, v)
    if (typeof v === 'boolean') return v ? 'Yes' : 'No'
    if (typeof v === 'number') return String(v)
    return String(v ?? '')
  }

  const statusField = fields.find((f) => f.type === 'status')
  const statusTabs = useMemo(() => {
    if (!statusField) return []
    const values = new Set<string>()
    let hasNoStatus = false
    for (const r of sortedRecords) {
      const v = String(r.data[statusField.key] ?? '').trim()
      if (v) values.add(v)
      else hasNoStatus = true
    }
    const rest = [...values].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    return hasNoStatus ? ['All', '(No Status)', ...rest] : ['All', ...rest]
  }, [statusField, sortedRecords])

  useEffect(() => {
    if (statusTabs.length > 0 && !statusTabs.includes(selectedStatusTab)) setSelectedStatusTab('All')
  }, [statusTabs, selectedStatusTab])

  const filteredRecords = useMemo(() => {
    let result = sortedRecords
    if (statusField && selectedStatusTab && selectedStatusTab !== 'All') {
      result = result.filter((r) => {
        const v = String(r.data[statusField.key] ?? '').trim()
        return selectedStatusTab === '(No Status)' ? !v : v === selectedStatusTab
      })
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      result = result.filter((r) => {
        const dateStr = formatDateTime(r.recordedAt)
        if (dateStr.toLowerCase().includes(q)) return true
        for (const f of fields) {
          const v = getDisplayVal(r, f.key)
          if (v.toLowerCase().includes(q)) return true
        }
        return false
      })
    }
    for (const [colKey, allowed] of Object.entries(columnFilters)) {
      if (allowed.size === 0) continue
      const f = fields.find((x) => x.key === colKey)
      result = result.filter((r) => {
        const v = colKey === 'date' ? formatDateTime(r.recordedAt) : getDisplayVal(r, colKey, f)
        return allowed.has(v)
      })
    }
    return result
  }, [sortedRecords, statusField, selectedStatusTab, searchQuery, columnFilters, fields])

  const hasActiveFilters = searchQuery.trim() !== '' || Object.values(columnFilters).some((s) => s.size > 0)

  const sortDiffersFromDefault =
    sortOrder.length !== defaultSortOrder.length ||
    sortOrder.some((s, i) => defaultSortOrder[i]?.key !== s.key || defaultSortOrder[i]?.dir !== s.dir)
  const statusDiffersFromDefault = statusTabs.length > 0 && selectedStatusTab !== 'All'
  const differsFromDefault = sortDiffersFromDefault || hasActiveFilters || statusDiffersFromDefault

  const clearToDefault = () => {
    setSortOrder(defaultSortOrder)
    setSearchQuery('')
    setColumnFilters({})
    setOpenFilterColumn(null)
    setSelectedStatusTab('All')
  }

  const getColumnValues = (key: SortKey): string[] => {
    const f = fields.find((x) => x.key === key)
    return sortedRecords.map((r) =>
      key === 'date' ? formatDateTime(r.recordedAt) : getDisplayVal(r, key, f)
    )
  }

  const handleSort = (key: SortKey, addSecondary: boolean) => {
    setSortOrder((prev) => {
      const idx = prev.findIndex((s) => s.key === key)
      if (addSecondary) {
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = { ...next[idx], dir: next[idx].dir === 'asc' ? 'desc' : 'asc' }
          return next
        }
        return [...prev, { key, dir: 'asc' }]
      }
      if (idx >= 0 && prev.length === 1) {
        return [{ key, dir: prev[0].dir === 'asc' ? 'desc' : 'asc' }]
      }
      return [{ key, dir: 'desc' }]
    })
  }

  const getSortHandlers = useSortableHeader(handleSort)
  const getSortIndex = (key: SortKey) => sortOrder.findIndex((s) => s.key === key)
  const getSortDir = (key: SortKey) => sortOrder.find((s) => s.key === key)?.dir

  const handleRowClick = (record: Record, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    startEdit(record)
  }

  if (loading || !plan) return <p className="text-foreground/60">Loading...</p>

  const hasFields = fields.length > 0

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <Link
        to="/test-plans"
        className="mb-2 flex min-h-[44px] w-fit shrink-0 items-center text-sm text-foreground/60 hover:text-foreground sm:min-h-0"
      >
        ← Back to plans
      </Link>
      <div className="mb-4 flex min-w-0 shrink-0 flex-col">
        <h1 className="text-2xl font-semibold text-foreground">{plan.name}</h1>
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-end sm:gap-x-5 sm:gap-y-1">
            {plan.description && (
              <p className="text-sm text-foreground/80 leading-relaxed">
                <span className="font-medium text-foreground/80">Description:</span>{' '}
                {plan.description}
              </p>
            )}
            {(plan.startDate || plan.endDate) && (
              <p className="shrink-0 text-sm text-foreground/70">
                <span className="font-medium text-foreground/80">Current Run:</span>{' '}
                {plan.startDate && plan.endDate
                  ? `${formatDate(plan.startDate + 'T00:00:00')} – ${formatDate(plan.endDate + 'T00:00:00')}`
                  : plan.startDate
                    ? `From ${formatDate(plan.startDate + 'T00:00:00')}`
                    : `Through ${formatDate(plan.endDate! + 'T00:00:00')}`}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowExportModal(true)}
              className="min-h-[44px] min-w-[44px] rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background sm:min-h-0 sm:min-w-0"
            >
              Export
            </button>
            {isAdmin && (
              <>
                <Link
                  to={`/test-plans/${plan.id}/edit`}
                  state={{ returnTo: `/test-plans/${planId}/data` }}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background sm:min-h-0 sm:min-w-0"
                >
                  Edit plan
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setArchiveStartDate(plan.startDate || '')
                    setArchiveEndDate(plan.endDate || format(new Date(), 'yyyy-MM-dd'))
                    setShowArchiveModal(true)
                  }}
                  className="min-h-[44px] shrink-0 rounded-lg border border-amber-500/50 px-4 py-2 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
                  title="View archived runs or archive current testing"
                >
                  Archive
                </button>
              </>
            )}
            {hasFields && canEditData && (
              <button
                type="button"
                onClick={startAdd}
                className="min-h-[44px] shrink-0 rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:bg-background sm:min-h-0"
              >
                + Add row
              </button>
            )}
          </div>
        </div>
      </div>
      {(plan.testPlan || plan.constraints) && (
        <div className="mb-6 w-full min-w-0">
          {planInfoCollapsed ? (
            <div className="rounded-lg border border-border bg-card/50">
              <button
                type="button"
                onClick={() => setPlanInfoCollapsed(false)}
                className="flex w-full items-center justify-between gap-2 px-5 py-3 text-left text-sm font-medium text-foreground hover:bg-background/30"
                aria-expanded={false}
              >
                <span className="text-xs font-semibold uppercase tracking-wider text-foreground/70">
                  Test plan & criteria
                </span>
                <svg
                  className="h-4 w-4 shrink-0 text-foreground/50"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card/50">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setPlanInfoCollapsed(true)}
                  className="absolute right-3 top-3 z-[1] rounded p-1 text-foreground/50 hover:bg-background/30 hover:text-foreground/80"
                  aria-expanded={true}
                  aria-label="Collapse test plan & criteria"
                >
                  <svg
                    className="h-4 w-4 rotate-180"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <div className="grid gap-6 p-5 sm:grid-cols-2">
                {plan.testPlan && (
                  <div className="min-w-0">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground/50">
                      Test plan
                    </h3>
                    <p className="whitespace-pre-wrap text-sm text-foreground/90 leading-relaxed">
                      {plan.testPlan}
                    </p>
                  </div>
                )}
                {plan.constraints && (
                  <div className="min-w-0">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground/50">
                      Test criteria
                    </h3>
                    <p className="whitespace-pre-wrap text-sm text-foreground/90 leading-relaxed">
                      {plan.constraints}
                    </p>
                  </div>
                )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {isAdding && (
        <AddRecordModal
          fields={fields}
          data={addData}
          onDataChange={updateAddField}
          onSave={saveAdd}
          onCancel={cancelAdd}
          submitting={submitting}
          formLayoutOrder={plan?.formLayoutOrder}
          plan={plan ?? undefined}
        />
      )}
      {showExportModal && (
        <ExportPlanModal
          planId={plan.id}
          planName={plan.name}
          onClose={() => setShowExportModal(false)}
          filteredRecords={filteredRecords}
          defaultSortOrder={defaultSortOrder}
          keyField={plan.keyField}
          fields={fields}
        />
      )}
      {editingRecord && (
        <EditRecordModal
          record={editingRecord}
          fields={fields}
          data={editData}
          onDataChange={updateEditField}
          onSave={saveEdit}
          onCancel={cancelEdit}
          onDelete={() => {
            setDeleteRecordPending(editingRecord.id)
            setEditingId(null)
            clearEditingParam()
          }}
          submitting={submitting}
          formLayoutOrder={plan?.formLayoutOrder}
          plan={plan ?? undefined}
          isAdmin={isAdmin}
          readOnly={!canEditData}
        />
      )}
      {showArchiveModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowArchiveModal(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-semibold text-foreground">Archive</h2>
            <div className="space-y-4">
              {(plan?.archivedRuns?.length ?? 0) > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium text-foreground/80">Archived runs</p>
                  <div className="flex flex-col gap-2">
                    {plan!.archivedRuns!.map((run) => {
                      const isReinstating = reinstatingRun?.startDate === run.startDate && reinstatingRun?.endDate === run.endDate
                      const isDeleting = deletingRun?.startDate === run.startDate && deletingRun?.endDate === run.endDate
                      return (
                        <div
                          key={`${run.startDate}-${run.endDate}`}
                          className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2"
                        >
                          <span className="min-w-0 flex-1 text-sm text-foreground">
                            {run.startDate} – {run.endDate}
                          </span>
                          <div className="flex shrink-0 gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setViewingArchivedRunAndUrl(run)
                                setShowArchiveModal(false)
                              }}
                              className="rounded border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-background/80"
                            >
                              View
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (currentPeriodHasRecords) {
                                  setReinstateChoicePending(run)
                                  setShowArchiveModal(false)
                                } else {
                                  handleReinstateRun(run)
                                }
                              }}
                              disabled={!!reinstatingRun || !!deletingRun}
                              className="rounded border border-primary/50 bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
                            >
                              {isReinstating ? 'Reinstating…' : 'Reinstate'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteArchivePending(run)}
                              disabled={!!reinstatingRun || !!deletingRun}
                              className="rounded border border-red-500/50 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-500/20 disabled:opacity-50 dark:text-red-400"
                            >
                              {isDeleting ? 'Deleting…' : 'Delete'}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              <div className="border-t border-border pt-4">
                <p className="mb-3 text-sm text-foreground/80">Save the current period as an archived run and clear plan dates for the next period.</p>
                {!plan?.startDate && (
                  <div className="mb-3">
                    <label className="mb-1 block text-sm font-medium text-foreground">Test start date (required)</label>
                    <input
                      type="date"
                      value={archiveStartDate}
                      onChange={(e) => setArchiveStartDate(e.target.value)}
                      className="w-full rounded border border-border bg-background px-3 py-2 text-foreground"
                    />
                  </div>
                )}
                {!plan?.endDate && (
                  <div className="mb-3">
                    <label className="mb-1 block text-sm font-medium text-foreground">Test end date (required)</label>
                    <input
                      type="date"
                      value={archiveEndDate}
                      onChange={(e) => setArchiveEndDate(e.target.value)}
                      className="w-full rounded border border-border bg-background px-3 py-2 text-foreground"
                    />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const runStart = plan?.startDate?.trim() || archiveStartDate.trim()
                    const runEnd = plan?.endDate?.trim() || archiveEndDate.trim()
                    if (!runStart) {
                      showAlert('Please enter the test start date.')
                      return
                    }
                    if (!runEnd) {
                      showAlert('Please enter the test end date.')
                      return
                    }
                    setArchiveConfirmPending({ runStart, runEnd })
                    setShowArchiveModal(false)
                  }}
                  disabled={archiving || (!plan?.startDate && !archiveStartDate.trim()) || (!plan?.endDate && !archiveEndDate.trim())}
                  className="w-full rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-700 hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-400"
                >
                  {archiving ? 'Archiving...' : 'Archive current testing'}
                </button>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setShowArchiveModal(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-background"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {reinstateChoicePending && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            setReinstateChoicePending(null)
            setShowArchiveModal(true)
          }}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-lg font-semibold text-foreground">Current period has data</h3>
            <p className="mb-4 text-sm text-foreground/80">
              Reinstating <strong>{reinstateChoicePending.startDate} – {reinstateChoicePending.endDate}</strong>. How do you want to handle the current period?
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  handleReinstateMerge(reinstateChoicePending)
                }}
                className="w-full rounded-lg border border-primary/50 bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20"
              >
                Merge into current range
              </button>
              <button
                type="button"
                onClick={() => {
                  handleReinstateArchiveCurrent(reinstateChoicePending)
                }}
                className="w-full rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
              >
                Archive current, then reinstate
              </button>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setReinstateChoicePending(null)
                  setShowArchiveModal(true)
                }}
                className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-background"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteArchivePending && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setDeleteArchivePending(null)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-lg font-semibold text-foreground">Remove archived run?</h3>
            <p className="mb-4 text-sm text-foreground/80">
              <strong>{deleteArchivePending.startDate} – {deleteArchivePending.endDate}</strong> will be removed from the archive. The records will become current (unarchived).
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteArchivePending(null)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const run = deleteArchivePending
                  setDeleteArchivePending(null)
                  if (run) handleDeleteArchivedRun(run)
                }}
                disabled={!!deletingRun}
                className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-500/20 disabled:opacity-50 dark:text-red-400"
              >
                {deletingRun ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
      {showAddRowDatesModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowAddRowDatesModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-lg font-semibold text-foreground">Set plan dates to add rows</h3>
            <p className="mb-4 text-sm text-foreground/80">
              Enter start and end dates for this testing period.
            </p>
            <div className="mb-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Start date (required)</label>
                <input
                  type="date"
                  value={addRowStartDate}
                  onChange={(e) => setAddRowStartDate(e.target.value)}
                  className="w-full rounded border border-border bg-background px-3 py-2 text-foreground"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">End date (optional)</label>
                <input
                  type="date"
                  value={addRowEndDate}
                  onChange={(e) => setAddRowEndDate(e.target.value)}
                  className="w-full rounded border border-border bg-background px-3 py-2 text-foreground"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddRowDatesModal(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmAddRowDates}
                disabled={!addRowStartDate.trim() || submitting}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {submitting ? 'Saving…' : 'Set dates & add row'}
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteRecordPending && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setDeleteRecordPending(null)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-lg font-semibold text-foreground">Delete this row?</h3>
            <p className="mb-4 text-sm text-foreground/80">
              This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteRecordPending(null)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = deleteRecordPending
                  setDeleteRecordPending(null)
                  if (id) deleteRecord(id)
                }}
                disabled={submitting}
                className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-500/20 disabled:opacity-50 dark:text-red-400"
              >
                {submitting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
      {bulkDeletePending && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setBulkDeletePending(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-lg font-semibold text-foreground">Delete {selectedIds.size} row(s)?</h3>
            <p className="mb-4 text-sm text-foreground/80">
              This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBulkDeletePending(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBulkDelete}
                disabled={submitting}
                className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-500/20 disabled:opacity-50 dark:text-red-400"
              >
                {submitting ? 'Deleting…' : 'Delete all'}
              </button>
            </div>
          </div>
        </div>
      )}
      {showBulkEditModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowBulkEditModal(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-lg font-semibold text-foreground">Edit field for {selectedIds.size} row(s)</h3>
            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-foreground">Field</label>
              <PopupSelect
                label=""
                value={bulkEditFieldKey ?? ''}
                onChange={(key) => {
                  const field = key ? fields.find((f) => f.key === key) : null
                  setBulkEditFieldKey(key || null)
                  const firstRecord = recordsWithComputed.find((r) => selectedIds.has(r.id))
                  if (field) {
                    const val = firstRecord?.data[key] ?? getDefaultValueForField(field, plan?.fieldDefaults)
                    setBulkEditValue(val)
                  } else {
                    setBulkEditValue(null)
                  }
                }}
                emptyOption="Select a field"
                options={bulkEditableFields.map((f) => ({ value: f.key, label: f.label }))}
              />
            </div>
            {bulkEditFieldKey && (() => {
              const field = fields.find((f) => f.key === bulkEditFieldKey)
              if (!field) return null
              const currentVal = bulkEditValue ?? getDefaultValueForField(field, plan?.fieldDefaults)
              return (
                <div className="mb-4">
                  <label className="mb-1 block text-sm font-medium text-foreground">New value</label>
                  <div className="min-w-0">
                    {renderFormField(
                      field,
                      currentVal,
                      (key, val) => setBulkEditValue(val),
                      { disabled: submitting, compact: false }
                    )}
                  </div>
                </div>
              )
            })()}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowBulkEditModal(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!bulkEditFieldKey) return
                  const field = fields.find((f) => f.key === bulkEditFieldKey)
                  const value = bulkEditValue ?? (field ? getDefaultValueForField(field, plan?.fieldDefaults) : '')
                  handleBulkEditApply(bulkEditFieldKey, value)
                }}
                disabled={submitting || !bulkEditFieldKey}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {submitting ? 'Applying…' : 'Apply to all'}
              </button>
            </div>
          </div>
        </div>
      )}
      {archiveConfirmPending && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            setArchiveConfirmPending(null)
            setShowArchiveModal(true)
          }}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-lg font-semibold text-foreground">Archive this period?</h3>
            <p className="mb-4 text-sm text-foreground/80">
              This will save the run <strong>{archiveConfirmPending.runStart} – {archiveConfirmPending.runEnd}</strong> as an archived run and clear plan dates. You can view or reinstate it later from Archive.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setArchiveConfirmPending(null)
                  setShowArchiveModal(true)
                }}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const { runStart, runEnd } = archiveConfirmPending
                  setArchiveConfirmPending(null)
                  handleArchiveCurrent(runStart, runEnd)
                }}
                className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
              >
                Archive
              </button>
            </div>
          </div>
        </div>
      )}
      {!hasFields ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-foreground/70">
            No fields configured. Edit the plan to add fields, then you can collect data.
          </p>
          {isAdmin && (
            <Link
              to={`/test-plans/${plan.id}/edit`}
              state={{ returnTo: `/test-plans/${planId}/data` }}
              className="mt-4 inline-flex min-h-[44px] shrink-0 items-center rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 sm:min-h-0"
            >
              Edit plan
            </Link>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-3">
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[160px] max-w-xs">
              <input
                type="search"
                placeholder="Search all columns..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 pl-9 text-sm text-foreground placeholder:text-foreground/50"
              />
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground/50">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </span>
            </div>
            {differsFromDefault && (
              <button
                type="button"
                onClick={clearToDefault}
                className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-background"
              >
                Clear
              </button>
            )}
            {hasActiveFilters && (
              <span className="text-sm text-foreground/60">
                {filteredRecords.length} of {sortedRecords.length} rows
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowMobileFilterPanel((s) => !s)}
              className={`flex min-h-[44px] items-center gap-2 rounded-lg border px-3 py-2 text-sm sm:min-h-0 md:hidden ${
                hasActiveFilters
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-foreground hover:bg-background'
              }`}
              title="Filter by column"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              <span className="text-xs">Filters</span>
            </button>
            <div
              role="radiogroup"
              aria-label="View mode"
              className="flex min-h-[44px] shrink-0 overflow-hidden rounded-lg border border-border bg-card shadow-sm sm:min-h-0"
            >
              {(['table', 'card', 'compact-card'] as const).map((mode, i) => {
                const isSelected = effectiveViewMode === mode
                return (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setViewMode(mode)}
                    title={mode === 'table' ? 'Table view' : mode === 'card' ? 'Full cards' : 'Compact cards'}
                    className={`flex min-h-[44px] min-w-0 flex-1 items-center justify-center border-border px-2 py-2 transition-colors sm:min-h-0 sm:px-3 ${
                      i > 0 ? 'border-l' : ''
                    } ${isSelected ? 'bg-primary text-primary-foreground shadow-inner' : 'bg-background text-foreground/80 hover:bg-background/80 hover:text-foreground'}`}
                  >
                    {mode === 'table' ? (
                      <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                      </svg>
                    ) : mode === 'card' ? (
                      <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5h14a1 1 0 011 1v12a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9h8M8 13h8M8 17h5" />
                      </svg>
                    ) : (
                      <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h6v6H3V3z M15 3h6v6h-6V3z M3 15h6v6H3v-6z M15 15h6v6h-6v-6z" />
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>
            {canEditData && (
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setDirectTableEdit((d) => !d)}
                className={`flex min-h-[44px] items-center gap-2 rounded-lg border px-3 py-2 text-sm shrink-0 sm:min-h-0 ${
                  directTableEdit
                    ? 'border-primary bg-primary/15 text-primary ring-2 ring-primary/30'
                    : 'border-border text-foreground hover:bg-background'
                }`}
                title={directTableEdit ? 'Turn off inline editing in table' : 'Turn on inline editing in table'}
              >
                <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                <span className="text-xs font-medium">Edit</span>
                {directTableEdit && (
                  <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                    On
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setBulkSelectMode((b) => !b)
                  if (bulkSelectMode) setSelectedIds(new Set())
                }}
                className={`flex min-h-[44px] items-center gap-2 rounded-lg border px-3 py-2 text-sm shrink-0 sm:min-h-0 ${
                  bulkSelectMode
                    ? 'border-primary bg-primary/15 text-primary ring-2 ring-primary/30'
                    : 'border-border text-foreground hover:bg-background'
                }`}
                title={bulkSelectMode ? 'Turn off row selection' : 'Select rows for bulk edit or delete'}
              >
                <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-xs font-medium">Bulk edit</span>
                {bulkSelectMode && (
                  <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                    On
                  </span>
                )}
              </button>
            </div>
            )}
            {showTableView && (
            <div className="relative">
              <button
                ref={columnPickerAnchorRef}
                type="button"
                onClick={() => setOpenColumnPicker((o) => !o)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                  visibleFields.length < fields.length
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-foreground hover:bg-background'
                }`}
                title="Choose columns to display"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                <span className="text-xs">Columns</span>
              </button>
              {openColumnPicker && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    aria-hidden
                    onClick={() => setOpenColumnPicker(false)}
                  />
                  <div
                    className="absolute right-0 top-full z-50 mt-1 min-w-[180px] max-w-[280px] rounded-lg border border-border bg-card py-2 shadow-lg"
                    style={{ left: columnPickerAnchorRef.current ? 'auto' : 0 }}
                  >
                    <div className="border-b border-border px-3 pb-2">
                      <span className="text-sm font-medium text-foreground">Show columns</span>
                    </div>
                    <div className="max-h-64 overflow-y-auto px-2 py-1">
                      <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-background">
                        <input type="checkbox" checked disabled className="h-4 w-4" />
                        <span className="text-sm text-foreground">Date</span>
                      </label>
                      {fields.filter((f) => !(plan?.hiddenFieldIds ?? []).includes(f.id)).map((f) => (
                        <label
                          key={f.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-background"
                        >
                          <input
                            type="checkbox"
                            checked={!hiddenColumnKeys.includes(f.key)}
                            onChange={() => toggleColumnVisibility(f.key)}
                            className="h-4 w-4"
                          />
                          <span className="truncate text-sm text-foreground">{f.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
            )}
          </div>
          {viewingArchivedRun && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
              <span className="text-sm text-amber-800 dark:text-amber-200">
                Viewing archived run: {viewingArchivedRun.startDate} – {viewingArchivedRun.endDate}
              </span>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (currentPeriodHasRecords) {
                      setReinstateChoicePending(viewingArchivedRun)
                      setViewingArchivedRunAndUrl(null)
                    } else {
                      handleReinstateRun(viewingArchivedRun)
                    }
                  }}
                  disabled={!!reinstatingRun}
                  className="rounded-lg border border-primary/50 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
                >
                  {reinstatingRun?.startDate === viewingArchivedRun.startDate && reinstatingRun?.endDate === viewingArchivedRun.endDate ? 'Reinstating…' : 'Reinstate'}
                </button>
                <button
                  type="button"
                  onClick={() => setViewingArchivedRunAndUrl(null)}
                  className="rounded-lg border border-amber-600/50 bg-amber-500/20 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-500/30 dark:text-amber-200"
                >
                  Back to current
                </button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
            {statusTabs.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1">
                {statusTabs.map((tab) => {
                  const tabColor = statusField?.config?.statusColors?.[tab]
                  const isSelected = selectedStatusTab === tab
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setSelectedStatusTab(tab)}
                      className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        isSelected && !tabColor
                          ? 'bg-primary text-primary-foreground'
                          : isSelected && tabColor
                            ? ''
                            : 'text-foreground/80 hover:bg-background hover:text-foreground'
                      }`}
                      style={isSelected && tabColor ? { backgroundColor: tabColor, color: getContrastTextColor(tabColor) } : undefined}
                    >
                      {tab}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div />
            )}
          </div>
          {canEditData && bulkSelectMode && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2">
              <span className="text-sm font-medium text-foreground">
                {selectedIds.size} selected
              </span>
              <button
                type="button"
                onClick={() => {
                  const first = bulkEditableFields[0]
                  if (first) {
                    const firstRecord = recordsWithComputed.find((r) => selectedIds.has(r.id))
                    setBulkEditFieldKey(first.key)
                    setBulkEditValue(firstRecord?.data[first.key] ?? getDefaultValueForField(first, plan?.fieldDefaults))
                  } else {
                    setBulkEditFieldKey(null)
                    setBulkEditValue(null)
                  }
                  setShowBulkEditModal(true)
                }}
                disabled={submitting || selectedIds.size === 0}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-background/80 disabled:opacity-50"
              >
                Edit field
              </button>
              <button
                type="button"
                onClick={() => setBulkDeletePending(true)}
                disabled={submitting || selectedIds.size === 0}
                className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-500/20 disabled:opacity-50 dark:text-red-400"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                disabled={selectedIds.size === 0}
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-background disabled:opacity-50"
              >
                Clear selection
              </button>
            </div>
          )}
          {/* Mobile filter panel */}
          {showMobileFilterPanel && (
            <div className="rounded-lg border border-border bg-card p-3 md:hidden">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">Filter by</span>
                <button
                  type="button"
                  onClick={() => {
                    setShowMobileFilterPanel(false)
                    setOpenFilterColumn(null)
                  }}
                  className="text-foreground/60 hover:text-foreground"
                  aria-label="Close"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="space-y-1">
                <div
                  ref={(el) => { filterAnchorRefs.current['date'] = el }}
                  className="relative"
                >
                  <button
                    type="button"
                    onClick={() => setOpenFilterColumn((c) => (c === 'date' ? null : 'date'))}
                    className={`flex w-full min-h-[44px] items-center justify-between rounded px-3 py-2 text-left text-sm hover:bg-background ${
                      columnFilters['date']?.size ? 'text-primary' : 'text-foreground'
                    }`}
                  >
                    <span>Date</span>
                    {columnFilters['date']?.size ? (
                      <span className="text-xs text-foreground/60">{columnFilters['date'].size} selected</span>
                    ) : (
                      <svg className="h-4 w-4 text-foreground/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    )}
                  </button>
                  {openFilterColumn === 'date' && (
                    <ColumnFilterDropdown
                      columnKey="date"
                      columnLabel="Date"
                      values={getColumnValues('date')}
                      selected={columnFilters['date'] ?? new Set()}
                      onChange={(s) => setColumnFilters((p) => ({ ...p, date: s }))}
                      onClose={() => setOpenFilterColumn(null)}
                      anchorRef={{ current: filterAnchorRefs.current['date'] }}
                    />
                  )}
                </div>
                {fields.map((f) => (
                  <div
                    key={f.id}
                    ref={(el) => { filterAnchorRefs.current[f.key] = el }}
                    className="relative"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenFilterColumn((c) => (c === f.key ? null : f.key))}
                      className={`flex w-full min-h-[44px] items-center justify-between rounded px-3 py-2 text-left text-sm hover:bg-background ${
                        columnFilters[f.key]?.size ? 'text-primary' : 'text-foreground'
                      }`}
                    >
                      <span>{f.label}</span>
                      {columnFilters[f.key]?.size ? (
                        <span className="text-xs text-foreground/60">{columnFilters[f.key]!.size} selected</span>
                      ) : (
                        <svg className="h-4 w-4 text-foreground/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      )}
                    </button>
                    {openFilterColumn === f.key && (
                      <ColumnFilterDropdown
                        columnKey={f.key}
                        columnLabel={f.label}
                        values={getColumnValues(f.key)}
                        selected={columnFilters[f.key] ?? new Set()}
                        onChange={(s) => setColumnFilters((p) => ({ ...p, [f.key]: s }))}
                        onClose={() => setOpenFilterColumn(null)}
                        anchorRef={{ current: filterAnchorRefs.current[f.key] }}
                        valueType={f.type === 'fraction' ? 'fraction' : f.type === 'number' ? 'number' : undefined}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Card layout (table, card, or compact card) */}
          {showCardView && (
          <div className="w-full min-w-0 space-y-2">
            {sortedRecords.length === 0 ? (
              <p className="rounded-lg border border-border bg-card p-4 text-center text-foreground/60">
                No data yet. Click &quot;+ Add row&quot; to add.
              </p>
            ) : filteredRecords.length === 0 ? (
              <p className="rounded-lg border border-border bg-card p-4 text-center text-foreground/60">
                No rows match the current filters.
              </p>
            ) : (
              filteredRecords.map((record) => {
                const cardFormOrder = statusField
                  ? normalizeFormLayoutOrder(plan?.formLayoutOrder, fields).filter((entry) => {
                      if (isSeparatorId(entry) || isSeparatorLineId(entry)) return true
                      return parseFieldEntry(entry).fieldId !== statusField.id
                    })
                  : normalizeFormLayoutOrder(plan?.formLayoutOrder, fields)
                const allFormRows = buildFormRowsFromOrder(fields, cardFormOrder)
                const { rows: formRows, truncated } = compactCards
                  ? truncateFormRowsForCompact(allFormRows, 3)
                  : { rows: allFormRows, truncated: false }
                return (
                  <div
                    key={record.id}
                    onClick={(e) => handleRowClick(record, e)}
                    className={`w-full min-w-0 cursor-pointer overflow-hidden rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-background/50 active:bg-background/70 ${bulkSelectMode && selectedIds.has(record.id) ? 'border-primary ring-1 ring-primary/50' : 'border-border'}`}
                  >
                    {canEditData && bulkSelectMode ? (
                      <div className="mb-2 flex items-start gap-2" onClick={(e) => e.stopPropagation()}>
                        <label className="flex shrink-0 cursor-pointer pt-0.5">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(record.id)}
                            onChange={(e) => {
                              e.stopPropagation()
                              setSelectedIds((prev) => {
                                const next = new Set(prev)
                                if (next.has(record.id)) next.delete(record.id)
                                else next.add(record.id)
                                return next
                              })
                            }}
                            className="h-4 w-4 rounded border-border"
                          />
                        </label>
                        <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/70">
                          {formatDateTime(record.recordedAt)}
                        </h3>
                      </div>
                    ) : (
                      <h3 className="mb-2 truncate text-sm font-medium text-foreground/70">
                        {formatDateTime(record.recordedAt)}
                      </h3>
                    )}
                    <div className="space-y-2">
                      {formRows.map((row, ri) =>
                        Array.isArray(row) ? (
                          <div key={ri} className="flex w-full min-w-0 flex-wrap gap-x-4 gap-y-2">
                            {row.map(({ field }) => (
                              <div
                                key={field.id}
                                className="min-w-0 flex-1 basis-0 overflow-hidden"
                              >
                                <label className="mb-0.5 block truncate text-sm font-medium text-foreground">
                                  {field.label}
                                </label>
                                <p className="truncate text-sm text-foreground">
                                  {typeof record.data[field.key] === 'boolean'
                                    ? record.data[field.key]
                                      ? 'Yes'
                                      : 'No'
                                    : field.type === 'image'
                                      ? (() => {
                                          const v = record.data[field.key]
                                          const arr = Array.isArray(v) ? v : v ? [v] : []
                                          const tag = field.config?.imageTag ? ` · ${field.config.imageTag}` : ''
                                          return arr.length ? `${arr.length} photo(s)${tag}` : '—'
                                        })()
                                      : field.type === 'timer'
                                        ? getDisplayVal(record, field.key, field)
                                        : field.type === 'longtext'
                                        ? (() => {
                                            const s = String(record.data[field.key] ?? '—')
                                            return s.length > 80 ? `${s.slice(0, 80)}…` : s || '—'
                                          })()
                                        : field.type === 'fraction'
                                          ? (() => {
                                              const n = Number(record.data[field.key])
                                              return n && Number.isFinite(n) ? formatDecimalAsFraction(n) : '—'
                                            })()
                                          : String(record.data[field.key] ?? '—')}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div key={ri} className="my-2 border-t-2 border-border" />
                        )
                      )}
                    </div>
                    {truncated && (
                      <p className="mt-2 text-xs text-foreground/50">… more</p>
                    )}
                    <div
                      className="mt-3 flex items-center justify-between gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {statusField ? (
                        (() => {
                          const statusVal = String(record.data[statusField.key] ?? '').trim() || '(No Status)'
                          const statusColor = statusVal !== '(No Status)' ? statusField.config?.statusColors?.[statusVal] : undefined
                          return (
                            <span className="whitespace-nowrap text-sm text-foreground/70">
                              <span className="font-medium text-foreground/50">Status:</span>{' '}
                              {statusColor ? (
                                <span
                                  className="inline-flex rounded px-1.5 py-0.5 text-xs font-medium"
                                  style={{ backgroundColor: statusColor, color: getContrastTextColor(statusColor) }}
                                >
                                  {statusVal}
                                </span>
                              ) : (
                                statusVal
                              )}
                            </span>
                          )
                        })()
                      ) : null}
                      {canEditData && (
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(record)}
                          className="min-h-[44px] rounded border border-border px-3 py-2 text-sm text-foreground hover:bg-background"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteRecordPending(record.id)}
                          disabled={submitting}
                          className="min-h-[44px] rounded border border-red-500/50 px-3 py-2 text-sm text-red-500 hover:bg-red-500/10 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
          )}
          {/* Table view: confined to viewport with visible horizontal scrollbar */}
          {showTableView && (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-scroll rounded-lg border border-border">
          <table
            className="w-full"
            style={{ tableLayout: 'fixed' }}
          >
            <colgroup>
              {canEditData && bulkSelectMode && <col style={{ width: '2.5rem' }} />}
              <col style={{ width: '14rem' }} />
              {visibleFields.map((f) => (
                <col key={f.id} style={{ width: hasFieldLayout ? (fieldLayout[f.id] || getColumnWidth(f)) : getColumnWidth(f) }} />
              ))}
              <col style={{ width: '150px' }} />
            </colgroup>
            <thead className="sticky top-0 z-10 border-b border-border bg-card">
              <tr>
                {canEditData && bulkSelectMode && (
                  <th className="w-10 px-2 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <label className="flex cursor-pointer justify-center">
                      <input
                        type="checkbox"
                        checked={filteredRecords.length > 0 && filteredRecords.every((r) => selectedIds.has(r.id))}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedIds(new Set(filteredRecords.map((r) => r.id)))
                          } else {
                            setSelectedIds(new Set())
                          }
                        }}
                        className="h-4 w-4 rounded border-border"
                      />
                    </label>
                  </th>
                )}
                <th
                  ref={(el) => { filterAnchorRefs.current['date'] = el }}
                  className="relative min-w-0 cursor-pointer select-none px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-background/50"
                  {...getSortHandlers('date')}
                  title="Tap to sort. Long-press or Shift+click to add secondary sort."
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="whitespace-nowrap">Date</span>
                    {getSortIndex('date') >= 0 && (
                      <span className="shrink-0 text-foreground/60">
                        {getSortIndex('date') + 1}{getSortDir('date') === 'asc' ? '↓' : '↑'}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setOpenFilterColumn((c) => (c === 'date' ? null : 'date')) }}
                      className={`shrink-0 rounded p-0.5 hover:bg-background ${columnFilters['date']?.size ? 'text-primary' : 'text-foreground/50'}`}
                      title="Filter column"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                      </svg>
                    </button>
                  </span>
                  {openFilterColumn === 'date' && (
                    <ColumnFilterDropdown
                      columnKey="date"
                      columnLabel="Date"
                      values={getColumnValues('date')}
                      selected={columnFilters['date'] ?? new Set()}
                      onChange={(s) => setColumnFilters((p) => ({ ...p, date: s }))}
                      onClose={() => setOpenFilterColumn(null)}
                      anchorRef={{ current: filterAnchorRefs.current['date'] }}
                    />
                  )}
                </th>
                {visibleFields.map((f) => (
                  <th
                    key={f.id}
                    ref={(el) => { filterAnchorRefs.current[f.key] = el }}
                    className="relative min-w-0 cursor-pointer select-none px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-background/50"
                    {...getSortHandlers(f.key)}
                    title="Tap to sort. Long-press or Shift+click to add secondary sort."
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="whitespace-nowrap">{f.label}</span>
                      {getSortIndex(f.key) >= 0 && (
                        <span className="shrink-0 text-foreground/60">
                          {getSortIndex(f.key) + 1}{getSortDir(f.key) === 'asc' ? '↓' : '↑'}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setOpenFilterColumn((c) => (c === f.key ? null : f.key)) }}
                        className={`shrink-0 rounded p-0.5 hover:bg-background ${columnFilters[f.key]?.size ? 'text-primary' : 'text-foreground/50'}`}
                        title="Filter column"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                        </svg>
                      </button>
                    </span>
                    {openFilterColumn === f.key && (
                      <ColumnFilterDropdown
                        columnKey={f.key}
                        columnLabel={f.label}
                        values={getColumnValues(f.key)}
                        selected={columnFilters[f.key] ?? new Set()}
                        onChange={(s) => setColumnFilters((p) => ({ ...p, [f.key]: s }))}
                        onClose={() => setOpenFilterColumn(null)}
                        anchorRef={{ current: filterAnchorRefs.current[f.key] }}
                        valueType={f.type === 'fraction' ? 'fraction' : f.type === 'number' ? 'number' : undefined}
                      />
                    )}
                  </th>
                ))}
                <th className="whitespace-nowrap px-3 py-3 text-right text-sm font-medium text-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedRecords.length === 0 ? (
                <tr>
                  <td
                    colSpan={visibleFields.length + (bulkSelectMode ? 3 : 2)}
                    className="p-6 text-center text-foreground/60"
                  >
                    No data yet. Click &quot;+ Add row&quot; to add.
                  </td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td
                    colSpan={visibleFields.length + (bulkSelectMode ? 3 : 2)}
                    className="p-6 text-center text-foreground/60"
                  >
                    No rows match the current filters.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((record) => (
                  <tr
                    key={record.id}
                    onClick={(e) => handleRowClick(record, e)}
                    className={`cursor-pointer bg-background transition-colors hover:bg-card ${canEditData && bulkSelectMode && selectedIds.has(record.id) ? 'ring-1 ring-primary/50' : ''}`}
                  >
                    {canEditData && bulkSelectMode && (
                      <td className="w-10 px-2 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <label className="flex cursor-pointer justify-center">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(record.id)}
                            onChange={(e) => {
                              e.stopPropagation()
                              setSelectedIds((prev) => {
                                const next = new Set(prev)
                                if (next.has(record.id)) next.delete(record.id)
                                else next.add(record.id)
                                return next
                              })
                            }}
                            className="h-4 w-4 rounded border-border"
                          />
                        </label>
                      </td>
                    )}
                    <td className="px-4 py-3 text-sm text-foreground/70">
                      {formatDateTime(record.recordedAt)}
                    </td>
                    {visibleFields.map((f) => {
                      const cellEditable = canEditData && (directTableEdit || f.type === 'status') && f.type !== 'formula' && !(f.type === 'status' && f.config?.formula)
                      return (
                      <td
                        key={f.id}
                        className="min-w-0 px-2 py-2 text-foreground align-top"
                        onClick={cellEditable ? (e) => e.stopPropagation() : undefined}
                      >
                        {cellEditable ? (
                          f.type === 'image' ? (
                            (() => {
                              const v = record.data[f.key]
                              const arr = Array.isArray(v) ? v : v ? [v] : []
                              const tag = f.config?.imageTag ? ` · ${f.config.imageTag}` : ''
                              return arr.length ? `${arr.length} photo(s)${tag}` : '—'
                            })()
                          ) : (
                            <div
                              className="min-w-0 w-full cursor-text"
                              onClick={
                                (f.type === 'datetime' || f.type === 'date')
                                  ? (e) => {
                                      const input = (e.target as HTMLElement).closest('td')?.querySelector<HTMLInputElement>('input[type="date"], input[type="time"], input[type="datetime-local"]')
                                      if (input && e.target !== input) {
                                        e.preventDefault()
                                        input.focus()
                                        input.showPicker?.()
                                      }
                                    }
                                  : undefined
                              }
                            >
                              {renderFormField(
                                f,
                                record.data[f.key] ?? (f.type === 'number' ? '' : f.type === 'boolean' ? false : f.type === 'fraction' ? 0 : f.type === 'timer' ? { totalElapsedMs: 0 } : f.type === 'datetime' ? '' : ''),
                                (key, val) => updateRecordField(record, key, val),
                                { disabled: submitting, compact: true }
                              )}
                            </div>
                          )
                        ) : (
                          <>
                            {typeof record.data[f.key] === 'boolean'
                              ? record.data[f.key]
                                ? 'Yes'
                                : 'No'
                              : f.type === 'image'
                                ? (() => {
                                    const v = record.data[f.key]
                                    const arr = Array.isArray(v) ? v : v ? [v] : []
                                    const tag = f.config?.imageTag ? ` · ${f.config.imageTag}` : ''
                                    return arr.length ? `${arr.length} photo(s)${tag}` : '—'
                                  })()
                                : f.type === 'longtext'
                                  ? (
                                    <span className="whitespace-pre-wrap break-words">
                                      {String(record.data[f.key] ?? '—')}
                                    </span>
                                    )
                                  : f.type === 'fraction'
                                    ? (() => {
                                        const n = Number(record.data[f.key])
                                        return n && Number.isFinite(n) ? formatDecimalAsFraction(n) : '—'
                                      })()
                                    : f.type === 'atlas_location'
                                      ? String(record.data[f.key] ?? '—')
                                      : getDisplayVal(record, f.key, f)}
                          </>
                        )}
                      </td>
                    ); })}
                    <td className="whitespace-nowrap px-2 py-3 text-right align-middle sm:px-3" onClick={(e) => e.stopPropagation()}>
                      {canEditData && (
                      <div className="flex shrink-0 justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(record)}
                          className="shrink-0 rounded border border-border px-3 py-1.5 text-sm text-foreground hover:bg-background"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteRecordPending(record.id)}
                          disabled={submitting}
                          className="shrink-0 rounded border border-red-500/50 px-3 py-1.5 text-sm text-red-500 hover:bg-red-500/10 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
          )}
        </div>
      )}
    </div>
  )
}
