/**
 * Probe official ui-sidebar-right services without importing pane UI.
 * Used by client apply() to refuse start on harness < 0.1.5 instead of
 * hanging on hard cordis inject.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'

type SidebarRightTabs = {
  register: (definition: unknown) => () => void
}

type SidebarRight = {
  openTab: (kind: string, options?: { paneId?: string }) => void
  openResource: (address: string, options?: { paneId?: string; revealIfOpened?: boolean; kind?: string }) => void
  split: (paneId?: string) => string | undefined
  close: (tabId: string) => void
}

export function resolveSidebarRightTabs(ctx: ClientContext): SidebarRightTabs | undefined {
  const fromField = (ctx as { sidebarRightTabs?: unknown }).sidebarRightTabs
  if (fromField !== null && typeof fromField === 'object' && 'register' in fromField) {
    return fromField as SidebarRightTabs
  }
  const fromGet = ctx.get('sidebarRightTabs')
  if (fromGet !== null && typeof fromGet === 'object' && 'register' in fromGet) {
    return fromGet as SidebarRightTabs
  }
  return undefined
}

export function resolveSidebarRight(ctx: ClientContext): SidebarRight | undefined {
  const fromField = (ctx as { sidebarRight?: unknown }).sidebarRight
  if (fromField !== null && typeof fromField === 'object' && 'openTab' in fromField) {
    return fromField as SidebarRight
  }
  const fromGet = ctx.get('sidebarRight')
  if (fromGet !== null && typeof fromGet === 'object' && 'openTab' in fromGet) {
    return fromGet as SidebarRight
  }
  return undefined
}

/** True when harness exposes official right-sidebar services (dsh ≥ 0.1.5). */
export function hasOfficialSidebarServices(ctx: ClientContext): boolean {
  return resolveSidebarRightTabs(ctx) !== undefined && resolveSidebarRight(ctx) !== undefined
}
