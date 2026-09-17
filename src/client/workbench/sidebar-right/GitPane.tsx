import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GitClient } from '../../api.ts'
import { GitSidebar } from '../GitSidebar.tsx'
import { openGitCommitDiffInSidebar, openGitDiffInSidebar } from './diff/open-git-diff.ts'
import { useEnsureGitRightPane } from './diff/use-ensure-git-right-pane.ts'
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

export type GitPaneProps =
  PropsRuntime<'sidebar.right.pane.tab'>
  & {
    client: GitClient
    t: Translate
    sessionId: string
    useWorkspaces: <T>(selector: (state: WorkspacesFace) => T) => T
  }

export function GitPane({ client, t, sessionId, useWorkspaces, useTabInfo }: GitPaneProps) {
  const { tab, panel } = useTabInfo()
  useEnsureGitRightPane(panel.id, tab.actions.close)
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
        onOpenDiff={(path, staged, repo) => {
          if (workspaceId === undefined) return
          openGitDiffInSidebar({
            workspaceId,
            path,
            staged,
            repo,
            gitPaneId: panel.id,
            closeGit: tab.actions.close,
          })
        }}
        onOpenCommitDiff={(hash, path, repo) => {
          if (workspaceId === undefined) return
          openGitCommitDiffInSidebar({
            workspaceId,
            hash,
            path,
            repo,
            gitPaneId: panel.id,
            closeGit: tab.actions.close,
          })
        }}
        t={t}
      />
    </PaneShell>
  )
}
