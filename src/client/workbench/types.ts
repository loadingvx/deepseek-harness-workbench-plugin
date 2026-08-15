import type { GitClient } from '../api.ts'
import type { GitFail } from '../../shared/types.ts'

export type Translate = (key: string, vars?: Record<string, string | number>) => string

export interface WorkspaceChoice {
  workspaceId: string
  path: string
  title: string
  sessionIds: string[]
}

export interface WorkbenchInjected {
  client: GitClient
}

export interface FileTab {
  id: string
  kind: 'file' | 'diff'
  path: string
  title: string
  staged?: boolean
}

export interface FileBuffer {
  path: string
  original: string
  draft: string
  language: string
}

export interface FailBanner {
  fail: GitFail
  onRetry?: () => void
}
