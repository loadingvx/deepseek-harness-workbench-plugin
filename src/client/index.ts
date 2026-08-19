import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { createGitClient } from './api.ts'
import { GitToolRow } from './GitToolRow.tsx'
import { installUltraSlashClient } from './ultra-slash/install.ts'
import { installFileRefClient } from './workbench/file-ref-client.ts'
import { installBrowserElClient } from './workbench/browser-el-client.ts'
import { Workbench } from './workbench/Workbench.tsx'
import { en, NS, zh } from './locales.ts'

export const inject = ['slots', 'locale', 'inputTriggers', 'sessions']

function registerWorkbenchLocale(locale: {
  dicts?: Map<string, Map<string, Record<string, string>>>
  register: (ns: string, dicts: unknown) => unknown
}): () => void {
  const table = locale.dicts?.get(NS)
  if (table !== undefined && (table.has('zh') || table.has('en'))) {
    const zhDict = table.get('zh')
    const enDict = table.get('en')
    if (zhDict !== undefined) Object.assign(zhDict, zh)
    else table.set('zh', { ...zh })
    if (enDict !== undefined) Object.assign(enDict, en)
    else table.set('en', { ...en })
    return () => {}
  }
  try {
    return locale.register(NS, { zh, en })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/already has locale/.test(message)) throw error
    const again = locale.dicts?.get(NS)
    if (again === undefined) throw error
    const zhDict = again.get('zh')
    const enDict = again.get('en')
    if (zhDict !== undefined) Object.assign(zhDict, zh)
    if (enDict !== undefined) Object.assign(enDict, en)
    return () => {}
  }
}

/** Browser half: native-chat split workbench, keyed git tool cards, and Ultra Slash. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => registerWorkbenchLocale(ctx.locale as {
    dicts?: Map<string, Map<string, Record<string, string>>>
    register: (ns: string, dicts: unknown) => unknown
  }), 'ui-workbench: dictionaries')
  const client = createGitClient()
  installUltraSlashClient(ctx)
  const fileRefs = installFileRefClient(ctx, client)
  const browserEls = installBrowserElClient(ctx)

  // Host lives in the composer overlay so a blank new-session hero still
  // mounts the workbench. The header utilities seat is hidden until the
  // first message, so it can only carry the toggle.
  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay',
    id: 'workbench-host',
    locale: NS,
    inject: () => ({ client, mount: 'host' as const, fileRefs, browserEls }),
  }, Workbench))

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'workbench',
    locale: NS,
    inject: () => ({ client, mount: 'toggle' as const }),
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
}
