export const GRAPH_MIN_H = 96
export const GRAPH_DEFAULT_H = 220
export const GRAPH_HEADER_H = 28
export const GRAPH_GUTTER_H = 5
export const CHANGES_BODY_MIN_H = 72

/** Space that must stay above GRAPH so CHANGES does not get covered. */
export function reservedAboveGraph(chromeHeights: number[]): number {
  const chrome = chromeHeights.reduce((sum, item) => sum + Math.max(0, item), 0)
  return chrome + GRAPH_GUTTER_H + CHANGES_BODY_MIN_H
}

export function measureReservedAboveGraph(host: HTMLElement): number {
  const heights: number[] = []
  for (const node of host.querySelectorAll('[data-git-chrome]')) {
    if (node instanceof HTMLElement) heights.push(node.offsetHeight)
  }
  return reservedAboveGraph(heights)
}

/**
 * Fit a saved GRAPH height into the current sidebar.
 * Never grow past the user's last drag; shrink when the window is too short.
 */
export function clampGraphHeight(desired: number, hostHeight: number, reserved: number): number {
  const host = Number.isFinite(hostHeight) && hostHeight > 0 ? hostHeight : GRAPH_DEFAULT_H + reserved
  const max = Math.max(GRAPH_HEADER_H, host - reserved)
  const min = Math.min(GRAPH_MIN_H, max)
  const raw = Number.isFinite(desired) && desired > 0 ? desired : GRAPH_DEFAULT_H
  return Math.round(Math.min(max, Math.max(min, raw)))
}
