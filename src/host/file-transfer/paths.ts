import { isAbsolute, relative, resolve } from 'node:path'
import { realpath } from 'node:fs/promises'
import { GitError } from '../../shared/errors.ts'

/** Workspace-relative path for a transfer. Empty / `.` means the workspace root itself. */
export function assertTransferPath(path: string | undefined): string {
  const trimmed = (path ?? '').trim()
  if (trimmed.startsWith('-') || /[\0\r\n]/.test(trimmed)) throw new GitError('INVALID_PATH')
  return trimmed === '' || trimmed === '.' ? '' : trimmed
}

/**
 * `relative()` escape test that also covers Windows/WSL cross-drive absolutes,
 * mirroring the caveat documented in `workspace-fs.ts`: a first path segment of
 * `..` is the escape; a file named `..foo` is not.
 */
function leavesWorkspace(rootReal: string, candidate: string): boolean {
  const rel = relative(rootReal, candidate)
  if (rel === '') return false
  if (isAbsolute(rel)) return true
  return rel.split(/[/\\]/)[0] === '..'
}

/**
 * Resolve a workspace-relative path to a real path jailed inside the real
 * workspace root. A symlink may never point outside the workspace; a missing
 * leaf (an upload target) resolves to its jailed literal path instead.
 */
export async function resolveInsideRoot(root: string, path: string): Promise<string> {
  const rootReal = await realpath(root)
  const absolute = resolve(rootReal, path)
  if (leavesWorkspace(rootReal, absolute)) throw new GitError('INVALID_PATH')
  let real: string
  try {
    real = await realpath(absolute)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return resolve(rootReal, relative(rootReal, absolute))
    throw new GitError('INVALID_PATH')
  }
  if (leavesWorkspace(rootReal, real)) throw new GitError('INVALID_PATH')
  return real
}
