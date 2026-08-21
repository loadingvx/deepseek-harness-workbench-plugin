/**
 * Agent file-mutation review: one baseline per path, Keep/Undo like Cursor/Trae.
 * Captures on tools/pre-execute for write/edit; refreshes after tools/result.
 * @module
 */
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve as resolvePath, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { GitError } from '../shared/errors.ts'
import {
  applyHunkToBaseline,
  computeReviewHunks,
  findHunk,
  hashText,
  reverseHunkOnCurrent,
  tallyHunkLines,
} from '../shared/review-hunks.ts'
import type { ReviewFileSnapshot, ReviewSnapshot } from '../shared/types.ts'
import { assertSafeWorkspacePath, MAX_FILE_BYTES, WorkspaceFs } from './workspace-fs.ts'
import { resolveWorkspacePath } from './workspace.ts'

const MUTATING_TOOLS = new Set(['write', 'edit'])
const MAX_PENDING_FILES = 80
const MAX_BASELINE_BYTES = MAX_FILE_BYTES

interface FileEntry {
  path: string
  /** null = did not exist before Agent touched it */
  baseline: string | null
  created: boolean
  afterHash: string
  updatedAt: number
}

interface WorkspaceBucket {
  root: string
  files: Map<string, FileEntry>
  revision: number
}

export class PendingReviewStore {
  private readonly buckets = new Map<string, WorkspaceBucket>()
  /** When false, write/edit are not captured into the review queue. */
  private enabled = true

  constructor(private readonly fs: WorkspaceFs) {}

  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Toggle capture. Disabling clears every pending baseline so turning back on
   * does not resurrect a stale queue from while the feature was off.
   */
  setEnabled(on: boolean): void {
    this.enabled = on
    if (!on) {
      for (const bucket of this.buckets.values()) {
        if (bucket.files.size === 0) continue
        bucket.files.clear()
        this.bump(bucket)
      }
    }
  }

  private async keyOf(root: string): Promise<string> {
    try {
      return await realpath(root)
    } catch {
      return resolvePath(root)
    }
  }

  private async bucket(root: string): Promise<WorkspaceBucket> {
    const key = await this.keyOf(root)
    let bucket = this.buckets.get(key)
    if (bucket === undefined) {
      bucket = { root: key, files: new Map(), revision: 0 }
      this.buckets.set(key, bucket)
    }
    return bucket
  }

  private bump(bucket: WorkspaceBucket): void {
    bucket.revision += 1
  }

  /** Resolve model-facing file_path into a workspace-relative posix path. */
  resolveRelPath(root: string, cwd: string, filePath: string): string {
    const trimmed = filePath.trim()
    if (trimmed === '') throw new GitError('INVALID_PATH')
    let abs: string
    if (isAbsolute(trimmed)) abs = resolvePath(trimmed)
    else abs = resolvePath(cwd || root, trimmed)
    const rel = relative(root, abs)
    if (rel.startsWith('..') || rel.split(sep).includes('..')) throw new GitError('INVALID_PATH')
    return assertSafeWorkspacePath(root, rel.split('\\').join('/'))
  }

  async captureBaseline(root: string, relPath: string): Promise<void> {
    if (!this.enabled) return
    const bucket = await this.bucket(root)
    if (bucket.files.has(relPath)) return
    if (bucket.files.size >= MAX_PENDING_FILES) throw new GitError('REVIEW_FULL')

    let baseline: string | null = null
    let created = true
    try {
      const snap = await this.fs.read(bucket.root, relPath)
      if (Buffer.byteLength(snap.content, 'utf8') > MAX_BASELINE_BYTES) return
      baseline = snap.content
      created = false
    } catch (error) {
      if (!(error instanceof GitError) || error.code !== 'FS_NOT_FOUND') {
        if (error instanceof GitError && (error.code === 'FS_BINARY' || error.code === 'FS_TOO_LARGE' || error.code === 'FS_IS_DIRECTORY')) {
          return
        }
        throw error
      }
    }

    bucket.files.set(relPath, {
      path: relPath,
      baseline,
      created,
      afterHash: '',
      updatedAt: Date.now(),
    })
    this.bump(bucket)
  }

  async noteSuccess(root: string, relPath: string): Promise<void> {
    if (!this.enabled) return
    const bucket = await this.bucket(root)
    const entry = bucket.files.get(relPath)
    if (entry === undefined) return
    try {
      const snap = await this.fs.read(bucket.root, relPath)
      entry.afterHash = hashText(snap.content)
      entry.updatedAt = Date.now()
      this.bump(bucket)
    } catch (error) {
      if (error instanceof GitError && error.code === 'FS_NOT_FOUND' && entry.created) {
        // Write failed after capture, or deleted — drop.
        bucket.files.delete(relPath)
        this.bump(bucket)
        return
      }
      // Binary / too large after write: cannot review — drop tracking.
      bucket.files.delete(relPath)
      this.bump(bucket)
    }
  }

