import { describe, expect, it } from 'vitest'
import {
  applyHunkToBaseline,
  computeReviewHunks,
  hashText,
  reverseHunkOnCurrent,
} from '../src/shared/review-hunks.ts'

describe('review-hunks', () => {
  it('computes a single edit hunk', () => {
    const hunks = computeReviewHunks('a.ts', 'one\ntwo\nthree\n', 'one\nTWO\nthree\n')
    expect(hunks.length).toBe(1)
    expect(hunks[0]!.oldText).toContain('two')
    expect(hunks[0]!.newText).toContain('TWO')
  })

  it('keep hunk folds baseline toward current', () => {
    const before = 'a\nb\nc\n'
    const after = 'a\nB\nc\n'
    const hunks = computeReviewHunks('f', before, after)
    const next = applyHunkToBaseline(before, hunks[0]!)
    expect(next).toBe(after)
    expect(computeReviewHunks('f', next, after)).toEqual([])
  })

  it('undo hunk reverses current toward baseline', () => {
    const before = 'a\nb\nc\n'
    const after = 'a\nB\nc\n'
    const hunks = computeReviewHunks('f', before, after)
    const restored = reverseHunkOnCurrent(after, hunks[0]!)
    expect(restored).toBe(before)
  })

  it('handles create-file as null baseline', () => {
    const hunks = computeReviewHunks('new.ts', null, 'hello\n')
    expect(hunks.length).toBeGreaterThan(0)
    const kept = applyHunkToBaseline(null, hunks[0]!)
    expect(kept).toBe(hunks[0]!.newText)
    expect(hashText(kept)).toHaveLength(64)
  })

  it('undo create hunk clears content', () => {
    const hunks = computeReviewHunks('new.ts', null, 'hello\n')
    expect(reverseHunkOnCurrent('hello\n', hunks[0]!)).toBe('')
  })
})
