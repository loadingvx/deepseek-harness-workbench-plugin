/**
 * Queue Canvas file paths after Agent write/edit so the workbench client can
 * auto-open them in preview mode.
 */
import type { Context } from '@deepseek-ai/cordis'
import { isCanvasPath } from '../shared/canvas-path.ts'
import type { CanvasOpenSnapshot } from '../shared/types.ts'
import { resolveWorkspacePath } from './workspace.ts'
import type { PendingReviewStore } from './pending-review.ts'

const MUTATING_TOOLS = new Set(['write', 'edit'])
const MAX_ENTRIES = 24

interface Entry {
  path: string
  seq: number
}

interface Bucket {
  entries: Entry[]
  seq: number
  revision: number
}

export class CanvasOpenQueue {
  private readonly buckets = new Map<string, Bucket>()

  private bucket(root: string): Bucket {
    const key = root
    let row = this.buckets.get(key)
    if (row === undefined) {
      row = { entries: [], seq: 0, revision: 0 }
      this.buckets.set(key, row)
    }
    return row
  }

  /** Record a workspace-relative Canvas path for client pickup. */
  noteOpen(root: string, relPath: string): void {
    if (!isCanvasPath(relPath)) return
    const bucket = this.bucket(root)
    bucket.seq += 1
    bucket.entries.push({ path: relPath, seq: bucket.seq })
    if (bucket.entries.length > MAX_ENTRIES) {
      bucket.entries.splice(0, bucket.entries.length - MAX_ENTRIES)
    }
    bucket.revision += 1
  }

  snapshot(root: string, sinceSeq: number): CanvasOpenSnapshot {
    const bucket = this.buckets.get(root)
    if (bucket === undefined) return { revision: 0, opens: [] }
    const opens = bucket.entries.filter((row) => row.seq > sinceSeq)
    return { revision: bucket.revision, opens }
  }
}

function toolArgsPath(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined
  const rec = args as Record<string, unknown>
  if (typeof rec.file_path === 'string') return rec.file_path
  if (typeof rec.path === 'string') return rec.path
  return undefined
}

function sessionCwd(exec: { agent?: { session?: { header?: { cwd?: string } } } }): string | undefined {
  const cwd = exec.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
}

/**
 * Hook write/edit results and enqueue `.canvas/*.canvas.tsx` paths.
 * Reuses {@link PendingReviewStore.resolveRelPath} for cwd-safe resolution.
 */
export function registerCanvasOpenQueue(
  ctx: Context,
  queue: CanvasOpenQueue,
  review: PendingReviewStore,
): () => void {
  const off = ctx.on('tools/result', (exec, result) => {
    const call = exec as {
      name?: string
      arguments?: unknown
      agent?: { session?: { header?: { cwd?: string } } }
    }
    const outcome = result as { isError?: boolean }
    if (typeof call.name !== 'string' || !MUTATING_TOOLS.has(call.name)) return
    if (outcome.isError === true) return
    const filePath = toolArgsPath(call.arguments)
    if (filePath === undefined) return
    void (async () => {
      try {
        const cwd = sessionCwd(call) ?? resolveWorkspacePath(ctx)
        const root = resolveWorkspacePath(ctx, undefined, cwd)
        const rel = review.resolveRelPath(root, cwd, filePath)
        queue.noteOpen(root, rel)
      } catch {
        /* ignore bad paths */
      }
    })()
  })
  return off
}
