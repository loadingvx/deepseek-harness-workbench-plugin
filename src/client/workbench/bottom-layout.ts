import { clamp } from './column-layout.ts'
import { STATUS_BAR_H } from './status-bar.ts'
import { TERMINAL_TAB_ID, type FileTab } from './types.ts'

/**
 * Terminal seating: editor tab, or a bottom panel stacked with the status bar.
 * Status-bar width always follows the terminal:
 *   tab    → editor + sidebar (chat stays full height)
 *   bottom → the chosen span (default: chat + editor + sidebar)
 */
export const TERM_DOCKS = ['tab', 'bottom'] as const
export type TermDock = (typeof TERM_DOCKS)[number]

/** How far the bottom StatusBar stretches across the workbench host. */
export const BOTTOM_SPANS = ['chat', 'side', 'full'] as const
export type BottomSpan = (typeof BOTTOM_SPANS)[number]

export const DEFAULT_TERM_DOCK: TermDock = 'bottom'
export const DEFAULT_BOTTOM_SPAN: BottomSpan = 'full'
export const BOTTOM_TOOLS = ['terminal', 'devtools'] as const
export type BottomTool = (typeof BOTTOM_TOOLS)[number]
export const DEFAULT_BOTTOM_TOOL: BottomTool = 'terminal'
export const BOTTOM_TOOL_KEY = 'dsh-workbench-bottom-tool-v1'
export const BOTTOM_DEVTOOLS_TAB_ID = 'devtools:panel'

export const TERM_DOCK_KEY = 'dsh-workbench-term-dock-v2'
/** v3: chat | side | full (replaces editor | right | full). */
export const BOTTOM_SPAN_KEY = 'dsh-workbench-bottom-span-v3'
export const TERM_H_KEY = 'dsh-workbench-term-h'
export const TERM_PANEL_OPEN_KEY = 'dsh-workbench-term-panel-open'

export const TERM_MIN_H = 96
export const TERM_DEFAULT_H = 220
/** Collapsed bottom panel: tab strip only, so the chevron can open it again. */
export const TERM_HEADER_H = 28
/** Leave room for chat/editor above the panel. */
export const TERM_MAX_RATIO = 0.55
export const TERM_ABOVE_MIN = 120

export function isTermDock(value: string): value is TermDock {
  return (TERM_DOCKS as readonly string[]).includes(value)
}

export function isBottomSpan(value: string): value is BottomSpan {
  return (BOTTOM_SPANS as readonly string[]).includes(value)
}

