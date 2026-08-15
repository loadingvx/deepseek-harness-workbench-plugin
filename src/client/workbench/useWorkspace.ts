import { useMemo } from 'react'
import type { WorkspaceChoice } from './types.ts'

export function pickWorkspace(
  workspaces: WorkspaceChoice[],
  currentSession?: string,
  recentWorkspaceId?: string,
): WorkspaceChoice | undefined {
  if (currentSession !== undefined) {
    const owned = workspaces.find(item => item.sessionIds?.includes(currentSession))
    if (owned) return owned
  }
  return workspaces.find(item => item.workspaceId === recentWorkspaceId) ?? workspaces[0]
}

export function useWorkspace(
  useSessions: (selector: (state: { current?: string }) => unknown) => unknown,
  useWorkspaces: (selector: (state: {
    items: WorkspaceChoice[]
    recentWorkspaceId?: string
  }) => unknown) => unknown,
): WorkspaceChoice | undefined {
  const current = useSessions(state => state.current) as string | undefined
  const workspaces = useWorkspaces(state => state.items) as WorkspaceChoice[]
  const recentWorkspaceId = useWorkspaces(state => state.recentWorkspaceId) as string | undefined
  return useMemo(
    () => pickWorkspace(workspaces ?? [], current, recentWorkspaceId),
    [current, recentWorkspaceId, workspaces],
  )
}
