import { useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'
import { PlanFieldSelector } from '../components/fields/PlanFieldSelector'
import { FieldLayoutEditor } from '../components/fields/FieldLayoutEditor'
import { CreateFieldForm } from '../components/fields/CreateFieldForm'
import type { TestPlan } from '../types'

export function TestPlanEditor() {
  const { planId } = useParams<{ planId: string }>()
  const navigate = useNavigate()
  const isAdmin = useAuthStore((s) => s.isAdmin())
  const isNew = !planId
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [fieldIds, setFieldIds] = useState<string[]>([])
  const [fieldLayout, setFieldLayout] = useState<Record<string, string>>({})
  const [showCreateField, setShowCreateField] = useState(false)
  const [loading, setLoading] = useState(!isNew)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!isNew && planId) {
      api
        .get<TestPlan>(`/test-plans/${planId}`)
        .then((r) => {
          setName(r.data.name)
          setDescription(r.data.description || '')
          setFieldIds(r.data.fieldIds || [])
          setFieldLayout(r.data.fieldLayout || {})
        })
        .catch(() => navigate('/test-plans'))
        .finally(() => setLoading(false))
    }
  }, [planId, isNew, navigate])

  const handleCreateField = (newFieldId: string) => {
    setFieldIds((ids) => [...ids, newFieldId])
    setShowCreateField(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    try {
      if (isNew) {
        const { data } = await api.post<{ id: string }>('/test-plans', {
          name: name.trim(),
          description: description.trim() || undefined,
          fieldIds,
          fieldLayout: Object.keys(fieldLayout).length > 0 ? fieldLayout : undefined,
        })
        navigate(`/test-plans/${data.id}/edit`)
      } else {
        await api.put(`/test-plans/${planId}`, {
          name: name.trim(),
          description: description.trim() || undefined,
          fieldIds,
          fieldLayout,
        })
        navigate('/test-plans')
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      alert(msg || 'Failed to save')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <p className="text-foreground/60">Loading...</p>

  if (showCreateField) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-foreground">Edit Test Plan</h1>
        <CreateFieldForm
          onSave={handleCreateField}
          onCancel={() => setShowCreateField(false)}
        />
      </div>
    )
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-foreground">
        {isNew ? 'New Test Plan' : 'Edit Test Plan'}
      </h1>
      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        <div>
          <label className="block text-sm font-medium text-foreground">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
            rows={3}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground">
            Data collection fields
          </label>
          <p className="mt-1 mb-2 text-sm text-foreground/60">
            Select and order fields. Drag to reorder. New tests in this plan will use these fields.
          </p>
          <div className="mt-2">
            <PlanFieldSelector
              selectedIds={fieldIds}
              onChange={setFieldIds}
              onCreateNew={() => setShowCreateField(true)}
            />
          </div>
        </div>
        {fieldIds.length > 0 && (
          <div>
            <FieldLayoutEditor
              fieldIds={fieldIds}
              value={fieldLayout}
              onChange={setFieldLayout}
            />
          </div>
        )}
        {isAdmin && !isNew && planId && (
          <div className="mb-6">
            <Link
              to={`/test-plans/${planId}/tests/new`}
              className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
            >
              + Add test
            </Link>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Saving...' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/test-plans')}
            className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
          >
            Cancel
          </button>
          {isAdmin && !isNew && (
            <button
              type="button"
              onClick={async () => {
                if (!confirm(`Delete plan "${name}"? This will also delete all tests and data in this plan.`)) return
                try {
                  await api.delete(`/test-plans/${planId}`)
                  navigate('/test-plans', { replace: true })
                } catch (e: unknown) {
                  const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
                  alert(err || 'Failed to delete plan')
                }
              }}
              className="rounded-lg border border-red-500/50 px-4 py-2 text-red-500 hover:bg-red-500/10"
            >
              Delete plan
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
