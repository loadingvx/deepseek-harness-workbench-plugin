import { fail } from '../shared/errors.ts'
import type {
  FsFileSnapshot, FsListSnapshot, FsWriteResult,
  GitBranchInfo, GitCommitMessage, GitCommitResult, GitDiffSnapshot, GitLogEntry, GitResult,
  GitStatusSnapshot, GitSwitchResult,
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
  switchBranch(workspaceId: string, name: string): Promise<GitResult<GitSwitchResult>>
  listDir(workspaceId: string, path?: string): Promise<GitResult<FsListSnapshot>>
  readFile(workspaceId: string, path: string): Promise<GitResult<FsFileSnapshot>>
  writeFile(workspaceId: string, path: string, content: string): Promise<GitResult<FsWriteResult>>
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
    switchBranch: (workspaceId, name) => request('/git/switch', {
      method: 'POST', body: JSON.stringify({ workspaceId, name }),
    }),
    listDir: (workspaceId, path) => {
      const query = new URLSearchParams({ workspaceId })
      if (path) query.set('path', path)
      return request(`/git/fs/list?${query.toString()}`)
    },
    readFile: (workspaceId, path) => {
      const query = new URLSearchParams({ workspaceId, path })
      return request(`/git/fs/read?${query.toString()}`)
    },
    writeFile: (workspaceId, path, content) => request('/git/fs/write', {
      method: 'POST', body: JSON.stringify({ workspaceId, path, content }),
    }),
  }
}
