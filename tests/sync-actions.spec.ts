import { describe, expect, it } from 'vitest'
import { visibleSyncActions } from '../src/shared/sync-actions.ts'

describe('visibleSyncActions', () => {
  const base = {
    dirtyCount: 0,
    detached: false,
    ahead: 0,
    behind: 0,
    hasRemote: true,
    hasUpstream: true,
    hasHead: true,
  }

  it('shows only commit when the worktree is dirty and already synced', () => {
    expect(visibleSyncActions({ ...base, dirtyCount: 2 })).toEqual({
      commit: true, push: false, pull: false,
    })
  })

  it('shows only push after a local commit that is not on the remote', () => {
    expect(visibleSyncActions({ ...base, ahead: 1 })).toEqual({
      commit: false, push: true, pull: false,
    })
  })

  it('shows push for the first publish when there is a remote but no upstream', () => {
    expect(visibleSyncActions({ ...base, hasUpstream: false })).toEqual({
      commit: false, push: true, pull: false,
    })
  })

  it('does not show push for unpublished branches while there are still local edits', () => {
    expect(visibleSyncActions({ ...base, hasUpstream: false, dirtyCount: 1 })).toEqual({
      commit: true, push: false, pull: false,
    })
  })

  it('shows only pull when the remote is ahead', () => {
    expect(visibleSyncActions({ ...base, behind: 2 })).toEqual({
      commit: false, push: false, pull: true,
    })
  })

  it('can show all three when dirty, ahead, and behind', () => {
    expect(visibleSyncActions({ ...base, dirtyCount: 1, ahead: 1, behind: 1 })).toEqual({
      commit: true, push: true, pull: true,
    })
  })

  it('hides push and pull without a remote or on detached HEAD', () => {
    expect(visibleSyncActions({ ...base, ahead: 1, behind: 1, hasRemote: false })).toEqual({
      commit: false, push: false, pull: false,
    })
    expect(visibleSyncActions({ ...base, dirtyCount: 1, ahead: 1, behind: 1, detached: true })).toEqual({
      commit: true, push: false, pull: false,
    })
  })
})
