import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INIT_BRANCH,
  invalidGitUserEmail, invalidGitUserName, invalidInitBranch, normalizeInitBranch,
} from '../src/shared/git-identity.ts'

describe('invalidGitUserName', () => {
  it('accepts ordinary and Chinese names', () => {
    expect(invalidGitUserName('Ada')).toBeNull()
    expect(invalidGitUserName('  张三  ')).toBeNull()
  })

  it('rejects empty and control characters', () => {
    expect(invalidGitUserName('   ')).toBe('empty')
    expect(invalidGitUserName('Ada\nLovelace')).toBe('invalid')
    expect(invalidGitUserName('a'.repeat(129))).toBe('invalid')
  })
})

describe('invalidGitUserEmail', () => {
  it('accepts a normal email', () => {
    expect(invalidGitUserEmail('ada@company.com')).toBeNull()
    expect(invalidGitUserEmail('  user@localhost  ')).toBeNull()
  })

  it('rejects empty, spaces, and missing @', () => {
    expect(invalidGitUserEmail('')).toBe('empty')
    expect(invalidGitUserEmail('not-an-email')).toBe('invalid')
    expect(invalidGitUserEmail('ada @company.com')).toBe('invalid')
  })
})

describe('normalizeInitBranch', () => {
  it('defaults empty input to main', () => {
    expect(normalizeInitBranch('')).toBe(DEFAULT_INIT_BRANCH)
    expect(normalizeInitBranch('  develop  ')).toBe('develop')
  })
})

describe('invalidInitBranch', () => {
  it('accepts empty because it becomes main', () => {
    expect(invalidInitBranch('')).toBeNull()
    expect(invalidInitBranch('main')).toBeNull()
  })

  it('rejects names git would refuse', () => {
    expect(invalidInitBranch('foo bar')).toBe('invalid')
    expect(invalidInitBranch('-evil')).toBe('invalid')
  })
})
