/** Shared chrome for the header toggle and the always-mounted workbench host. */

export type WorkbenchMount = 'host' | 'toggle'

export const WORKBENCH_SIDE_TABS = ['files', 'git', 'usage'] as const
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
  editorOpen: false,
  sideOpen: true,
  sideTab: 'files',
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
    enabled: asBool(rec.enabled, base.enabled),
    chatOpen: asBool(rec.chatOpen, base.chatOpen),
    editorOpen: asBool(rec.editorOpen, base.editorOpen),
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
 * Split as soon as the user left workbench on. The blank new-session hero
 * still shows the files/Git sidebar; the editor starts collapsed until
 * the user opens it. Column collapse itself is remembered globally.
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
