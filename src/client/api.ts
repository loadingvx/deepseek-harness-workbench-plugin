import { fail } from '../shared/errors.ts'
import { parseCommitStreamLine } from '../shared/commit-stream.ts'
import type {
  ExternalEditorId, ExternalEditorsSnapshot, ExternalOpenResult,
  FsCopyResult, FsDeleteResult, FsFileSnapshot, FsListSnapshot, FsMkdirResult, FsRenameResult, FsRevealResult, FsSearchSnapshot, FsWriteResult,
  GitBranchInfo, GitCommitMessage, GitCommitResult, GitCreateBranchResult, GitDiffSnapshot,
  GitFail, GitFetchResult, GitFileChange, GitIdentity, GitInitInput, GitLogEntry, GitMergeResult, GitPullResult, GitPushResult, GitResult,
  GitStatusSnapshot, GitSwitchResult, NearbyGitSnapshot, PluginUpdateSnapshot, ProviderUsageSnapshot,
  ReviewSnapshot,
} from '../shared/types.ts'
import type { ControlPlaneKnobPatch, ControlPlaneKnobs, ControlPlaneSnapshot } from '../shared/control-plane.ts'
import type { PullMode, PushMode } from '../shared/git-sync-prefs.ts'
import { isCurrentRepoId } from '../shared/git-nearby.ts'

async function request<T>(path: string, init?: RequestInit): Promise<GitResult<T>> {
  try {
    const response = await fetch(path, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
    const data: unknown = await response.json()
    if (typeof data === 'object' && data !== null && 'ok' in data) {
      return data as GitResult<T>
    }
    return fail('GIT_FAILED', '服务返回了无法识别的内容。')
  } catch {
    return fail('NETWORK')
  }
}

function withRepoQuery(workspaceId: string, extra?: Record<string, string>, repo?: string): string {
  const params = new URLSearchParams({ workspaceId, ...extra })
  if (!isCurrentRepoId(repo)) params.set('repo', repo ?? '')
  return params.toString()
}

function withRepoBody(workspaceId: string, extra: Record<string, unknown>, repo?: string): string {
  return JSON.stringify({
    workspaceId,
    ...extra,
    ...isCurrentRepoId(repo) ? {} : { repo },
  })
}

async function readLlmNdjsonStream(
  path: string,
  body: Record<string, unknown>,
  options?: { signal?: AbortSignal; onDelta?: (text: string) => void },
  emptyFail = '模型没有返回内容。',
): Promise<GitResult<{ message: string }>> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      signal: options?.signal,
      headers: {
        accept: 'application/x-ndjson, application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const ctype = response.headers.get('content-type') ?? ''
    if (response.body === null || (ctype.includes('application/json') && !ctype.includes('ndjson'))) {
      const data: unknown = await response.json()
      if (typeof data === 'object' && data !== null && 'ok' in data) {
        const result = data as GitResult<{ message: string }>
        if (result.ok) options?.onDelta?.(result.value.message)
        return result
      }
      return fail('GIT_FAILED', '服务返回了无法识别的内容。')
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let last = ''
    let doneMessage: string | null = null
    let failResult: GitFail | null = null
    const consume = (line: string): void => {
      const parsed = parseCommitStreamLine(line)
      if (parsed === null) return
      if ('ok' in parsed && parsed.ok === false) {
        failResult = parsed
        return
      }
      if (!('type' in parsed)) return
      if (parsed.type === 'delta') {
        last = parsed.text
        options?.onDelta?.(parsed.text)
      } else {
        doneMessage = parsed.message
      }
    }
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl = buf.indexOf('\n')
      while (nl !== -1) {
        consume(buf.slice(0, nl))
        buf = buf.slice(nl + 1)
        nl = buf.indexOf('\n')
      }
    }
    buf += decoder.decode()
    if (buf.trim() !== '') consume(buf)
    if (failResult !== null) return failResult
    if (doneMessage !== null) return { ok: true, value: { message: doneMessage } }
    if (last !== '') return { ok: true, value: { message: last } }
    return fail('LLM_FAILED', emptyFail)
  } catch {
    if (options?.signal?.aborted) return fail('LLM_FAILED', '生成已取消。')
    return fail('NETWORK')
  }
}

async function readCommitMessageStream(
  workspaceId: string,
  template?: string,
  options?: { signal?: AbortSignal; onDelta?: (text: string) => void; repo?: string },
): Promise<GitResult<GitCommitMessage>> {
  return readLlmNdjsonStream(
    '/git/commit-message/stream',
    { workspaceId, template, ...isCurrentRepoId(options?.repo) ? {} : { repo: options?.repo } },
    options,
    '模型没有返回提交说明。',
  )
}

