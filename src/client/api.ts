import { fail } from '../shared/errors.ts'
import { parseCommitStreamLine } from '../shared/commit-stream.ts'
import type {
  ExternalEditorId, ExternalEditorsSnapshot, ExternalOpenResult,
  FsDeleteResult, FsFileSnapshot, FsListSnapshot, FsRenameResult, FsSearchSnapshot, FsWriteResult,
  GitBranchInfo, GitCommitMessage, GitCommitResult, GitCreateBranchResult, GitDiffSnapshot,
  GitFail, GitFetchResult, GitFileChange, GitIdentity, GitInitInput, GitLogEntry, GitMergeResult, GitPullResult, GitPushResult, GitResult,
  GitStatusSnapshot, GitSwitchResult, PluginUpdateSnapshot, ProviderUsageSnapshot,
} from '../shared/types.ts'
import type { PullMode, PushMode } from '../shared/git-sync-prefs.ts'

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
  options?: { signal?: AbortSignal; onDelta?: (text: string) => void },
): Promise<GitResult<GitCommitMessage>> {
  return readLlmNdjsonStream(
    '/git/commit-message/stream',
    { workspaceId, template },
    options,
    '模型没有返回提交说明。',
  )
}

export interface GitClient {
  status(workspaceId: string): Promise<GitResult<GitStatusSnapshot>>
  identity(workspaceId: string): Promise<GitResult<GitIdentity>>
  initRepo(workspaceId: string, input: GitInitInput): Promise<GitResult<GitStatusSnapshot>>
  diff(workspaceId: string, path?: string, staged?: boolean): Promise<GitResult<GitDiffSnapshot>>
  log(workspaceId: string): Promise<GitResult<GitLogEntry[]>>
  branches(workspaceId: string): Promise<GitResult<GitBranchInfo[]>>
  stage(workspaceId: string, paths: string[]): Promise<GitResult<{ done: boolean }>>
  unstage(workspaceId: string, paths: string[]): Promise<GitResult<{ done: boolean }>>
  restore(workspaceId: string, paths: string[]): Promise<GitResult<{ done: boolean }>>
  commit(workspaceId: string, message: string, all?: boolean): Promise<GitResult<GitCommitResult>>
  generateCommitMessage(
    workspaceId: string,
    template?: string,
    options?: { signal?: AbortSignal; onDelta?: (text: string) => void },
  ): Promise<GitResult<GitCommitMessage>>
  push(workspaceId: string, pushMode?: PushMode): Promise<GitResult<GitPushResult>>
  pull(workspaceId: string, pullMode?: PullMode): Promise<GitResult<GitPullResult>>
  fetch(workspaceId: string): Promise<GitResult<GitFetchResult>>
  createBranch(workspaceId: string, name: string): Promise<GitResult<GitCreateBranchResult>>
  mergeBranch(workspaceId: string, name: string): Promise<GitResult<GitMergeResult>>
  switchBranch(workspaceId: string, name: string): Promise<GitResult<GitSwitchResult>>
  renameFile(workspaceId: string, from: string, to: string): Promise<GitResult<FsRenameResult>>
  deleteFile(workspaceId: string, path: string): Promise<GitResult<FsDeleteResult>>
  commitFiles(workspaceId: string, hash: string): Promise<GitResult<GitFileChange[]>>
  commitDiff(workspaceId: string, hash: string, path: string): Promise<GitResult<GitDiffSnapshot>>
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
}

export function createGitClient(): GitClient {
  return {
    status: workspaceId => request(`/git/status?workspaceId=${encodeURIComponent(workspaceId)}`),
    identity: workspaceId => request(`/git/identity?workspaceId=${encodeURIComponent(workspaceId)}`),
    initRepo: (workspaceId, input) => request('/git/init', {
      method: 'POST', body: JSON.stringify({ workspaceId, ...input }),
    }),
    diff: (workspaceId, path, staged) => {
      const query = new URLSearchParams({ workspaceId })
      if (path) query.set('path', path)
      if (staged) query.set('staged', '1')
      return request(`/git/diff?${query.toString()}`)
    },
    log: workspaceId => request(`/git/log?workspaceId=${encodeURIComponent(workspaceId)}&limit=80`),
    branches: workspaceId => request(`/git/branches?workspaceId=${encodeURIComponent(workspaceId)}`),
    stage: (workspaceId, paths) => request('/git/stage', {
      method: 'POST', body: JSON.stringify({ workspaceId, paths }),
    }),
    unstage: (workspaceId, paths) => request('/git/unstage', {
      method: 'POST', body: JSON.stringify({ workspaceId, paths }),
    }),
    restore: (workspaceId, paths) => request('/git/restore', {
      method: 'POST', body: JSON.stringify({ workspaceId, paths }),
    }),
    commit: (workspaceId, message, all) => request('/git/commit', {
      method: 'POST', body: JSON.stringify({ workspaceId, message, all: all === true }),
    }),
    generateCommitMessage: (workspaceId, template, options) => readCommitMessageStream(workspaceId, template, options),
    push: (workspaceId, pushMode) => request('/git/push', {
      method: 'POST', body: JSON.stringify({ workspaceId, pushMode }),
    }),
    pull: (workspaceId, pullMode) => request('/git/pull', {
      method: 'POST', body: JSON.stringify({ workspaceId, pullMode }),
    }),
    fetch: workspaceId => request('/git/fetch', {
      method: 'POST', body: JSON.stringify({ workspaceId }),
    }),
    createBranch: (workspaceId, name) => request('/git/create-branch', {
      method: 'POST', body: JSON.stringify({ workspaceId, name }),
    }),
    mergeBranch: (workspaceId, name) => request('/git/merge', {
      method: 'POST', body: JSON.stringify({ workspaceId, name }),
    }),
    switchBranch: (workspaceId, name) => request('/git/switch', {
      method: 'POST', body: JSON.stringify({ workspaceId, name }),
    }),
    renameFile: (workspaceId, from, to) => request('/git/fs/rename', {
      method: 'POST', body: JSON.stringify({ workspaceId, from, to }),
    }),
    deleteFile: (workspaceId, path) => request('/git/fs/delete', {
      method: 'POST', body: JSON.stringify({ workspaceId, path }),
    }),
    commitFiles: (workspaceId, hash) => {
      const query = new URLSearchParams({ workspaceId, hash })
      return request(`/git/commit-files?${query.toString()}`)
    },
    commitDiff: (workspaceId, hash, path) => {
      const query = new URLSearchParams({ workspaceId, hash, path })
      return request(`/git/commit-diff?${query.toString()}`)
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
  }
}