  async list(root: string): Promise<ReviewSnapshot> {
    if (!this.enabled) return { revision: 0, files: [] }
    const bucket = await this.bucket(root)
    const files: ReviewFileSnapshot[] = []
    for (const entry of [...bucket.files.values()].sort((a, b) => a.path.localeCompare(b.path))) {
      let current = ''
      let missing = false
      try {
        current = (await this.fs.read(bucket.root, entry.path)).content
      } catch (error) {
        if (error instanceof GitError && error.code === 'FS_NOT_FOUND') missing = true
        else {
          bucket.files.delete(entry.path)
          continue
        }
      }
      if (missing) {
        if (entry.created) {
          // Agent 新建后又被删掉：没有可审阅内容。
          bucket.files.delete(entry.path)
          continue
        }
        // 相对 baseline 被删：仍可用 Undo 恢复 baseline。
        current = ''
      }

      const currentHash = hashText(missing ? '' : current)
      // Cursor 风格：手改后仍留在 pending；diff = baseline ↔ 当前盘。
      // afterHash 保持 Agent 落盘快照，用来标 manualEdited，绝不能在 list 里改成手改后的 hash。
      const manualEdited = entry.afterHash !== '' && currentHash !== entry.afterHash

      const baselineText = entry.baseline ?? ''
      if (!missing && current === baselineText) {
        // 已回到改前（含手改撤干净）：出队。
        bucket.files.delete(entry.path)
        continue
      }
      const hunks = computeReviewHunks(entry.path, entry.baseline, missing ? '' : current)
      if (hunks.length === 0 && !missing) {
        bucket.files.delete(entry.path)
        continue
      }
      const { added, removed } = tallyHunkLines(hunks)
      files.push({
        path: entry.path,
        created: entry.created,
        updatedAt: entry.updatedAt,
        afterHash: entry.afterHash,
        manualEdited,
        hunks,
        addedLines: added,
        removedLines: removed,
      })
    }
    if (files.length !== bucket.files.size) this.bump(bucket)
    return { revision: bucket.revision, files }
  }

  async keepFile(root: string, path: string): Promise<ReviewSnapshot> {
    const bucket = await this.bucket(root)
    const rel = assertSafeWorkspacePath(bucket.root, path)
    if (!bucket.files.has(rel)) throw new GitError('REVIEW_NOT_FOUND')
    bucket.files.delete(rel)
    this.bump(bucket)
    return this.list(bucket.root)
  }

  async keepAll(root: string): Promise<ReviewSnapshot> {
    const bucket = await this.bucket(root)
    bucket.files.clear()
    this.bump(bucket)
    return this.list(bucket.root)
  }

  async undoFile(root: string, path: string): Promise<ReviewSnapshot> {
    const bucket = await this.bucket(root)
    const rel = assertSafeWorkspacePath(bucket.root, path)
    const entry = bucket.files.get(rel)
    if (entry === undefined) throw new GitError('REVIEW_NOT_FOUND')
    // Cursor 风格：Undo 始终回到 baseline（可含冲掉手改）；确认框由 UI 负责。
    if (entry.created) {
      try {
        await this.fs.delete(bucket.root, rel)
      } catch (error) {
        if (!(error instanceof GitError) || error.code !== 'FS_NOT_FOUND') throw error
      }
    } else {
      await this.fs.write(bucket.root, rel, entry.baseline ?? '')
    }
    bucket.files.delete(rel)
    this.bump(bucket)
    return this.list(bucket.root)
  }

  async undoAll(root: string): Promise<ReviewSnapshot> {
    const bucket = await this.bucket(root)
    const paths = [...bucket.files.keys()].sort().reverse()
    for (const path of paths) {
      await this.undoFile(bucket.root, path)
    }
    return this.list(bucket.root)
  }

  async keepHunk(root: string, path: string, hunkId: string): Promise<ReviewSnapshot> {
    const bucket = await this.bucket(root)
    const rel = assertSafeWorkspacePath(bucket.root, path)
    const entry = bucket.files.get(rel)
    if (entry === undefined) throw new GitError('REVIEW_NOT_FOUND')
    const current = await this.readCurrent(bucket, entry)
    this.assertAgentSnapshot(entry, current)
    const hunks = computeReviewHunks(rel, entry.baseline, current)
    const hunk = findHunk(hunks, hunkId)
    if (hunk === undefined) throw new GitError('REVIEW_NOT_FOUND')
    try {
      entry.baseline = applyHunkToBaseline(entry.baseline, hunk)
    } catch (error) {
      throw mapHunkError(error)
    }
    entry.created = false
    entry.afterHash = hashText(current)
    entry.updatedAt = Date.now()
    if (entry.baseline === current) {
      bucket.files.delete(rel)
    }
    this.bump(bucket)
    return this.list(bucket.root)
  }

