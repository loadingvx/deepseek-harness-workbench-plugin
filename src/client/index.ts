import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { createGitClient } from './api.ts'
import { GitToolRow } from './GitToolRow.tsx'
import { installUltraSlashClient } from './ultra-slash/install.ts'
import { installFileRefClient } from './workbench/file-ref-client.ts'
import { installBrowserElClient } from './workbench/browser-el-client.ts'
import { installNetRefClient } from './workbench/net-ref-client.ts'
import { installTermRefClient } from './workbench/term-ref-client.ts'
import { installEditorRefClient } from './workbench/editor-ref-client.ts'
import { Workbench } from './workbench/Workbench.tsx'
import type { WorkbenchInjected } from './workbench/types.ts'
import { en, NS, zh } from './locales.ts'
import { selectSvgTailGated } from './workbench/svg-render-settings.ts'
import { svgRenderEn, svgRenderZh } from './workbench/svg-render-locales.ts'
import { reviewSettingsEn, reviewSettingsZh } from './workbench/review-settings-locales.ts'
import { SvgTailView } from './workbench/SvgTailView.tsx'

export const inject = ['slots', 'locale', 'inputTriggers', 'sessions']

function registerWorkbenchLocale(locale: {
  dicts?: Map<string, Map<string, Record<string, string>>>
  register: (ns: string, dicts: unknown) => unknown
}): () => void {
  // SVG 渲染翻译外移到独立模块（svg-render-locales.ts），注册时运行时合并进
  // workbench 命名空间，避免逐行插入 locales.ts（缩小上游合并冲突面）。
  const fullZh = { ...zh, ...svgRenderZh, ...reviewSettingsZh }
  const fullEn = { ...en, ...svgRenderEn, ...reviewSettingsEn }
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
  const netRefs = installNetRefClient(ctx)
  const termRefs = installTermRefClient(ctx)
  const editorRefs = installEditorRefClient(ctx)

  const injected: WorkbenchInjected = {
    client,
  }

  // Host lives in the composer overlay so a blank new-session hero still
  // mounts the workbench. The header utilities seat is hidden until the
  // first message, so it can only carry the toggle.
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

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'workbench',
    locale: NS,
    inject: () => ({
      ...injected,
      mount: 'toggle' as const,
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

  // 会话渲染增强：回答尾部渲染标准 SVG（conversation.chat.turnTail 扩展点）。
  // select 内部按设置开关门控：关闭时返回 null（不匹配、不渲染），与无 SVG 时不渲染的行为一致。
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    id: 'workbench-svg-tail',
    locale: NS,
    select: selectSvgTailGated,
  }, SvgTailView))
}
