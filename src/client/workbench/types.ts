import type { GitClient } from '../api.ts'
import type { GitFail } from '../../shared/types.ts'
import type { WorkbenchMount } from './auto-open.ts'
import type { FileRefApi } from './file-ref-client.ts'

export type Translate = (key: string, vars?: Record<string, string | number>) => string

export interface WorkspaceChoice {
  workspaceId: string
  path: string
  title: string
  sessionIds: string[]
}

export interface WorkbenchInjected {
  client: GitClient
  /** `host` portals the IDE; `toggle` is the header button. Default `toggle`. */
  mount?: WorkbenchMount
  /** Official composer file chips. Host mount only. */
  fileRefs?: FileRefApi
}

export const TERMINAL_TAB_ID = 'terminal:main'

export interface FileTab {
  id: string
  kind: 'file' | 'preview' | 'diff' | 'commitDiff' | 'terminal'
  path: string
  title: string
  /** Direct-render kind for preview tabs (image / table). */
  preview?: 'image' | 'table'
  staged?: boolean
  /** Commit hash for commitDiff tabs. */
  hash?: string
  /** Nearby git repo id for diff / commitDiff tabs. */
  repo?: string
  /** 1 = 主终端；2+ = 额外终端。展示文案用 terminalTabLabel，不要写死中文。 */
  termIndex?: number
  /** Open file matches .gitignore and is not tracked. */
  ignored?: boolean
}

export function createTerminalTab(id = TERMINAL_TAB_ID, termIndex = 1): FileTab {
  return { id, kind: 'terminal', path: '', title: '', termIndex }
}

let terminalTabSeq = 0

export function nextTerminalTab(tabs: FileTab[]): FileTab {
  const count = tabs.filter(tab => tab.kind === 'terminal').length
  const n = count + 1
  // Date.now() alone can collide when tabs are created in the same millisecond,
  // which would share one termId (one PTY session) across two tabs.
  terminalTabSeq += 1
  return createTerminalTab(`terminal:${Date.now().toString(36)}-${terminalTabSeq.toString(36)}`, n)
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