/** Shared chrome for the header toggle and the always-mounted workbench host. */

export type WorkbenchMount = 'host' | 'toggle'

export const WORKBENCH_SIDE_TABS = ['review', 'settings', 'devtools'] as const
export type SideTab = (typeof WORKBENCH_SIDE_TABS)[number]

export interface WorkbenchChrome {
  enabled: boolean
  chatOpen: boolean
  editorOpen: boolean
  sideOpen: boolean
  sideTab: SideTab
}

export const WORKBENCH_CHROME_KEY = 'dsh-workbench-chrome'

export const DEFAULT_WORKBENCH_CHROME: WorkbenchChrome = {
  enabled: true,
  chatOpen: true,
  // Editor column removed — files / terminal / browser live in official ui-sidebar-right.
  editorOpen: false,
  sideOpen: false,
  sideTab: 'settings',
}

const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function freshChrome(): WorkbenchChrome {
  return { ...DEFAULT_WORKBENCH_CHROME }
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function isSideTab(value: unknown): value is SideTab {
  return typeof value === 'string' && (WORKBENCH_SIDE_TABS as readonly string[]).includes(value)
}

/** Fill missing / invalid fields with factory defaults. */
export function parseWorkbenchChrome(raw: unknown): WorkbenchChrome {
  const base = freshChrome()
  if (typeof raw !== 'object' || raw === null) return base
  const rec = raw as Record<string, unknown>
  return {
    // Header toggle removed — StatusBar / host chrome stay on permanently.
    enabled: true,
    chatOpen: asBool(rec.chatOpen, base.chatOpen),
    // Always collapse the retired workbench editor column.
    editorOpen: false,
    sideOpen: asBool(rec.sideOpen, base.sideOpen),
    sideTab: isSideTab(rec.sideTab) ? rec.sideTab : base.sideTab,
  }
}

export function readWorkbenchChrome(): WorkbenchChrome {
  try {
    const text = localStorage.getItem(WORKBENCH_CHROME_KEY)
    if (text === null || text.trim() === '') return freshChrome()
    return parseWorkbenchChrome(JSON.parse(text) as unknown)
  } catch {
    return freshChrome()
  }
}

export function writeWorkbenchChrome(next: WorkbenchChrome): void {
  try {
    localStorage.setItem(WORKBENCH_CHROME_KEY, JSON.stringify(parseWorkbenchChrome(next)))
  } catch { /* private mode / quota */ }
}

let chrome: WorkbenchChrome = readWorkbenchChrome()

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
  chrome = parseWorkbenchChrome({ ...chrome, ...patch })
  writeWorkbenchChrome(chrome)
  emit()
}

/** Re-read from storage (page reload / other tab). */
export function hydrateWorkbenchChrome(): WorkbenchChrome {
  chrome = readWorkbenchChrome()
  emit()
  return chrome
}

/** Test helper: restore factory defaults. Production layout is persisted and must not reset on a new session. */
export function resetWorkbenchChrome(): void {
  chrome = freshChrome()
  writeWorkbenchChrome(chrome)
  emit()
}

/**
 * Host chrome (StatusBar) is always mounted. Column collapse is remembered
 * globally; the legacy SideDock starts collapsed (official right Sidebar).
 */
export function shouldSplitWorkbench(_enabled = true, _blank = false): boolean {
  return true
}

/** Header 「工作台」toggle was removed; keep the helper for mount typing. */
export function workbenchShowsToggle(_mount: WorkbenchMount): boolean {
  return false
}

export function workbenchOwnsPortal(mount: WorkbenchMount): boolean {
  return mount === 'host'
}
