import type { GitClient } from '../../api.ts'
import { termIdFromTabId } from '../../../shared/new-file-path.ts'
import { TerminalView } from '../TerminalView.tsx'
import { TERMINAL_TAB_ID } from '../types.ts'
import type { Translate } from '../types.ts'
import { PaneShell } from './PaneShell.tsx'

type WorkspacesFace = {
  items: Array<{
    workspaceId: string
    path: string
    title: string
    sessionIds: string[]
  }>
  recentWorkspaceId?: string
}

export type TerminalPaneProps = {
  client: GitClient
  t: Translate
  sessionId: string
  useWorkspaces: <T>(selector: (state: WorkspacesFace) => T) => T
}

/** Workspace shell hosted in the official right Sidebar. */
export function TerminalPane({ client, t, sessionId, useWorkspaces }: TerminalPaneProps) {
  const workspaceId = useWorkspaces((state) => {
    const items = state.items ?? []
    const owned = items.find(item => item.sessionIds?.includes(sessionId))
    if (owned !== undefined) return owned.workspaceId
    const recent = items.find(item => item.workspaceId === state.recentWorkspaceId)
    return recent?.workspaceId ?? items[0]?.workspaceId
  })
  return (
    <PaneShell>
      <TerminalView
        client={client}
        workspaceId={workspaceId}
        termId={termIdFromTabId(TERMINAL_TAB_ID)}
        t={t}
      />
    </PaneShell>
  )
}
