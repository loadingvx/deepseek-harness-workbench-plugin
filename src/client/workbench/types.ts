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

export const TERMINAL_TAB_ID = 'terminal:main'

export interface FileTab {
  id: string
  kind: 'file' | 'diff' | 'terminal'
  path: string
  title: string
  staged?: boolean
}

export function createTerminalTab(): FileTab {
  return { id: TERMINAL_TAB_ID, kind: 'terminal', path: '', title: '终端' }
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
