import { describe, expect, it } from 'vitest'
import {
  CURRENT_REPO_ID, PARENT_REPO_ID, folderNameFromPath, isCurrentRepoId, isSkippedChildName,
  parentNeedsAsk, parseNearbyRepoId, pickNearbyRepoId, visibleNearbyRepos,
} from '../src/shared/git-nearby.ts'
import type { NearbyGitSnapshot } from '../src/shared/types.ts'

const snapshot = (parent: boolean, children: string[] = []): NearbyGitSnapshot => ({
  workspaceName: 'app',
  current: { id: CURRENT_REPO_ID, kind: 'current', name: 'app', isRepo: true },
  parent: parent ? { id: PARENT_REPO_ID, kind: 'parent', name: 'work', isRepo: true } : null,
  children: children.map(name => ({ id: name, kind: 'child' as const, name, isRepo: true })),
})

describe('parseNearbyRepoId', () => {
  it('treats empty and . as the current folder', () => {
    expect(parseNearbyRepoId(undefined)).toEqual({ kind: 'current' })
    expect(parseNearbyRepoId('')).toEqual({ kind: 'current' })
    expect(parseNearbyRepoId('.')).toEqual({ kind: 'current' })
    expect(isCurrentRepoId('.')).toBe(true)
  })

  it('accepts .. as the parent and a child or nested submodule path', () => {
    expect(parseNearbyRepoId('..')).toEqual({ kind: 'parent' })
    expect(parseNearbyRepoId('packages')).toEqual({ kind: 'child', child: 'packages' })
    expect(parseNearbyRepoId('third_party/sdk')).toEqual({ kind: 'child', child: 'third_party/sdk' })
  })

  it('rejects path escapes', () => {
    expect(parseNearbyRepoId('../secret')).toBeNull()
    expect(parseNearbyRepoId('a/../b')).toBeNull()
    expect(parseNearbyRepoId('foo..bar')).toBeNull()
    expect(parseNearbyRepoId('-evil')).toBeNull()
    expect(parseNearbyRepoId('a\\b')).toBeNull()
    expect(parseNearbyRepoId('/abs')).toBeNull()
  })
})

describe('visibleNearbyRepos', () => {
  it('always includes the current folder and auto-includes children', () => {
    const list = visibleNearbyRepos(snapshot(true, ['lib', 'cli']), null)
    expect(list.map(item => item.id)).toEqual(['.', 'lib', 'cli'])
  })

  it('adds the parent only after the user includes it', () => {
    const before = visibleNearbyRepos(snapshot(true, ['lib']), null)
    const after = visibleNearbyRepos(snapshot(true, ['lib']), 'include')
    const skipped = visibleNearbyRepos(snapshot(true, ['lib']), 'skip')
    expect(before.map(item => item.id)).toEqual(['.', 'lib'])
    expect(after.map(item => item.id)).toEqual(['.', '..', 'lib'])
    expect(skipped.map(item => item.id)).toEqual(['.', 'lib'])
  })
})

describe('pickNearbyRepoId', () => {
  it('keeps the current folder when the saved id disappeared', () => {
    const repos = visibleNearbyRepos(snapshot(false, ['lib']), null)
    expect(pickNearbyRepoId(repos, '..')).toBe('.')
    expect(pickNearbyRepoId(repos, 'lib')).toBe('lib')
  })
})

describe('parentNeedsAsk', () => {
  it('asks once when a parent repo exists and there is no saved decision', () => {
    expect(parentNeedsAsk(snapshot(true), null)).toBe(true)
    expect(parentNeedsAsk(snapshot(true), 'skip')).toBe(false)
    expect(parentNeedsAsk(snapshot(false), null)).toBe(false)
  })
})

describe('folderNameFromPath', () => {
  it('takes the last segment', () => {
    expect(folderNameFromPath('/Users/me/app')).toBe('app')
    expect(folderNameFromPath('/')).toBe('/')
  })
})

describe('isSkippedChildName', () => {
  it('skips node_modules so a huge install tree is not scanned as a repo', () => {
    expect(isSkippedChildName('node_modules')).toBe(true)
    expect(isSkippedChildName('packages')).toBe(false)
  })
})
