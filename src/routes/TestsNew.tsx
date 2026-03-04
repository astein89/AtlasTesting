import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { FieldSelector } from '../components/fields/FieldSelector'
import { CreateFieldForm } from '../components/fields/CreateFieldForm'
import type { TestPlan } from '../types'

export function TestsNew() {
  const { planId } = useParams<{ planId: string }>()
  const navigate = useNavigate()
  const [plan, setPlan] = useState<TestPlan | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [fieldIds, setFieldIds] = useState<string[]>([])
  const [showCreateField, setShowCreateField] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (planId) {
      api
        .get<TestPlan>(`/test-plans/${planId}`)
        .then((r) => {
          setPlan(r.data)
          if (r.data.fieldIds?.length && fieldIds.length === 0) {
            setFieldIds(r.data.fieldIds)
          }
        })
        .catch(() => navigate('/test-plans'))
    }
  }, [planId, navigate])

  const handleCreateField = (newFieldId: string) => {
    setFieldIds((ids) => [...ids, newFieldId])
    setShowCreateField(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!planId || !name.trim() || fieldIds.length === 0) {
      alert('Name and at least one field required')
      return
    }
    setSubmitting(true)
    try {
      const { data } = await api.post<{ id: string }>('/tests', {
        testPlanId: planId,
        name: name.trim(),
        description: description.trim() || undefined,
        fieldIds,
      })
      navigate(`/tests/${data.id}/data`)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      alert(msg || 'Failed to create test')
    } finally {
      setSubmitting(false)
    }
  }

  if (!plan) return <p className="text-foreground/60">Loading...</p>

  return (
    <div>
      <Link
        to={`/test-plans/${planId}/edit`}
        className="mb-4 block text-sm text-foreground/60 hover:text-foreground"
      >
        ← Back to {plan.name}
      </Link>
      <h1 className="mb-6 text-2xl font-semibold text-foreground">
        New Test in {plan.name}
      </h1>
      {showCreateField ? (
        <CreateFieldForm
          onSave={handleCreateField}
          onCancel={() => setShowCreateField(false)}
        />
      ) : (
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
              rows={2}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground">
              Data Collection Fields
            </label>
            <p className="mt-1 mb-2 text-sm text-foreground/60">
              Select at least one field. Use &quot;Create new field&quot; or{' '}
              <Link to="/fields" className="text-primary hover:underline">
                manage Data Fields
              </Link>{' '}
              to add fields.
            </p>
            <div className="mt-2">
              <FieldSelector
                selectedIds={fieldIds}
                onChange={setFieldIds}
                onCreateNew={() => setShowCreateField(true)}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? 'Creating...' : 'Create Test'}
            </button>
            <button
              type="button"
              onClick={() => navigate(`/test-plans/${planId}/edit`)}
              className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
