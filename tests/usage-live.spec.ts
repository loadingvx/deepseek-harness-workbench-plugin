// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import type { GitClient } from '../src/client/api.ts'
import type { ProviderUsageSnapshot } from '../src/shared/types.ts'
import {
  readUsageLive,
  refreshUsageLive,
  retainUsageLive,
  subscribeUsageLive,
} from '../src/client/workbench/usage-live.ts'

function snapshot(total: string): ProviderUsageSnapshot {
  return {
    provider: 'deepseek-official',
    providerName: 'DeepSeek',
    model: 'deepseek-chat',
    modelName: 'DeepSeek',
    source: 'default',
    balanceStatus: 'ok',
    balances: [{ currency: 'CNY', total }],
    fetchedAt: 1,
  }
}

function fakeClient(total: string): GitClient {
  return {
    usage: async () => ({ ok: true, value: snapshot(total) }),
  } as GitClient
}

describe('usage live store', () => {
  it('publishes the latest successful balance to every subscriber', async () => {
    let ticks = 0
    const unsub = subscribeUsageLive(() => { ticks += 1 })
    const stop = retainUsageLive(fakeClient('1.95'), 's1')
    await refreshUsageLive()
    expect(readUsageLive()?.balances[0]?.total).toBe('1.95')
    expect(ticks).toBeGreaterThan(0)
    unsub()
    stop()
  })
})
