import type { CanvasViewMode } from '../../shared/canvas-path.ts'

/** One-shot preview preference set before {@link openFile} runs. */
const pending = new Map<string, CanvasViewMode>()

export function requestCanvasView(path: string, mode: CanvasViewMode = 'preview'): void {
  pending.set(path.replace(/\\/g, '/'), mode)
}

/** Returns and clears a pending view mode for `path`. */
export function consumeCanvasView(path: string): CanvasViewMode | undefined {
  const key = path.replace(/\\/g, '/')
  const mode = pending.get(key)
  if (mode === undefined) return undefined
  pending.delete(key)
  return mode
}
