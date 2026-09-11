import type { GitClient } from '../../api.ts'
import { ControlPlanePanel } from '../ControlPlanePanel.tsx'
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

export type ControlPlanePaneProps = {
  client: GitClient
  t: Translate
  sessionId: string
  useSession?: <T>(selector: (state: {
    nodes?: readonly unknown[]
    partial?: unknown
    running?: boolean
    runningCalls?: readonly unknown[]
  }) => T) => T
  useWorkspaces: <T>(selector: (state: WorkspacesFace) => T) => T
}

/** Agent / model control plane hosted in the official right Sidebar. */
export function ControlPlanePane({
  client, t, sessionId, useSession, useWorkspaces,
}: ControlPlanePaneProps) {
  const workspaceId = useWorkspaces((state) => {
    const items = state.items ?? []
    const owned = items.find(item => item.sessionIds?.includes(sessionId))
    if (owned !== undefined) return owned.workspaceId
    const recent = items.find(item => item.workspaceId === state.recentWorkspaceId)
    return recent?.workspaceId ?? items[0]?.workspaceId
  })
  return (
    <PaneShell>
      <ControlPlanePanel
        client={client}
        workspaceId={workspaceId}
        sessionId={sessionId}
        useSession={useSession}
        t={t}
      />
    </PaneShell>
  )
}
