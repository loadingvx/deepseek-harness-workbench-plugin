import { gitCommitDiffAddressOf, gitDiffAddressOf } from './address.ts'
import {
  liveRememberedDiffPane,
  rememberedGitPaneId,
  resetDiffColumnMemory,
  splitGitToRight,
  type SidebarPaneFace,
} from './dock-panes.ts'
import { WORKBENCH_DIFF_KIND } from '../ids.ts'

let sidebarFace: SidebarPaneFace | undefined

export function bindSidebarDiffFace(next: SidebarPaneFace): () => void {
  sidebarFace = next
  return () => {
    if (sidebarFace === next) sidebarFace = undefined
  }
}

export function getSidebarPaneFace(): SidebarPaneFace | undefined {
  return sidebarFace
}

/**
 * Open a git-diff resource by naming the type (skips glob ranking).
 * Never pass a stale paneId — that throws `layout: unknown node …` and kills the click.
 */
function openDiff(address: string, paneId?: string): void {
  const sidebar = sidebarFace
  if (sidebar?.openResource === undefined) return
  const options = {
    kind: WORKBENCH_DIFF_KIND,
    revealIfOpened: true as const,
    ...(paneId === undefined ? {} : { paneId }),
  }
  try {
    sidebar.openResource(address, options)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (paneId !== undefined && /unknown node/.test(message)) {
      resetDiffColumnMemory()
      sidebar.openResource(address, { kind: WORKBENCH_DIFF_KIND, revealIfOpened: true })
      return
    }
    throw error
  }
}

/**
 * After a successful split: left = original pane (diff), right = new pane (git).
 * If harness refuses to split, the diff still opens as a tab in the active pane.
 */
function openInDiffColumn(address: string, gitPaneId: string, closeGit: () => void): void {
  const sidebar = sidebarFace
  const knownDiff = liveRememberedDiffPane()
  const knownGit = rememberedGitPaneId()

  if (knownDiff !== undefined && knownGit === gitPaneId && knownDiff !== gitPaneId) {
    openDiff(address, knownDiff)
    return
  }

  const right = sidebar === undefined ? undefined : splitGitToRight(sidebar, gitPaneId)
  // Open into the current git pane (left after a successful split). Omit paneId
  // when split failed — active dock pane is fine and avoids stale ids.
  openDiff(address, right === undefined ? undefined : gitPaneId)
  if (right === undefined || sidebar === undefined) return
  sidebar.openTab('git', { paneId: right })
  closeGit()
}

export function openGitDiffInSidebar(input: {
  workspaceId: string
  path: string
  staged: boolean
  repo?: string
  gitPaneId: string
  closeGit: () => void
}): void {
  openInDiffColumn(gitDiffAddressOf(input), input.gitPaneId, input.closeGit)
}

export function openGitCommitDiffInSidebar(input: {
  workspaceId: string
  path: string
  hash: string
  repo?: string
  gitPaneId: string
  closeGit: () => void
}): void {
  openInDiffColumn(gitCommitDiffAddressOf(input), input.gitPaneId, input.closeGit)
}
