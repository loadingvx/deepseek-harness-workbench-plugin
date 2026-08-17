/** Height and compact-mode rules for the usage panel when pinned in the left nav. */

export const NAV_USAGE_H_KEY = 'dsh-workbench-nav-usage-h'
export const NAV_USAGE_HEAD_H = 36
export const NAV_USAGE_MIN_H = 132
export const NAV_USAGE_DEFAULT_H = 240
export const NAV_USAGE_COMPACT_MIN_H = 96
export const NAV_USAGE_COMPACT_W = 88
/** Session list / workspace tree above the footer must keep at least this much. */
export const NAV_SESSION_RESERVE = 200

export function isNavUsageCompact(width: number): boolean {
  return Number.isFinite(width) && width > 0 && width < NAV_USAGE_COMPACT_W
}

/**
 * Fit a saved usage height into the left sidebar.
 * Never grow past the last drag; shrink when the window is too short so the
 * session list above Settings is not covered.
 */
export function clampNavUsageHeight(
  desired: number,
  sidebarHeight: number,
  settingsHeight: number,
  compact = false,
): number {
  const reserved = Math.max(0, settingsHeight) + NAV_SESSION_RESERVE
  const column = Number.isFinite(sidebarHeight) && sidebarHeight > 0
    ? sidebarHeight
    : NAV_USAGE_DEFAULT_H + reserved
  const floor = compact ? NAV_USAGE_COMPACT_MIN_H : NAV_USAGE_HEAD_H
  const max = Math.max(floor, column - reserved)
  const preferredMin = compact ? NAV_USAGE_COMPACT_MIN_H : NAV_USAGE_MIN_H
  const min = Math.min(preferredMin, max)
  const raw = Number.isFinite(desired) && desired > 0 ? desired : NAV_USAGE_DEFAULT_H
  return Math.round(Math.min(max, Math.max(min, raw)))
}

export function readNavUsageHeight(): number {
  try {
    const raw = Number(localStorage.getItem(NAV_USAGE_H_KEY))
    if (Number.isFinite(raw) && raw >= 80) return Math.round(raw)
  } catch { /* private mode */ }
  return NAV_USAGE_DEFAULT_H
}

export function writeNavUsageHeight(value: number): void {
  try {
    localStorage.setItem(NAV_USAGE_H_KEY, String(Math.round(value)))
  } catch { /* ignore */ }
}

/** Default indent so pin-mode copy lines up with the workspace list above. */
export const NAV_CONTENT_PAD = 12

export function clampNavContentPad(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return NAV_CONTENT_PAD
  return Math.round(Math.min(24, Math.max(8, n)))
}

export function navHostBleedStyle(
  sidebarWidth: number,
  sidebarLeft: number,
  contentLeft: number,
): { marginLeft: string; width: string; maxWidth: string } | null {
  if (!Number.isFinite(sidebarWidth) || sidebarWidth <= 0) return null
  if (!Number.isFinite(sidebarLeft) || !Number.isFinite(contentLeft)) return null
  const shift = Math.round(contentLeft - sidebarLeft)
  const width = `${Math.round(sidebarWidth)}px`
  return {
    marginLeft: `${-shift}px`,
    width,
    maxWidth: width,
  }
}
