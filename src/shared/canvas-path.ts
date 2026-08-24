/**
 * Workspace Canvas files live under `.canvas/` as `*.canvas.tsx`.
 */

const CANVAS_FILE_SUFFIX = '.canvas.tsx'

/** True when `path` is a Canvas deliverable (not arbitrary `.tsx`). */
export function isCanvasPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').trim()
  if (!normalized.endsWith(CANVAS_FILE_SUFFIX)) return false
  return normalized.includes('/.canvas/') || normalized.startsWith('.canvas/')
}

/** Suggested default view when a Canvas tab is first opened. */
export type CanvasViewMode = 'edit' | 'preview' | 'split'
