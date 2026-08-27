import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COMMIT_TEMPLATE,
  DEFAULT_COMMIT_TEMPLATE_EN,
  DEFAULT_COMMIT_TEMPLATE_ZH,
  isDefaultCommitTemplate,
  resolveCommitTemplate,
} from '../src/shared/commit-template.ts'
import {
  buildCommitUserPrompt,
  collectCommitText,
  generateCommitMessage,
  pickCommitReasoningEffort,
  pickCommitRoute,
  previewCommitMessage,
  sanitizeCommitMessage,
  streamCommitMessage,
} from '../src/host/commit-message.ts'
import { parseCommitStreamLine } from '../src/shared/commit-stream.ts'
import { parseDecorations } from '../src/host/git-service.ts'

describe('parseDecorations', () => {
  it('reads HEAD and the current branch', () => {
    expect(parseDecorations('HEAD -> main, origin/main')).toEqual({
      head: true,
      refs: [
        { name: 'main', kind: 'branch' },
        { name: 'origin/main', kind: 'remote' },
      ],
    })
  })

  it('treats a bare HEAD as detached', () => {
    expect(parseDecorations('HEAD')).toEqual({ head: true, refs: [] })
  })

  it('keeps tags distinct from branches and remotes', () => {
    expect(parseDecorations('tag: v1.0.0, origin/main')).toEqual({
      head: false,
      refs: [
        { name: 'v1.0.0', kind: 'tag' },
        { name: 'origin/main', kind: 'remote' },
      ],
    })
  })

  it('returns empty marks for a blank line', () => {
    expect(parseDecorations('')).toEqual({ head: false, refs: [] })
  })

  it('hides origin/HEAD so the graph does not show a fake remote branch', () => {
    expect(parseDecorations('HEAD -> main, origin/HEAD, origin/main')).toEqual({
      head: true,
      refs: [
        { name: 'main', kind: 'branch' },
        { name: 'origin/main', kind: 'remote' },
      ],
    })
  })

  it('keeps slash local branches as branches when Git prints full ref names', () => {
    expect(parseDecorations('HEAD -> refs/heads/feature/login, refs/remotes/origin/feature/login')).toEqual({
      head: true,
      refs: [
        { name: 'feature/login', kind: 'branch' },
        { name: 'origin/feature/login', kind: 'remote' },
      ],
    })
    expect(parseDecorations('refs/heads/feature/login, tag: refs/tags/v1.0.0')).toEqual({
      head: false,
      refs: [
        { name: 'feature/login', kind: 'branch' },
        { name: 'v1.0.0', kind: 'tag' },
      ],
    })
  })

  it('treats HEAD -> feature/login as a local branch even in short decorate output', () => {
    expect(parseDecorations('HEAD -> feature/login')).toEqual({
      head: true,
      refs: [{ name: 'feature/login', kind: 'branch' }],
    })
  })

  it('hides refs/remotes/*/HEAD from full decorate output', () => {
    expect(parseDecorations(
      'HEAD -> refs/heads/main, refs/remotes/origin/HEAD, refs/remotes/origin/main',
    )).toEqual({
      head: true,
      refs: [
        { name: 'main', kind: 'branch' },
        { name: 'origin/main', kind: 'remote' },
      ],
    })
  })
})

describe('sanitizeCommitMessage', () => {
  it('strips fences and quotes', () => {
    expect(sanitizeCommitMessage('```\nfeat: 修好布局\n```')).toBe('feat: 修好布局')
    expect(sanitizeCommitMessage('"chore: 调整文案"')).toBe('chore: 调整文案')
  })

  it('rejects whitespace-only output', () => {
    expect(sanitizeCommitMessage('   \n')).toBe('')
  })
})

