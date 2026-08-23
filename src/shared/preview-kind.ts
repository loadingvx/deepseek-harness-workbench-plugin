/**
 * Classify a workspace file into a direct-render preview kind.
 *
 * Images (raster) render straight in the editor pane; CSV / TSV / Excel
 * spreadsheets render as a table. SVG intentionally stays a text file
 * (it is editable XML). Everything else returns null and keeps the
 * regular text-editor / binary-error path.
 */

export type PreviewKind = 'image' | 'table'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.ico'])

/** .xls is recognized as a table but cannot be parsed by the small xlsx reader. */
const TABLE_EXT = new Set(['.csv', '.tsv', '.xlsx', '.xls'])

function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? path
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  return base.slice(dot).toLowerCase()
}

export function previewKindOfPath(path: string): PreviewKind | null {
  const ext = extensionOf(path)
  if (IMAGE_EXT.has(ext)) return 'image'
  if (TABLE_EXT.has(ext)) return 'table'
  return null
}

export function isPreviewImagePath(path: string): boolean {
  return previewKindOfPath(path) === 'image'
}

export function isPreviewTablePath(path: string): boolean {
  return previewKindOfPath(path) === 'table'
}

/** Old binary Excel workbook (.xls): recognized but not previewable in-browser. */
export function isLegacyXlsPath(path: string): boolean {
  return extensionOf(path) === '.xls'
}
