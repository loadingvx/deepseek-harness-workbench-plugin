export const MAX_COMMIT_TEMPLATE_CHARS = 4_000

export const DEFAULT_COMMIT_TEMPLATE_ZH = [
  '你是 Git 提交说明生成器。根据用户给出的 diff 写一条符合 Conventional Commits 的提交说明。',
  '规则：',
  '1. 只输出提交说明本身，不要解释、不要用 Markdown 代码块、不要加引号。',
  '2. 第一行：type(scope): 摘要，不超过 72 个字符。type 只能是 feat、fix、docs、style、refactor、perf、test、chore、build、ci。',
  '3. 如有必要，空一行后写正文：说明为什么改、影响范围；不要逐行复述 diff。',
  '4. 摘要和正文使用中文；文件名、符号、API 名称保持原文。',
  '5. 不要编造 diff 里没有的改动。',
].join('\n')

export const DEFAULT_COMMIT_TEMPLATE_EN = [
  'You are a Git commit-message generator. Write a Conventional Commits message from the given diff.',
  'Rules:',
  '1. Output only the commit message. No explanation, no Markdown fences, no quotation marks.',
  '2. First line: type(scope): summary, at most 72 characters. type must be feat, fix, docs, style, refactor, perf, test, chore, build, or ci.',
  '3. If needed, add a blank line and a body: why it changed and the impact. Do not restate the diff line by line.',
  '4. Write the summary and body in English. Keep file names, symbols, and API names as-is.',
  '5. Do not invent changes that are not in the diff.',
].join('\n')

/** Host fallback when the client sends nothing. UI should send the locale default. */
export const DEFAULT_COMMIT_TEMPLATE = DEFAULT_COMMIT_TEMPLATE_ZH

export function defaultCommitTemplates(): readonly string[] {
  return [DEFAULT_COMMIT_TEMPLATE_ZH, DEFAULT_COMMIT_TEMPLATE_EN]
}

/** Empty / oversized / non-string input falls back to the built-in Chinese template. */
export function resolveCommitTemplate(raw: unknown, fallback = DEFAULT_COMMIT_TEMPLATE): string {
  if (typeof raw !== 'string') return fallback
  const trimmed = raw.replace(/\r\n/g, '\n').trim()
  if (trimmed === '') return fallback
  return trimmed.length > MAX_COMMIT_TEMPLATE_CHARS
    ? trimmed.slice(0, MAX_COMMIT_TEMPLATE_CHARS).trim()
    : trimmed
}

export function isDefaultCommitTemplate(raw: string): boolean {
  const resolved = resolveCommitTemplate(raw)
  return defaultCommitTemplates().includes(resolved)
}