export function isBottomTool(value: string): value is BottomTool {
  return (BOTTOM_TOOLS as readonly string[]).includes(value)
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

export function loadTermDock(): TermDock {
  const raw = readStorage(TERM_DOCK_KEY)
  return raw !== null && isTermDock(raw) ? raw : DEFAULT_TERM_DOCK
}

export function saveTermDock(dock: TermDock): void {
  writeStorage(TERM_DOCK_KEY, isTermDock(dock) ? dock : DEFAULT_TERM_DOCK)
}

export function loadBottomSpan(): BottomSpan {
  const raw = readStorage(BOTTOM_SPAN_KEY)
  if (raw !== null && isBottomSpan(raw)) return raw
  // Migrate retired v2 keys written before the editor column was removed.
  const legacy = readStorage('dsh-workbench-bottom-span-v2')
  if (legacy === 'editor') return 'chat'
  if (legacy === 'right') return 'side'
  if (legacy === 'full') return 'full'
  return DEFAULT_BOTTOM_SPAN
}

export function saveBottomSpan(span: BottomSpan): void {
  writeStorage(BOTTOM_SPAN_KEY, isBottomSpan(span) ? span : DEFAULT_BOTTOM_SPAN)
}

export function loadTermPanelOpen(): boolean {
  const raw = readStorage(TERM_PANEL_OPEN_KEY)
  if (raw === '0') return false
  if (raw === '1') return true
  return true
}

export function saveTermPanelOpen(open: boolean): void {
  writeStorage(TERM_PANEL_OPEN_KEY, open ? '1' : '0')
}

export function loadBottomTool(): BottomTool {
  const raw = readStorage(BOTTOM_TOOL_KEY)
  return raw !== null && isBottomTool(raw) ? raw : DEFAULT_BOTTOM_TOOL
}

export function saveBottomTool(tool: BottomTool): void {
  writeStorage(BOTTOM_TOOL_KEY, isBottomTool(tool) ? tool : DEFAULT_BOTTOM_TOOL)
}

/** Bottom dock always keeps a grid row; collapse only shrinks it to the tab strip. */
export function termPanelVisible(dock: TermDock, _panelOpen?: boolean): boolean {
  return dock === 'bottom'
}

/**
 * A SideDock-only bottom strip needs the legacy side column open.
 * Fall back to full width so the bar never becomes an unreadably narrow rail.
 */
export function effectiveBottomSpan(
  span: BottomSpan,
  open: { side: boolean },
): BottomSpan {
  if (span === 'side' && !open.side) return 'full'
  return span
}

/** Resolved StatusBar span for the current chrome. */
export function layoutBottomSpan(
  _dock: TermDock,
  span: BottomSpan,
  open: { editor?: boolean; side: boolean },
): BottomSpan {
  return effectiveBottomSpan(span, { side: open.side })
}

export function bottomSpanDisabledReason(
  span: BottomSpan,
  open: { editor?: boolean; side: boolean },
  t: (key: string) => string,
  _dock: TermDock = 'bottom',
): string | null {
  if (span === 'side' && !open.side) return t('layout.span.sideDisabled')
  return null
}

/** Space that must stay above the terminal so chat/editor do not collapse. */
export function reservedAboveTerm(_hostHeight: number): number {
  return STATUS_BAR_H + TERM_ABOVE_MIN
}

export function clampTermHeight(desired: number, hostHeight: number, reserved: number): number {
  const host = Number.isFinite(hostHeight) && hostHeight > 0 ? hostHeight : TERM_DEFAULT_H + reserved
  const maxByHost = Math.max(TERM_MIN_H, host - reserved)
  const maxByRatio = Math.max(TERM_MIN_H, Math.round(host * TERM_MAX_RATIO))
  const max = Math.max(TERM_MIN_H, Math.min(maxByHost, maxByRatio))
  const min = Math.min(TERM_MIN_H, max)
  const raw = Number.isFinite(desired) && desired > 0 ? desired : TERM_DEFAULT_H
  return Math.round(clamp(raw, min, max))
}

export function isTerminalTab(tab: FileTab): boolean {
  return tab.kind === 'terminal'
}

export function fileTabsOf(tabs: readonly FileTab[]): FileTab[] {
  return tabs.filter(tab => tab.kind !== 'terminal')
}

export function termTabsOf(tabs: readonly FileTab[]): FileTab[] {
  return tabs.filter(tab => tab.kind === 'terminal')
}

/** Prefer `wanted` when it still exists in `tabs`; otherwise the last remaining tab. */
export function pickTabId(tabs: readonly FileTab[], wanted: string | null | undefined): string | null {
  if (wanted !== undefined && wanted !== null && tabs.some(tab => tab.id === wanted)) return wanted
  return tabs[tabs.length - 1]?.id ?? null
}

/**
 * Status-bar chips.
 * Bottom terminal has its own tab strip; duplicating files there is noise.
 */
export function statusBarVisibleTabs(
  tabs: readonly FileTab[],
  opts: { editorOpen: boolean; termDock: TermDock },
): FileTab[] {
  if (opts.termDock === 'bottom') return []
  if (!opts.editorOpen) return []
  return [...tabs]
}

/** Terminal the user is looking at: the focused tab if it is a terminal, else the last one. */
export function visibleTermId(
  tabs: readonly FileTab[],
  activeId: string | null | undefined,
  lastTermId: string,
): string {
  const focused = activeId !== undefined && activeId !== null
    ? tabs.find(tab => tab.id === activeId)
    : undefined
  const wanted = focused?.kind === 'terminal' ? focused.id : lastTermId
  return pickTabId(termTabsOf(tabs), wanted) ?? TERMINAL_TAB_ID
}
