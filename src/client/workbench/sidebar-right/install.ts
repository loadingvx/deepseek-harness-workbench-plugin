/**
 * Register workbench page tabs on the official ui-sidebar-right surface.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { GitClient } from '../../api.ts'
import { NS } from '../../locales.ts'
import type { Translate } from '../types.ts'
import { bindOfficialSidebar } from '../official-sidebar.ts'
import {
  browserTabDefinition,
  controlPlaneTabDefinition,
  gitTabDefinition,
  slashTabDefinition,
  terminalTabDefinition,
  usageTabDefinition,
} from './definitions.tsx'
import { BrowserPane } from './BrowserPane.tsx'
import { ControlPlanePane } from './ControlPlanePane.tsx'
import { GitPane } from './GitPane.tsx'
import { SlashPane } from './SlashPane.tsx'
import { TerminalPane } from './TerminalPane.tsx'
import { UsagePane } from './UsagePane.tsx'
import {
  WORKBENCH_BROWSER_ID,
  WORKBENCH_CONTROL_PLANE_ID,
  WORKBENCH_GIT_ID,
  WORKBENCH_SLASH_ID,
  WORKBENCH_TERMINAL_ID,
  WORKBENCH_USAGE_ID,
} from './ids.ts'
import {
  hasOfficialSidebarServices,
  resolveSidebarRight,
  resolveSidebarRightTabs,
} from './services.ts'

export { hasOfficialSidebarServices } from './services.ts'

type LocaleBind = {
  bind: (ns: string) => Translate
}

function registerBody(
  ctx: ClientContext,
  key: string,
  label: string,
  Component: unknown,
  inject?: () => Record<string, unknown>,
): void {
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key,
    locale: NS,
    ...(inject === undefined ? {} : { inject }),
  }, Component)), label)
}

/** Install workbench page tabs when the official right Sidebar is present. */
export function installOfficialSidebarTabs(ctx: ClientContext, client: GitClient): void {
  const tabs = resolveSidebarRightTabs(ctx)
  if (tabs === undefined) return

  const locale = ctx.locale as LocaleBind
  const t = locale.bind(NS)
  const withClient = () => ({ client })

  ctx.effect(() => tabs.register(gitTabDefinition(t)), 'ui-workbench: sidebar-right git type')
  ctx.effect(() => tabs.register(usageTabDefinition(t)), 'ui-workbench: sidebar-right usage type')
  ctx.effect(() => tabs.register(slashTabDefinition(t)), 'ui-workbench: sidebar-right ultra-slash type')
  ctx.effect(() => tabs.register(terminalTabDefinition(t)), 'ui-workbench: sidebar-right terminal type')
  ctx.effect(() => tabs.register(browserTabDefinition(t)), 'ui-workbench: sidebar-right browser type')
  ctx.effect(() => tabs.register(controlPlaneTabDefinition(t)), 'ui-workbench: sidebar-right control-plane type')

  registerBody(ctx, WORKBENCH_GIT_ID, 'ui-workbench: sidebar-right git body', GitPane, withClient)
  registerBody(ctx, WORKBENCH_USAGE_ID, 'ui-workbench: sidebar-right usage body', UsagePane, withClient)
  registerBody(ctx, WORKBENCH_SLASH_ID, 'ui-workbench: sidebar-right ultra-slash body', SlashPane)
  registerBody(ctx, WORKBENCH_TERMINAL_ID, 'ui-workbench: sidebar-right terminal body', TerminalPane, withClient)
  registerBody(ctx, WORKBENCH_BROWSER_ID, 'ui-workbench: sidebar-right browser body', BrowserPane)
  registerBody(ctx, WORKBENCH_CONTROL_PLANE_ID, 'ui-workbench: sidebar-right control-plane body', ControlPlanePane, withClient)

  const sidebar = resolveSidebarRight(ctx)
  if (sidebar !== undefined) {
    ctx.effect(() => bindOfficialSidebar({
      openTab: (kind) => { sidebar.openTab(kind) },
    }), 'ui-workbench: bind official sidebar')
  }
}
