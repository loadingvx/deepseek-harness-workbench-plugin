export type SidebarPaneFace = {
  split: (paneId?: string) => string | undefined
  openTab: (kind: string, options?: { paneId?: string }) => void
  openResource?: (
    address: string,
    options?: { paneId?: string; revealIfOpened?: boolean; kind?: string },
  ) => void
}

/** Left (diff) / right (git) pane ids from the last successful `sidebar.split()`. */
let diffPaneId: string | undefined
let gitPaneId: string | undefined

/** @internal test helper */
export function resetDiffColumnMemory(): void {
  diffPaneId = undefined
  gitPaneId = undefined
}

export function rememberSplitColumns(leftPaneId: string, rightPaneId: string): void {
  diffPaneId = leftPaneId
  gitPaneId = rightPaneId
}

export function rememberedDiffPaneId(): string | undefined {
  return diffPaneId
}

export function rememberedGitPaneId(): string | undefined {
  return gitPaneId
}

/** Live docked pane ids from the official surface (empty when not mounted). */
export function readDockPaneIds(): string[] {
  if (typeof document === 'undefined') return []
  const surface = document.querySelector('[data-dockkit-surface]')
  if (surface === null) return []
  return [...surface.querySelectorAll<HTMLElement>('[data-dockkit-pane]')]
    .map(el => el.dataset.dockkitPane)
    .filter((id): id is string => id !== undefined && id !== '')
}

/** Drop remembered columns when either id is gone (session remint / pane merge). */
export function liveRememberedDiffPane(): string | undefined {
  if (diffPaneId === undefined || gitPaneId === undefined) return undefined
  const live = new Set(readDockPaneIds())
  if (!live.has(diffPaneId) || !live.has(gitPaneId)) {
    resetDiffColumnMemory()
    return undefined
  }
  return diffPaneId
}

/**
 * Split the git pane to the right. Harness `split()` already no-ops when two
 * docked panes exist or the room rule refuses; it returns the new pane id only
 * on success. Never invent pane ids from the DOM.
 */
export function splitGitToRight(sidebar: SidebarPaneFace, fromPaneId: string): string | undefined {
  const right = sidebar.split(fromPaneId) ?? sidebar.split()
  if (right === undefined) return undefined
  rememberSplitColumns(fromPaneId, right)
  return right
}