describe('resolveCommitTemplate', () => {
  it('falls back to the built-in Chinese template', () => {
    expect(resolveCommitTemplate('')).toBe(DEFAULT_COMMIT_TEMPLATE_ZH)
    expect(resolveCommitTemplate('   ')).toBe(DEFAULT_COMMIT_TEMPLATE)
    expect(resolveCommitTemplate(undefined)).toBe(DEFAULT_COMMIT_TEMPLATE_ZH)
  })

  it('can fall back to the English template', () => {
    expect(resolveCommitTemplate('', DEFAULT_COMMIT_TEMPLATE_EN)).toBe(DEFAULT_COMMIT_TEMPLATE_EN)
  })

  it('treats both locale defaults as stock templates', () => {
    expect(isDefaultCommitTemplate(DEFAULT_COMMIT_TEMPLATE_ZH)).toBe(true)
    expect(isDefaultCommitTemplate(DEFAULT_COMMIT_TEMPLATE_EN)).toBe(true)
    expect(isDefaultCommitTemplate('只用一行英文摘要')).toBe(false)
  })

  it('keeps a custom template', () => {
    expect(resolveCommitTemplate('只用一行英文摘要')).toBe('只用一行英文摘要')
  })
})

describe('buildCommitUserPrompt', () => {
  it('includes staged, unstaged, and untracked sections', () => {
    const prompt = buildCommitUserPrompt({
      staged: 'diff --git a/a.ts',
      unstaged: 'diff --git a/b.ts',
      untracked: [{ path: 'c.ts', patch: '+export const x = 1' }],
    })
    expect(prompt).toContain('## 已暂存')
    expect(prompt).toContain('## 未暂存')
    expect(prompt).toContain('### c.ts')
    expect(prompt).toContain('+export const x = 1')
  })
})

