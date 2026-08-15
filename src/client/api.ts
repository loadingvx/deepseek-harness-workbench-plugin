import { fail } from '../shared/errors.ts'
import type {
  ExternalEditorId, ExternalEditorsSnapshot, ExternalOpenResult,
  FsFileSnapshot, FsListSnapshot, FsSearchSnapshot, FsWriteResult,
  GitBranchInfo, GitCommitMessage, GitCommitResult, GitCreateBranchResult, GitDiffSnapshot,
  GitFetchResult, GitLogEntry, GitMergeResult, GitPullResult, GitPushResult, GitResult,
  GitStatusSnapshot, GitSwitchResult, PluginUpdateSnapshot,
} from '../shared/types.ts'

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

export interface GitClient {
  status(workspaceId: string): Promise<GitResult<GitStatusSnapshot>>
  diff(workspaceId: string, path?: string, staged?: boolean): Promise<GitResult<GitDiffSnapshot>>
  log(workspaceId: string): Promise<GitResult<GitLogEntry[]>>
  branches(workspaceId: string): Promise<GitResult<GitBranchInfo[]>>
  stage(workspaceId: string, paths: string[]): Promise<GitResult<{ done: boolean }>>
  unstage(workspaceId: string, paths: string[]): Promise<GitResult<{ done: boolean }>>
  commit(workspaceId: string, message: string, all?: boolean): Promise<GitResult<GitCommitResult>>
  generateCommitMessage(workspaceId: string): Promise<GitResult<GitCommitMessage>>
  push(workspaceId: string): Promise<GitResult<GitPushResult>>
  pull(workspaceId: string): Promise<GitResult<GitPullResult>>
  fetch(workspaceId: string): Promise<GitResult<GitFetchResult>>
  createBranch(workspaceId: string, name: string): Promise<GitResult<GitCreateBranchResult>>
  mergeBranch(workspaceId: string, name: string): Promise<GitResult<GitMergeResult>>
  switchBranch(workspaceId: string, name: string): Promise<GitResult<GitSwitchResult>>
  listDir(workspaceId: string, path?: string): Promise<GitResult<FsListSnapshot>>
  searchFiles(workspaceId: string, query: string, hidden?: boolean): Promise<GitResult<FsSearchSnapshot>>
  readFile(workspaceId: string, path: string): Promise<GitResult<FsFileSnapshot>>
  writeFile(workspaceId: string, path: string, content: string): Promise<GitResult<FsWriteResult>>
  listEditors(): Promise<GitResult<ExternalEditorsSnapshot>>
  openExternal(workspaceId: string, path?: string, app?: ExternalEditorId): Promise<GitResult<ExternalOpenResult>>
  writeTerm(workspaceId: string, data: string, termId?: string): Promise<GitResult<{ ok: true }>>
  resizeTerm(workspaceId: string, cols: number, rows: number, termId?: string): Promise<GitResult<{ ok: true; cols: number; rows: number }>>
  interruptTerm(workspaceId: string, termId?: string): Promise<GitResult<{ ok: true }>>
  restartTerm(workspaceId: string, cols?: number, rows?: number, termId?: string): Promise<GitResult<{ cwd: string; shell: string; cols: number; rows: number }>>
  closeTerm(workspaceId: string, termId?: string): Promise<GitResult<{ ok: true }>>
  pluginUpdate(): Promise<GitResult<PluginUpdateSnapshot>>
}

export function createGitClient(): GitClient {
  return {
    status: workspaceId => request(`/git/status?workspaceId=${encodeURIComponent(workspaceId)}`),
    diff: (workspaceId, path, staged) => {
      const query = new URLSearchParams({ workspaceId })
      if (path) query.set('path', path)
      if (staged) query.set('staged', '1')
      return request(`/git/diff?${query.toString()}`)
    },
    log: workspaceId => request(`/git/log?workspaceId=${encodeURIComponent(workspaceId)}&limit=40`),
    branches: workspaceId => request(`/git/branches?workspaceId=${encodeURIComponent(workspaceId)}`),
    stage: (workspaceId, paths) => request('/git/stage', {
      method: 'POST', body: JSON.stringify({ workspaceId, paths }),
    }),
    unstage: (workspaceId, paths) => request('/git/unstage', {
      method: 'POST', body: JSON.stringify({ workspaceId, paths }),
    }),
    commit: (workspaceId, message, all) => request('/git/commit', {
      method: 'POST', body: JSON.stringify({ workspaceId, message, all: all === true }),
    }),
    generateCommitMessage: workspaceId => request('/git/commit-message', {
      method: 'POST', body: JSON.stringify({ workspaceId }),
    }),
    push: workspaceId => request('/git/push', {
      method: 'POST', body: JSON.stringify({ workspaceId }),
    }),
    pull: workspaceId => request('/git/pull', {
      method: 'POST', body: JSON.stringify({ workspaceId }),
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
  }
}
