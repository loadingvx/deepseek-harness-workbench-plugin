// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitClient } from '../src/client/api.ts'
import type { GitStatusSnapshot } from '../src/shared/types.ts'
import {
  pauseGitLive,
  readGitLiveStatus,
  refreshGitLiveStatus,
  retainGitLive,
  subscribeGitLive,
} from '../src/client/workbench/git-live.ts'

const snapshot: GitStatusSnapshot = {
  probe: {
    gitAvailable: true,
    isRepo: true,
    detached: false,
    ahead: 0,
    behind: 0,
    hasHead: true,
    branch: 'main',
  },
  staged: [],
  unstaged: [],
  untracked: [],
}

function mockClient(): GitClient {
  return {
    status: vi.fn(async () => ({ ok: true as const, value: snapshot })),
    fetch: vi.fn(async () => ({ ok: true as const, value: { remote: 'origin' } })),
  } as unknown as GitClient
}

afterEach(() => {
  vi.useRealTimers()
})

describe('git-live shared polling', () => {
  it('dedupes consumers and exposes the latest status', async () => {
    const client = mockClient()
    const offA = retainGitLive(client, 'ws-1', '.')
    const offB = retainGitLive(client, 'ws-1', '.')
    await refreshGitLiveStatus()
    expect(readGitLiveStatus()).toEqual(snapshot)
    offA()
    offB()
  })

  it('pauses polling while a write lock is held', async () => {
    vi.useFakeTimers()
    const client = mockClient()
    const seen: Array<GitStatusSnapshot | null> = []
    const offSub = subscribeGitLive(() => { seen.push(readGitLiveStatus()) })
    const release = retainGitLive(client, 'ws-1', '.')
    await Promise.resolve()
    vi.mocked(client.status).mockClear()
    const pause = pauseGitLive()
    vi.advanceTimersByTime(8000)
    await Promise.resolve()
    expect(client.status).not.toHaveBeenCalled()
    pause()
    vi.advanceTimersByTime(8000)
    await Promise.resolve()
    expect(client.status).toHaveBeenCalled()
    offSub()
    release()
  })
})