  async undoHunk(root: string, path: string, hunkId: string): Promise<ReviewSnapshot> {
    const bucket = await this.bucket(root)
    const rel = assertSafeWorkspacePath(bucket.root, path)
    const entry = bucket.files.get(rel)
    if (entry === undefined) throw new GitError('REVIEW_NOT_FOUND')
    const current = await this.readCurrent(bucket, entry)
    this.assertAgentSnapshot(entry, current)
    const hunks = computeReviewHunks(rel, entry.baseline, current)
    const hunk = findHunk(hunks, hunkId)
    if (hunk === undefined) throw new GitError('REVIEW_NOT_FOUND')
    let next: string
    try {
      next = reverseHunkOnCurrent(current, hunk)
    } catch (error) {
      throw mapHunkError(error)
    }
    if (entry.created && next === '') {
      try {
        await this.fs.delete(bucket.root, rel)
      } catch (error) {
        if (!(error instanceof GitError) || error.code !== 'FS_NOT_FOUND') throw error
      }
      bucket.files.delete(rel)
    } else {
      await this.fs.write(bucket.root, rel, next)
      entry.afterHash = hashText(next)
      entry.updatedAt = Date.now()
      if (next === (entry.baseline ?? '')) {
        bucket.files.delete(rel)
      }
    }
    this.bump(bucket)
    return this.list(bucket.root)
  }

  private async readCurrent(bucket: WorkspaceBucket, entry: FileEntry): Promise<string> {
    try {
      return (await this.fs.read(bucket.root, entry.path)).content
    } catch (error) {
      if (error instanceof GitError && error.code === 'FS_NOT_FOUND') {
        if (entry.afterHash === hashText('')) return ''
        // 手改删除了文件：整文件 Undo 可恢复；单块操作拒绝。
        throw new GitError('REVIEW_STALE')
      }
      throw error
    }
  }

  /** Hunk ops require the disk to still match the Agent-settled snapshot. */
  private assertAgentSnapshot(entry: FileEntry, current: string): void {
    if (entry.afterHash === '') return
    if (hashText(current) !== entry.afterHash) throw new GitError('REVIEW_STALE')
  }
}

function mapHunkError(error: unknown): GitError {
  if (error instanceof GitError) return error
  if (error instanceof Error) {
    if (error.message === 'REVIEW_STALE' || (error as { code?: string }).code === 'REVIEW_STALE') {
      return new GitError('REVIEW_STALE')
    }
    if (error.message === 'REVIEW_AMBIGUOUS' || (error as { code?: string }).code === 'REVIEW_AMBIGUOUS') {
      return new GitError('REVIEW_AMBIGUOUS')
    }
  }
  return new GitError('GIT_FAILED', error instanceof Error ? error.message : String(error))
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
 * Wire write/edit into the review store. Never blocks the tool pipeline.
 */
export function registerPendingReview(
  ctx: Context,
  store: PendingReviewStore,
): () => void {
  const offPre = ctx.on('tools/pre-execute', async (exec, next) => {
    const call = exec as {
      name?: string
      arguments?: unknown
      agent?: { session?: { header?: { cwd?: string } } }
    }
    const proceed = next as () => Promise<unknown>
    if (typeof call.name !== 'string' || !MUTATING_TOOLS.has(call.name)) return proceed()
    try {
      const filePath = toolArgsPath(call.arguments)
      if (filePath === undefined) return proceed()
      const cwd = sessionCwd(call) ?? resolveWorkspacePath(ctx)
      const root = resolveWorkspacePath(ctx, undefined, cwd)
      const rel = store.resolveRelPath(root, cwd, filePath)
      await store.captureBaseline(root, rel)
    } catch {
      // Never veto Agent writes because review capture failed.
    }
    return proceed()
  })

  const offResult = ctx.on('tools/result', (exec, result) => {
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
        const rel = store.resolveRelPath(root, cwd, filePath)
        await store.noteSuccess(root, rel)
      } catch {
        /* ignore */
      }
    })()
  })

  return () => {
    offPre()
    offResult()
  }
}

/** @internal test helper */
export function __testOnlyClear(store: PendingReviewStore): void {
  ;(store as unknown as { buckets: Map<string, unknown> }).buckets.clear()
}
