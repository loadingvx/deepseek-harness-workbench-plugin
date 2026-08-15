import type { Context } from '@deepseek-ai/cordis'
import { GitError } from '../shared/errors.ts'
import { assertSafeRepoPath, type GitService } from './git-service.ts'
import { runGit } from './git-exec.ts'

const MAX_DIFF_CHARS = 60_000
const GENERATE_TIMEOUT_MS = 45_000

export const COMMIT_SYSTEM_PROMPT = [
  '你是 Git 提交说明生成器。根据用户给出的 diff 写一条符合 Conventional Commits 的提交说明。',
  '规则：',
  '1. 只输出提交说明本身，不要解释、不要用 Markdown 代码块、不要加引号。',
  '2. 第一行：type(scope): 摘要，不超过 72 个字符。type 只能是 feat、fix、docs、style、refactor、perf、test、chore、build、ci。',
  '3. 如有必要，空一行后写正文：说明为什么改、影响范围；不要逐行复述 diff。',
  '4. 摘要和正文使用中文；文件名、符号、API 名称保持原文。',
  '5. 不要编造 diff 里没有的改动。',
].join('\n')

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

export async function collectChangePayload(
  git: GitService,
  root: string,
  signal?: AbortSignal,
): Promise<{ staged: string; unstaged: string; untracked: Array<{ path: string; patch: string }> }> {
  const status = await git.status(root, signal)
  const dirty = status.staged.length + status.unstaged.length + status.untracked.length
  if (dirty === 0) throw new GitError('NOTHING_TO_DESCRIBE')
  const staged = status.staged.length > 0 ? (await git.diff(root, undefined, true, signal)).text : ''
  const unstaged = status.unstaged.length > 0 ? (await git.diff(root, undefined, false, signal)).text : ''
  const untracked: Array<{ path: string; patch: string }> = []
  for (const file of status.untracked.slice(0, 20)) {
    const safe = assertSafeRepoPath(root, file.path)
    const result = await runGit({
      cwd: root,
      args: ['diff', '--no-color', '--no-index', '--', '/dev/null', safe],
      signal,
      allowNonZero: true,
    })
    untracked.push({ path: file.path, patch: result.stdout.slice(0, 8_000) })
  }
  return { staged, unstaged, untracked }
}

async function resolveRoute(llm: Context['llm']): Promise<{ provider: string; model: string }> {
  const providers = llm.listProviders()
  if (providers.length === 0) throw new GitError('LLM_UNAVAILABLE')
  const ranked = [...providers].sort((left, right) => {
    const score = (id: string): number => (id.includes('deepseek') ? 0 : 1)
    return score(left.id) - score(right.id)
  })
  for (const provider of ranked) {
    const models = await llm.listModels(provider.id)
    if (models[0]?.id) return { provider: provider.id, model: models[0].id }
  }
  return { provider: ranked[0]!.id, model: 'deepseek-chat' }
}

/** One-shot auxiliary LLM call: fixed prompt + current diff → commit message. */
export async function generateCommitMessage(
  ctx: Context,
  git: GitService,
  root: string,
  signal?: AbortSignal,
): Promise<string> {
  const payload = await collectChangePayload(git, root, signal)
  const route = await resolveRoute(ctx.llm)
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, GENERATE_TIMEOUT_MS)
  const onAbort = (): void => { controller.abort() }
  signal?.addEventListener('abort', onAbort)
  try {
    let text = ''
    let fail = ''
    for await (const chunk of ctx.llm.stream({
      provider: route.provider,
      model: route.model,
      system: COMMIT_SYSTEM_PROMPT,
      messages: [{
        id: crypto.randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: buildCommitUserPrompt(payload) }],
        source: { kind: 'plugin', plugin: 'dsh-workbench-plugin' },
      }],
      maxTokens: 256,
      temperature: 0.2,
      signal: controller.signal,
    })) {
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
      if (chunk.type === 'finish' && (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted')) {
        fail = chunk.reason.failure?.message ?? '模型没有返回可用结果'
      }
    }
    if (fail !== '') throw new GitError('LLM_FAILED', fail)
    const message = sanitizeCommitMessage(text)
    if (message === '') throw new GitError('LLM_FAILED', '模型没有返回提交说明。')
    return message
  } catch (error) {
    if (error instanceof GitError) throw error
    throw new GitError('LLM_FAILED', error instanceof Error ? error.message : String(error))
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
