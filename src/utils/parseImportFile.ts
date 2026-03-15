import Papa from 'papaparse'
import * as XLSX from 'xlsx'

export interface ParsedImportFile {
  headers: string[]
  rows: Record<string, string>[]
}

/**
 * Deduplicate headers so each has a unique value (for use as mapping keys).
 * Second occurrence becomes "name (2)", etc.
 */
function dedupeHeaders(rawHeaders: string[]): string[] {
  const seen = new Map<string, number>()
  return rawHeaders.map((h) => {
    const trimmed = (h ?? '').trim() || 'Column'
    const count = seen.get(trimmed) ?? 0
    seen.set(trimmed, count + 1)
    return count === 0 ? trimmed : `${trimmed} (${count + 1})`
  })
}

/**
 * Build row objects keyed by the deduped headers; use same header string
 * so each row[key] matches the header.
 */
function rowsToObjects(headers: string[], rows: string[][]): Record<string, string>[] {
  return rows.map((cells) => {
    const row: Record<string, string> = {}
    headers.forEach((header, i) => {
      const raw = cells[i]
      row[header] = raw != null ? String(raw).trim() : ''
    })
    return row
  })
}

export function parseCsv(file: File): Promise<ParsedImportFile> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      header: false,
      skipEmptyLines: true,
      complete(result) {
        const rows = result.data as string[][]
        if (!rows || rows.length === 0) {
          resolve({ headers: [], rows: [] })
          return
        }
        const rawHeaders = rows[0].map((c) => (c != null ? String(c).trim() : ''))
        const headers = dedupeHeaders(rawHeaders)
        const dataRows = rows.slice(1)
        resolve({
          headers,
          rows: rowsToObjects(headers, dataRows),
        })
      },
      error(err) {
        reject(err)
      },
    })
  })
}

export function parseXlsx(file: File): Promise<ParsedImportFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = e.target?.result
        if (!data || typeof data !== 'object' || !(data instanceof ArrayBuffer)) {
          reject(new Error('Failed to read file'))
          return
        }
        const workbook = XLSX.read(data, { type: 'array' })
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
        if (!firstSheet) {
          resolve({ headers: [], rows: [] })
          return
        }
        const json = XLSX.utils.sheet_to_json<string[]>(firstSheet, {
          header: 1,
          defval: '',
          raw: false,
        }) as string[][]
        if (!json.length) {
          resolve({ headers: [], rows: [] })
          return
        }
        const rawHeaders = json[0].map((c) => (c != null ? String(c).trim() : ''))
        const headers = dedupeHeaders(rawHeaders)
        const dataRows = json.slice(1)
        resolve({
          headers,
          rows: rowsToObjects(headers, dataRows),
        })
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsArrayBuffer(file)
  })
}

export function parseImportFile(file: File): Promise<ParsedImportFile> {
  const name = (file.name || '').toLowerCase()
  if (name.endsWith('.csv')) return parseCsv(file)
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return parseXlsx(file)
  return Promise.reject(new Error('Unsupported file type. Use .csv or .xlsx'))
}
