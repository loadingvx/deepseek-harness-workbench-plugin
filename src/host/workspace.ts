import type { Context } from '@deepseek-ai/cordis'
import { GitError } from '../shared/errors.ts'

export interface WorkspaceLookup {
  get(id: string): { readonly path: string } | undefined
  list(): Array<{ readonly id: string; readonly path: string }>
}

export function readWorkspaceRegistry(ctx: Context): WorkspaceLookup | undefined {
  const registry = ctx.get('workspaceRegistry') as WorkspaceLookup | undefined
  return registry
}

/** Resolve a workspace directory. Prefer an explicit id, then a single registered workspace. */
export function resolveWorkspacePath(ctx: Context, workspaceId?: string, fallbackCwd?: string): string {
  const registry = readWorkspaceRegistry(ctx)
  if (workspaceId !== undefined && workspaceId !== '') {
    const found = registry?.get(workspaceId)
    if (found === undefined) throw new GitError('UNKNOWN_WORKSPACE')
    return found.path
  }
  const listed = registry?.list() ?? []
  if (listed.length === 1) return listed[0]!.path
  if (fallbackCwd !== undefined && fallbackCwd !== '') return fallbackCwd
  if (listed.length === 0) throw new GitError('NO_WORKSPACE')
  throw new GitError('NO_WORKSPACE')
}
