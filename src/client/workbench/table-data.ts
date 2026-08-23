import Papa from 'papaparse'
import { readSheet } from 'read-excel-file/universal'

/** A single spreadsheet cell as parsed from CSV or XLSX. */
export type Cell = string | number | boolean | Date | null
export type TableRow = Cell[]

export interface TableData {
  rows: TableRow[]
  /** Total rows found before display capping. */
  totalRows: number
  truncated: boolean
}

/** Render at most this many rows; larger files get a truncation note. */
export const MAX_PREVIEW_ROWS = 500
/** Cap columns so a pathological wide row cannot freeze the layout. */
export const MAX_PREVIEW_COLS = 100

export function cellText(cell: Cell): string {
  if (cell === null || cell === undefined) return ''
  if (cell instanceof Date) {
    return Number.isNaN(cell.getTime()) ? '' : cell.toLocaleString()
  }
  return String(cell)
}

export function columnCount(rows: TableRow[]): number {
  let max = 0
  for (const row of rows) max = Math.max(max, row.length)
  return Math.min(max, MAX_PREVIEW_COLS)
}

/**
 * Parse delimited text (csv / tsv). papaparse auto-detects the delimiter and
 * handles quoted fields with embedded newlines. Values stay strings so the
 * preview is faithful to the file.
 */
export function parseCsvText(text: string): TableData {
  const cleaned = text.replace(/^\uFEFF/, '')
  const parsed = Papa.parse(cleaned, { skipEmptyLines: 'greedy' })
  const rows = (parsed.data as unknown[][]).map(
    row => row.map(value => (value === null || value === undefined ? '' : String(value))),
  )
  const totalRows = rows.length
  return {
    rows: rows.slice(0, MAX_PREVIEW_ROWS),
    totalRows,
    truncated: totalRows > MAX_PREVIEW_ROWS,
  }
}

/** Parse an .xlsx workbook (first sheet) into rows. */
export async function parseXlsxBuffer(buffer: ArrayBuffer): Promise<TableData> {
  let rows: TableRow[]
  try {
    rows = (await readSheet(buffer)) as TableRow[]
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  }
  const normalized = rows.map(row => (Array.isArray(row) ? row : []))
  const totalRows = normalized.length
  return {
    rows: normalized.slice(0, MAX_PREVIEW_ROWS),
    totalRows,
    truncated: totalRows > MAX_PREVIEW_ROWS,
  }
}
