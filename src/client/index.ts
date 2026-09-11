import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { createGitClient } from './api.ts'
import { GitToolRow } from './GitToolRow.tsx'
import { installUltraSlashClient } from './ultra-slash/install.ts'
import { installFileRefClient } from './workbench/file-ref-client.ts'
import { installBrowserElClient } from './workbench/browser-el-client.ts'
import { installNetRefClient } from './workbench/net-ref-client.ts'
import { installTermRefClient } from './workbench/term-ref-client.ts'
import { installEditorRefClient } from './workbench/editor-ref-client.ts'
import { installOfficialSidebarTabs } from './workbench/sidebar-right/install.ts'
import { Workbench } from './workbench/Workbench.tsx'
import type { WorkbenchInjected } from './workbench/types.ts'
import { en, NS, zh } from './locales.ts'
import { selectSvgTailGated } from './workbench/svg-render-settings.ts'
import { svgRenderEn, svgRenderZh } from './workbench/svg-render-locales.ts'
import { reviewSettingsEn, reviewSettingsZh } from './workbench/review-settings-locales.ts'
import { agentAssetsEn, agentAssetsZh } from './workbench/agent-assets-locales.ts'
import { SvgTailView } from './workbench/SvgTailView.tsx'
import { MIN_HARNESS_VERSION, PLUGIN_NAME } from '../shared/version.ts'

/**
 * Hard inject must NOT include sidebarRight*.
 * Listing them makes cordis park the whole entry as
 * "pending (waiting for services…)" on harness &lt; 0.1.5 and blocks web boot.
 * We nest-inject those services below so the parent entry always activates.
 */
export const inject = ['slots', 'locale', 'inputTriggers', 'sessions']

const SIDEBAR_RIGHT_INJECT = ['sidebarRightTabs', 'sidebarRight'] as const

function registerWorkbenchLocale(locale: {
  dicts?: Map<string, Map<string, Record<string, string>>>
  register: (ns: string, dicts: unknown) => unknown
}): () => void {
  const fullZh = { ...zh, ...svgRenderZh, ...reviewSettingsZh, ...agentAssetsZh }
  const fullEn = { ...en, ...svgRenderEn, ...reviewSettingsEn, ...agentAssetsEn }
  const table = locale.dicts?.get(NS)
  if (table !== undefined && (table.has('zh') || table.has('en'))) {
    const zhDict = table.get('zh')
    const enDict = table.get('en')
    if (zhDict !== undefined) Object.assign(zhDict, fullZh)
    else table.set('zh', { ...fullZh })
    if (enDict !== undefined) Object.assign(enDict, fullEn)
    else table.set('en', { ...fullEn })
    return () => {}
  }
  try {
    return locale.register(NS, { zh: fullZh, en: fullEn })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/already has locale/.test(message)) throw error
    const again = locale.dicts?.get(NS)
    if (again === undefined) throw error
    const zhDict = again.get('zh')
    const enDict = again.get('en')
    if (zhDict !== undefined) Object.assign(zhDict, fullZh)
    if (enDict !== undefined) Object.assign(enDict, fullEn)
    return () => {}
  }
}

/** Real workbench body — only runs once official sidebar services exist. */
function applyWorkbench(ctx: ClientContext): void {
  ctx.effect(() => registerWorkbenchLocale(ctx.locale as {
    dicts?: Map<string, Map<string, Record<string, string>>>
    register: (ns: string, dicts: unknown) => unknown
  }), 'ui-workbench: dictionaries')
  const client = createGitClient()
  installUltraSlashClient(ctx)
  const fileRefs = installFileRefClient(ctx, client)
  const browserEls = installBrowserElClient(ctx)
  const netRefs = installNetRefClient(ctx)
  const termRefs = installTermRefClient(ctx)
  const editorRefs = installEditorRefClient(ctx)

  const injected: WorkbenchInjected = {
    client,
  }

  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay',
    id: 'workbench-host',
    locale: NS,
    inject: () => ({
      ...injected,
      mount: 'host' as const,
      fileRefs,
      browserEls,
      netRefs,
      termRefs,
      editorRefs,
    }),
  }, Workbench))

  ctx.slots.inject('tool.call.toolview', function* () {
    for (const key of ['git_status', 'git_diff', 'git_log', 'git_branch', 'git_commit']) {
      yield ctx.slots.register({
        name: 'tool.call.toolview',
        key,
        locale: NS,
      }, GitToolRow)
    }
  })

  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    id: 'workbench-svg-tail',
    locale: NS,
    select: selectSvgTailGated,
  }, SvgTailView))

  installOfficialSidebarTabs(ctx, client)
}

/**
 * Browser half: activate immediately; mount workbench only when
 * ui-sidebar-right services are available (harness ≥ 0.1.5).
 */
export function apply(ctx: ClientContext): void {
  // Nested inject: parent entry activates even if sidebar services never appear
  // (old harness). Do not probe ctx.sidebarRight* here — that throws
  // "cannot get property … without inject".
  let armed = false
  const warnTimer = typeof window !== 'undefined'
    ? window.setTimeout(() => {
      if (armed) return
      console.error(
        `[${PLUGIN_NAME}] official ui-sidebar-right did not become available `
        + `(need DeepSeek Harness ≥ ${MIN_HARNESS_VERSION}). `
        + 'Workbench stays inactive; the rest of the web UI keeps running. '
        + 'Upgrade dsh and restart to use this plugin.',
      )
    }, 4000)
    : 0

  ctx.effect(() => () => {
    if (warnTimer !== 0) window.clearTimeout(warnTimer)
  }, 'ui-workbench: sidebar-gate-timer')

  ctx.inject([...SIDEBAR_RIGHT_INJECT], (scoped) => {
    armed = true
    if (warnTimer !== 0) window.clearTimeout(warnTimer)
    applyWorkbench(scoped)
  })
}
