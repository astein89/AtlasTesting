import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { DataField } from '../types'

export function FieldsList() {
  const [fields, setFields] = useState<DataField[]>([])
  const [loading, setLoading] = useState(true)

  const loadFields = useCallback(() => {
    setLoading(true)
    api
      .get<DataField[]>('/fields')
      .then((r) => setFields(r.data))
      .catch(() => setFields([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadFields()
  }, [loadFields])

  const handleDelete = async (id: string, key: string) => {
    if (!confirm(`Delete field "${key}"? This may affect tests using it.`)) return
    try {
      await api.delete(`/fields/${id}`)
      loadFields()
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      alert(err || 'Failed to delete field')
      loadFields()
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Data Fields</h1>
        <Link
          to="/fields/new"
          className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
        >
          Add Field
        </Link>
      </div>
      {loading ? (
        <p className="text-foreground/60">Loading...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full">
            <thead className="bg-card">
              <tr>
                <th className="px-4 py-2 text-left text-sm font-medium text-foreground">
                  Key
                </th>
                <th className="px-4 py-2 text-left text-sm font-medium text-foreground">
                  Label
                </th>
                <th className="px-4 py-2 text-left text-sm font-medium text-foreground">
                  Type
                </th>
                <th className="px-4 py-2 text-right text-sm font-medium text-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {fields.map((f) => (
                <tr key={f.id} className="bg-background">
                  <td className="px-4 py-2 text-foreground">{f.key}</td>
                  <td className="px-4 py-2 text-foreground">{f.label}</td>
                  <td className="px-4 py-2 text-foreground">{f.type}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-3">
                      <Link
                        to={`/fields/${f.id}`}
                        className="text-primary hover:underline"
                      >
                        Edit
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleDelete(f.id, f.key)}
                        className="text-red-500 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
