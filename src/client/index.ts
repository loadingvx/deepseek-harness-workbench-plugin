import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { createGitClient } from './api.ts'
import { GitToolRow } from './GitToolRow.tsx'
import { Workbench } from './workbench/Workbench.tsx'
import { en, NS, zh } from './locales.ts'

export const inject = ['slots', 'locale']

/** Browser half: native-chat split workbench and keyed git tool cards. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-workbench: dictionaries')
  const client = createGitClient()

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'workbench',
    locale: NS,
    inject: () => ({ client }),
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
