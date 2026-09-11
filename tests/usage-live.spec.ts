// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import type { GitClient } from '../src/client/api.ts'
import type { ProviderUsageSnapshot } from '../src/shared/types.ts'
import {
  bindUsageLiveSession,
  readUsageLive,
  readUsageLiveSession,
  refreshUsageLive,
  retainUsageLive,
  resetUsageLiveForTests,
  subscribeUsageLive,
} from '../src/client/workbench/usage-live.ts'

function snapshot(total: string, modelName = 'DeepSeek'): ProviderUsageSnapshot {
  return {
    provider: 'deepseek-official',
    providerName: 'DeepSeek',
    model: 'deepseek-chat',
    modelName,
    source: 'default',
    balanceStatus: 'ok',
    balances: [{ currency: 'CNY', total }],
    fetchedAt: 1,
  }
}

function fakeClient(bySession: Record<string, ProviderUsageSnapshot>): GitClient {
  return {
    usage: async (sessionId?: string) => {
      const key = sessionId ?? ''
      const value = bySession[key] ?? snapshot('0', 'none')
      return { ok: true as const, value }
    },
  } as GitClient
}

afterEach(() => {
  resetUsageLiveForTests()
})

describe('usage live store', () => {
  it('publishes the latest successful balance to every subscriber', async () => {
    let ticks = 0
    const unsub = subscribeUsageLive(() => { ticks += 1 })
    const stop = retainUsageLive(fakeClient({ s1: snapshot('1.95') }), 's1')
    await refreshUsageLive()
    expect(readUsageLive()?.balances[0]?.total).toBe('1.95')
    expect(ticks).toBeGreaterThan(0)
    unsub()
    stop()
  })

  it('keeps pulls on the bound current session when a stale retain passes another id', async () => {
    const client = fakeClient({
      s1: snapshot('1.00', 'glm-pro'),
      s2: snapshot('2.00', 'deepseek-flash'),
    })
    bindUsageLiveSession('s2')
    const stopStale = retainUsageLive(client, 's1')
    const stopCurrent = retainUsageLive(client, 's2')
    await refreshUsageLive()
    expect(readUsageLiveSession()).toBe('s2')
    expect(readUsageLive()?.modelName).toBe('deepseek-flash')
    expect(readUsageLive()?.balances[0]?.total).toBe('2.00')
    stopStale()
    stopCurrent()
  })

  it('rebinds and clears when harness current session changes', async () => {
    const client = fakeClient({
      s1: snapshot('1.00', 'glm-pro'),
      s2: snapshot('2.00', 'deepseek-flash'),
    })
    bindUsageLiveSession('s1')
    const stop = retainUsageLive(client, 's1')
    await refreshUsageLive()
    expect(readUsageLive()?.modelName).toBe('glm-pro')

    bindUsageLiveSession('s2')
    expect(readUsageLive()).toBeNull()
    expect(readUsageLiveSession()).toBe('s2')
    await refreshUsageLive()
    expect(readUsageLive()?.modelName).toBe('deepseek-flash')
    stop()
  })
})
