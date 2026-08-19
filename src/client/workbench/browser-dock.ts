export const DEVTOOLS_DOCKS = ['side', 'bottom'] as const
export type DevtoolsDock = (typeof DEVTOOLS_DOCKS)[number]

export const DEVTOOLS_PANES = ['console', 'network', 'application', 'css', 'files', 'page'] as const
export type DevtoolsPane = (typeof DEVTOOLS_PANES)[number]

export const DEFAULT_DEVTOOLS_DOCK: DevtoolsDock = 'side'
export const DEFAULT_DEVTOOLS_PANE: DevtoolsPane = 'console'
export const DEVTOOLS_DOCK_KEY = 'dsh-workbench-devtools-dock-v1'
export const DEVTOOLS_OPEN_KEY = 'dsh-workbench-devtools-open-v1'
export const DEVTOOLS_PANE_KEY = 'dsh-workbench-devtools-pane-v1'

export function isDevtoolsDock(value: string): value is DevtoolsDock {
  return (DEVTOOLS_DOCKS as readonly string[]).includes(value)
}

export function isDevtoolsPane(value: string): value is DevtoolsPane {
  return (DEVTOOLS_PANES as readonly string[]).includes(value)
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch { /* private mode / quota */ }
}

export function loadDevtoolsDock(): DevtoolsDock {
  const raw = readStorage(DEVTOOLS_DOCK_KEY)
  return raw !== null && isDevtoolsDock(raw) ? raw : DEFAULT_DEVTOOLS_DOCK
}

export function saveDevtoolsDock(dock: DevtoolsDock): void {
  writeStorage(DEVTOOLS_DOCK_KEY, isDevtoolsDock(dock) ? dock : DEFAULT_DEVTOOLS_DOCK)
}

export function loadDevtoolsOpen(): boolean {
  return readStorage(DEVTOOLS_OPEN_KEY) === '1'
}

export function saveDevtoolsOpen(open: boolean): void {
  writeStorage(DEVTOOLS_OPEN_KEY, open ? '1' : '0')
}

export function loadDevtoolsPane(): DevtoolsPane {
  const raw = readStorage(DEVTOOLS_PANE_KEY)
  return raw !== null && isDevtoolsPane(raw) ? raw : DEFAULT_DEVTOOLS_PANE
}

export function saveDevtoolsPane(pane: DevtoolsPane): void {
  writeStorage(DEVTOOLS_PANE_KEY, isDevtoolsPane(pane) ? pane : DEFAULT_DEVTOOLS_PANE)
}

/** Bottom strip shows when the terminal is there, or DevUtils is docked to the bottom and open. */
export function bottomChromeVisible(
  termDock: 'tab' | 'bottom',
  termShown: boolean,
  devtools: { dock: DevtoolsDock; open: boolean },
): boolean {
  if (termDock === 'bottom' && termShown) return true
  return devtools.dock === 'bottom' && devtools.open
}
