import type { Context } from '@deepseek-ai/cordis'
import { DEFAULT_COMMIT_TEMPLATE, resolveCommitTemplate } from '../shared/commit-template.ts'
import { GitError } from '../shared/errors.ts'
import type { GitService } from './git-service.ts'

const MAX_DIFF_CHARS = 60_000
const GENERATE_TIMEOUT_MS = 45_000
const COMMIT_MAX_TOKENS = 1_024
const PLUGIN_SOURCE = { kind: 'plugin', plugin: 'dsh-workbench-plugin' } as const

export const COMMIT_SYSTEM_PROMPT = DEFAULT_COMMIT_TEMPLATE

export type LlmStreamChunk = {
  type?: string
  index?: number
  text?: string
  block?: { type?: string; text?: string }
  reason?: { kind?: string; failure?: { message?: string; code?: string } }
}

export function sanitizeCommitMessage(raw: string): string {
  let text = raw.replace(/\r\n/g, '\n').trim()
  const fenced = /^```(?:\w+)?\n([\s\S]*?)\n```$/m.exec(text)
  if (fenced?.[1] !== undefined) text = fenced[1].trim()
  text = text.replace(/^["'`]+|["'`]+$/g, '').trim()
  if (text.length > 4000) text = text.slice(0, 4000).trim()
  return text
}

export function buildCommitUserPrompt(input: {
  staged: string
  unstaged: string
  untracked: Array<{ path: string; patch: string }>
}): string {
  const parts: string[] = ['请根据下面的仓库改动生成提交说明。']
  if (input.staged.trim() !== '') {
    parts.push('', '## 已暂存', input.staged.trim())
  }
  if (input.unstaged.trim() !== '') {
    parts.push('', '## 未暂存', input.unstaged.trim())
  }
  if (input.untracked.length > 0) {
    parts.push('', '## 未跟踪')
    for (const file of input.untracked) {
      parts.push('', `### ${file.path}`)
      parts.push(file.patch.trim() === '' ? '（新文件，未能读取内容）' : file.patch.trim())
    }
  }
  let body = parts.join('\n')
  if (body.length > MAX_DIFF_CHARS) {
    body = `${body.slice(0, MAX_DIFF_CHARS)}\n\n…（差异过长，已截断。请只根据已给出的部分总结。）`
  }
  return body
}

export function summarizeCommitChunks(chunks: readonly LlmStreamChunk[]): string {
  if (chunks.length === 0) return '没有任何数据'
  const counts = new Map<string, number>()
  for (const chunk of chunks) {
    const type = chunk.type ?? 'unknown'
    counts.set(type, (counts.get(type) ?? 0) + 1)
  }
  return [...counts.entries()].map(([type, count]) => `${type}×${count}`).join('，')
}

/**
 * Assemble visible commit text the same way harness BlockAssembler does:
 * text-delta plus authoritative block-end text. Reasoning is never the answer.
 */
export function collectCommitText(chunks: readonly LlmStreamChunk[]): { text: string; fail: string } {
  const parts = new Map<number, { text: string; closed: boolean }>()
  let sawReasoning = false
  let fail = ''
  let finishKind = ''
  let failCode = ''

  for (const chunk of chunks) {
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
      const index = typeof chunk.index === 'number' ? chunk.index : 0
      const part = parts.get(index) ?? { text: '', closed: false }
      if (!part.closed) part.text += chunk.text
      parts.set(index, part)
    }
    if (chunk.type === 'reasoning-delta' || chunk.block?.type === 'reasoning') {
      sawReasoning = true
    }
    if (chunk.type === 'block-end' && chunk.block?.type === 'text' && typeof chunk.block.text === 'string') {
      const index = typeof chunk.index === 'number' ? chunk.index : 0
      parts.set(index, { text: chunk.block.text, closed: true })
    }
    if (chunk.type === 'finish') {
      finishKind = chunk.reason?.kind ?? ''
      failCode = chunk.reason?.failure?.code ?? ''
      if (finishKind === 'error' || finishKind === 'aborted') {
        fail = chunk.reason?.failure?.message
          ?? (finishKind === 'aborted' ? '生成已取消或超时。' : '模型没有返回可用结果。')
      }
    }
  }

  const text = [...parts.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, part]) => part.text)
    .join('')
  const trace = summarizeCommitChunks(chunks)
  if (fail !== '') {
    const code = failCode === '' ? '' : ` [${failCode}]`
    return { text, fail: `${fail}${code}（${trace}）` }
  }
  if (sanitizeCommitMessage(text) !== '') return { text, fail: '' }
  if (chunks.length === 0) {
    return { text, fail: '模型接口没有返回任何数据。请确认「模型」已配置，然后重试。' }
  }
  if (finishKind === 'max-tokens') {
    return {
      text,
      fail: sawReasoning
        ? `模型把输出额度用在了思考过程上，没有写出提交说明。（${trace}）`
        : `模型输出被截断，没有完整提交说明。（${trace}）`,
    }
  }
  if (sawReasoning) {
    return { text, fail: `模型只返回了思考过程，没有写出提交说明。（${trace}）` }
  }
  if (finishKind === '') {
    return { text, fail: `模型调用没有正常结束。（${trace}）` }
  }
  return { text, fail: `模型没有返回提交说明。（${trace}）` }
}

