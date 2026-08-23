import type { Context } from '@deepseek-ai/cordis'
import {
  applyCommitChunk,
  commitAssembleText,
  createCommitAssemble,
  pickCommitReasoningEffort,
  pickCommitRoute,
  previewCommitMessage,
  type CommitAssembleState,
  type LlmStreamChunk,
} from './commit-message.ts'
import { GitError } from '../shared/errors.ts'
import { redactSecrets } from '../shared/redact.ts'
import {
  buildTermAssistUserPrompt,
  clipAssistInput,
  clipAssistTranscript,
  parseAssistOutput,
  previewAssistText,
} from '../shared/term-assist.ts'
import { resolveTermAssistPrefs } from '../shared/term-assist-prefs.ts'
import { DEFAULT_TERM_ASSIST_TEMPLATE, resolveTermAssistTemplate } from '../shared/term-assist-prompt.ts'

const GENERATE_TIMEOUT_MS = 30_000
const ASSIST_MAX_TOKENS = 512
const PLUGIN_SOURCE = { kind: 'plugin', plugin: 'dsh-workbench-plugin' } as const

export type TermAssistStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; message: string }

function readLlm(ctx: Context): Context['llm'] {
  const llm = ctx.llm ?? ctx.get('llm') as Context['llm'] | undefined
  if (llm === undefined || typeof llm.stream !== 'function' || typeof llm.listProviders !== 'function') {
    throw new GitError('LLM_UNAVAILABLE')
  }
  return llm
}

function readPreferredRoute(ctx: Context): { provider: string; model: string } | undefined {
  const service = ctx.agentDefaultModel
    ?? ctx.get('agentDefaultModel') as Context['agentDefaultModel'] | undefined
  const selection = service?.currentSelection?.()
  if (
    typeof selection?.provider === 'string'
    && selection.provider !== ''
    && typeof selection.model === 'string'
    && selection.model !== ''
  ) {
    return { provider: selection.provider, model: selection.model }
  }
  return undefined
}

async function resolveRoute(ctx: Context): Promise<{ provider: string; model: string }> {
  const llm = readLlm(ctx)
  const providers = llm.listProviders()
  const preferred = readPreferredRoute(ctx)
  if (preferred !== undefined && providers.some(provider => provider.id === preferred.provider)) {
    return preferred
  }
  const models: Record<string, Array<{ id: string }>> = {}
  for (const provider of providers) {
    try {
      models[provider.id] = await llm.listModels(provider.id)
    } catch {
      models[provider.id] = []
    }
  }
  return pickCommitRoute(providers, models, preferred)
}

async function resolveReasoningEffort(
  llm: Context['llm'],
  route: { provider: string; model: string },
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (typeof llm.resolveModelInfo !== 'function') return 'off'
  try {
    return pickCommitReasoningEffort(await llm.resolveModelInfo(route.provider, route.model, signal))
  } catch {
    return undefined
  }
}

function buildUserMessage(text: string): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: PLUGIN_SOURCE,
  }
}

function summarizeTypes(types: readonly string[]): string {
  if (types.length === 0) return '没有任何数据'
  const counts = new Map<string, number>()
  for (const type of types) counts.set(type, (counts.get(type) ?? 0) + 1)
  return [...counts.entries()].map(([type, count]) => `${type}×${count}`).join('，')
}

export function assistAssembleResult(state: CommitAssembleState): { text: string; fail: string } {
  const text = commitAssembleText(state)
  const trace = summarizeTypes(state.types)
  if (state.fail !== '') {
    const code = state.failCode === '' ? '' : ` [${state.failCode}]`
    return { text, fail: `${state.fail}${code}（${trace}）` }
  }
  if (parseAssistOutput(text).kind !== 'empty') return { text, fail: '' }
  if (state.types.length === 0) {
    return { text, fail: '模型接口没有返回任何数据。请确认会话里已经配好模型，然后重试。' }
  }
  if (state.finishKind === 'max-tokens') {
    return {
      text,
      fail: state.sawReasoning
        ? `模型把输出额度用在了思考过程上，没有写出命令。（${trace}）`
        : `模型输出被截断，没有完整命令。（${trace}）`,
    }
  }
  if (state.sawReasoning) {
    return { text, fail: `模型只返回了思考过程，没有写出命令。（${trace}）` }
  }
  if (state.finishKind === '') {
    return { text, fail: `模型调用没有正常结束。（${trace}）` }
  }
  return { text, fail: `模型没有返回可用的命令。（${trace}）` }
}

