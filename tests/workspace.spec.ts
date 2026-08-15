import { describe, expect, it } from 'vitest'
import { GitError } from '../src/shared/errors.ts'
import { resolveWorkspacePath } from '../src/host/workspace.ts'

function ctxWith(registry?: { get: (id: string) => { path: string } | undefined; list: () => Array<{ id: string; path: string }> }) {
  return { get: (name: string) => (name === 'workspaceRegistry' ? registry : undefined) } as never
}

describe('resolveWorkspacePath', () => {
  it('uses an explicit workspace id', () => {
    const ctx = ctxWith({
      get: id => (id === 'ws-1' ? { path: '/repo' } : undefined),
      list: () => [{ id: 'ws-1', path: '/repo' }],
    })
    expect(resolveWorkspacePath(ctx, 'ws-1')).toBe('/repo')
  })

  it('falls back to the only registered workspace', () => {
    const ctx = ctxWith({
      get: () => undefined,
      list: () => [{ id: 'ws-1', path: '/only' }],
    })
    expect(resolveWorkspacePath(ctx, undefined)).toBe('/only')
  })

  it('uses session cwd when no id is given and several workspaces exist', () => {
    const ctx = ctxWith({
      get: () => undefined,
      list: () => [{ id: 'a', path: '/a' }, { id: 'b', path: '/b' }],
    })
    expect(resolveWorkspacePath(ctx, undefined, '/session')).toBe('/session')
  })

  it('rejects an unknown workspace id', () => {
    const ctx = ctxWith({ get: () => undefined, list: () => [] })
    expect(() => resolveWorkspacePath(ctx, 'missing')).toThrow(GitError)
  })

  it('rejects when nothing can be resolved', () => {
    const ctx = ctxWith({ get: () => undefined, list: () => [] })
    expect(() => resolveWorkspacePath(ctx)).toThrow(GitError)
  })
})
