import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { GitError } from '../shared/errors.ts'
import {
  CURRENT_REPO_ID, PARENT_REPO_ID, folderNameFromPath, isSkippedChildName, parseNearbyRepoId,
} from '../shared/git-nearby.ts'
import type { NearbyGitRepo, NearbyGitSnapshot, NearbyRepoKind } from '../shared/types.ts'
import { assertSafeWorkspacePath } from './workspace-fs.ts'

/** True when this directory itself has a `.git` file or folder (does not walk up). */
export async function hasGitRoot(dir: string): Promise<boolean> {
  try {
    const info = await stat(join(dir, '.git'))
    return info.isDirectory() || info.isFile()
  } catch {
    return false
  }
}

async function realOrSelf(dir: string): Promise<string> {
  try {
    return await realpath(dir)
  } catch {
    return dir
  }
}

function childIdOf(id: string): string | null {
  const parsed = parseNearbyRepoId(id)
  return parsed?.kind === 'child' ? parsed.child ?? null : null
}

/**
 * Resolve a workspace-relative folder / symlink / submodule to its git cwd.
 * The id must stay a safe relative path under the workspace; the target may
 * sit outside when the workspace entry itself is a symlink.
 */
export async function resolveChildGitPath(workspace: string, id: string): Promise<string | null> {
  const child = childIdOf(id)
  if (child === null) return null
  let rel: string
  try {
    rel = assertSafeWorkspacePath(workspace, child)
  } catch {
    return null
  }
  if (rel === '') return null
  try {
    return await realpath(join(workspace, rel))
  } catch {
    return null
  }
}

async function classifyChild(workspace: string, id: string): Promise<NearbyGitRepo | null> {
  const child = childIdOf(id)
  if (child === null) return null
  let rel: string
  try {
    rel = assertSafeWorkspacePath(workspace, child)
  } catch {
    return null
  }
  if (rel === '') return null
  const full = join(workspace, rel)
  const real = await resolveChildGitPath(workspace, rel)
  if (real === null) return null
  if (!(await hasGitRoot(real))) return null
  let kind: NearbyRepoKind = 'child'
  try {
    if ((await lstat(full)).isSymbolicLink()) kind = 'link'
    else if ((await lstat(join(real, '.git'))).isFile()) kind = 'submodule'
  } catch {
    kind = 'child'
  }
  return {
    id: rel,
    kind,
    name: rel.includes('/') ? rel : folderNameFromPath(rel) || rel,
    isRepo: true,
  }
}

/** `path =` entries from `.gitmodules`. Ignores comments and unknown keys. */
export function parseGitmodulePaths(text: string): string[] {
  const paths: string[] = []
  const seen = new Set<string>()
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue
    const match = /^path\s*=\s*(.+)$/.exec(line)
    if (match === null) continue
    let value = match[1].trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2)
      || (value.startsWith('\'') && value.endsWith('\'') && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }
    if (value === '' || seen.has(value)) continue
    seen.add(value)
    paths.push(value)
  }
  return paths
}

async function submodulePaths(workspace: string): Promise<string[]> {
  try {
    return parseGitmodulePaths(await readFile(join(workspace, '.gitmodules'), 'utf8'))
  } catch {
    return []
  }
}

export async function scanNearbyGit(workspace: string, signal?: AbortSignal): Promise<NearbyGitSnapshot> {
  const root = await realOrSelf(workspace)
  const workspaceName = folderNameFromPath(root) || basename(root) || root
  const current: NearbyGitRepo = {
    id: CURRENT_REPO_ID,
    kind: 'current',
    name: workspaceName,
    isRepo: await hasGitRoot(root),
  }
  let parent: NearbyGitRepo | null = null
  const parentDir = dirname(root)
  if (parentDir !== root && parentDir !== '') {
    if (signal?.aborted) {
      return { workspaceName, current, parent: null, children: [] }
    }
    if (await hasGitRoot(parentDir)) {
      parent = {
        id: PARENT_REPO_ID,
        kind: 'parent',
        name: folderNameFromPath(parentDir) || parentDir,
        isRepo: true,
      }
    }
  }
  const childrenById = new Map<string, NearbyGitRepo>()
  const consider = async (id: string): Promise<void> => {
    if (signal?.aborted) return
    const found = await classifyChild(root, id)
    if (found === null || childrenById.has(found.id)) return
    childrenById.set(found.id, found)
  }
  let names: string[] = []
  try {
    const entries = await readdir(root, { withFileTypes: true })
    names = entries
      .filter(entry => entry.isDirectory() || entry.isSymbolicLink())
      .map(entry => entry.name)
  } catch {
    names = []
  }
  for (const name of names) {
    if (signal?.aborted) break
    if (isSkippedChildName(name)) continue
    await consider(name)
  }
  for (const path of await submodulePaths(root)) {
    if (signal?.aborted) break
    await consider(path)
  }
  const children = [...childrenById.values()].sort((a, b) => a.name.localeCompare(b.name, 'en'))
  return { workspaceName, current, parent, children }
}

/**
 * Resolve a nearby-repo id to an absolute git cwd.
 * `undefined` / `.` → workspace. `..` → parent only if it is a git root.
 * Any other id must be a child folder, symlink, or registered submodule that is a git root.
 */
export async function resolveNearbyGitPath(workspace: string, repoId?: string): Promise<string> {
  const parsed = parseNearbyRepoId(repoId)
  if (parsed === null) throw new GitError('UNKNOWN_REPO')
  const root = await realOrSelf(workspace)
  if (parsed.kind === 'current') return root
  if (parsed.kind === 'parent') {
    const parentDir = dirname(root)
    if (parentDir === root || parentDir === '') throw new GitError('UNKNOWN_REPO')
    if (!(await hasGitRoot(parentDir))) throw new GitError('UNKNOWN_REPO')
    return realOrSelf(parentDir)
  }
  const child = parsed.child
  if (child === undefined) throw new GitError('UNKNOWN_REPO')
  const found = await classifyChild(root, child)
  if (found === null) throw new GitError('UNKNOWN_REPO')
  const real = await resolveChildGitPath(root, found.id)
  if (real === null) throw new GitError('UNKNOWN_REPO')
  return real
}
