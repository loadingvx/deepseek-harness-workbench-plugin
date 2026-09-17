/** Resource addresses for git diff tabs on ui-sidebar-right. */
const PREFIX = 'dsh-resource://git-diff/'

export type GitDiffResource = {
  workspaceId: string
  path: string
  staged: boolean
  hash?: string
  repo?: string
}

function encodePath(path: string): string {
  return path.split('/').map(part => encodeURIComponent(part)).join('/')
}

/** Nearby-repo id `.` is the workspace root; do not encode it — glob `**` rejects a trailing `/.`. */
function repoSuffix(repo?: string): string {
  if (repo === undefined || repo === '' || repo === '.') return ''
  return `/r/${encodeURIComponent(repo)}`
}

function decodePath(encoded: string): string {
  return encoded.split('/').map(part => {
    try {
      return decodeURIComponent(part)
    } catch {
      return part
    }
  }).join('/')
}

/** Build a working-tree diff address (staged or unstaged). */
export function gitDiffAddressOf(input: {
  workspaceId: string
  path: string
  staged: boolean
  repo?: string
}): string {
  const stage = input.staged ? '/staged' : '/unstaged'
  return `${PREFIX}w/${encodeURIComponent(input.workspaceId)}/f/${encodePath(input.path)}${stage}${repoSuffix(input.repo)}`
}

/** Build a commit-scoped diff address. */
export function gitCommitDiffAddressOf(input: {
  workspaceId: string
  path: string
  hash: string
  repo?: string
}): string {
  return `${PREFIX}w/${encodeURIComponent(input.workspaceId)}/f/${encodePath(input.path)}/c/${encodeURIComponent(input.hash)}${repoSuffix(input.repo)}`
}

/** Parse a git-diff resource address opened in the sidebar. */
export function parseGitDiffAddress(address: string): GitDiffResource | null {
  if (!address.startsWith(PREFIX)) return null
  const rest = address.slice(PREFIX.length)
  const match = /^w\/([^/]+)\/f\/(.+)$/.exec(rest)
  if (match === null) return null
  let workspaceId = match[1] ?? ''
  let tail = match[2] ?? ''
  try {
    workspaceId = decodeURIComponent(workspaceId)
  } catch { /* keep raw */ }

  let repo: string | undefined
  const repoMatch = /\/r\/([^/]+)$/.exec(tail)
  if (repoMatch !== null) {
    try {
      repo = decodeURIComponent(repoMatch[1] ?? '')
    } catch {
      repo = repoMatch[1]
    }
    tail = tail.slice(0, repoMatch.index)
  }

  if (tail.endsWith('/staged')) {
    return {
      workspaceId,
      path: decodePath(tail.slice(0, -'/staged'.length)),
      staged: true,
      repo,
    }
  }
  if (tail.endsWith('/unstaged')) {
    return {
      workspaceId,
      path: decodePath(tail.slice(0, -'/unstaged'.length)),
      staged: false,
      repo,
    }
  }

  const commitMatch = /\/c\/([^/]+)$/.exec(tail)
  if (commitMatch !== null) {
    const hash = (() => {
      try {
        return decodeURIComponent(commitMatch[1] ?? '')
      } catch {
        return commitMatch[1] ?? ''
      }
    })()
    return {
      workspaceId,
      path: decodePath(tail.slice(0, commitMatch.index)),
      staged: false,
      hash,
      repo,
    }
  }

  return null
}

export function gitDiffFileName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}
