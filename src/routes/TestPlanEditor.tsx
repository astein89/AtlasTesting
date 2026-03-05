import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'
import { PlanFieldsEditor } from '../components/fields/PlanFieldsEditor'
import { CreateFieldForm } from '../components/fields/CreateFieldForm'
import { getFieldIdsFromOrder } from '../utils/formLayout'
import type { TestPlan } from '../types'

export function TestPlanEditor() {
  const { planId } = useParams<{ planId: string }>()
  const navigate = useNavigate()
  const isAdmin = useAuthStore((s) => s.isAdmin())
  const isNew = !planId
  const [name, setName] = useState('')
  const [shortDescription, setShortDescription] = useState('')
  const [description, setDescription] = useState('')
  const [constraints, setConstraints] = useState('')
  const [fieldIds, setFieldIds] = useState<string[]>([])
  const [formLayoutOrder, setFormLayoutOrder] = useState<string[]>([])
  const [showCreateField, setShowCreateField] = useState(false)
  const [loading, setLoading] = useState(!isNew)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!isNew && planId) {
      api
        .get<TestPlan>(`/test-plans/${planId}`)
        .then((r) => {
          setName(r.data.name)
          setShortDescription(r.data.shortDescription || '')
          setDescription(r.data.description || '')
          setConstraints(r.data.constraints || '')
          setFieldIds(r.data.fieldIds || [])
          setFormLayoutOrder(
            Array.isArray(r.data.formLayoutOrder) && r.data.formLayoutOrder.length > 0
              ? r.data.formLayoutOrder
              : r.data.fieldIds || []
          )
        })
        .catch(() => navigate('/test-plans'))
        .finally(() => setLoading(false))
    }
  }, [planId, isNew, navigate])

  const handleCreateField = (newFieldId: string) => {
    setFieldIds((ids) => [...ids, newFieldId])
    setFormLayoutOrder((order) => [...order, newFieldId])
    setShowCreateField(false)
  }

  const handleFormLayoutChange = (order: string[]) => {
    setFormLayoutOrder(order)
    setFieldIds(getFieldIdsFromOrder(order))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    try {
      if (isNew) {
        const { data } = await api.post<{ id: string }>('/test-plans', {
          name: name.trim(),
          shortDescription: shortDescription.trim() || undefined,
          description: description.trim() || undefined,
          constraints: constraints.trim() || undefined,
          fieldIds,
          formLayoutOrder: formLayoutOrder.length > 0 ? formLayoutOrder : undefined,
        })
        navigate(`/test-plans/${data.id}/edit`)
      } else {
        await api.put(`/test-plans/${planId}`, {
          name: name.trim(),
          shortDescription: shortDescription.trim() || undefined,
          description: description.trim() || undefined,
          constraints: constraints.trim() || undefined,
          fieldIds,
          formLayoutOrder,
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
      <form onSubmit={handleSubmit} className="max-w-4xl space-y-6">
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
          <input
            value={shortDescription}
            onChange={(e) => setShortDescription(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground">
            Test plan
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
            Constraints
          </label>
          <textarea
            value={constraints}
            onChange={(e) => setConstraints(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
            rows={3}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground">
            Data collection fields
          </label>
          <p className="mt-1 mb-2 text-sm text-foreground/60">
            Add fields, drag to reorder, and use New line or Separator to
            control layout.
          </p>
          <div className="mt-2">
            <PlanFieldsEditor
              formLayoutOrder={formLayoutOrder}
              onChange={handleFormLayoutChange}
              onCreateNew={() => setShowCreateField(true)}
            />
          </div>
        </div>
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
                if (!confirm(`Delete plan "${name}"? This will also delete all data in this plan.`)) return
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
