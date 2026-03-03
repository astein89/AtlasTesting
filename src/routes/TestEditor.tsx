import { useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'
import { FieldSelector } from '../components/fields/FieldSelector'
import { CreateFieldForm } from '../components/fields/CreateFieldForm'
import type { Test } from '../types'

export function TestEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isAdmin = useAuthStore((s) => s.isAdmin())
  const [test, setTest] = useState<Test | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [fieldIds, setFieldIds] = useState<string[]>([])
  const [showCreateField, setShowCreateField] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (id) {
      api
        .get<Test>(`/tests/${id}`)
        .then((r) => {
          setTest(r.data)
          setName(r.data.name)
          setDescription(r.data.description || '')
          setFieldIds(r.data.fieldIds)
        })
        .catch(() => navigate('/tests'))
        .finally(() => setLoading(false))
    }
  }, [id, navigate])

  const handleCreateField = (newFieldId: string) => {
    setFieldIds((ids) => [...ids, newFieldId])
    setShowCreateField(false)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id || !name.trim() || fieldIds.length === 0) return
    setSubmitting(true)
    try {
      await api.put(`/tests/${id}`, {
        name: name.trim(),
        description: description.trim() || undefined,
        fieldIds,
      })
      navigate(`/test-plans/${test.testPlanId}/edit`)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      alert(msg || 'Failed to save')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading || !test) return <p className="text-foreground/60">Loading...</p>

  if (showCreateField) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-foreground">Edit Test</h1>
        <CreateFieldForm
          onSave={handleCreateField}
          onCancel={() => setShowCreateField(false)}
        />
      </div>
    )
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-foreground">Edit Test</h1>
      {!isAdmin ? (
        <p className="text-foreground/60">Only admins can edit tests.</p>
      ) : (
        <form onSubmit={handleSave} className="max-w-2xl space-y-6">
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
              {submitting ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => test && navigate(`/test-plans/${test.testPlanId}/edit`)}
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
