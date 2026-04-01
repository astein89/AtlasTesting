import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useSortableHeader } from '../hooks/useSortableHeader'
import { useMatchMedia } from '../hooks/useMatchMedia'
import { useUserPreference } from '../hooks/useUserPreference'
import { formatDate, formatDateTime } from '../lib/dateTimeConfig'
import { api } from '../api/client'
import { getTests, getTest, updateTest, createTest } from '../api/tests'
import { formatDecimalAsFraction } from '../utils/fraction'
import { useAuthStore } from '../store/authStore'
import { EditRecordModal } from '../components/data/EditRecordModal'
import { AddRecordModal } from '../components/data/AddRecordModal'
import { BulkAddRowsModal } from '../components/data/BulkAddRowsModal'
import { ImportDataModal } from '../components/data/ImportDataModal'
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
import type { DataField, Test, TestPlan, TimerValue } from '../types'
import { getStatusOptions } from '../types'
import { getElapsedMs, formatTimerMs, parseTimerValue } from '../utils/timer'
import { getDefaultValueForField } from '../utils/fieldDefaults'
import {
  computeRecordDataWithPlanAutomation,
  getPendingConditionalStatusUpdates,
  planHasStatusAutomationForFieldId,
  recomputeRowDataAfterFieldEdit,
  setUserStatusLockForField,
  USER_STATUS_AUTOMATION_LOCK_KEY,
} from '../utils/planConditionalStatus'
import { getConditionalFormatStyle } from '../utils/conditionalFormat'
import { formatFieldValue } from '../utils/formatFieldValue'
import type { FormulaData } from '../utils/formulaEvaluator'
import { getContrastTextColor } from '../utils/colorContrast'
import { useAlertConfirm } from '../contexts/AlertConfirmContext'
import { ModalNestedHistoryContext } from '../contexts/ModalNestedHistoryContext'

interface Record {
  id: string
  testPlanId: string
  planName: string
  recordedAt: string
  /** When present, last edit time from record_history (falls back to recordedAt). */
  lastEditedAt?: string
  enteredBy: string
  status: string
  data: Record<string, string | number | boolean | string[] | TimerValue>
  runId?: string
}

function getDefaultData(
  fields: DataField[],
  plan?: TestPlan | null
): Record<string, string | number | boolean | string[] | TimerValue> {
  const defaults = plan?.fieldDefaults
  const out: Record<string, string | number | boolean | string[] | TimerValue> = {}
  for (const f of fields) {
    const planDefault = defaults?.[f.key]
    if (planDefault !== undefined && planDefault !== null) {
      if (f.type === 'number' && (typeof planDefault === 'number' || planDefault === '')) out[f.key] = planDefault
      else if (f.type === 'boolean' && typeof planDefault === 'boolean') out[f.key] = planDefault
      else if (f.type === 'select' && typeof planDefault === 'string') out[f.key] = planDefault
      else if (f.type === 'radio_select' && typeof planDefault === 'string') out[f.key] = planDefault
      else if (f.type === 'checkbox_select' && Array.isArray(planDefault)) {
        const opts = f.config?.options ?? []
        const set = new Set(opts.map(String))
        out[f.key] = planDefault.filter((x): x is string => typeof x === 'string' && set.has(x))
      }
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
      else if (f.type === 'radio_select') out[f.key] = ''
      else if (f.type === 'checkbox_select') out[f.key] = []
      else if (f.type === 'status') {
        if (planHasStatusAutomationForFieldId(plan, f.id) && !f.config?.formula) {
          out[f.key] = ''
        } else {
          const opts = getStatusOptions(f)
          out[f.key] = opts[0] ?? 'In Progress'
        }
      }
      else if (f.type === 'atlas_location') out[f.key] = ''
      else if (f.type === 'image') out[f.key] = f.config?.imageMultiple ? [] : ''
      else if (f.type === 'timer') out[f.key] = { totalElapsedMs: 0 }
      else if (f.type === 'formula') out[f.key] = getDefaultValueForField(f, defaults)
      else out[f.key] = ''
    }
  }
  return computeRecordDataWithPlanAutomation(fields, plan ?? null, out)
}

type PendingStatusConditionalItem = {
  fieldKey: string
  fieldLabel: string
  currentValue: string
  suggestedValue: string
}

const STATUS_CONDITIONAL_INTRO =
  'A Status Conditional is met and is different from your selection. Choose which to use.'

/** null = user closed the dialog without choosing (abort save, keep editor open). */
type StatusConditionalChoiceResult = 'selection' | 'conditional' | null

/** Matches `SelectInput` trigger styling used for status on Add row / Edit row modals. */
function StatusValueLikeSelectTrigger({ field, value }: { field: DataField; value: string }) {
  const valueColor = field.config?.statusColors?.[value]
  const hasColor = Boolean(value && valueColor)
  const triggerStyle =
    hasColor && valueColor
      ? { backgroundColor: valueColor, color: getContrastTextColor(valueColor), borderColor: valueColor }
      : undefined
  return (
    <span
      className="flex min-h-[44px] w-full min-w-[140px] items-center rounded border border-border bg-background px-3 py-2 text-left text-foreground"
      style={triggerStyle}
    >
      <span className={!value ? (hasColor ? '' : 'text-foreground/60') : ''}>{value || '—'}</span>
    </span>
  )
}

function StatusValueLikeSelectTriggerPlain({ value }: { value: string }) {
  return (
    <span className="flex min-h-[44px] w-full min-w-[140px] items-center rounded border border-border bg-background px-3 py-2 text-left text-foreground">
      <span className={value ? '' : 'text-foreground/60'}>{value || '—'}</span>
    </span>
  )
}

