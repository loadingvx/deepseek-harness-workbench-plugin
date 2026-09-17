/** Sibling tab ids in the same docked pane, left → right strip order. */
export function siblingTabIds(tabId: string): string[] {
  if (typeof document === 'undefined') return []
  const chip = document.querySelector(`[data-dockkit-tab="${CSS.escape(tabId)}"]`)
  const pane = chip?.closest('[data-dockkit-pane]')
  if (pane === null || pane === undefined) return []
  return [...pane.querySelectorAll<HTMLElement>('[data-dockkit-tab]')]
    .map(el => el.dataset.dockkitTab)
    .filter((id): id is string => id !== undefined && id !== '')
}

/** True when the kit exposes a close control for this tab. */
export function tabHasCloseControl(tabId: string): boolean {
  if (typeof document === 'undefined') return false
  const chip = document.querySelector(`[data-dockkit-tab="${CSS.escape(tabId)}"]`)
  return chip?.querySelector('[data-dockkit-tab-close]') !== null
}

export type TabCloseTargets = {
  others: string[]
  all: string[]
  left: string[]
  right: string[]
}

/** Closable siblings relative to `tabId` (same pane strip). */
export function tabCloseTargets(tabId: string): TabCloseTargets {
  const siblings = siblingTabIds(tabId)
  const index = siblings.indexOf(tabId)
  const closable = siblings.filter(tabHasCloseControl)
  return {
    others: closable.filter(id => id !== tabId),
    all: closable,
    left: index <= 0 ? [] : closable.filter(id => siblings.indexOf(id) < index),
    right: index < 0 ? [] : closable.filter(id => siblings.indexOf(id) > index),
  }
}
