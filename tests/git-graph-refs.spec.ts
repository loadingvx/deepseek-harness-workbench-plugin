import { describe, expect, it } from 'vitest'
import { toRefMark } from '../src/client/workbench/git-refs.ts'
import { parseParents } from '../src/host/git-service.ts'

describe('toRefMark', () => {
  it('keeps typed marks from the host', () => {
    expect(toRefMark({ name: 'v0.1.0', kind: 'tag' })).toEqual({ name: 'v0.1.0', kind: 'tag' })
    expect(toRefMark({ name: 'main', kind: 'branch' })).toEqual({ name: 'main', kind: 'branch' })
  })

  it('still shows text when an old host sends plain strings', () => {
    expect(toRefMark('v0.1.0')).toEqual({ name: 'v0.1.0', kind: 'branch' })
    expect(toRefMark('tag: v0.1.0')).toEqual({ name: 'v0.1.0', kind: 'tag' })
    expect(toRefMark('origin/main')).toEqual({ name: 'origin/main', kind: 'remote' })
  })

  it('uses Git ref namespaces instead of guessing from slashes', () => {
    expect(toRefMark('refs/heads/feature/login')).toEqual({ name: 'feature/login', kind: 'branch' })
    expect(toRefMark('refs/remotes/origin/feature/login')).toEqual({ name: 'origin/feature/login', kind: 'remote' })
    expect(toRefMark('refs/tags/v1.0.0')).toEqual({ name: 'v1.0.0', kind: 'tag' })
    expect(toRefMark({ name: 'refs/heads/release/v2', kind: 'branch' })).toEqual({
      name: 'release/v2',
      kind: 'branch',
    })
  })

  it('drops empty values so the pill is not blank', () => {
    expect(toRefMark('')).toBeNull()
    expect(toRefMark({ name: '  ', kind: 'tag' })).toBeNull()
  })

  it('hides origin/HEAD', () => {
    expect(toRefMark('origin/HEAD')).toBeNull()
    expect(toRefMark({ name: 'origin/HEAD', kind: 'remote' })).toBeNull()
  })
})

describe('parseParents', () => {
  it('reads space-separated hashes and drops junk', () => {
    expect(parseParents('aaaabbbbccccddddaaaabbbbccccddddaaaabbbb ccccaaaabbbbddddccccffff')).toEqual([
      'aaaabbbbccccddddaaaabbbbccccddddaaaabbbb',
      'ccccaaaabbbbddddccccffff',
    ])
    expect(parseParents('')).toEqual([])
    expect(parseParents('not-a-hash')).toEqual([])
  })
})