export interface GitClient {
  nearby(workspaceId: string, signal?: AbortSignal): Promise<GitResult<NearbyGitSnapshot>>
  status(workspaceId: string, repo?: string): Promise<GitResult<GitStatusSnapshot>>
  identity(workspaceId: string, repo?: string): Promise<GitResult<GitIdentity>>
  initRepo(workspaceId: string, input: GitInitInput): Promise<GitResult<GitStatusSnapshot>>
  diff(workspaceId: string, path?: string, staged?: boolean, repo?: string): Promise<GitResult<GitDiffSnapshot>>
  log(workspaceId: string, repo?: string): Promise<GitResult<GitLogEntry[]>>
  branches(workspaceId: string, repo?: string): Promise<GitResult<GitBranchInfo[]>>
  stage(workspaceId: string, paths: string[], repo?: string): Promise<GitResult<{ done: boolean }>>
  unstage(workspaceId: string, paths: string[], repo?: string): Promise<GitResult<{ done: boolean }>>
  restore(workspaceId: string, paths: string[], repo?: string): Promise<GitResult<{ done: boolean }>>
  commit(workspaceId: string, message: string, all?: boolean, repo?: string): Promise<GitResult<GitCommitResult>>
  generateCommitMessage(
    workspaceId: string,
    template?: string,
    options?: { signal?: AbortSignal; onDelta?: (text: string) => void; repo?: string },
  ): Promise<GitResult<GitCommitMessage>>
  push(workspaceId: string, pushMode?: PushMode, repo?: string): Promise<GitResult<GitPushResult>>
  pull(workspaceId: string, pullMode?: PullMode, repo?: string): Promise<GitResult<GitPullResult>>
  fetch(workspaceId: string, repo?: string): Promise<GitResult<GitFetchResult>>
  createBranch(workspaceId: string, name: string, repo?: string): Promise<GitResult<GitCreateBranchResult>>
  mergeBranch(workspaceId: string, name: string, repo?: string): Promise<GitResult<GitMergeResult>>
  switchBranch(workspaceId: string, name: string, repo?: string): Promise<GitResult<GitSwitchResult>>
  renameFile(workspaceId: string, from: string, to: string): Promise<GitResult<FsRenameResult>>
  deleteFile(workspaceId: string, path: string): Promise<GitResult<FsDeleteResult>>
  mkdir(workspaceId: string, path: string): Promise<GitResult<FsMkdirResult>>
  copyFile(workspaceId: string, from: string, to: string): Promise<GitResult<FsCopyResult>>
  revealInFolder(workspaceId: string, path?: string): Promise<GitResult<FsRevealResult>>
  commitFiles(workspaceId: string, hash: string, repo?: string): Promise<GitResult<GitFileChange[]>>
  commitDiff(workspaceId: string, hash: string, path: string, repo?: string): Promise<GitResult<GitDiffSnapshot>>
  listDir(workspaceId: string, path?: string): Promise<GitResult<FsListSnapshot>>
  searchFiles(workspaceId: string, query: string, hidden?: boolean): Promise<GitResult<FsSearchSnapshot>>
  readFile(workspaceId: string, path: string): Promise<GitResult<FsFileSnapshot>>
  /** Fetch a data file (xlsx / csv / tsv) as raw bytes for table preview. */
  readRawFile(workspaceId: string, path: string): Promise<GitResult<ArrayBuffer>>
  writeFile(workspaceId: string, path: string, content: string): Promise<GitResult<FsWriteResult>>
  listEditors(): Promise<GitResult<ExternalEditorsSnapshot>>
  openExternal(workspaceId: string, path?: string, app?: ExternalEditorId): Promise<GitResult<ExternalOpenResult>>
  writeTerm(workspaceId: string, data: string, termId?: string): Promise<GitResult<{ ok: true }>>
  resizeTerm(workspaceId: string, cols: number, rows: number, termId?: string): Promise<GitResult<{ ok: true; cols: number; rows: number }>>
  interruptTerm(workspaceId: string, termId?: string): Promise<GitResult<{ ok: true }>>
  restartTerm(workspaceId: string, cols?: number, rows?: number, termId?: string): Promise<GitResult<{ cwd: string; shell: string; cols: number; rows: number }>>
  closeTerm(workspaceId: string, termId?: string): Promise<GitResult<{ ok: true }>>
  pluginUpdate(): Promise<GitResult<PluginUpdateSnapshot>>
  usage(sessionId?: string): Promise<GitResult<ProviderUsageSnapshot>>
  controlPlane(sessionId?: string): Promise<GitResult<ControlPlaneSnapshot>>
  patchControlPlaneKnobs(
    sessionId: string,
    patch: ControlPlaneKnobPatch,
  ): Promise<GitResult<{ knobs: ControlPlaneKnobs; snapshot: ControlPlaneSnapshot }>>
  assistTerm(
    workspaceId: string,
    text: string,
    options?: {
      cwd?: string
      transcript?: string
      template?: string
      prefs?: unknown
      signal?: AbortSignal
      onDelta?: (text: string) => void
    },
  ): Promise<GitResult<{ message: string }>>
  reviewList(workspaceId: string): Promise<GitResult<ReviewSnapshot>>
  reviewKeep(workspaceId: string, path?: string, hunkId?: string): Promise<GitResult<ReviewSnapshot>>
  reviewUndo(workspaceId: string, path?: string, hunkId?: string): Promise<GitResult<ReviewSnapshot>>
  /** Sync Change review preference to the host (stops/starts baseline capture). */
  reviewSetEnabled(enabled: boolean): Promise<GitResult<{ enabled: boolean }>>
}