describe('collectCommitText', () => {
  it('joins text-delta chunks', () => {
    expect(collectCommitText([
      { type: 'block-start', index: 0 },
      { type: 'text-delta', index: 0, text: 'feat: ' },
      { type: 'text-delta', index: 0, text: '修好布局' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'feat: 修好布局' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]).text).toBe('feat: 修好布局')
  })

  it('uses block-end text when deltas never arrive', () => {
    expect(collectCommitText([
      { type: 'block-start', index: 0 },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'fix: 只给了整块文本' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])).toEqual({ text: 'fix: 只给了整块文本', fail: '' })
  })

  it('does not treat reasoning as the commit message', () => {
    const result = collectCommitText([
      { type: 'block-start', index: 0 },
      { type: 'reasoning-delta', index: 0, text: '先想想怎么写…' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: '先想想怎么写…' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    expect(result.text).toBe('')
    expect(result.fail).toContain('思考过程')
    expect(result.fail).toContain('reasoning-delta')
  })

  it('explains a thinking-only max-tokens finish', () => {
    const result = collectCommitText([
      { type: 'reasoning-delta', index: 0, text: '…' },
      { type: 'finish', reason: { kind: 'max-tokens' } },
    ])
    expect(result.fail).toContain('思考过程')
  })

  it('surfaces adapter finish errors', () => {
    expect(collectCommitText([
      { type: 'finish', reason: { kind: 'error', failure: { message: 'no adapter registered', code: 'NO_ADAPTER' } } },
    ]).fail).toContain('no adapter registered')
  })
})

describe('pickCommitRoute', () => {
  it('prefers the user default model when that provider is registered', () => {
    expect(pickCommitRoute(
      [{ id: 'openai' }, { id: 'deepseek-official' }],
      { openai: [{ id: 'gpt' }], 'deepseek-official': [{ id: 'deepseek-v4-flash' }] },
      { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    )).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
  })

  it('does not invent a model id when the catalog is empty', () => {
    expect(() => pickCommitRoute([{ id: 'deepseek-official' }], { 'deepseek-official': [] }))
      .toThrow(/LLM_UNAVAILABLE/)
  })
})

describe('pickCommitReasoningEffort', () => {
  it('turns thinking off when the model publishes off', () => {
    expect(pickCommitReasoningEffort({
      reasoning: { efforts: [{ id: 'off' }, { id: 'high' }] },
    })).toBe('off')
  })

  it('leaves effort unset when the adapter has no reasoning metadata', () => {
    expect(pickCommitReasoningEffort({})).toBeUndefined()
  })
})

describe('previewCommitMessage', () => {
  it('hides an opening fence while the model is still writing', () => {
    expect(previewCommitMessage('```\nfeat: 修好')).toBe('feat: 修好')
    expect(previewCommitMessage('```json\nfeat: 修好\n```')).toBe('feat: 修好')
  })

  it('leaves ordinary text alone', () => {
    expect(previewCommitMessage('feat: 修好布局')).toBe('feat: 修好布局')
  })
})

describe('parseCommitStreamLine', () => {
  it('reads delta, done, and fail lines', () => {
    expect(parseCommitStreamLine('{"type":"delta","text":"feat: "}')).toEqual({ type: 'delta', text: 'feat: ' })
    expect(parseCommitStreamLine('{"type":"done","message":"feat: 修好"}')).toEqual({ type: 'done', message: 'feat: 修好' })
    expect(parseCommitStreamLine('{"ok":false,"code":"LLM_FAILED","messageZh":"失败","hintZh":"重试"}'))
      .toEqual({ ok: false, code: 'LLM_FAILED', messageZh: '失败', hintZh: '重试' })
  })

  it('ignores blank and junk lines', () => {
    expect(parseCommitStreamLine('')).toBeNull()
    expect(parseCommitStreamLine('not-json')).toBeNull()
  })
})

describe('generateCommitMessage', () => {
  it('calls the host LLM with thinking off and returns assembled text', async () => {
    const seen: Record<string, unknown>[] = []
    const ctx = {
      llm: {
        listProviders: () => [{ id: 'deepseek-official' }],
        listModels: async () => [{ id: 'deepseek-v4-flash' }],
        resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'off' }, { id: 'high' }] } }),
        stream: async function* (options: Record<string, unknown>) {
          seen.push(options)
          yield { type: 'text-delta', index: 0, text: 'chore: 调整文案' }
          yield { type: 'block-end', index: 0, block: { type: 'text', text: 'chore: 调整文案' } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      },
      get: () => undefined,
    }
    const git = {
      status: async () => ({
        staged: [{ path: 'a.ts' }],
        unstaged: [],
        untracked: [],
      }),
      diff: async () => ({ text: 'diff --git a/a.ts' }),
    }
    const message = await generateCommitMessage(ctx as never, git as never, '/tmp/repo')
    expect(message).toBe('chore: 调整文案')
    expect(seen[0]?.provider).toBe('deepseek-official')
    expect(seen[0]?.reasoningEffort).toBe('off')
    expect(seen[0]?.purpose).toBe('session-title')
    expect(seen[0]?.maxTokens).toBe(1024)
  })

  it('yields text as the model streams it', async () => {
    const ctx = {
      llm: {
        listProviders: () => [{ id: 'deepseek-official' }],
        listModels: async () => [{ id: 'deepseek-v4-flash' }],
        resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'off' }] } }),
        stream: async function* () {
          yield { type: 'text-delta', index: 0, text: 'feat: ' }
          yield { type: 'text-delta', index: 0, text: '修好布局' }
          yield { type: 'block-end', index: 0, block: { type: 'text', text: 'feat: 修好布局' } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      },
      get: () => undefined,
    }
    const git = {
      status: async () => ({ staged: [{ path: 'a.ts' }], unstaged: [], untracked: [] }),
      diff: async () => ({ text: 'diff --git a/a.ts' }),
    }
    const events: Array<{ type: string; text?: string; message?: string }> = []
    for await (const event of streamCommitMessage(ctx as never, git as never, '/tmp/repo')) {
      events.push(event)
    }
    expect(events.filter(event => event.type === 'delta').map(event => event.text))
      .toEqual(['feat: ', 'feat: 修好布局'])
    expect(events.at(-1)).toEqual({ type: 'done', message: 'feat: 修好布局' })
  })
})
