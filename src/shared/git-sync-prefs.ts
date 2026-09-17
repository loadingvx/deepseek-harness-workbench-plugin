/** Safe, enumerable pull/push defaults. Never accept free-form argv from the UI. */

export const GIT_SYNC_PREFS_KEY = 'dsh-workbench-git-sync-prefs'

export type PullMode = 'merge' | 'ff-only' | 'rebase'
export type PushMode = 'safe' | 'lease'

export interface GitSyncPrefs {
  pullMode: PullMode
  pushMode: PushMode
}

export const DEFAULT_GIT_SYNC_PREFS: GitSyncPrefs = {
  pullMode: 'merge',
  pushMode: 'safe',
}

export function parsePullMode(raw: unknown): PullMode {
  if (raw === 'ff-only' || raw === 'rebase' || raw === 'merge') return raw
  return DEFAULT_GIT_SYNC_PREFS.pullMode
}

export function parsePushMode(raw: unknown): PushMode {
  if (raw === 'lease' || raw === 'safe') return raw
  return DEFAULT_GIT_SYNC_PREFS.pushMode
}

export function parseGitSyncPrefs(raw: unknown): GitSyncPrefs {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_GIT_SYNC_PREFS }
  const rec = raw as { pullMode?: unknown; pushMode?: unknown }
  return {
    pullMode: parsePullMode(rec.pullMode),
    pushMode: parsePushMode(rec.pushMode),
  }
}

export function readGitSyncPrefs(): GitSyncPrefs {
  try {
    const text = localStorage.getItem(GIT_SYNC_PREFS_KEY)
    if (text === null || text.trim() === '') return { ...DEFAULT_GIT_SYNC_PREFS }
    return parseGitSyncPrefs(JSON.parse(text) as unknown)
  } catch {
    return { ...DEFAULT_GIT_SYNC_PREFS }
  }
}

export function writeGitSyncPrefs(prefs: GitSyncPrefs): GitSyncPrefs {
  const next = parseGitSyncPrefs(prefs)
  try {
    localStorage.setItem(GIT_SYNC_PREFS_KEY, JSON.stringify(next))
  } catch { /* ignore quota */ }
  return next
}

export function pullArgs(mode: PullMode): string[] {
  switch (mode) {
    case 'ff-only': return ['pull', '--ff-only']
    case 'rebase': return ['pull', '--rebase']
    default: return ['pull', '--no-rebase', '--no-edit']
  }
}

export function pushArgs(mode: PushMode, remote: string, setUpstream: boolean): string[] {
  if (setUpstream) return ['push', '-u', remote, 'HEAD']
  if (mode === 'lease') return ['push', '--force-with-lease']
  return ['push']
}

export function pullCommandPreview(mode: PullMode): string {
  return `git ${pullArgs(mode).join(' ')}`
}

export function pushCommandPreview(mode: PushMode): string {
  if (mode === 'lease') return 'git push --force-with-lease'
  return 'git push'
}