function recordFormDataChanged(
  original: Record<string, string | number | boolean | string[] | TimerValue>,
  current: Record<string, string | number | boolean | string[] | TimerValue>
): boolean {
  const keys = new Set([...Object.keys(original), ...Object.keys(current)])
  keys.delete(USER_STATUS_AUTOMATION_LOCK_KEY)
  for (const k of keys) {
    const a = original[k]
    const b = current[k]
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return true
      if (a.some((v, i) => v !== b[i])) return true
    } else if (
      typeof a === 'object' &&
      a !== null &&
      'totalElapsedMs' in a &&
      typeof b === 'object' &&
      b !== null &&
      'totalElapsedMs' in b
    ) {
      const ta = a as TimerValue
      const tb = b as TimerValue
      if (ta.totalElapsedMs !== tb.totalElapsedMs || ta.startedAt !== tb.startedAt) return true
    } else if (a !== b) {
      return true
    }
  }
  return false
}

export function TestPlanDataView() {
  const { planId, testId } = useParams<{ planId: string; testId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const [plan, setPlan] = useState<TestPlan | null>(null)
  const [currentTest, setCurrentTest] = useState<Test | null>(null)
  const [fields, setFields] = useState<DataField[]>([])
  const [records, setRecords] = useState<Record[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [editData, setEditData] = useState<Record<string, string | number | boolean | string[] | TimerValue>>({})
  const [editSessionBaseline, setEditSessionBaseline] = useState<Record<
    string,
    string | number | boolean | string[] | TimerValue
  > | null>(null)
  const [addData, setAddData] = useState<Record<string, string | number | boolean | string[] | TimerValue>>({})
  const [addSessionBaseline, setAddSessionBaseline] = useState<Record<
    string,
    string | number | boolean | string[] | TimerValue
  > | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [deleteRecordPending, setDeleteRecordPending] = useState<string | null>(null)
  const [showExportModal, setShowExportModal] = useState(false)
  const [persistTableFilters] = useUserPreference('atlas-persist-table-filters', false)
  const searchPrefKey = `atlas-data-search-${planId ?? 'default'}`
  const [prefSearch, setPrefSearch] = useUserPreference(searchPrefKey, '')
  const [localSearch, setLocalSearch] = useState('')
  const searchQuery = persistTableFilters ? prefSearch : localSearch
  const setSearchQuery = persistTableFilters ? setPrefSearch : setLocalSearch
  type ViewMode = 'table' | 'card' | 'compact-card' | 'responsive'
  const [viewMode, setViewMode] = useUserPreference<ViewMode>('atlas-data-view-mode', 'responsive')
  const isMobile = useMatchMedia('(max-width: 767px)')
  // On mobile, always show compact card view, regardless of the saved preference.
  const effectiveViewMode: 'table' | 'card' | 'compact-card' = isMobile
    ? 'compact-card'
    : viewMode === 'responsive'
      ? 'table'
      : viewMode
  const showTableView = effectiveViewMode === 'table'
  const showCardView = effectiveViewMode === 'card' || effectiveViewMode === 'compact-card'
  const compactCards = effectiveViewMode === 'compact-card'
  const columnFiltersPrefKey = `atlas-data-column-filters-${planId ?? 'default'}`
  const serializeColumnFilters = (v: Record<string, string[]>) => JSON.stringify(v)
  const deserializeColumnFilters = (s: string): Record<string, string[]> => {
    try {
      const o = JSON.parse(s)
      if (typeof o !== 'object' || o === null) return {}
      return Object.fromEntries(
        Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? v.map(String) : []])
      )
    } catch {
      return {}
    }
  }
  const [prefColumnFiltersArr, setPrefColumnFiltersArr] = useUserPreference<Record<string, string[]>>(
    columnFiltersPrefKey,
    {},
    serializeColumnFilters,
    deserializeColumnFilters
  )
  const prefColumnFilters = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(prefColumnFiltersArr).map(([k, v]) => [k, new Set(v)] as const)
      ),
    [prefColumnFiltersArr]
  )
  const setPrefColumnFilters = useCallback(
    (valueOrUpdater: Record<string, Set<string>> | ((prev: Record<string, Set<string>>) => Record<string, Set<string>>)) => {
      setPrefColumnFiltersArr((prevArr) => {
        const prevSets = Object.fromEntries(
          Object.entries(prevArr).map(([k, v]) => [k, new Set(v)] as const)
        )
        const nextSets =
          typeof valueOrUpdater === 'function' ? valueOrUpdater(prevSets) : valueOrUpdater
        return Object.fromEntries(
          Object.entries(nextSets).map(([k, v]) => [k, [...v]] as const)
        )
      })
    },
    [setPrefColumnFiltersArr]
  )
  const [localColumnFilters, setLocalColumnFilters] = useState<Record<string, Set<string>>>({})
  const columnFilters = persistTableFilters ? prefColumnFilters : localColumnFilters
  const setColumnFilters = persistTableFilters ? setPrefColumnFilters : setLocalColumnFilters
  const [openFilterColumn, setOpenFilterColumn] = useState<string | null>(null)
  const [showMobileFilterPanel, setShowMobileFilterPanel] = useState(false)
  const statusTabPrefKey = `atlas-data-status-tab-${planId ?? 'default'}`
  const [selectedStatusTab, setSelectedStatusTab] = useUserPreference(statusTabPrefKey, 'All')
  const [openColumnPicker, setOpenColumnPicker] = useState(false)
  const columnPickerAnchorRef = useRef<HTMLButtonElement | null>(null)
  const filterAnchorRefs = useRef<Record<string, HTMLElement | null>>({})
  const isAdmin = useAuthStore((s) => s.isAdmin())
  const canEditData = useAuthStore((s) => s.canEditData())
  const isArchived = currentTest?.archived === true
  const editingAllowed = canEditData && (!testId || (currentTest != null && !currentTest.archived))
  const { showAlert, showConfirm } = useAlertConfirm()
  const navigate = useNavigate()

  const [statusConditionalChoice, setStatusConditionalChoice] = useState<{
    pending: PendingStatusConditionalItem[]
    resolve: (choice: StatusConditionalChoiceResult) => void
  } | null>(null)

  const resolveStatusConditionalChoice = useCallback((choice: StatusConditionalChoiceResult) => {
    setStatusConditionalChoice((s) => {
      s?.resolve(choice)
      return null
    })
  }, [])

  const requestStatusConditionalChoice = useCallback(
    (pending: PendingStatusConditionalItem[]) =>
      new Promise<StatusConditionalChoiceResult>((resolve) => {
        setStatusConditionalChoice({ pending, resolve })
      }),
    []
  )

  useEffect(() => {
    if (!statusConditionalChoice) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') resolveStatusConditionalChoice(null)
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [statusConditionalChoice, resolveStatusConditionalChoice])

  const finalizeDataForSaveWithStatusPrompt = useCallback(
    async (
      baseline: Record<string, string | number | boolean | string[] | TimerValue> | null,
      draft: Record<string, string | number | boolean | string[] | TimerValue>
    ): Promise<Record<string, string | number | boolean | string[] | TimerValue> | null> => {
      const draftFd = draft as FormulaData
      const computed = computeRecordDataWithPlanAutomation(fields, plan, draftFd) as Record<
        string,
        string | number | boolean | string[] | TimerValue
      >
      if (!baseline || !recordFormDataChanged(baseline, draft)) {
        return computed
      }
      const pending = getPendingConditionalStatusUpdates(fields, plan, draftFd)
      if (pending.length === 0) return computed
      const choice = await requestStatusConditionalChoice(pending)
      if (choice === null) return null
      let out = computed as FormulaData
      if (choice === 'conditional') {
        for (const p of pending) {
          out = { ...out, [p.fieldKey]: p.suggestedValue }
          out = setUserStatusLockForField(out, p.fieldKey, false)
        }
      } else {
        for (const p of pending) {
          out = { ...out, [p.fieldKey]: p.currentValue }
          out = setUserStatusLockForField(out, p.fieldKey, true)
        }
      }
      return out as Record<string, string | number | boolean | string[] | TimerValue>
    },
    [fields, plan, requestStatusConditionalChoice]
  )

  const columnsPrefKey = planId ? `atlas-data-hidden-columns-${planId}` : 'atlas-data-hidden-columns-default'
  const [hiddenColumnKeys, setHiddenColumnKeys] = useUserPreference<string[]>(columnsPrefKey, [])
  const [directTableEdit, setDirectTableEdit] = useUserPreference('atlas-direct-table-edit', false)
  const [bulkSelectMode, setBulkSelectMode] = useState(false)
  const [openRecordsViewOnly, setOpenRecordsViewOnly] = useUserPreference('atlas-open-records-view-only', false)
  const [recordModalViewOnly, setRecordModalViewOnly] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBulkEditModal, setShowBulkEditModal] = useState(false)
  const [showBulkAddRowsModal, setShowBulkAddRowsModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [bulkDeletePending, setBulkDeletePending] = useState(false)
  const [bulkEditFieldKey, setBulkEditFieldKey] = useState<string | null>(null)
  const [bulkEditValue, setBulkEditValue] = useState<string | number | boolean | string[] | TimerValue | null>(null)
  const [showMoveToTestModal, setShowMoveToTestModal] = useState(false)
  const [otherTests, setOtherTests] = useState<Array<{ id: string; name: string }>>([])
  const [moveToTestId, setMoveToTestId] = useState<string>('')
  const [showAddTestInMoveModal, setShowAddTestInMoveModal] = useState(false)
  const [newTestName, setNewTestName] = useState('')
  const [newTestStart, setNewTestStart] = useState('')
  const [newTestEnd, setNewTestEnd] = useState('')
  const [restoringFromArchive, setRestoringFromArchive] = useState(false)
  const [showLastEditedColumn, setShowLastEditedColumn] = useUserPreference<boolean>(
    planId ? `atlas-data-show-last-edited-${planId}` : 'atlas-data-show-last-edited-default',
    false
  )
  const visibleFields = useMemo(() => {
    const allTableFields = fields
    const shouldApplyPlanDefault =
      plan?.defaultVisibleColumnIds &&
      plan.defaultVisibleColumnIds.length > 0 &&
      hiddenColumnKeys.length === 0
    if (shouldApplyPlanDefault) {
      const defaultVisibleKeys = new Set(
        fields
          .filter((f) => (plan?.defaultVisibleColumnIds ?? []).includes(f.id))
          .map((f) => f.key)
      )
      const allKeys = allTableFields.map((f) => f.key)
      const newHiddenKeys = allKeys.filter((k) => !defaultVisibleKeys.has(k))
      if (newHiddenKeys.length > 0) {
        return allTableFields.filter((f) => !newHiddenKeys.includes(f.key))
      }
      return allTableFields
    }
    return allTableFields.filter((f) => !hiddenColumnKeys.includes(f.key))
  }, [fields, hiddenColumnKeys, plan?.defaultVisibleColumnIds])

  useEffect(() => {
    if (!plan?.defaultVisibleColumnIds?.length) return
    if (hiddenColumnKeys.length > 0) return
    if (fields.length === 0) return
    const defaultVisibleKeys = new Set(
      fields.filter((f) => plan.defaultVisibleColumnIds.includes(f.id)).map((f) => f.key)
    )
    const newHiddenKeys = fields.map((f) => f.key).filter((k) => !defaultVisibleKeys.has(k))
    if (newHiddenKeys.length > 0) setHiddenColumnKeys(newHiddenKeys)
  }, [plan, fields, hiddenColumnKeys.length, setHiddenColumnKeys])

  // Export uses a fixed column order: all data fields in their base table order,
  // regardless of which columns are currently hidden in the UI.
  const exportFieldOrder = useMemo(
    () => fields.map((f) => f.key),
    [fields]
  )
  const toggleColumnVisibility = (fieldKey: string) => {
    setHiddenColumnKeys((prev) =>
      prev.includes(fieldKey) ? prev.filter((k) => k !== fieldKey) : [...prev, fieldKey]
    )
  }

  const loadRecords = useCallback(() => {
    if (!planId || !testId) return
    api
      .get<Record[]>('/records', { params: { testPlanId: planId, testId, limit: 100 } })
      .then((r) => setRecords(r.data))
      .catch(() => setRecords([]))
  }, [planId, testId])

  const loadPlanAndFields = useCallback(() => {
    if (!planId) return
    api
      .get<TestPlan>(`/test-plans/${planId}`)
      .then((r) => {
        const planData = r.data
        setPlan(planData)
        const fieldIds = planData.fieldIds?.length ? planData.fieldIds : []
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
            .filter((res): res is PromiseFulfilledResult<DataField> => res.status === 'fulfilled' && res.value != null)
            .map((res) => res.value)
          setFields(f)
          setAddData(getDefaultData(f, planData))
        })
      })
      .catch(() => setPlan(null))
  }, [planId])

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
    if (!planId || !testId) return
    getTest(planId, testId)
      .then((t) => setCurrentTest(t))
      .catch(() => setCurrentTest(null))
  }, [planId, testId])

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

  const hasModalOpen =
    !!deleteRecordPending ||
    showExportModal ||
    !!editingId ||
    isAdding ||
    showBulkEditModal ||
    bulkDeletePending ||
    showBulkAddRowsModal ||
    showImportModal ||
    showMoveToTestModal

  const closeTopmostModal = useCallback(() => {
    if (deleteRecordPending) {
      setDeleteRecordPending(null)
    } else if (showMoveToTestModal) {
      setShowMoveToTestModal(false)
    } else if (showBulkEditModal) {
      setShowBulkEditModal(false)
    } else if (bulkDeletePending) {
      setBulkDeletePending(false)
    } else if (showExportModal) {
      setShowExportModal(false)
    } else if (showImportModal) {
      setShowImportModal(false)
    } else if (showBulkAddRowsModal) {
      setShowBulkAddRowsModal(false)
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
    deleteRecordPending,
    showBulkEditModal,
    bulkDeletePending,
    showMoveToTestModal,
    showExportModal,
    showImportModal,
    showBulkAddRowsModal,
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
  /** Nested overlays (Atlas location picker) push another entry; Back must dismiss them before the parent modal. */
  const atlasPickerCloseRef = useRef<(() => void) | null>(null)
  const atlasClosedByBrowserBackRef = useRef(false)
  const ignoreAtlasHistoryPopRef = useRef(false)

  const registerAtlasPickerHistory = useCallback((onClose: () => void) => {
    const url = window.location.pathname + window.location.search + window.location.hash
    window.history.pushState({ atlasLocationPicker: true }, '', url)
    atlasPickerCloseRef.current = onClose
    return () => {
      if (atlasClosedByBrowserBackRef.current) {
        atlasClosedByBrowserBackRef.current = false
        atlasPickerCloseRef.current = null
        return
      }
      atlasPickerCloseRef.current = null
      ignoreAtlasHistoryPopRef.current = true
      window.history.back()
    }
  }, [])

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
      if (ignoreAtlasHistoryPopRef.current) {
        ignoreAtlasHistoryPopRef.current = false
        return
      }
      if (atlasPickerCloseRef.current) {
        atlasClosedByBrowserBackRef.current = true
        const fn = atlasPickerCloseRef.current
        atlasPickerCloseRef.current = null
        fn()
        return
      }
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
    if (!editingIdFromUrl || records.length === 0 || fields.length === 0) return
    if (editingId != null) return // already editing (e.g. opened from UI), don't overwrite
    const record = records.find((r) => r.id === editingIdFromUrl)
    if (record) {
      setEditingId(record.id)
      const init = computeRecordDataWithPlanAutomation(fields, plan, record.data as FormulaData)
      setEditData(init)
      setEditSessionBaseline({ ...init })
    } else {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.delete('editing')
        const s = next.toString()
        return s ? next : new URLSearchParams()
      })
    }
  }, [editingIdFromUrl, records, fields, plan])

  const startAdd = () => {
    setIsAdding(true)
    if (fields.length > 0 && plan) {
      const base = getDefaultData(fields, plan)
      setAddData(base)
      setAddSessionBaseline({ ...base })
    }
  }

  useEffect(() => {
    if (isAdding && fields.length > 0) {
      const base = getDefaultData(fields, plan)
      setAddData(base)
      setAddSessionBaseline({ ...base })
    }
  }, [isAdding, plan, fields])

  const cancelAdd = () => {
    setIsAdding(false)
    setAddSessionBaseline(null)
  }

  const saveAdd = async () => {
    if (!planId || !testId) return
    setSubmitting(true)
    try {
      const dataToSave = await finalizeDataForSaveWithStatusPrompt(addSessionBaseline, addData)
      if (dataToSave === null) return
      await api.post('/records', {
        testPlanId: planId,
        testId,
        data: dataToSave,
        status: 'partial',
      })
      loadRecords()
      setIsAdding(false)
      setAddSessionBaseline(null)
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      showAlert(err || 'Failed to add data')
    } finally {
      setSubmitting(false)
    }
  }

  const startEdit = (record: Record) => {
    setEditingId(record.id)
    const init = computeRecordDataWithPlanAutomation(fields, plan, record.data as FormulaData)
    setEditData(init)
    setEditSessionBaseline({ ...init })
    setRecordModalViewOnly(openRecordsViewOnly)
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
    setEditSessionBaseline(null)
    setRecordModalViewOnly(false)
    clearEditingParam()
  }

  const handleRestoreFromArchive = async () => {
    if (!planId || !testId) return
    const ok = await showConfirm(
      'Restore this test? It will appear in the main test list again and you can edit data.'
    )
    if (!ok) return
    setRestoringFromArchive(true)
    try {
      await updateTest(planId, testId, { archived: false })
      navigate(`/test-plans/${planId}`)
    } catch {
      showAlert('Failed to restore test.')
    } finally {
      setRestoringFromArchive(false)
    }
  }

  const deleteRecord = async (recordId: string) => {
    setSubmitting(true)
    if (editingId === recordId) {
      setEditingId(null)
      setEditSessionBaseline(null)
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
            data: recomputeRowDataAfterFieldEdit(fields, plan, rec.data as FormulaData, fieldKey, value),
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

  const openMoveToTestModal = useCallback(() => {
    if (!planId || !testId) return
    getTests(planId)
      .then((list) => setOtherTests(list.filter((t) => !t.archived && t.id !== testId).map((t) => ({ id: t.id, name: t.name }))))
      .catch(() => setOtherTests([]))
    setMoveToTestId('')
    setShowAddTestInMoveModal(false)
    setNewTestName('')
    setNewTestStart('')
    setNewTestEnd('')
    setShowMoveToTestModal(true)
  }, [planId, testId])

  const refreshOtherTests = useCallback(() => {
    if (!planId || !testId) return
    getTests(planId)
      .then((list) => setOtherTests(list.filter((t) => !t.archived && t.id !== testId).map((t) => ({ id: t.id, name: t.name }))))
      .catch(() => setOtherTests([]))
  }, [planId, testId])

  const handleAddTestFromMoveModal = async () => {
    if (!planId || !newTestName.trim() || !newTestStart.trim()) return
    setSubmitting(true)
    try {
      const test = await createTest(planId, {
        name: newTestName.trim(),
        startDate: newTestStart.trim() || undefined,
        endDate: newTestEnd.trim() || undefined,
      })
      await refreshOtherTests()
      setMoveToTestId(test.id)
      setShowAddTestInMoveModal(false)
      setNewTestName('')
      setNewTestStart('')
      setNewTestEnd('')
    } catch {
      showAlert('Failed to add test.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleMoveToTest = async () => {
    if (!moveToTestId || selectedIds.size === 0) return
    const ids = [...selectedIds]
    setSubmitting(true)
    try {
      await Promise.all(ids.map((id) => api.put(`/records/${id}`, { testId: moveToTestId })))
      loadRecords()
      setShowMoveToTestModal(false)
      setSelectedIds(new Set())
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      showAlert(err || 'Failed to move some rows')
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
      const dataToSave = await finalizeDataForSaveWithStatusPrompt(editSessionBaseline, editData)
      if (dataToSave === null) return
      await api.put(`/records/${editingId}`, {
        data: dataToSave,
        status: rec.status,
      })
      loadRecords()
      setEditingId(null)
      setEditSessionBaseline(null)
      clearEditingParam()
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      showAlert(err || 'Failed to save')
    } finally {
      setSubmitting(false)
    }
  }

  const updateAddField = (key: string, value: string | number | boolean | string[] | TimerValue) => {
    setAddData((d: Record<string, string | number | boolean | string[] | TimerValue>) =>
      recomputeRowDataAfterFieldEdit(fields, plan, d as FormulaData, key, value)
    )
  }

  const updateEditField = (key: string, value: string | number | boolean | string[] | TimerValue) => {
    setEditData((d: Record<string, string | number | boolean | string[] | TimerValue>) =>
      recomputeRowDataAfterFieldEdit(fields, plan, d as FormulaData, key, value)
    )
  }

  const updateRecordField = async (record: Record, key: string, value: string | number | boolean | string[] | TimerValue) => {
    const baseline = computeRecordDataWithPlanAutomation(fields, plan, record.data as FormulaData) as Record<
      string,
      string | number | boolean | string[] | TimerValue
    >
    const newData = recomputeRowDataAfterFieldEdit(fields, plan, record.data as FormulaData, key, value)
    const dataToSave = await finalizeDataForSaveWithStatusPrompt(baseline, newData as Record<
      string,
      string | number | boolean | string[] | TimerValue
    >)
    if (dataToSave === null) return
    try {
      await api.put(`/records/${record.id}`, { data: dataToSave, status: record.status })
      setRecords((prev) =>
        prev.map((r) => (r.id === record.id ? { ...r, data: dataToSave } : r))
      )
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      showAlert(err || 'Failed to update')
    }
  }

  const fieldLayout = plan?.fieldLayout ?? {}
  const hasFieldLayout = Object.keys(fieldLayout).length > 0
  const recordsWithComputed = useMemo(
    () =>
      records.map((r) => ({
        ...r,
        data: computeRecordDataWithPlanAutomation(fields, plan, r.data as FormulaData) as Record<
          string,
          string | number | boolean | string[] | TimerValue
        >,
      })),
    [records, fields, plan]
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
    if (f.type === 'radio_select' && Array.isArray(f.config?.options)) {
      optionLen = Math.max(0, ...f.config.options.map((o) => String(o).length))
    }
    if (f.type === 'checkbox_select' && Array.isArray(f.config?.options)) {
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
      case 'radio_select':
      case 'checkbox_select':
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

  type SortKey = 'date' | 'lastEdited' | string
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
    if (key === 'lastEdited') return record.lastEditedAt ?? record.recordedAt
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

  /** Records for the current test (loaded by testId). */
  const displayRecords = useMemo(() => recordsWithComputed, [recordsWithComputed])

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
  const columnSelectionDiffersFromDefault = useMemo(() => {
    const allTableFields = fields
    const baselineHiddenKeys =
      plan?.defaultVisibleColumnIds && plan.defaultVisibleColumnIds.length > 0
        ? allTableFields
            .filter((f) => !(plan.defaultVisibleColumnIds ?? []).includes(f.id))
            .map((f) => f.key)
        : []
    // If there is no plan-level default and user hasn't customized, treat as not differing
    if ((!plan?.defaultVisibleColumnIds || plan.defaultVisibleColumnIds.length === 0) && hiddenColumnKeys.length === 0) {
      return false
    }
    // Compare sets of hidden keys
    const a = new Set(baselineHiddenKeys)
    const b = new Set(hiddenColumnKeys)
    if (a.size !== b.size) return true
    for (const k of a) {
      if (!b.has(k)) return true
    }
    return false
  }, [fields, hiddenColumnKeys, plan?.defaultVisibleColumnIds])

  const differsFromDefault =
    sortDiffersFromDefault || hasActiveFilters || statusDiffersFromDefault || columnSelectionDiffersFromDefault

  const clearToDefault = () => {
    setSortOrder(defaultSortOrder)
    setSearchQuery('')
    setColumnFilters({})
    setOpenFilterColumn(null)
    setSelectedStatusTab('All')
    // Reset per-user column visibility back to the plan-level default
    setHiddenColumnKeys([])
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
      // First click on a column sorts ascending.
      return [{ key, dir: 'asc' }]
    })
  }

  const getSortHandlers = useSortableHeader(handleSort)
  const getSortIndex = (key: SortKey) => sortOrder.findIndex((s) => s.key === key)
  const getSortDir = (key: SortKey) => sortOrder.find((s) => s.key === key)?.dir

  const handleRowClick = (record: Record, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    if (editingAllowed && bulkSelectMode) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(record.id)) next.delete(record.id)
        else next.add(record.id)
        return next
      })
      return
    }
    startEdit(record)
  }

  if (loading || !plan) return <p className="text-foreground/60">Loading...</p>

  const hasFields = fields.length > 0

  return (
    <ModalNestedHistoryContext.Provider value={registerAtlasPickerHistory}>
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm text-foreground/70">
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/test-plans" className="hover:text-foreground hover:underline">
            Test plans
          </Link>
          <span>/</span>
          <Link to={`/test-plans/${planId}`} className="text-foreground hover:underline">
            {plan.name}
          </Link>
          {currentTest && (
            <>
              <span>/</span>
              <span className="text-foreground/80">{currentTest.name}</span>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowExportModal(true)}
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-background"
          >
            Export
          </button>
          {editingAllowed && (
            <button
              type="button"
              onClick={() => setShowImportModal(true)}
              className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-background"
              title="Import rows from CSV or XLSX file"
            >
              Import
            </button>
          )}
          {hasFields && editingAllowed && (
            <>
              <button
                type="button"
                onClick={() => setShowBulkAddRowsModal(true)}
                className="rounded-lg border border-primary/60 px-4 py-2 text-sm text-primary hover:bg-primary/5"
                title="Bulk add rows by entering a value and optional shared fields"
              >
                Bulk add
              </button>
              <button
                type="button"
                onClick={startAdd}
                className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
              >
                + Add row
              </button>
            </>
          )}
        </div>
      </div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">{plan.name}</h1>
        {plan.description && (
          <p className="mt-1 max-w-2xl whitespace-pre-wrap text-sm text-foreground/80 leading-relaxed">
            {plan.description}
          </p>
        )}
      </div>
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
      {showBulkAddRowsModal && plan && testId && (
        <BulkAddRowsModal
          fields={fields}
          plan={plan}
          testId={testId}
          onClose={() => setShowBulkAddRowsModal(false)}
          onCreated={() => {
            setShowBulkAddRowsModal(false)
            loadRecords()
          }}
        />
      )}
      {showImportModal && plan && testId && (
        <ImportDataModal
          planId={planId!}
          plan={plan}
          testId={testId}
          fields={fields}
          onClose={() => setShowImportModal(false)}
          onImported={() => {
            loadRecords()
            loadPlanAndFields()
          }}
        />
      )}
      {showExportModal && (
        <ExportPlanModal
          planId={plan.id}
          planName={plan.name}
          onClose={() => setShowExportModal(false)}
          filteredRecords={filteredRecords}
          testName={currentTest?.name}
          defaultSortOrder={defaultSortOrder}
          keyField={plan.keyField}
          fields={fields}
          fieldOrderKeys={exportFieldOrder}
          formLayoutOrder={plan.formLayoutOrder}
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
          readOnly={!editingAllowed || recordModalViewOnly}
          onStartEdit={editingAllowed ? () => setRecordModalViewOnly(false) : undefined}
        />
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
      {showMoveToTestModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowMoveToTestModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-lg font-semibold text-foreground">Move {selectedIds.size} row(s) to test</h3>
            <p className="mb-4 text-sm text-foreground/80">
              Select the destination test. Rows will remain in this plan.
            </p>
            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-foreground">Test</label>
              <PopupSelect
                label=""
                value={moveToTestId}
                onChange={(id) => setMoveToTestId(id || '')}
                emptyOption="Select a test"
                options={otherTests.map((t) => ({ value: t.id, label: t.name }))}
              />
            </div>
            {!showAddTestInMoveModal ? (
              <div className="mb-4">
                <button
                  type="button"
                  onClick={() => {
                    setNewTestStart(new Date().toISOString().slice(0, 10))
                    setShowAddTestInMoveModal(true)
                  }}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-background"
                >
                  Add new test
                </button>
              </div>
            ) : (
              <div className="mb-4 rounded-lg border border-border bg-muted/30 p-3 space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground/80">Name</label>
                  <input
                    type="text"
                    value={newTestName}
                    onChange={(e) => setNewTestName(e.target.value)}
                    placeholder="Test name"
                    className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground/80">Start date</label>
                  <input
                    type="date"
                    value={newTestStart}
                    onChange={(e) => setNewTestStart(e.target.value)}
                    className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground/80">End date (optional)</label>
                  <input
                    type="date"
                    value={newTestEnd}
                    onChange={(e) => setNewTestEnd(e.target.value)}
                    className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddTestInMoveModal(false)
                      setNewTestName('')
                      setNewTestStart('')
                      setNewTestEnd('')
                    }}
                    className="rounded border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-background"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleAddTestFromMoveModal}
                    disabled={submitting || !newTestName.trim() || !newTestStart.trim()}
                    className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {submitting ? 'Creating…' : 'Create test'}
                  </button>
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowMoveToTestModal(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleMoveToTest}
                disabled={submitting || !moveToTestId}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {submitting ? 'Moving…' : 'Move'}
              </button>
            </div>
          </div>
        </div>
      )}
      {!hasFields ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-foreground/70">
            No fields configured. Go to the plan page to edit the plan and add fields, then you can collect data.
          </p>
          <Link
            to={`/test-plans/${planId}`}
            className="mt-4 inline-flex min-h-[44px] shrink-0 items-center rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 sm:min-h-0"
          >
            ← Back to plan
          </Link>
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
{editingAllowed && (
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
                title={bulkSelectMode ? 'Turn off row selection' : 'Select rows'}
              >
                <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-xs font-medium">Select</span>
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
                      <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-background">
                        <input
                          type="checkbox"
                          checked={showLastEditedColumn}
                          onChange={(e) => setShowLastEditedColumn(e.target.checked)}
                          className="h-4 w-4"
                        />
                        <span className="text-sm text-foreground">Last edited</span>
                      </label>
                      {fields.map((f) => (
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
          {editingAllowed && bulkSelectMode && (
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
                onClick={openMoveToTestModal}
                disabled={submitting || selectedIds.size === 0}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-background/80 disabled:opacity-50"
              >
                Move to test
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
                      tableAnchorRefs={filterAnchorRefs}
                      tableAnchorKey="date"
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
                        tableAnchorRefs={filterAnchorRefs}
                        tableAnchorKey={f.key}
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
                    className={`w-full min-w-0 cursor-pointer overflow-hidden rounded-lg border px-4 py-3 transition-colors hover:bg-background/50 active:bg-background/70 ${bulkSelectMode && selectedIds.has(record.id) ? 'border-border bg-blue-600/20 dark:bg-blue-500/20' : 'border-border bg-card'}`}
                  >
                    {editingAllowed && bulkSelectMode ? (
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
                                {field.type === 'image' ? (
                                  (() => {
                                    const v = record.data[field.key]
                                    const arr = Array.isArray(v) ? v : v ? [v] : []
                                    const urls = arr.filter((s): s is string => typeof s === 'string' && s.length > 0)
                                    if (urls.length === 0) return <p className="text-sm text-foreground">—</p>
                                    return (
                                      <div className="flex flex-wrap gap-1.5">
                                        {urls.map((src, i) => (
                                          <img
                                            key={i}
                                            src={src}
                                            alt=""
                                            className="h-14 w-14 shrink-0 rounded object-cover"
                                          />
                                        ))}
                                      </div>
                                    )
                                  })()
                                ) : (
                                <p className="truncate text-sm text-foreground">
                                  {typeof record.data[field.key] === 'boolean'
                                    ? record.data[field.key]
                                      ? 'Yes'
                                      : 'No'
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
                                )}
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
{editingAllowed && (
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
          {/* Table view: main scroll area. On small screens, ensure enough vertical space for many rows. */}
          {showTableView && (
          <>
          {isArchived && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm text-foreground">
              <span className="font-medium">This test is archived.</span>
              <span className="text-foreground/80">View-only.</span>
              <button
                type="button"
                onClick={handleRestoreFromArchive}
                disabled={restoringFromArchive}
                className="shrink-0 rounded border border-amber-600/60 bg-amber-500/20 px-3 py-1.5 font-medium text-foreground hover:bg-amber-500/30 disabled:opacity-50 dark:border-amber-400/50 dark:bg-amber-500/15 dark:hover:bg-amber-500/25"
              >
                {restoringFromArchive ? 'Restoring…' : 'Restore'}
              </button>
            </div>
          )}
          <div className="flex min-h-[60vh] min-w-0 flex-1 flex-col overflow-y-auto overflow-x-auto rounded-lg border border-border">
          <table
            className="w-full"
            style={{ tableLayout: 'fixed' }}
          >
            <colgroup>
              {editingAllowed && bulkSelectMode && <col style={{ width: '2.5rem' }} />}
              <col style={{ width: '14rem' }} />
              {showLastEditedColumn && <col style={{ width: '14rem' }} />}
              {visibleFields.map((f) => (
                <col key={f.id} style={{ width: hasFieldLayout ? (fieldLayout[f.id] || getColumnWidth(f)) : getColumnWidth(f) }} />
              ))}
              <col style={{ width: '150px' }} />
            </colgroup>
            <thead className="sticky top-0 z-10 border-b border-border bg-card">
              <tr>
                {editingAllowed && bulkSelectMode && (
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
                      tableAnchorRefs={filterAnchorRefs}
                      tableAnchorKey="date"
                    />
                  )}
                </th>
                {showLastEditedColumn && (
                  <th
                    className="min-w-0 cursor-pointer select-none px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-background/50"
                    {...getSortHandlers('lastEdited')}
                    title="Tap to sort. Long-press or Shift+click to add secondary sort."
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="whitespace-nowrap">Last edited</span>
                      {getSortIndex('lastEdited') >= 0 && (
                        <span className="shrink-0 text-foreground/60">
                          {getSortIndex('lastEdited') + 1}{getSortDir('lastEdited') === 'asc' ? '↓' : '↑'}
                        </span>
                      )}
                    </span>
                  </th>
                )}
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
                        tableAnchorRefs={filterAnchorRefs}
                        tableAnchorKey={f.key}
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
                    colSpan={visibleFields.length + (bulkSelectMode ? 3 : 2) + (showLastEditedColumn ? 1 : 0)}
                    className="p-6 text-center text-foreground/60"
                  >
                    No data yet. Click &quot;+ Add row&quot; to add.
                  </td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td
                    colSpan={visibleFields.length + (bulkSelectMode ? 3 : 2) + (showLastEditedColumn ? 1 : 0)}
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
                    className={`cursor-pointer transition-colors hover:bg-card ${editingAllowed && bulkSelectMode && selectedIds.has(record.id) ? 'bg-blue-600/20 dark:bg-blue-500/20' : 'bg-background'}`}
                  >
                    {editingAllowed && bulkSelectMode && (
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
                    <td className="whitespace-nowrap min-w-0 px-4 py-3 text-sm text-foreground align-top">
                      {formatDateTime(record.recordedAt)}
                    </td>
                    {showLastEditedColumn && (
                      <td className="whitespace-nowrap min-w-0 px-4 py-3 text-sm text-foreground/80 align-top">
                        {record.lastEditedAt ? formatDateTime(record.lastEditedAt) : '—'}
                      </td>
                    )}
                    {visibleFields.map((f) => {
                      const cellEditable = editingAllowed && (directTableEdit || f.type === 'status') && f.type !== 'formula' && !(f.type === 'status' && f.config?.formula)
                      const cfStyle = getConditionalFormatStyle(f, record.data as FormulaData)
                      return (
                      <td
                        key={f.id}
                        className="min-w-0 px-2 py-2 text-foreground align-top"
                        style={cfStyle}
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
                                record.data[f.key] ??
                                  (f.type === 'number'
                                    ? ''
                                    : f.type === 'boolean'
                                      ? false
                                      : f.type === 'fraction'
                                        ? 0
                                        : f.type === 'timer'
                                          ? { totalElapsedMs: 0 }
                                          : f.type === 'datetime'
                                            ? ''
                                            : f.type === 'checkbox_select'
                                              ? []
                                              : ''),
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
                                    ? formatFieldValue(f as any, record.data[f.key])
                                    : f.type === 'atlas_location'
                                      ? String(record.data[f.key] ?? '—')
                                      : getDisplayVal(record, f.key, f)}
                          </>
                        )}
                      </td>
                    ); })}
                    <td className="whitespace-nowrap px-2 py-3 text-right align-middle sm:px-3" onClick={(e) => e.stopPropagation()}>
{editingAllowed && (
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
          </>
          )}
        </div>
      )}
      {statusConditionalChoice && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="status-conditional-title"
          aria-describedby="status-conditional-desc"
        >
          <div
            className="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl border border-border bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-border pl-4 pr-1">
              <h2
                id="status-conditional-title"
                className="min-w-0 flex-1 py-3 pr-2 text-lg font-semibold leading-tight text-foreground"
              >
                Suggested status
              </h2>
              <button
                type="button"
                onClick={() => resolveStatusConditionalChoice(null)}
                className="flex h-11 min-w-[44px] shrink-0 items-center justify-center rounded-lg text-foreground/70 hover:bg-background hover:text-foreground"
                aria-label="Close without saving"
              >
                <span className="text-2xl leading-none" aria-hidden>
                  ×
                </span>
              </button>
            </div>
            <div
              id="status-conditional-desc"
              className="min-h-[44px] flex-1 overflow-y-auto px-4 py-4 text-sm leading-relaxed text-foreground"
            >
              <p className="text-foreground/90">{STATUS_CONDITIONAL_INTRO}</p>
              <div className="mt-4 flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => resolveStatusConditionalChoice('selection')}
                  className="w-full rounded border border-border bg-background p-2 text-left transition-colors hover:border-primary hover:bg-card focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label={`Selection — ${statusConditionalChoice.pending.map((p) => `${p.fieldLabel}: ${p.currentValue}`).join('; ')}`}
                >
                  <div className="flex w-full flex-col gap-2">
                    {statusConditionalChoice.pending.map((p) => {
                      const f = fields.find((x) => x.key === p.fieldKey)
                      return f ? (
                        <StatusValueLikeSelectTrigger key={p.fieldKey} field={f} value={p.currentValue} />
                      ) : (
                        <StatusValueLikeSelectTriggerPlain key={p.fieldKey} value={p.currentValue} />
                      )
                    })}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => resolveStatusConditionalChoice('conditional')}
                  className="w-full rounded border border-border bg-background p-2 text-left transition-colors hover:border-primary hover:bg-card focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label={`Conditional — ${statusConditionalChoice.pending.map((p) => `${p.fieldLabel}: ${p.suggestedValue}`).join('; ')}`}
                >
                  <div className="flex w-full flex-col gap-2">
                    {statusConditionalChoice.pending.map((p) => {
                      const f = fields.find((x) => x.key === p.fieldKey)
                      return f ? (
                        <StatusValueLikeSelectTrigger key={p.fieldKey} field={f} value={p.suggestedValue} />
                      ) : (
                        <StatusValueLikeSelectTriggerPlain key={p.fieldKey} value={p.suggestedValue} />
                      )
                    })}
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </ModalNestedHistoryContext.Provider>
  )
}
