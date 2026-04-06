import { useState } from 'react'
import { api, isAbortLikeError } from '../api/client'
import { useAbortableEffect } from '../hooks/useAbortableEffect'
import { PopupSelect } from '../components/ui/PopupSelect'

export function DbTablesViewer() {
  const [tables, setTables] = useState<string[]>([])
  const [selected, setSelected] = useState<string>('')
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(false)

  useAbortableEffect((signal) => {
    void api
      .get<string[]>('/admin/tables', { signal })
      .then((r) => {
        setTables(r.data)
        if (r.data.length && !selected) setSelected(r.data[0])
      })
      .catch((e) => {
        if (!isAbortLikeError(e)) setTables([])
      })
  }, [])

  useAbortableEffect(
    (signal) => {
      if (!selected) return
      setLoading(true)
      void api
        .get<Record<string, unknown>[]>(`/admin/tables/${selected}`, { signal })
        .then((r) => setRows(r.data))
        .catch((e) => {
          if (!isAbortLikeError(e)) setRows([])
        })
        .finally(() => setLoading(false))
    },
    [selected]
  )

  const cols = rows.length > 0 ? Object.keys(rows[0]) : []

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-foreground">DB Tables</h1>
      <div className="mb-4">
        <PopupSelect
          label="Table"
          value={selected}
          onChange={setSelected}
          options={tables}
        />
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
