import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { format } from 'date-fns'
import { api } from '../api/client'
import { EditRunModal } from '../components/data/EditRunModal'
import { AddRunModal } from '../components/data/AddRunModal'
import type { DataField, Test, TestPlan } from '../types'

interface Run {
  id: string
  testId: string
  testName: string
  runAt: string
  enteredBy: string
  status: string
  data: Record<string, string | number | boolean>
}

function getDefaultData(fields: DataField[]): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const f of fields) {
    if (f.type === 'number') out[f.key] = 0
    else if (f.type === 'boolean') out[f.key] = false
    else if (f.type === 'longtext') out[f.key] = ''
    else if (f.type === 'select') out[f.key] = ''
    else out[f.key] = ''
  }
  return out
}

export function TestData() {
  const { id } = useParams<{ id: string }>()
  const [test, setTest] = useState<Test | null>(null)
  const [plan, setPlan] = useState<TestPlan | null>(null)
  const [fields, setFields] = useState<DataField[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [editData, setEditData] = useState<Record<string, string | number | boolean>>({})
  const [addData, setAddData] = useState<Record<string, string | number | boolean>>({})
  const [submitting, setSubmitting] = useState(false)

  const loadRuns = () => {
    if (!id) return
    api
      .get<Run[]>('/runs', { params: { testId: id, limit: 100 } })
      .then((r) => setRuns(r.data))
      .catch(() => setRuns([]))
  }

  useEffect(() => {
    if (id) {
      api
        .get<Test>(`/tests/${id}`)
        .then((r) => {
          setTest(r.data)
          return Promise.all(
            r.data.fieldIds.map((fid) =>
              api.get<DataField>(`/fields/${fid}`).then((fr) => fr.data)
            )
          ).then((fieldsList) =>
            api
              .get<TestPlan>(`/test-plans/${r.data.testPlanId}`)
              .then((pr) => [fieldsList, pr.data] as const)
              .catch(() => [fieldsList, null] as const)
          )
        })
        .then(([fieldsList, planData]) => {
          setFields(fieldsList)
          setPlan(planData)
          setAddData(getDefaultData(fieldsList))
        })
        .catch(() => setTest(null))
        .finally(() => setLoading(false))
    }
  }, [id])

  useEffect(() => {
    if (id) loadRuns()
  }, [id])

  const startAdd = () => {
    setIsAdding(true)
    setAddData(getDefaultData(fields))
  }

  const cancelAdd = () => setIsAdding(false)

  const saveAdd = async () => {
    if (!id) return
    setSubmitting(true)
    try {
      await api.post('/runs', { testId: id, data: addData, status: 'pass' })
      loadRuns()
      setIsAdding(false)
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      alert(err || 'Failed to add data')
    } finally {
      setSubmitting(false)
    }
  }

  const startEdit = (run: Run) => {
    setEditingId(run.id)
    setEditData({ ...run.data })
  }

  const cancelEdit = () => setEditingId(null)

  const deleteRun = async (runId: string) => {
    if (!confirm('Delete this row?')) return
    setSubmitting(true)
    try {
      await api.delete(`/runs/${runId}`)
      loadRuns()
      if (editingId === runId) setEditingId(null)
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      alert(err || 'Failed to delete')
    } finally {
      setSubmitting(false)
    }
  }

  const saveEdit = async () => {
    if (!editingId) return
    setSubmitting(true)
    try {
      await api.put(`/runs/${editingId}`, { data: editData, status: 'pass' })
      loadRuns()
      setEditingId(null)
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      alert(err || 'Failed to save')
    } finally {
      setSubmitting(false)
    }
  }

  const updateAddField = (key: string, value: string | number | boolean) => {
    setAddData((d) => ({ ...d, [key]: value }))
  }

  const updateEditField = (key: string, value: string | number | boolean) => {
    setEditData((d) => ({ ...d, [key]: value }))
  }

  const fieldLayout = plan?.fieldLayout ?? {}
  const editingRun = runs.find((r) => r.id === editingId)

  if (loading || !test) return <p className="text-foreground/60">Loading...</p>

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link
            to="/test-plans"
            className="mb-2 block text-sm text-foreground/60 hover:text-foreground"
          >
            ← Back to plans
          </Link>
          <h1 className="text-2xl font-semibold text-foreground">Data: {test.name}</h1>
        </div>
        <button
          type="button"
          onClick={startAdd}
          className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
        >
          + Add row
        </button>
      </div>
      {isAdding && (
        <AddRunModal
          fields={fields}
          data={addData}
          onDataChange={updateAddField}
          onSave={saveAdd}
          onCancel={cancelAdd}
          submitting={submitting}
        />
      )}
      {editingRun && (
        <EditRunModal
          run={editingRun}
          fields={fields}
          data={editData}
          onDataChange={updateEditField}
          onSave={saveEdit}
          onCancel={cancelEdit}
          submitting={submitting}
        />
      )}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table
          className="w-full"
          style={{
            tableLayout: Object.keys(fieldLayout).length > 0 ? 'fixed' : undefined,
          }}
        >
          {Object.keys(fieldLayout).length > 0 && (
            <colgroup>
              <col style={{ width: '140px' }} />
              {fields.map((f) => (
                <col key={f.id} style={{ width: fieldLayout[f.id] || 'auto' }} />
              ))}
              <col style={{ width: '100px' }} />
            </colgroup>
          )}
          <thead className="bg-card">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-foreground">
                Date
              </th>
              {fields.map((f) => (
                <th
                  key={f.id}
                  className="px-4 py-3 text-left text-sm font-medium text-foreground"
                >
                  {f.label}
                </th>
              ))}
              <th className="px-4 py-3 text-right text-sm font-medium text-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {runs.map((run) => (
                <tr key={run.id} className="bg-background">
                  <td className="px-4 py-3 text-sm text-foreground/70">
                    {format(new Date(run.runAt), 'MM/dd/yyyy HH:mm')}
                  </td>
                  {fields.map((f) => (
                    <td key={f.id} className="px-4 py-3 text-foreground">
                      {typeof run.data[f.key] === 'boolean'
                        ? run.data[f.key]
                          ? 'Yes'
                          : 'No'
                        : f.type === 'longtext'
                          ? (
                            <span className="whitespace-pre-wrap break-words">
                              {String(run.data[f.key] ?? '—')}
                            </span>
                            )
                          : String(run.data[f.key] ?? '—')}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(run)}
                        className="rounded border border-border px-2 py-1 text-sm text-foreground hover:bg-background"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteRun(run.id)}
                        disabled={submitting}
                        className="rounded border border-red-500/50 px-2 py-1 text-sm text-red-500 hover:bg-red-500/10 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
            ))}
          </tbody>
        </table>
        {runs.length === 0 && !isAdding && (
          <p className="p-6 text-center text-foreground/60">No data yet. Click &quot;+ Add row&quot; to add.</p>
        )}
      </div>
    </div>
  )
}
