import { describe, expect, it } from 'vitest'
import { pickWorkspace } from '../src/client/workbench/useWorkspace.ts'

describe('pickWorkspace', () => {
  const items = [
    { workspaceId: 'a', path: '/a', title: 'A', sessionIds: ['s1'] },
    { workspaceId: 'b', path: '/b', title: 'B', sessionIds: ['s2'] },
  ]

  it('prefers the workspace that owns the current session', () => {
    expect(pickWorkspace(items, 's2', 'a')?.workspaceId).toBe('b')
  })

  it('falls back to the recent workspace, then the first one', () => {
    expect(pickWorkspace(items, undefined, 'b')?.workspaceId).toBe('b')
    expect(pickWorkspace(items, undefined, undefined)?.workspaceId).toBe('a')
    expect(pickWorkspace([], undefined, undefined)).toBeUndefined()
  })
})
