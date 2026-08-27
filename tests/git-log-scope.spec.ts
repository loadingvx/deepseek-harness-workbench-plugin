import { describe, expect, it } from 'vitest'
import { parseGitLogScope } from '../src/shared/git-log-scope.ts'

describe('parseGitLogScope', () => {
  it('defaults missing or blank values to the current checkout', () => {
    expect(parseGitLogScope(undefined)).toBe('head')
    expect(parseGitLogScope('')).toBe('head')
    expect(parseGitLogScope('  ')).toBe('head')
  })

  it('accepts head and all, ignoring case and padding', () => {
    expect(parseGitLogScope('head')).toBe('head')
    expect(parseGitLogScope('HEAD')).toBe('head')
    expect(parseGitLogScope(' all ')).toBe('all')
  })

  it('rejects unknown values so the API can return a readable error', () => {
    expect(parseGitLogScope('everything')).toBeNull()
    expect(parseGitLogScope('current')).toBeNull()
    expect(parseGitLogScope('--all')).toBeNull()
  })
})
