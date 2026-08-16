/** Shared chrome for the header toggle and the always-mounted workbench host. */

export type WorkbenchMount = 'host' | 'toggle'

export interface WorkbenchChrome {
  enabled: boolean
  chatOpen: boolean
  editorOpen: boolean
  sideOpen: boolean
}

const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function freshChrome(): WorkbenchChrome {
  return { enabled: true, chatOpen: true, editorOpen: true, sideOpen: true }
}

let chrome: WorkbenchChrome = freshChrome()

export function defaultWorkbenchChrome(): WorkbenchChrome {
  return freshChrome()
}

export function getWorkbenchChrome(): WorkbenchChrome {
  return chrome
}

export function subscribeWorkbenchChrome(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function patchWorkbenchChrome(patch: Partial<WorkbenchChrome>): void {
  chrome = { ...chrome, ...patch }
  emit()
}

/** New session (or session switch): open the full three-column workbench. */
export function resetWorkbenchChrome(): void {
  chrome = freshChrome()
  emit()
}

/**
 * Split as soon as the user left workbench on. The blank new-session hero
 * must not hide the editor / Git sidebar — that page is exactly when people
 * expect the plugin to appear.
 */
export function shouldSplitWorkbench(enabled: boolean, _blank = false): boolean {
  return enabled
}

export function workbenchShowsToggle(mount: WorkbenchMount): boolean {
  return mount === 'toggle'
}

export function workbenchOwnsPortal(mount: WorkbenchMount): boolean {
  return mount === 'host'
}
