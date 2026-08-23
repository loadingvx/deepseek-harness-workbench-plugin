import { navHostBleedStyle, clampNavContentPad, NAV_CONTENT_PAD } from './nav-usage-layout.ts'

export type UsageDock = 'side' | 'nav'

export const USAGE_DOCK_KEY = 'dsh-workbench-usage-dock'
export const USAGE_DOCK_HOST = 'data-dsw-usage-dock'
export const DEFAULT_USAGE_DOCK: UsageDock = 'nav'

const SETTINGS_LABELS = new Set(['Settings', '设置'])

function isWorkbenchChrome(el: Element): boolean {
  return el.closest('[data-git-ide-panel], [data-git-chrome]') !== null
}

function accessibleName(el: Element): string {
  const labelled = el.getAttribute('aria-labelledby')
  const fromIds = labelled === null
    ? ''
    : labelled.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
  return [el.getAttribute('aria-label'), el.getAttribute('title'), fromIds, el.textContent]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function nameLooksLikeSettings(name: string): boolean {
  if (name === '') return false
  for (const label of SETTINGS_LABELS) {
    if (name === label || name.includes(label)) return true
  }
  return false
}

const dockListeners = new Set<() => void>()
const hostListeners = new Set<() => void>()

function emit(listeners: Set<() => void>): void {
  for (const listener of listeners) listener()
}

export function isUsageDock(value: string): value is UsageDock {
  return value === 'side' || value === 'nav'
}

/** Right-dock Usage tab is hidden once the panel is seated above Settings. */
export function usageTabVisible(dock: UsageDock, navReady: boolean): boolean {
  return dock !== 'nav' || !navReady
}

export function defaultUsageDock(): UsageDock {
  return DEFAULT_USAGE_DOCK
}

export function readUsageDock(): UsageDock {
  try {
    const raw = localStorage.getItem(USAGE_DOCK_KEY)
    if (raw !== null && isUsageDock(raw)) return raw
  } catch { /* private mode */ }
  return DEFAULT_USAGE_DOCK
}

export function writeUsageDock(next: UsageDock): UsageDock {
  const value = isUsageDock(next) ? next : DEFAULT_USAGE_DOCK
  try {
    localStorage.setItem(USAGE_DOCK_KEY, value)
  } catch { /* ignore */ }
  emit(dockListeners)
  return value
}

export function subscribeUsageDock(listener: () => void): () => void {
  dockListeners.add(listener)
  return () => { dockListeners.delete(listener) }
}

let navHostReady = false

export function isNavHostReady(): boolean {
  return navHostReady
}

function setNavHostReady(next: boolean): void {
  if (navHostReady === next) return
  navHostReady = next
  emit(hostListeners)
}

export function subscribeNavHost(listener: () => void): () => void {
  hostListeners.add(listener)
  return () => { hostListeners.delete(listener) }
}

export function isNativeSettingsTrigger(el: Element): boolean {
  if (!(el instanceof HTMLButtonElement)) return false
  if (el.getAttribute('aria-haspopup') !== 'dialog') return false
  if (isWorkbenchChrome(el)) return false
  if (el.closest('[class*="settingsArea"]') !== null) return true
  return nameLooksLikeSettings(accessibleName(el))
}

export function findNativeSettingsArea(): HTMLElement | null {
  const buttons = document.querySelectorAll('button[aria-haspopup="dialog"]')
  for (const btn of buttons) {
    if (!isNativeSettingsTrigger(btn)) continue
    const area = btn.closest('[class*="settingsArea"]')
    if (area instanceof HTMLElement) return area
    if (btn.parentElement instanceof HTMLElement) return btn.parentElement
    return btn
  }
  for (const area of document.querySelectorAll('[class*="settingsArea"]')) {
    if (area instanceof HTMLElement && !isWorkbenchChrome(area)) return area
  }
  return null
}

/** Footer of the native left session rail, including the collapsed icon rail. */
export function findNativeNavFoot(): HTMLElement | null {
  const area = findNativeSettingsArea()
  const nested = area?.closest('[class*="footArea"]')
  if (nested instanceof HTMLElement) return nested
  for (const foot of document.querySelectorAll('[class*="footArea"]')) {
    if (foot instanceof HTMLElement && !isWorkbenchChrome(foot)) return foot
  }
  return null
}

export function findNavFootArea(from: HTMLElement): HTMLElement | null {
  const nested = from.closest('[class*="footArea"]')
  if (nested instanceof HTMLElement) return nested
  const next = from.nextElementSibling
  if (next instanceof HTMLElement && next.className.includes('footArea')) return next
  const area = findNativeSettingsArea()
  const foot = area?.closest('[class*="footArea"]')
  return foot instanceof HTMLElement ? foot : null
}

export function findNavSidebarRoot(from: HTMLElement): HTMLElement | null {
  const foot = findNavFootArea(from)
  if (foot?.parentElement instanceof HTMLElement) return foot.parentElement
  return from.parentElement
}

export function measureNavSettingsHeight(): number {
  const area = findNativeSettingsArea()
  if (area === null) return 40
  return Math.max(0, area.getBoundingClientRect().height)
}

function firstListContent(root: HTMLElement): HTMLElement | null {
  const hit = root.querySelector('button, a, [class*="workspace"], [class*="session"], [class*="item"], [class*="row"], [class*="title"], [class*="name"]')
  return hit instanceof HTMLElement ? hit : root
}

export function measureNavContentPad(sidebar: HTMLElement, host: HTMLElement): { left: number; right: number } {
  const side = sidebar.getBoundingClientRect()
  const list = host.previousElementSibling
  if (list instanceof HTMLElement && !list.className.includes('footArea')) {
    const cs = getComputedStyle(list)
    const padL = Number.parseFloat(cs.paddingLeft) || 0
    const padR = Number.parseFloat(cs.paddingRight) || 0
    if (padL >= 8) return { left: clampNavContentPad(padL), right: clampNavContentPad(padR || padL) }
    const probe = firstListContent(list)
    if (probe !== null && side.width > 0) {
      const box = probe.getBoundingClientRect()
      const left = box.left - side.left
      const right = side.right - box.right
      if (left >= 6 && left <= 24) {
        return {
          left: clampNavContentPad(left),
          right: clampNavContentPad(right >= 6 && right <= 24 ? right : left),
        }
      }
    }
  }
  const foot = findNavFootArea(host)
  if (foot !== null) {
    const cs = getComputedStyle(foot)
    const padL = Number.parseFloat(cs.paddingLeft) || 0
    const padR = Number.parseFloat(cs.paddingRight) || 0
    if (padL >= 8) return { left: clampNavContentPad(padL), right: clampNavContentPad(padR || padL) }
  }
  return { left: NAV_CONTENT_PAD, right: NAV_CONTENT_PAD }
}

export function parentContentLeft(parent: HTMLElement): number {
  const box = parent.getBoundingClientRect()
  const cs = getComputedStyle(parent)
  const padL = Number.parseFloat(cs.paddingLeft) || 0
  const borderL = Number.parseFloat(cs.borderLeftWidth) || 0
  return box.left + borderL + padL
}

function seatHostAboveFooter(host: HTMLElement): void {
  const area = findNativeSettingsArea()
  const foot = findNavFootArea(host)
    ?? findNativeNavFoot()
    ?? (area?.closest('[class*="footArea"]') instanceof HTMLElement
      ? area.closest('[class*="footArea"]') as HTMLElement
      : null)
  const sidebar = foot?.parentElement
  if (foot !== null && sidebar instanceof HTMLElement) {
    if (host.nextElementSibling !== foot || host.parentElement !== sidebar) {
      sidebar.insertBefore(host, foot)
    }
    return
  }
  if (area !== null && area.parentElement !== null && host.nextElementSibling !== area) {
    area.parentElement.insertBefore(host, area)
  }
}

export function syncNavDockHostBox(host: HTMLElement): void {
  seatHostAboveFooter(host)
  host.style.boxSizing = 'border-box'
  host.style.display = 'block'
  host.style.flex = '0 0 auto'
  host.style.alignSelf = 'stretch'
  host.style.justifySelf = 'stretch'
  host.style.minWidth = '0'
  host.style.margin = '0'
  host.style.padding = '0'
  host.style.overflow = 'hidden'
  host.style.overflowX = 'hidden'
  host.style.overflowY = 'hidden'
  const sidebar = findNavSidebarRoot(host)
  const parent = host.parentElement
  if (sidebar !== null && parent !== null) {
    const bleed = navHostBleedStyle(
      sidebar.getBoundingClientRect().width,
      sidebar.getBoundingClientRect().left,
      parentContentLeft(parent),
    )
    if (bleed !== null) {
      host.style.marginLeft = bleed.marginLeft
      host.style.marginRight = '0'
      host.style.width = bleed.width
      host.style.maxWidth = bleed.maxWidth
    } else {
      host.style.width = '100%'
      host.style.maxWidth = '100%'
    }
    const pad = measureNavContentPad(sidebar, host)
    host.style.setProperty('--dsw-usage-pad-left', `${pad.left}px`)
    host.style.setProperty('--dsw-usage-pad-right', `${pad.right}px`)
    return
  }
  host.style.width = '100%'
  host.style.maxWidth = '100%'
  host.style.setProperty('--dsw-usage-pad-left', `${NAV_CONTENT_PAD}px`)
  host.style.setProperty('--dsw-usage-pad-right', `${NAV_CONTENT_PAD}px`)
}

export function navHostIsSeated(host: HTMLElement): boolean {
  if (!host.isConnected) return false
  const foot = findNavFootArea(host) ?? findNativeNavFoot()
  if (foot !== null && host.nextElementSibling === foot) return true
  const area = findNativeSettingsArea()
  return area !== null && host.nextElementSibling === area
}

export function ensureNavDockHost(): HTMLElement | null {
  const live = document.querySelector(`[${USAGE_DOCK_HOST}]`)
  if (live instanceof HTMLElement && live.isConnected) {
    syncNavDockHostBox(live)
    setNavHostReady(true)
    return live
  }
  const foot = findNativeNavFoot()
  const area = findNativeSettingsArea()
  const sidebar = foot?.parentElement ?? area?.parentElement
  if (sidebar === null || sidebar === undefined) {
    setNavHostReady(false)
    return null
  }
  const host = document.createElement('div')
  host.setAttribute(USAGE_DOCK_HOST, 'nav')
  if (foot !== null) {
    sidebar.insertBefore(host, foot)
  } else if (area !== null) {
    sidebar.insertBefore(host, area)
  } else {
    setNavHostReady(false)
    return null
  }
  syncNavDockHostBox(host)
  setNavHostReady(true)
  return host
}

export function releaseNavDockHost(): void {
  for (const node of document.querySelectorAll(`[${USAGE_DOCK_HOST}]`)) {
    if (node instanceof HTMLElement && node.childElementCount === 0) node.remove()
  }
  setNavHostReady(false)
}

export function tryPinToNav(): HTMLElement | null {
  return ensureNavDockHost()
}
