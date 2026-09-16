// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitClient } from '../src/client/api.ts'
import type { GitStatusSnapshot } from '../src/shared/types.ts'
import { writeGitSyncPrefs } from '../src/shared/git-sync-prefs.ts'
import {
  pauseGitLive,
  readGitLiveStatus,
  refreshGitLiveRemote,
  refreshGitLiveStatus,
  retainGitLive,
  subscribeGitLive,
} from '../src/client/workbench/git-live.ts'

const memory = new Map<string, string>()

beforeEach(() => {
  memory.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, String(value)) },
    removeItem: (key: string) => { memory.delete(key) },
    clear: () => { memory.clear() },
  })
  writeGitSyncPrefs({ pullMode: 'merge', pushMode: 'safe', autoFetchMinutes: 60 })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const snapshot: GitStatusSnapshot = {
  probe: {
    gitAvailable: true,
    isRepo: true,
    detached: false,
    ahead: 0,
    behind: 0,
    hasHead: true,
    branch: 'main',
    remote: 'origin',
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

  it('does not start a second fetch while one is in flight', async () => {
    let finishFetch!: (value: { ok: true; value: { remote: string } }) => void
    const client = mockClient()
    vi.mocked(client.fetch).mockImplementation(() => new Promise((resolve) => {
      finishFetch = resolve
    }))

    const release = retainGitLive(client, 'ws-1', '.')
    await refreshGitLiveStatus()
    const first = refreshGitLiveRemote()
    await Promise.resolve()
    expect(client.fetch).toHaveBeenCalledTimes(1)

    void refreshGitLiveRemote()
    await Promise.resolve()
    expect(client.fetch).toHaveBeenCalledTimes(1)

    finishFetch({ ok: true, value: { remote: 'origin' } })
    await first
    release()
  })
})
