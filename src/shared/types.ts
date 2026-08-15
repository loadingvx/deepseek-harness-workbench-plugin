/** Shared JSON contract between the Host Git HTTP API and the browser panel. */

export type GitErrorCode =
  | 'GIT_NOT_FOUND'
  | 'NOT_A_REPO'
  | 'NO_WORKSPACE'
  | 'UNKNOWN_WORKSPACE'
  | 'EMPTY_MESSAGE'
  | 'NOTHING_STAGED'
  | 'INDEX_LOCKED'
  | 'DIRTY_WORKTREE'
  | 'BUSY'
  | 'BRANCH_MISSING'
  | 'IDENTITY_MISSING'
  | 'INVALID_PATH'
  | 'NETWORK'
  | 'BAD_REQUEST'
  | 'GIT_FAILED'
  | 'FS_NOT_FOUND'
  | 'FS_IS_DIRECTORY'
  | 'FS_TOO_LARGE'
  | 'FS_BINARY'
  | 'FS_WRITE_FAILED'
  | 'LLM_UNAVAILABLE'
  | 'LLM_FAILED'
  | 'NOTHING_TO_DESCRIBE'
  | 'NO_REMOTE'
  | 'NO_UPSTREAM'
  | 'NOTHING_TO_PUSH'
  | 'NOTHING_TO_PULL'
  | 'REMOTE_AHEAD'
  | 'DIVERGED'
  | 'AUTH_FAILED'
  | 'REMOTE_UNREACHABLE'
  | 'DETACHED_HEAD'

export interface GitFail {
  ok: false
  code: GitErrorCode
  messageZh: string
  hintZh: string
}

export interface GitOk<T> {
  ok: true
  value: T
}

export type GitResult<T> = GitOk<T> | GitFail

export type FileStatusKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict'

export interface GitFileChange {
  path: string
  kind: FileStatusKind
  staged: boolean
  labelZh: string
}

export interface GitProbe {
  gitAvailable: boolean
  gitVersion?: string
  isRepo: boolean
  root?: string
  branch?: string
  detached: boolean
  ahead: number
  behind: number
  hasHead: boolean
  remote?: string
  upstream?: string
}

export interface GitStatusSnapshot {
  probe: GitProbe
  staged: GitFileChange[]
  unstaged: GitFileChange[]
  untracked: GitFileChange[]
}

export interface GitDiffSnapshot {
  path?: string
  staged: boolean
  text: string
  empty: boolean
}

export type GitRefKind = 'branch' | 'tag' | 'remote'

export interface GitRefMark {
  name: string
  kind: GitRefKind
}

export interface GitLogEntry {
  hash: string
  shortHash: string
  author: string
  date: string
  subject: string
  head: boolean
  refs: GitRefMark[]
}

export interface GitBranchInfo {
  name: string
  current: boolean
}

export interface GitCommitResult {
  hash: string
  subject: string
}

export interface GitCommitMessage {
  message: string
}

export interface GitSwitchResult {
  branch: string
}

export interface GitPushResult {
  remote: string
  branch: string
  setUpstream: boolean
}

export interface GitPullResult {
  remote: string
  branch: string
}

export interface FsDirEntry {
  name: string
  path: string
  kind: 'file' | 'directory'
  hidden: boolean
}

export interface FsListSnapshot {
  path: string
  entries: FsDirEntry[]
  truncated: boolean
}

export interface FsFileSnapshot {
  path: string
  content: string
  size: number
  language: string
}

export interface FsWriteResult {
  path: string
  size: number
}
