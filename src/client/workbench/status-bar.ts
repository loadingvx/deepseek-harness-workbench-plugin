import { redactSecrets } from '../../shared/redact.ts'

/** Same height as the conversation stats line under the composer (12px / 20px + 4px). */
export const STATUS_BAR_H = 24

/** Short folder for the status bar. Secrets are stripped first. */
export function shortPath(path: string): string {
  const clean = redactSecrets(path).replace(/\\/g, '/').replace(/\/+$/, '')
  if (clean === '' || clean === '/') return clean === '' ? '—' : '/'
  const parts = clean.split('/').filter(Boolean)
  if (parts.length <= 2) return clean.startsWith('/') ? `/${parts.join('/')}` : parts.join('/')
  return `…/${parts.slice(-2).join('/')}`
}

export function fileName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || path
}

/** Whether the status-bar tab strip can scroll either way. 1px slack avoids flicker. */
export function tabStripOverflow(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
): { canLeft: boolean; canRight: boolean } {
  const left = Math.max(0, scrollLeft)
  return {
    canLeft: left > 1,
    canRight: left + clientWidth < scrollWidth - 1,
  }
}

/** One click jumps about 60% of the visible strip, at least one short tab. */
export function tabStripScrollDelta(clientWidth: number): number {
  return Math.max(80, Math.round(Math.max(0, clientWidth) * 0.6))
}

/** Tabs, the tab list, overflow triangles and the keymap menu belong to an open editor column. */
export function showEditorStatusChrome(editorOpen: boolean): boolean {
  return editorOpen
}

/**
 * Viewport offsets for a status-bar popup menu (portaled + position:fixed).
 *
 * The bar sits inside the bottom strip ([data-git-ide-panel=bottom], which is
 * overflow:hidden and z-index:4). Absolute menus get clipped when that strip is
 * only the 24px bar; fixed-but-in-tree menus still lose to the sticky chat
 * composer. StatusMenu therefore portals to document.body and pins with these
 * offsets: menu bottom 4px above the anchor top, right edges aligned.
 */
export function statusMenuAnchorStyle(
  rect: { right: number; top: number },
  viewport: { width: number; height: number },
): { right: number; bottom: number } {
  return {
    right: Math.max(8, viewport.width - rect.right),
    bottom: Math.max(8, viewport.height - rect.top + 4),
  }
}
