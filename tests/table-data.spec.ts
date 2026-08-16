import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import {
  cellText, columnCount, MAX_PREVIEW_ROWS, parseCsvText, parseXlsxBuffer,
} from '../src/client/workbench/table-data.ts'

/** Build a minimal single-sheet .xlsx in memory. */
function makeXlsxBytes(): ArrayBuffer {
  const xml = (inner: string): string =>
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    inner + '</sheetData></worksheet>'
  const row = (r: number, cells: string): string => `<row r="${r}">${cells}</row>`
  const num = (ref: string, value: number): string => `<c r="${ref}"><v>${value}</v></c>`
  const str = (ref: string, value: string): string =>
    `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`
  const sheet = xml(
    row(1, str('A1', 'Name') + str('B1', 'Value') + str('C1', 'Score')) +
    row(2, str('A2', 'alice') + str('B2', 'hello') + num('C2', 42)) +
    row(3, str('A3', 'bob') + str('B3', '你好') + num('C3', 7)),
  )
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '</Types>'),
    '_rels/.rels': strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>'),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '</Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  }
  const zipped = zipSync(files)
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength)
}

describe('parseCsvText', () => {
  it('parses plain CSV rows', () => {
    const data = parseCsvText('a,b,c\n1,2,3\n4,5,6\n')
    expect(data.rows).toEqual([['a', 'b', 'c'], ['1', '2', '3'], ['4', '5', '6']])
    expect(data.totalRows).toBe(3)
    expect(data.truncated).toBe(false)
  })

  it('handles quoted fields with commas and newlines', () => {
    const data = parseCsvText('name,note\n"doe, jane","line1\nline2"\n')
    expect(data.rows[1]).toEqual(['doe, jane', 'line1\nline2'])
  })

  it('strips a UTF-8 BOM and skips empty lines', () => {
    const data = parseCsvText('\uFEFFx,y\n\n1,2\n')
    expect(data.rows[0]).toEqual(['x', 'y'])
    expect(data.rows).toHaveLength(2)
  })

  it('auto-detects tab separators', () => {
    const data = parseCsvText('a\tb\t c\t\n1\t2\t3\n')
    expect(data.rows[1]).toEqual(['1', '2', '3'])
  })

  it('caps rows for very large files', () => {
    const lines = Array.from({ length: MAX_PREVIEW_ROWS + 10 }, (_, i) => `r${i},v${i}`).join('\n')
    const data = parseCsvText(lines + '\n')
    expect(data.rows).toHaveLength(MAX_PREVIEW_ROWS)
    expect(data.totalRows).toBe(MAX_PREVIEW_ROWS + 10)
    expect(data.truncated).toBe(true)
  })
})

describe('parseXlsxBuffer', () => {
  it('reads the first sheet into rows with typed cells', async () => {
    const data = await parseXlsxBuffer(makeXlsxBytes())
    expect(data.rows[0]).toEqual(['Name', 'Value', 'Score'])
    expect(data.rows[1]).toEqual(['alice', 'hello', 42])
    expect(data.rows[2]?.[1]).toBe('你好')
    expect(data.totalRows).toBe(3)
    expect(data.truncated).toBe(false)
  })

  it('rejects non-xlsx input', async () => {
    await expect(parseXlsxBuffer(new TextEncoder().encode('not a zip').buffer)).rejects.toThrow()
  })
})

describe('cellText and columnCount', () => {
  it('formats cells for display', () => {
    expect(cellText(null)).toBe('')
    expect(cellText('x')).toBe('x')
    expect(cellText(42)).toBe('42')
    expect(cellText(true)).toBe('true')
    const date = new Date('2024-01-02T00:00:00Z')
    expect(cellText(date)).not.toBe('')
  })

  it('counts the widest row and caps at the preview limit', () => {
    expect(columnCount([['a'], ['b', 'c', 'd']])).toBe(3)
    expect(columnCount([])).toBe(0)
    expect(columnCount([Array.from({ length: 200 }, (_, i) => String(i))])).toBe(100)
  })
})