export function createGitClient(): GitClient {
  return {
    nearby: (workspaceId, signal) => request(`/git/nearby?${withRepoQuery(workspaceId)}`, { signal }),
    status: (workspaceId, repo) => request(`/git/status?${withRepoQuery(workspaceId, undefined, repo)}`),
    identity: (workspaceId, repo) => request(`/git/identity?${withRepoQuery(workspaceId, undefined, repo)}`),
    initRepo: (workspaceId, input) => request('/git/init', {
      method: 'POST', body: JSON.stringify({ workspaceId, ...input }),
    }),
    diff: (workspaceId, path, staged, repo) => {
      const extra: Record<string, string> = {}
      if (path) extra.path = path
      if (staged) extra.staged = '1'
      return request(`/git/diff?${withRepoQuery(workspaceId, extra, repo)}`)
    },
    log: (workspaceId, repo) => request(`/git/log?${withRepoQuery(workspaceId, { limit: '80' }, repo)}`),
    branches: (workspaceId, repo) => request(`/git/branches?${withRepoQuery(workspaceId, undefined, repo)}`),
    stage: (workspaceId, paths, repo) => request('/git/stage', {
      method: 'POST', body: withRepoBody(workspaceId, { paths }, repo),
    }),
    unstage: (workspaceId, paths, repo) => request('/git/unstage', {
      method: 'POST', body: withRepoBody(workspaceId, { paths }, repo),
    }),
    restore: (workspaceId, paths, repo) => request('/git/restore', {
      method: 'POST', body: withRepoBody(workspaceId, { paths }, repo),
    }),
    commit: (workspaceId, message, all, repo) => request('/git/commit', {
      method: 'POST', body: withRepoBody(workspaceId, { message, all: all === true }, repo),
    }),
    generateCommitMessage: (workspaceId, template, options) => readCommitMessageStream(workspaceId, template, options),
    push: (workspaceId, pushMode, repo) => request('/git/push', {
      method: 'POST', body: withRepoBody(workspaceId, { pushMode }, repo),
    }),
    pull: (workspaceId, pullMode, repo) => request('/git/pull', {
      method: 'POST', body: withRepoBody(workspaceId, { pullMode }, repo),
    }),
    fetch: (workspaceId, repo) => request('/git/fetch', {
      method: 'POST', body: withRepoBody(workspaceId, {}, repo),
    }),
    createBranch: (workspaceId, name, repo) => request('/git/create-branch', {
      method: 'POST', body: withRepoBody(workspaceId, { name }, repo),
    }),
    mergeBranch: (workspaceId, name, repo) => request('/git/merge', {
      method: 'POST', body: withRepoBody(workspaceId, { name }, repo),
    }),
    switchBranch: (workspaceId, name, repo) => request('/git/switch', {
      method: 'POST', body: withRepoBody(workspaceId, { name }, repo),
    }),
    renameFile: (workspaceId, from, to) => request('/git/fs/rename', {
      method: 'POST', body: JSON.stringify({ workspaceId, from, to }),
    }),
    deleteFile: (workspaceId, path) => request('/git/fs/delete', {
      method: 'POST', body: JSON.stringify({ workspaceId, path }),
    }),
    mkdir: (workspaceId, path) => request('/git/fs/mkdir', {
      method: 'POST', body: JSON.stringify({ workspaceId, path }),
    }),
    copyFile: (workspaceId, from, to) => request('/git/fs/copy', {
      method: 'POST', body: JSON.stringify({ workspaceId, from, to }),
    }),
    revealInFolder: (workspaceId, path) => request('/git/fs/reveal', {
      method: 'POST', body: JSON.stringify({ workspaceId, path: path ?? '' }),
    }),
    commitFiles: (workspaceId, hash, repo) => {
      return request(`/git/commit-files?${withRepoQuery(workspaceId, { hash }, repo)}`)
    },
    commitDiff: (workspaceId, hash, path, repo) => {
      return request(`/git/commit-diff?${withRepoQuery(workspaceId, { hash, path }, repo)}`)
    },
    listDir: (workspaceId, path) => {
      const query = new URLSearchParams({ workspaceId })
      if (path) query.set('path', path)
      return request(`/git/fs/list?${query.toString()}`)
    },
    searchFiles: (workspaceId, query, hidden) => {
      const params = new URLSearchParams({ workspaceId, q: query })
      if (hidden) params.set('hidden', '1')
      return request(`/git/fs/search?${params.toString()}`)
    },
    readFile: (workspaceId, path) => {
      const query = new URLSearchParams({ workspaceId, path })
      return request(`/git/fs/read?${query.toString()}`)
    },
    readRawFile: async (workspaceId, path) => {
      const query = new URLSearchParams({ workspaceId, path })
      try {
        const response = await fetch(`/git/fs/raw?${query.toString()}`)
        if (!response.ok) {
          try {
            const data: unknown = await response.json()
            if (typeof data === 'object' && data !== null && 'ok' in data) return data as GitFail
          } catch { /* fall through to a generic failure */ }
          return fail('GIT_FAILED', '无法读取这个文件用于预览。')
        }
        return { ok: true, value: await response.arrayBuffer() }
      } catch {
        return fail('NETWORK')
      }
    },
    writeFile: (workspaceId, path, content) => request('/git/fs/write', {
      method: 'POST', body: JSON.stringify({ workspaceId, path, content }),
    }),
    listEditors: () => request('/git/fs/editors'),
    openExternal: (workspaceId, path, app) => request('/git/fs/open', {
      method: 'POST', body: JSON.stringify({ workspaceId, path: path ?? '', app }),
    }),
    writeTerm: (workspaceId, data, termId) => request('/git/term/write', {
      method: 'POST', body: JSON.stringify({ workspaceId, data, termId }),
    }),
    resizeTerm: (workspaceId, cols, rows, termId) => request('/git/term/resize', {
      method: 'POST', body: JSON.stringify({ workspaceId, cols, rows, termId }),
    }),
    interruptTerm: (workspaceId, termId) => request('/git/term/interrupt', {
      method: 'POST', body: JSON.stringify({ workspaceId, termId }),
    }),
    restartTerm: (workspaceId, cols, rows, termId) => request('/git/term/restart', {
      method: 'POST', body: JSON.stringify({ workspaceId, cols, rows, termId }),
    }),
    closeTerm: (workspaceId, termId) => request('/git/term/close', {
      method: 'POST', body: JSON.stringify({ workspaceId, termId }),
    }),
    pluginUpdate: () => request('/git/update'),
    usage: (sessionId) => {
      const suffix = sessionId !== undefined && sessionId !== ''
        ? `?sessionId=${encodeURIComponent(sessionId)}`
        : ''
      return request(`/git/usage${suffix}`)
    },
    controlPlane: (sessionId) => {
      const suffix = sessionId !== undefined && sessionId !== ''
        ? `?sessionId=${encodeURIComponent(sessionId)}`
        : ''
      return request(`/git/control-plane${suffix}`)
    },
    patchControlPlaneKnobs: (sessionId, patch) => request('/git/control-plane/knobs', {
      method: 'POST',
      body: JSON.stringify({ sessionId, ...patch }),
    }),
    assistTerm: (workspaceId, text, options) => readLlmNdjsonStream(
      '/git/term/assist/stream',
      {
        workspaceId,
        text,
        cwd: options?.cwd,
        transcript: options?.transcript,
        template: options?.template,
        prefs: options?.prefs,
      },
      options,
      '模型没有返回命令。',
    ),
    reviewList: (workspaceId) => request(`/git/review?${withRepoQuery(workspaceId)}`),
    reviewKeep: (workspaceId, path, hunkId) => request('/git/review/keep', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId,
        ...(path !== undefined && path !== '' ? { path } : {}),
        ...(hunkId !== undefined && hunkId !== '' ? { hunkId } : {}),
      }),
    }),
    reviewUndo: (workspaceId, path, hunkId) => request('/git/review/undo', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId,
        ...(path !== undefined && path !== '' ? { path } : {}),
        ...(hunkId !== undefined && hunkId !== '' ? { hunkId } : {}),
      }),
    }),
    reviewSetEnabled: (enabled) => request('/git/review/prefs', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  }
}