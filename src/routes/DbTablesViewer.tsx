import { useEffect, useState } from 'react'
import { api } from '../api/client'

export function DbTablesViewer() {
  const [tables, setTables] = useState<string[]>([])
  const [selected, setSelected] = useState<string>('')
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api
      .get<string[]>('/admin/tables')
      .then((r) => {
        setTables(r.data)
        if (r.data.length && !selected) setSelected(r.data[0])
      })
      .catch(() => setTables([]))
  }, [])

  useEffect(() => {
    if (!selected) return
    setLoading(true)
    api
      .get<Record<string, unknown>[]>(`/admin/tables/${selected}`)
      .then((r) => setRows(r.data))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [selected])

  const cols = rows.length > 0 ? Object.keys(rows[0]) : []

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-foreground">DB Tables</h1>
      <div className="mb-4">
        <label className="mr-2 text-sm text-foreground">Table:</label>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-foreground"
        >
          {tables.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      {loading ? (
        <p className="text-foreground/60">Loading...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-card">
              <tr>
                {cols.map((c) => (
                  <th
                    key={c}
                    className="px-4 py-2 text-left font-medium text-foreground"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row, i) => (
                <tr key={i} className="bg-background">
                  {cols.map((c) => (
                    <td key={c} className="max-w-xs truncate px-4 py-2 text-foreground">
                      {String(row[c] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
