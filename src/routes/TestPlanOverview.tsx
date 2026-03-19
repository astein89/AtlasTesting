import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { getTests, createTest, updateTest, deleteTest } from '../api/tests'
import { useAuthStore } from '../store/authStore'
import { useAlertConfirm } from '../contexts/AlertConfirmContext'
import { ExportPlanModal } from '../components/plan/ExportPlanModal'
import { formatDate, formatDateTime } from '../lib/dateTimeConfig'
import type { Test, TestPlan } from '../types'

export function TestPlanOverview() {
  const { planId } = useParams<{ planId: string }>()
  const navigate = useNavigate()
  const isAdmin = useAuthStore((s) => s.isAdmin())
  const { showAlert, showConfirm } = useAlertConfirm()
  const [plan, setPlan] = useState<TestPlan | null>(null)
  const [tests, setTests] = useState<Test[]>([])
  const [archivedTests, setArchivedTests] = useState<Test[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [loading, setLoading] = useState(true)
  const [addTestOpen, setAddTestOpen] = useState(false)
  const [addTestName, setAddTestName] = useState('')
  const [addTestStart, setAddTestStart] = useState('')
  const [addTestEnd, setAddTestEnd] = useState('')
  const [archiveModalOpen, setArchiveModalOpen] = useState(false)
  const [selectedToArchive, setSelectedToArchive] = useState<Set<string>>(new Set())
  const [restoringTestId, setRestoringTestId] = useState<string | null>(null)
  const [editingTest, setEditingTest] = useState<Test | null>(null)
  const [editTestName, setEditTestName] = useState('')
  const [editTestStart, setEditTestStart] = useState('')
  const [editTestEnd, setEditTestEnd] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  type TestSortKey = 'name' | 'startDate' | 'endDate' | 'lastEdited' | 'recordCount'
  const [testsSortKey, setTestsSortKey] = useState<TestSortKey>('name')
  const [testsSortDir, setTestsSortDir] = useState<'asc' | 'desc'>('asc')
  const [planInfoCollapsed, setPlanInfoCollapsed] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false
  )

  const sortTests = (list: Test[]) => {
    const copy = [...list]
    copy.sort((a, b) => {
      let aVal: string | number
      let bVal: string | number
      if (testsSortKey === 'name') {
        aVal = a.name ?? ''
        bVal = b.name ?? ''
      } else if (testsSortKey === 'startDate') {
        aVal = a.startDate ?? ''
        bVal = b.startDate ?? ''
      } else if (testsSortKey === 'endDate') {
        aVal = a.endDate ?? ''
        bVal = b.endDate ?? ''
      } else if (testsSortKey === 'lastEdited') {
        aVal = a.updatedAt ?? a.createdAt ?? ''
        bVal = b.updatedAt ?? b.createdAt ?? ''
      } else {
        aVal = a.recordCount ?? 0
        bVal = b.recordCount ?? 0
      }
      const cmp =
        typeof aVal === 'number' && typeof bVal === 'number'
          ? aVal - bVal
          : String(aVal).localeCompare(String(bVal), undefined, { sensitivity: 'base' })
      return testsSortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }
  const sortedTests = useMemo(() => sortTests(tests), [tests, testsSortKey, testsSortDir])
  const sortedArchivedTests = useMemo(() => sortTests(archivedTests), [archivedTests, testsSortKey, testsSortDir])

  const handleTestsSort = (key: TestSortKey) => {
    if (testsSortKey === key) setTestsSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setTestsSortKey(key)
      setTestsSortDir('asc')
    }
  }

  const loadPlan = () => {
    if (!planId) return
    api
      .get<TestPlan>(`/test-plans/${planId}`)
      .then((r) => setPlan(r.data))
      .catch(() => navigate('/test-plans'))
  }

  const loadTests = () => {
    if (!planId) return
    getTests(planId)
      .then((data) => setTests(data.filter((t) => !t.archived)))
      .catch(() => setTests([]))
    getTests(planId, { archived: true })
      .then((data) => setArchivedTests(data.filter((t) => t.archived)))
      .catch(() => setArchivedTests([]))
  }

  useEffect(() => {
    if (!planId) return
    setLoading(true)
    loadPlan()
    getTests(planId)
      .then((data) => {
        setTests(data.filter((t) => !t.archived))
        return getTests(planId!, { archived: true })
      })
      .then((data) => setArchivedTests(data.filter((t) => t.archived)))
      .catch(() => {
        setTests([])
        setArchivedTests([])
      })
      .finally(() => setLoading(false))
  }, [planId])

  const handleAddTest = async () => {
    if (!planId || !addTestName.trim() || !addTestStart.trim()) return
    setSubmitting(true)
    try {
      await createTest(planId, {
        name: addTestName.trim(),
        startDate: addTestStart.trim() || undefined,
        endDate: addTestEnd.trim() || undefined,
      })
      setAddTestOpen(false)
      setAddTestName('')
      setAddTestStart('')
      setAddTestEnd('')
      loadTests()
    } catch {
      showAlert('Failed to add test.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleArchiveSelected = async () => {
    if (!planId || selectedToArchive.size === 0) return
    setSubmitting(true)
    const today = new Date().toISOString().slice(0, 10)
    try {
      await Promise.all(
        [...selectedToArchive].map((testId) => {
          const test = tests.find((t) => t.id === testId)
          const payload: { archived: boolean; endDate?: string } = { archived: true }
          if (test && !test.endDate) payload.endDate = today
          return updateTest(planId, testId, payload)
        })
      )
      setArchiveModalOpen(false)
      setSelectedToArchive(new Set())
      loadTests()
    } catch {
      showAlert('Failed to archive selected tests.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRestoreTest = async (test: Test) => {
    if (!planId) return
    const ok = await showConfirm(
      `Restore test "${test.name}"? It will appear in the main test list again.`
    )
    if (!ok) return
    setRestoringTestId(test.id)
    try {
      await updateTest(planId, test.id, { archived: false })
      setArchiveModalOpen(false)
      setSelectedToArchive(new Set())
      loadTests()
    } catch {
      showAlert('Failed to restore test.')
    } finally {
      setRestoringTestId(null)
    }
  }

  const handleArchiveTest = async (test: Test) => {
    if (!planId) return
    const ok = await showConfirm(`Archive test "${test.name}"? It will be hidden from the main list. You can restore it from the Archive modal.`)
    if (!ok) return
    const today = new Date().toISOString().slice(0, 10)
    const payload: { archived: boolean; endDate?: string } = { archived: true }
    if (!test.endDate) payload.endDate = today
    try {
      await updateTest(planId, test.id, payload)
      loadTests()
    } catch {
      showAlert('Failed to archive test.')
    }
  }

  const openEditTest = (test: Test) => {
    setEditingTest(test)
    setEditTestName(test.name)
    setEditTestStart(test.startDate ?? '')
    setEditTestEnd(test.endDate ?? '')
  }

  const handleSaveEditTest = async () => {
    if (!planId || !editingTest || !editTestName.trim()) return
    setSubmitting(true)
    try {
      await updateTest(planId, editingTest.id, {
        name: editTestName.trim(),
        startDate: editTestStart.trim() || undefined,
        endDate: editTestEnd.trim() || undefined,
      })
      setEditingTest(null)
      loadTests()
    } catch {
      showAlert('Failed to update test.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteTest = async (test: Test) => {
    if (!planId) return
    const ok = await showConfirm(
      `Delete test "${test.name}" and all ${test.recordCount ?? 0} record(s)?`
    )
    if (!ok) return
    try {
      await deleteTest(planId, test.id)
      loadTests()
    } catch {
      showAlert('Failed to delete test.')
    }
  }

  if (!planId) return null
  if (loading && !plan) {
    return <p className="p-4 text-foreground/60">Loading...</p>
  }
  if (!plan) return null

  const handleTestRowClick = (t: Test, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a')) return
    navigate(`/test-plans/${planId}/tests/${t.id}/data`)
  }

  const renderTestsList = (list: Test[], archived: boolean, sortKey: TestSortKey, sortDir: 'asc' | 'desc', onSort: (key: TestSortKey) => void) => (
    <>
      {/* Mobile: card layout */}
      <div className="w-full min-w-0 space-y-2 md:hidden">
        {list.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-4 text-center text-foreground/60">
            {archived ? 'No archived tests.' : 'No tests yet. Add one to start recording data.'}
          </p>
        ) : (
          list.map((t) => (
            <div
              key={t.id}
              onClick={(e) => handleTestRowClick(t, e)}
              className="w-full min-w-0 cursor-pointer overflow-hidden rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-background/50 active:bg-background/70"
            >
              <p className="truncate font-medium text-foreground">{t.name}</p>
              <p className="mt-0.5 truncate text-sm text-foreground/70">
                {t.startDate || t.endDate
                  ? [t.startDate ? formatDate(t.startDate + 'T00:00:00') : '', t.endDate ? formatDate(t.endDate + 'T00:00:00') : ''].filter(Boolean).join(' – ') || '—'
                  : '—'}
              </p>
              <p className="mt-0.5 text-sm text-foreground/60">
                {(t.updatedAt ?? t.createdAt) ? formatDateTime(t.updatedAt ?? t.createdAt!) : '—'}
              </p>
              <p className="mt-0.5 text-sm text-foreground/60">
                {t.recordCount ?? 0}
              </p>
              <div className="mt-2 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                {isAdmin && (
                  <>
                    <button
                      type="button"
                      onClick={() => openEditTest(t)}
                      className="min-h-[44px] rounded border border-border px-3 py-2 text-sm text-foreground hover:bg-background"
                    >
                      Edit
                    </button>
                    {archived ? (
                      <button
                        type="button"
                        onClick={() => handleRestoreTest(t)}
                        disabled={restoringTestId === t.id}
                        className="min-h-[44px] rounded border border-amber-500/50 px-3 py-2 text-sm text-amber-600 hover:bg-amber-500/10 disabled:opacity-50 dark:text-amber-400"
                      >
                        {restoringTestId === t.id ? 'Restoring…' : 'Restore'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleArchiveTest(t)}
                        className="min-h-[44px] rounded border border-amber-500/50 px-3 py-2 text-sm text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
                      >
                        Archive
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDeleteTest(t)}
                      className="min-h-[44px] rounded border border-border px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      {/* Desktop: table */}
      <div className="hidden w-full min-w-0 overflow-x-auto overflow-y-auto rounded-lg border border-border md:block">
        <table className="w-full">
          <thead className="sticky top-0 z-10 border-b border-border bg-card">
            <tr>
              <th
                className="cursor-pointer select-none px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-background/50"
                onClick={() => onSort('name')}
              >
                <span className="flex items-center gap-1">
                  Name
                  {sortKey === 'name' && (
                    <span className="text-foreground/60">{sortDir === 'asc' ? '↓' : '↑'}</span>
                  )}
                </span>
              </th>
              <th
                className="cursor-pointer select-none px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-background/50"
                onClick={() => onSort('startDate')}
              >
                <span className="flex items-center gap-1">
                  Start date
                  {sortKey === 'startDate' && (
                    <span className="text-foreground/60">{sortDir === 'asc' ? '↓' : '↑'}</span>
                  )}
                </span>
              </th>
              <th
                className="cursor-pointer select-none px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-background/50"
                onClick={() => onSort('endDate')}
              >
                <span className="flex items-center gap-1">
                  End date
                  {sortKey === 'endDate' && (
                    <span className="text-foreground/60">{sortDir === 'asc' ? '↓' : '↑'}</span>
                  )}
                </span>
              </th>
              <th
                className="cursor-pointer select-none px-4 py-3 text-right text-sm font-medium text-foreground hover:bg-background/50"
                onClick={() => onSort('lastEdited')}
              >
                <span className="inline-flex items-center gap-1">
                  Last edited
                  {sortKey === 'lastEdited' && (
                    <span className="text-foreground/60">{sortDir === 'asc' ? '↓' : '↑'}</span>
                  )}
                </span>
              </th>
              <th
                className="cursor-pointer select-none px-4 py-3 text-right text-sm font-medium text-foreground hover:bg-background/50"
                onClick={() => onSort('recordCount')}
              >
                <span className="inline-flex items-center gap-1">
                  Records
                  {sortKey === 'recordCount' && (
                    <span className="text-foreground/60">{sortDir === 'asc' ? '↓' : '↑'}</span>
                  )}
                </span>
              </th>
              <th className="px-4 py-3 text-right text-sm font-medium text-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {list.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-foreground/60">
                  {archived ? 'No archived tests.' : 'No tests yet. Add one to start recording data.'}
                </td>
              </tr>
            ) : (
              list.map((t) => (
                <tr
                  key={t.id}
                  onClick={(e) => handleTestRowClick(t, e)}
                  className="cursor-pointer bg-background transition-colors hover:bg-card"
                >
                  <td className="px-4 py-3 font-medium text-foreground">{t.name}</td>
                  <td className="px-4 py-3 text-sm text-foreground/70">
                    {t.startDate ? formatDate(t.startDate + 'T00:00:00') : '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground/70">
                    {t.endDate ? formatDate(t.endDate + 'T00:00:00') : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-foreground/70">
                    {(t.updatedAt ?? t.createdAt)
                      ? formatDateTime(t.updatedAt ?? t.createdAt!)
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-foreground/70">
                    {t.recordCount ?? 0}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex shrink-0 justify-end gap-2">
                      {isAdmin && (
                        <>
                          <button
                            type="button"
                            onClick={() => openEditTest(t)}
                            className="shrink-0 rounded border border-border px-3 py-1.5 text-sm text-foreground hover:bg-background"
                          >
                            Edit
                          </button>
                          {archived ? (
                            <button
                              type="button"
                              onClick={() => handleRestoreTest(t)}
                              disabled={restoringTestId === t.id}
                              className="shrink-0 rounded border border-amber-500/50 px-3 py-1.5 text-sm text-amber-600 hover:bg-amber-500/10 disabled:opacity-50 dark:text-amber-400"
                            >
                              {restoringTestId === t.id ? 'Restoring…' : 'Restore'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleArchiveTest(t)}
                              className="shrink-0 rounded border border-amber-500/50 px-3 py-1.5 text-sm text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
                            >
                              Archive
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteTest(t)}
                            className="shrink-0 rounded border border-red-500/50 px-3 py-1.5 text-sm text-red-500 hover:bg-red-500/10 dark:text-red-400"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  )

  return (
    <div className="w-full min-w-0">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm text-foreground/70">
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/test-plans" className="hover:text-foreground hover:underline">
            Test plans
          </Link>
          <span>/</span>
          <span className="text-foreground">{plan.name}</span>
        </div>
        {isAdmin && (
          <Link
            to={`/test-plans/${planId}/edit`}
            state={{ returnTo: `/test-plans/${planId}` }}
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-background shrink-0"
          >
            Edit plan
          </Link>
        )}
      </div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">{plan.name}</h1>
          {plan.description && (
            <p className="mt-1 max-w-2xl whitespace-pre-wrap text-sm text-foreground/80 leading-relaxed">
              {plan.description}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-background"
          >
            Export all plan data
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setArchiveModalOpen(true)}
              className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-background"
            >
              Archive
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setAddTestStart(new Date().toISOString().slice(0, 10))
              setAddTestOpen(true)
            }}
            className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
          >
            Add new test
          </button>
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
              <button
                type="button"
                onClick={() => setPlanInfoCollapsed(true)}
                className="relative flex w-full cursor-pointer flex-col gap-6 p-5 text-left hover:bg-background/30 sm:grid sm:grid-cols-2"
                aria-expanded={true}
                aria-label="Collapse test plan & criteria"
              >
                <div className="pointer-events-none absolute right-3 top-3 z-[1] rounded p-1 text-foreground/50">
                  <svg
                    className="h-4 w-4 rotate-180"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                {plan.testPlan && (
                  <div className="min-w-0 order-1 sm:order-none">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground/50">
                      Test plan
                    </h3>
                    <p className="whitespace-pre-wrap text-sm text-foreground/90 leading-relaxed">
                      {plan.testPlan}
                    </p>
                  </div>
                )}
                {plan.constraints && (
                  <div className="min-w-0 order-2 sm:order-none">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground/50">
                      Test criteria
                    </h3>
                    <p className="whitespace-pre-wrap text-sm text-foreground/90 leading-relaxed">
                      {plan.constraints}
                    </p>
                  </div>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      <div>
        {renderTestsList(sortedTests, false, testsSortKey, testsSortDir, handleTestsSort)}
      </div>

      {archivedTests.length > 0 && (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="mb-2 text-sm text-foreground/70 hover:text-foreground"
          >
            {showArchived ? 'Hide' : 'Show'} archived tests ({archivedTests.length})
          </button>
          {showArchived && (
            <div>
              {renderTestsList(sortedArchivedTests, true, testsSortKey, testsSortDir, handleTestsSort)}
            </div>
          )}
        </div>
      )}

      {addTestOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-card p-6 shadow-lg">
            <h2 className="text-lg font-semibold text-foreground">Add new test</h2>
            <div className="mt-4 space-y-3">
              <label className="block text-sm font-medium text-foreground">
                Name <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={addTestName}
                onChange={(e) => setAddTestName(e.target.value)}
                className="w-full rounded border border-border bg-background px-3 py-2 text-foreground"
                placeholder="e.g. Run 1 – March 2025"
              />
              <label className="block text-sm font-medium text-foreground">
                Start date <span className="text-destructive">*</span>
              </label>
              <input
                type="date"
                required
                value={addTestStart}
                onChange={(e) => setAddTestStart(e.target.value)}
                className="w-full rounded border border-border bg-background px-3 py-2 text-foreground"
              />
              <label className="block text-sm font-medium text-foreground">End date (optional)</label>
              <input
                type="date"
                value={addTestEnd}
                onChange={(e) => setAddTestEnd(e.target.value)}
                className="w-full rounded border border-border bg-background px-3 py-2 text-foreground"
              />
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setAddTestOpen(false)
                  setAddTestName('')
                  setAddTestStart('')
                  setAddTestEnd('')
                }}
                className="rounded border border-border px-4 py-2 text-sm text-foreground hover:bg-background"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddTest}
                disabled={!addTestName.trim() || !addTestStart.trim() || submitting}
                className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? 'Adding…' : 'Add test'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingTest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-card p-6 shadow-lg">
            <h2 className="text-lg font-semibold text-foreground">Edit test</h2>
            <div className="mt-4 space-y-3">
              <label className="block text-sm font-medium text-foreground">
                Name <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={editTestName}
                onChange={(e) => setEditTestName(e.target.value)}
                className="w-full rounded border border-border bg-background px-3 py-2 text-foreground"
                placeholder="e.g. Run 1 – March 2025"
              />
              <label className="block text-sm font-medium text-foreground">Start date (optional)</label>
              <input
                type="date"
                value={editTestStart}
                onChange={(e) => setEditTestStart(e.target.value)}
                className="w-full rounded border border-border bg-background px-3 py-2 text-foreground"
              />
              <label className="block text-sm font-medium text-foreground">End date (optional)</label>
              <input
                type="date"
                value={editTestEnd}
                onChange={(e) => setEditTestEnd(e.target.value)}
                className="w-full rounded border border-border bg-background px-3 py-2 text-foreground"
              />
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditingTest(null)
                  setEditTestName('')
                  setEditTestStart('')
                  setEditTestEnd('')
                }}
                className="rounded border border-border px-4 py-2 text-sm text-foreground hover:bg-background"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEditTest}
                disabled={!editTestName.trim() || submitting}
                className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {archiveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md max-h-[85vh] flex flex-col rounded-lg bg-card shadow-lg">
            <div className="flex shrink-0 flex-col gap-1 border-b border-border p-6 pb-4">
              <h2 className="text-lg font-semibold text-foreground">Archive tests</h2>
              <p className="text-sm text-foreground/70">
                View archived tests below. Select tests from the active list to archive more.
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-6 pt-4 space-y-6">
              <div>
                <h3 className="text-sm font-medium text-foreground/90">Archived tests</h3>
                <div className="mt-2 max-h-52 overflow-y-auto rounded border border-border bg-background/50 p-2 space-y-1.5">
                  {archivedTests.length === 0 ? (
                    <p className="py-2 text-sm text-foreground/60">No archived tests.</p>
                  ) : (
                    archivedTests.map((t) => (
                      <div
                        key={t.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded border border-transparent px-2 py-2 text-sm hover:border-border hover:bg-background/70"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="font-medium text-foreground">{t.name}</span>
                          <span className="ml-1.5 text-foreground/60">
                            {t.startDate || t.endDate
                              ? [t.startDate ? formatDate(t.startDate + 'T00:00:00') : '', t.endDate ? formatDate(t.endDate + 'T00:00:00') : ''].filter(Boolean).join(' – ') || '—'
                              : '—'}
                            {' · '}{t.recordCount ?? 0}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Link
                            to={`/test-plans/${planId}/tests/${t.id}/data`}
                            onClick={() => setArchiveModalOpen(false)}
                            className="text-sm text-primary hover:underline"
                          >
                            View data
                          </Link>
                          <button
                            type="button"
                            onClick={() => handleRestoreTest(t)}
                            disabled={restoringTestId !== null}
                            className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-background disabled:opacity-50"
                          >
                            {restoringTestId === t.id ? 'Restoring…' : 'Restore'}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-medium text-foreground/90">Archive more tests</h3>
                <p className="mt-0.5 text-xs text-foreground/60">Select tests to archive. Data is kept.</p>
                <div className="mt-2 max-h-48 overflow-y-auto space-y-2">
                  {tests.length === 0 ? (
                    <p className="text-sm text-foreground/60">No tests to archive.</p>
                  ) : (
                    tests.map((t) => (
                      <label key={t.id} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedToArchive.has(t.id)}
                          onChange={(e) => {
                            setSelectedToArchive((prev) => {
                              const next = new Set(prev)
                              if (e.target.checked) next.add(t.id)
                              else next.delete(t.id)
                              return next
                            })
                          }}
                          className="rounded border-border"
                        />
                        <span className="text-sm text-foreground">{t.name}</span>
                        <span className="text-xs text-foreground/60">({t.recordCount ?? 0})</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            </div>
            <div className="shrink-0 flex justify-end gap-2 border-t border-border p-4">
              <button
                type="button"
                onClick={() => {
                  setArchiveModalOpen(false)
                  setSelectedToArchive(new Set())
                }}
                className="rounded border border-border px-4 py-2 text-sm text-foreground hover:bg-background"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleArchiveSelected}
                disabled={selectedToArchive.size === 0 || submitting}
                className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? 'Archiving…' : 'Archive selected'}
              </button>
            </div>
          </div>
        </div>
      )}

      {exportOpen && (
        <ExportPlanModal
          planId={planId}
          planName={plan.name}
          keyField={plan.keyField}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  )
}