export function collectAssistText(chunks: readonly LlmStreamChunk[]): { text: string; fail: string } {
  const state = createCommitAssemble()
  for (const chunk of chunks) applyCommitChunk(state, chunk)
  return assistAssembleResult(state)
}

/** Stream a shell command (or ASK note) as the model writes it. */
export async function* streamTermAssist(
  ctx: Context,
  options: {
    text: string
    cwd?: string
    transcript?: string
    template?: string
    prefs?: unknown
    signal?: AbortSignal
  },
): AsyncGenerator<TermAssistStreamEvent> {
  const text = clipAssistInput(options.text)
  if (text === '') throw new GitError('LLM_FAILED', '请先输入命令，或用一句话描述你想做什么。')
  const signal = options.signal
  const system = resolveTermAssistTemplate(options.template, DEFAULT_TERM_ASSIST_TEMPLATE)
  const llm = readLlm(ctx)
  const route = await resolveRoute(ctx)
  const reasoningEffort = await resolveReasoningEffort(llm, route, signal)
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, GENERATE_TIMEOUT_MS)
  const onAbort = (): void => { controller.abort() }
  signal?.addEventListener('abort', onAbort)
  const user = buildTermAssistUserPrompt({
    text,
    cwd: options.cwd,
    transcript: options.transcript === undefined ? undefined : clipAssistTranscript(options.transcript),
  })
  try {
    const state = createCommitAssemble()
    let last = ''
    for await (const chunk of llm.stream({
      provider: route.provider,
      model: route.model,
      system,
      messages: [buildUserMessage(user)],
      maxTokens: ASSIST_MAX_TOKENS,
      temperature: 0.1,
      purpose: 'session-title',
      ...reasoningEffort === undefined ? {} : { reasoningEffort },
      signal: controller.signal,
    })) {
      if (controller.signal.aborted) break
      applyCommitChunk(state, chunk)
      const visible = previewAssistText(previewCommitMessage(commitAssembleText(state)))
      if (visible !== last) {
        last = visible
        yield { type: 'delta', text: redactSecrets(visible) }
      }
    }
    if (signal?.aborted) {
      throw new GitError('LLM_FAILED', '生成已取消。')
    }
    const assembled = assistAssembleResult(state)
    if (assembled.fail !== '') {
      throw new GitError('LLM_FAILED', `${assembled.fail} 路由：${route.provider} / ${route.model}`)
    }
    yield { type: 'done', message: redactSecrets(sanitizeDone(assembled.text, options.prefs)) }
  } catch (error) {
    if (error instanceof GitError) throw error
    if (controller.signal.aborted) {
      throw new GitError('LLM_FAILED', signal?.aborted ? '生成已取消。' : '生成超时或已取消，请稍后重试。')
    }
    throw new GitError('LLM_FAILED', error instanceof Error ? error.message : String(error))
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

function sanitizeDone(raw: string, prefs?: unknown): string {
  const parsed = parseAssistOutput(raw, resolveTermAssistPrefs(prefs))
  if (parsed.kind === 'command') {
    return parsed.explain === '' ? parsed.command : `# ${parsed.explain}\n${parsed.command}`
  }
  if (parsed.kind === 'ask') return `ASK: ${parsed.note}`
  return previewAssistText(raw).trim()
}

export async function generateTermAssist(
  ctx: Context,
  options: {
    text: string
    cwd?: string
    transcript?: string
    template?: string
    prefs?: unknown
    signal?: AbortSignal
  },
): Promise<string> {
  let message = ''
  for await (const event of streamTermAssist(ctx, options)) {
    if (event.type === 'done') message = event.message
  }
  return message
}