export function pickCommitRoute(
  providers: Array<{ id: string }>,
  models: Record<string, Array<{ id: string }>>,
  preferred?: { provider: string; model: string },
): { provider: string; model: string } {
  if (providers.length === 0) throw new GitError('LLM_UNAVAILABLE')
  if (
    preferred !== undefined
    && preferred.provider !== ''
    && preferred.model !== ''
    && providers.some(provider => provider.id === preferred.provider)
  ) {
    return { provider: preferred.provider, model: preferred.model }
  }
  const ranked = [...providers].sort((left, right) => {
    const score = (id: string): number => (id.includes('deepseek') ? 0 : 1)
    return score(left.id) - score(right.id)
  })
  for (const provider of ranked) {
    const first = models[provider.id]?.[0]?.id
    if (first) return { provider: provider.id, model: first }
  }
  throw new GitError('LLM_UNAVAILABLE')
}

export function pickCommitReasoningEffort(
  info?: { reasoning?: { efforts: Array<{ id: string }> } },
): string | undefined {
  const efforts = info?.reasoning?.efforts ?? []
  if (efforts.length === 0) return undefined
  return efforts.some(effort => effort.id === 'off') ? 'off' : undefined
}

export async function collectChangePayload(
  git: GitService,
  root: string,
  signal?: AbortSignal,
): Promise<{ staged: string; unstaged: string; untracked: Array<{ path: string; patch: string }> }> {
  const status = await git.status(root, signal)
  const dirty = status.staged.length + status.unstaged.length + status.untracked.length
  if (dirty === 0) throw new GitError('NOTHING_TO_DESCRIBE')
  if (status.staged.length > 0) {
    const staged = (await git.diff(root, undefined, true, signal)).text
    return { staged, unstaged: '', untracked: [] }
  }
  const unstaged = status.unstaged.length > 0 ? (await git.diff(root, undefined, false, signal)).text : ''
  const untracked: Array<{ path: string; patch: string }> = []
  for (const file of status.untracked.slice(0, 20)) {
    try {
      const result = await git.diff(root, file.path, false, signal)
      untracked.push({ path: file.path, patch: result.text.slice(0, 8_000) })
    } catch {
      untracked.push({ path: file.path, patch: '' })
    }
  }
  return { staged: '', unstaged, untracked }
}

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

/** One-shot auxiliary LLM call: fixed prompt + current diff → commit message. */
export async function generateCommitMessage(
  ctx: Context,
  git: GitService,
  root: string,
  options?: { signal?: AbortSignal; template?: string },
): Promise<string> {
  const signal = options?.signal
  const system = resolveCommitTemplate(options?.template)
  const payload = await collectChangePayload(git, root, signal)
  const llm = readLlm(ctx)
  const route = await resolveRoute(ctx)
  const reasoningEffort = await resolveReasoningEffort(llm, route, signal)
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, GENERATE_TIMEOUT_MS)
  const onAbort = (): void => { controller.abort() }
  signal?.addEventListener('abort', onAbort)
  try {
    const chunks: LlmStreamChunk[] = []
    for await (const chunk of llm.stream({
      provider: route.provider,
      model: route.model,
      system,
      messages: [buildUserMessage(buildCommitUserPrompt(payload))],
      maxTokens: COMMIT_MAX_TOKENS,
      temperature: 0.2,
      // DeepSeek only forces thinking off for this auxiliary purpose. No sessionId,
      // so the session-title plugin ignores the call. Compaction does not disable thinking.
      purpose: 'session-title',
      ...reasoningEffort === undefined ? {} : { reasoningEffort },
      signal: controller.signal,
    })) {
      chunks.push(chunk)
    }
    const assembled = collectCommitText(chunks)
    if (assembled.fail !== '') {
      throw new GitError('LLM_FAILED', `${assembled.fail} 路由：${route.provider} / ${route.model}`)
    }
    return sanitizeCommitMessage(assembled.text)
  } catch (error) {
    if (error instanceof GitError) throw error
    if (controller.signal.aborted) {
      throw new GitError('LLM_FAILED', '生成超时或已取消，请稍后重试。')
    }
    throw new GitError('LLM_FAILED', error instanceof Error ? error.message : String(error))
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
