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
  kind: 'file' | 'diff' | 'commitDiff' | 'terminal'
  path: string
  title: string
  staged?: boolean
  /** Commit hash for commitDiff tabs. */
  hash?: string
  /** 1 = 主终端；2+ = 额外终端。展示文案用 terminalTabLabel，不要写死中文。 */
  termIndex?: number
}

export function createTerminalTab(id = TERMINAL_TAB_ID, termIndex = 1): FileTab {
  return { id, kind: 'terminal', path: '', title: '', termIndex }
}

export function nextTerminalTab(tabs: FileTab[]): FileTab {
  const count = tabs.filter(tab => tab.kind === 'terminal').length
  const n = count + 1
  return createTerminalTab(`terminal:${Date.now()}`, n)
}

export function terminalTabLabel(tab: FileTab, t: Translate): string {
  const n = tab.termIndex ?? 0
  return n > 1 ? t('term.tabN', { n }) : t('term.tab')
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