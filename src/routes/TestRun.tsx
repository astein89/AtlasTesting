import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { DynamicDataEntryForm } from '../components/tests/DynamicDataEntryForm'
import type { DataField, Test } from '../types'

export function TestRun() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [test, setTest] = useState<Test | null>(null)
  const [fields, setFields] = useState<DataField[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (id) {
      api
        .get<Test>(`/tests/${id}`)
        .then((r) => {
          setTest(r.data)
          return Promise.all(
            r.data.fieldIds.map((fid) =>
              api.get<DataField>(`/fields/${fid}`).then((r) => r.data)
            )
          )
        })
        .then((f) => setFields(f))
        .catch(() => navigate('/test-plans'))
        .finally(() => setLoading(false))
    }
  }, [id, navigate])

  const handleSubmit = async (
    data: Record<string, string | number | boolean>,
    status: string
  ) => {
    if (!id) return
    setSubmitting(true)
    try {
      await api.post('/runs', { testId: id, data, status })
      navigate('/results')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      alert(msg || 'Failed to save run')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading || !test) return <p className="text-foreground/60">Loading...</p>

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-foreground">Run: {test.name}</h1>
      <DynamicDataEntryForm
        fields={fields}
        onSubmit={handleSubmit}
        isSubmitting={submitting}
      />
    </div>
  )
}
