/**
 * Bridge from workbench UI to the official right Sidebar controller.
 * `apply()` binds the live face; panes and StatusBar call through here so they
 * never need a cordis Context handle.
 */
export type OfficialSidebarKind =
  | 'git'
  | 'usage'
  | 'ultra-slash'
  | 'files'
  | 'terminal'
  | 'browser'
  | 'control-plane'

type OfficialSidebarFace = {
  openTab: (kind: string) => void
}

let face: OfficialSidebarFace | undefined

export function bindOfficialSidebar(next: OfficialSidebarFace): () => void {
  face = next
  return () => {
    if (face === next) face = undefined
  }
}

/** Open (or focus) a page tab in the official right Sidebar; expands the column. */
export function openOfficialSidebarTab(kind: OfficialSidebarKind): void {
  try {
    face?.openTab(kind)
  } catch {
    // No mounted session surface yet — ignore.
  }
}
