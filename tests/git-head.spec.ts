import { describe, expect, it } from 'vitest'
import { headChangedOf, headKeyOf } from '../src/client/workbench/git-head.ts'

const repoProbe = {
  gitAvailable: true,
  isRepo: true,
  detached: false,
  ahead: 0,
  behind: 0,
  hasHead: true,
  branch: 'main',
}

describe('headKeyOf', () => {
  it('returns the HEAD identity for a normal repo', () => {
    expect(headKeyOf(repoProbe)).toEqual({ branch: 'main', detached: false, hasHead: true })
  })

  it('returns null when git is unavailable or the folder is not a repo', () => {
    expect(headKeyOf({ ...repoProbe, gitAvailable: false })).toBeNull()
    expect(headKeyOf({ ...repoProbe, isRepo: false })).toBeNull()
  })

  it('keeps an undefined branch for a detached HEAD', () => {
    expect(headKeyOf({ ...repoProbe, detached: true, branch: undefined }))
      .toEqual({ branch: undefined, detached: true, hasHead: true })
  })
})

describe('headChangedOf', () => {
  const main: { branch?: string; detached: boolean; hasHead: boolean } = { branch: 'main', detached: false, hasHead: true }

  it('treats a branch switch as a change', () => {
    expect(headChangedOf(main, { branch: 'feature/x', detached: false, hasHead: true })).toBe(true)
  })

  it('treats detaching / re-attaching as a change', () => {
    expect(headChangedOf(main, { branch: undefined, detached: true, hasHead: true })).toBe(true)
    expect(headChangedOf({ branch: undefined, detached: true, hasHead: true }, main)).toBe(true)
  })

  it('treats the first seen identity as no change (no spurious refresh)', () => {
    expect(headChangedOf(null, main)).toBe(false)
  })

  it('ignores transitions into a non-repo / no-git state', () => {
    expect(headChangedOf(main, null)).toBe(false)
  })

  it('treats a missing HEAD as a change once a HEAD existed', () => {
    expect(headChangedOf(main, { branch: undefined, detached: true, hasHead: false })).toBe(true)
  })

  it('is false for the same identity and for pure file-list changes', () => {
    expect(headChangedOf(main, { ...main })).toBe(false)
    expect(headChangedOf(main, main)).toBe(false)
  })
})
