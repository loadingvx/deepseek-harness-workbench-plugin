import type { NearbyGitRepo, NearbyGitSnapshot, NearbyRepoKind, ParentGitDecision } from './types.ts'

export const CURRENT_REPO_ID = '.'
export const PARENT_REPO_ID = '..'

const SKIP_CHILD_NAMES = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '.next',
  'dist',
  'build',
  'coverage',
  'vendor',
])

export function isSkippedChildName(name: string): boolean {
  return SKIP_CHILD_NAMES.has(name)
}

export function folderNameFromPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  if (trimmed === '' || trimmed === '/') return '/'
  const parts = trimmed.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || trimmed
}

export function isCurrentRepoId(id: string | undefined): boolean {
  return id === undefined || id === '' || id === CURRENT_REPO_ID
}

export function parseNearbyRepoId(id: string | undefined): { kind: NearbyRepoKind; child?: string } | null {
  if (isCurrentRepoId(id)) return { kind: 'current' }
  if (id === PARENT_REPO_ID) return { kind: 'parent' }
  if (id === undefined) return null
  const name = id.trim()
  if (name === '' || name === CURRENT_REPO_ID || name === PARENT_REPO_ID) return null
  if (name.startsWith('-') || name.startsWith('/') || name.endsWith('/')) return null
  if (/[\\\0]/.test(name) || name.includes('..')) return null
  const parts = name.split('/')
  if (parts.some(part => part === '' || part === '.' || part.startsWith('-'))) return null
  return { kind: 'child', child: name }
}

export function parentNeedsAsk(
  snapshot: NearbyGitSnapshot | null,
  decision: ParentGitDecision | null,
): boolean {
  return snapshot?.parent !== null && snapshot?.parent !== undefined && decision === null
}

export function visibleNearbyRepos(
  snapshot: NearbyGitSnapshot | null,
  decision: ParentGitDecision | null,
): NearbyGitRepo[] {
  if (snapshot === null) return []
  const list: NearbyGitRepo[] = [snapshot.current]
  if (snapshot.parent !== null && decision === 'include') list.push(snapshot.parent)
  list.push(...snapshot.children)
  return list
}

/** Keep a saved id only when it is still in the managed list; otherwise the current folder. */
export function pickNearbyRepoId(repos: readonly NearbyGitRepo[], saved?: string): string {
  if (saved !== undefined && saved !== '' && repos.some(repo => repo.id === saved)) return saved
  return CURRENT_REPO_ID
}

export function nearbyRepoById(
  repos: readonly NearbyGitRepo[],
  id: string | undefined,
): NearbyGitRepo | undefined {
  const target = isCurrentRepoId(id) ? CURRENT_REPO_ID : id
  return repos.find(repo => repo.id === target)
}
