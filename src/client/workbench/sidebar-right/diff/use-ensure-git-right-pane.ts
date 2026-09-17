import { useEffect } from 'react'
import {
  liveRememberedDiffPane,
  rememberedGitPaneId,
  splitGitToRight,
} from './dock-panes.ts'
import { getSidebarPaneFace } from './open-git-diff.ts'

/**
 * After git is visible and the dock has been measured, move it onto the pane
 * `split()` creates to the right. A layout-effect is too early: harness
 * `split()` refuses while the room rule still thinks the collapsed column is
 * too narrow.
 */
export function useEnsureGitRightPane(
  gitPaneId: string,
  closeGit: () => void,
): void {
  useEffect(() => {
    // Drop stale memory from a previous session remint before deciding.
    liveRememberedDiffPane()
    if (rememberedGitPaneId() === gitPaneId) return
    let cancelled = false
    const run = (): void => {
      if (cancelled) return
      if (rememberedGitPaneId() === gitPaneId) return
      const sidebar = getSidebarPaneFace()
      if (sidebar === undefined) return
      const right = splitGitToRight(sidebar, gitPaneId)
      if (right === undefined) return
      sidebar.openTab('git', { paneId: right })
      closeGit()
    }
    const inner = requestAnimationFrame(() => {
      requestAnimationFrame(run)
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(inner)
    }
  }, [gitPaneId, closeGit])
}
