import type { GitClient } from '../../api.ts'
import { GitSidebar } from '../GitSidebar.tsx'
import { openWorkbenchCommitDiff, openWorkbenchDiff } from '../workbench-actions.ts'
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

export type GitPaneProps = {
  client: GitClient
  t: Translate
  sessionId: string
  useWorkspaces: <T>(selector: (state: WorkspacesFace) => T) => T
}

export function GitPane({ client, t, sessionId, useWorkspaces }: GitPaneProps) {
  const workspaceId = useWorkspaces((state) => {
    const items = state.items ?? []
    const owned = items.find(item => item.sessionIds?.includes(sessionId))
    if (owned !== undefined) return owned.workspaceId
    const recent = items.find(item => item.workspaceId === state.recentWorkspaceId)
    return recent?.workspaceId ?? items[0]?.workspaceId
  })
  return (
    <PaneShell>
      <GitSidebar
        client={client}
        workspaceId={workspaceId}
        onOpenDiff={openWorkbenchDiff}
        onOpenCommitDiff={openWorkbenchCommitDiff}
        t={t}
      />
    </PaneShell>
  )
}
