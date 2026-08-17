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
  | 'BRANCH_EXISTS'
  | 'BRANCH_INVALID'
  | 'MERGE_CONFLICT'
  | 'IDENTITY_MISSING'
  | 'IDENTITY_INVALID'
  | 'INVALID_PATH'
  | 'NETWORK'
  | 'BAD_REQUEST'
  | 'GIT_FAILED'
  | 'FS_NOT_FOUND'
  | 'FS_IS_DIRECTORY'
  | 'FS_TOO_LARGE'
  | 'FS_BINARY'
  | 'FS_WRITE_FAILED'
  | 'FS_EXISTS'
  | 'FS_RENAME_FAILED'
  | 'FS_DELETE_FAILED'
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
  | 'EDITOR_NOT_FOUND'
  | 'EDITOR_FAILED'
  | 'EDITOR_UNKNOWN'
  | 'TERM_NO_SHELL'
  | 'TERM_FAILED'

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

/** Prefill for `git init`: name / email / default branch from this machine. */
export interface GitIdentity {
  name: string
  email: string
  defaultBranch: string
}

export interface GitInitInput {
  name: string
  email: string
  branch: string
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
  /** Parent hashes, newest-first walk. Empty for the root commit. */
  parents: string[]
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

export interface GitFetchResult {
  remote: string
}

export interface GitCreateBranchResult {
  branch: string
}

export interface GitMergeResult {
  branch: string
  from: string
}

export interface FsDirEntry {
  name: string
  path: string
  kind: 'file' | 'directory'
  hidden: boolean
  /** True when Git will not track this path (matches .gitignore and is not already tracked). */
  ignored: boolean
}

export interface FsListSnapshot {
  path: string
  entries: FsDirEntry[]
  truncated: boolean
}

export interface FsSearchSnapshot {
  query: string
  hits: FsDirEntry[]
  truncated: boolean
}

export interface FsFileSnapshot {
  path: string
  content: string
  size: number
  language: string
  ignored: boolean
}

export interface FsWriteResult {
  path: string
  size: number
}

export interface FsRenameResult {
  path: string
}

export interface FsDeleteResult {
  path: string
}

export const EXTERNAL_EDITOR_IDS = [
  'cursor',
  'vscode',
  'vscode-insiders',
  'codium',
  'windsurf',
  'zed',
  'system',
] as const

export type ExternalEditorId = (typeof EXTERNAL_EDITOR_IDS)[number]

export function isExternalEditorId(value: unknown): value is ExternalEditorId {
  return typeof value === 'string' && (EXTERNAL_EDITOR_IDS as readonly string[]).includes(value)
}

export interface ExternalEditorInfo {
  id: ExternalEditorId
  label: string
  available: boolean
}

export interface ExternalEditorsSnapshot {
  editors: ExternalEditorInfo[]
}

export interface ExternalOpenResult {
  app: ExternalEditorId
  path: string
}

export interface PluginUpdateSnapshot {
  name: string
  current: string
  latest: string | null
  outdated: boolean
  command: string
}

/** How the host learned the session's current model. */
export type UsageRouteSource = 'session' | 'default'

/** Why the provider balance could not be shown as a number. */
export type UsageBalanceStatus = 'ok' | 'unsupported' | 'no_key' | 'auth' | 'failed'

/** One currency row from a provider billing API. */
export interface UsageBalanceRow {
  currency: string
  total: string
  granted?: string
  toppedUp?: string
  used?: string
}

/** Provider account snapshot for the model currently shown in this session. */
export interface ProviderUsageSnapshot {
  provider: string
  providerName: string
  model: string
  modelName: string
  reasoningEffort?: string
  source: UsageRouteSource
  /** Host + path only; credentials never appear. */
  endpoint?: string
  balanceStatus: UsageBalanceStatus
  /** True when the provider says the key can still call models. */
  accountAvailable?: boolean
  balances: UsageBalanceRow[]
  fetchedAt: number
}

/** Durable session token totals from the conversation projection. */
export interface SessionTokenUsage {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** Approximate context occupancy for the next request. */
export interface SessionContextPressure {
  pressureTokens?: number
  projectedTokens?: number
  contextWindow?: number
}

/** Heuristic composition of the next request (not billed totals). */
export interface SessionContextBreakdown {
  systemTokens: number
  toolsTokens: number
  messageTokens: number
}