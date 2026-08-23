import { describe, expect, it } from 'vitest'
import { invalidBranchName, normalizeBranchName } from '../src/shared/branch-name.ts'

describe('invalidBranchName', () => {
  it('accepts ordinary and Chinese names', () => {
    expect(invalidBranchName('feature/login')).toBeNull()
    expect(invalidBranchName('修复登录')).toBeNull()
    expect(invalidBranchName('v1.2')).toBeNull()
  })

  it('rejects empty, reserved, and unsafe names', () => {
    expect(invalidBranchName('   ')).toBe('empty')
    expect(invalidBranchName('HEAD')).toBe('invalid')
    expect(invalidBranchName('-evil')).toBe('invalid')
    expect(invalidBranchName('foo bar')).toBe('invalid')
    expect(invalidBranchName('a..b')).toBe('invalid')
    expect(invalidBranchName('foo/')).toBe('invalid')
    expect(invalidBranchName('a'.repeat(65))).toBe('invalid')
  })
})

describe('normalizeBranchName', () => {
  it('trims surrounding spaces', () => {
    expect(normalizeBranchName('  feature/login  ')).toBe('feature/login')
  })
})
