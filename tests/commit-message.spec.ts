import { describe, expect, it } from 'vitest'
import { buildCommitUserPrompt, sanitizeCommitMessage } from '../src/host/commit-message.ts'
import { parseDecorations } from '../src/host/git-service.ts'

describe('parseDecorations', () => {
  it('reads HEAD and the current branch', () => {
    expect(parseDecorations('HEAD -> main, origin/main')).toEqual({
      head: true,
      refs: ['main', 'origin/main'],
    })
  })

  it('treats a bare HEAD as detached', () => {
    expect(parseDecorations('HEAD')).toEqual({ head: true, refs: [] })
  })

  it('strips tag prefixes', () => {
    expect(parseDecorations('tag: v1.0.0, origin/main')).toEqual({
      head: false,
      refs: ['v1.0.0', 'origin/main'],
    })
  })

  it('returns empty marks for a blank line', () => {
    expect(parseDecorations('')).toEqual({ head: false, refs: [] })
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
