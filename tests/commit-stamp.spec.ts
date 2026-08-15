import { describe, expect, it } from 'vitest'
import { formatCommitStamp, formatCommitTooltip } from '../src/client/workbench/commit-stamp.ts'

describe('formatCommitStamp', () => {
  const now = new Date(2026, 7, 15, 21, 0, 0)

  it('shows time of day when the commit is today', () => {
    expect(formatCommitStamp(new Date(2026, 7, 15, 9, 4, 7).toISOString(), now)).toBe('09:04:07')
  })

  it('shows YYYY-MM-DD when the commit is on another day', () => {
    expect(formatCommitStamp(new Date(2026, 2, 1, 23, 59, 1).toISOString(), now)).toBe('2026-03-01')
    expect(formatCommitStamp(new Date(2026, 7, 14, 23, 59, 59).toISOString(), now)).toBe('2026-08-14')
  })

  it('returns empty text for missing or invalid dates', () => {
    expect(formatCommitStamp('', now)).toBe('')
    expect(formatCommitStamp('not-a-date', now)).toBe('')
  })
})

describe('formatCommitTooltip', () => {
  it('always includes date and time for hover', () => {
    expect(formatCommitTooltip(new Date(2026, 2, 1, 14, 32, 1).toISOString())).toBe('2026-03-01 14:32:01')
  })
})
