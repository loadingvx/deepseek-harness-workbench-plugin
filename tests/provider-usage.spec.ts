import { describe, expect, it } from 'vitest'
import { readProviderUsage } from '../src/host/provider-usage.ts'
import {
  billedInputTokens,
  billingOrigin,
  billingUrls,
  cacheHitPercent,
  contextOccupancy,
  formatMoney,
  formatTokenCount,
  parseBalanceBody,
  spentFromRow,
  totalBilledTokens,
} from '../src/shared/usage-format.ts'

describe('formatTokenCount', () => {
  it('keeps small counts as integers', () => {
    expect(formatTokenCount(0)).toBe('0')
    expect(formatTokenCount(517)).toBe('517')
  })

  it('compacts thousands and millions', () => {
    expect(formatTokenCount(12_200)).toBe('12.2K')
    expect(formatTokenCount(1_200_000)).toBe('1.2M')
  })
})

describe('token totals', () => {
  it('adds the three disjoint prompt buckets', () => {
    const usage = { uncachedInputTokens: 10, outputTokens: 4, cacheReadTokens: 3, cacheWriteTokens: 2 }
    expect(billedInputTokens(usage)).toBe(15)
    expect(totalBilledTokens(usage)).toBe(19)
    expect(cacheHitPercent(usage)).toBe(20)
  })

  it('hides cache hit when nothing was billed', () => {
    expect(cacheHitPercent({ uncachedInputTokens: 0, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeNull()
  })
})

describe('contextOccupancy', () => {
  it('uses projected tokens when present', () => {
    expect(contextOccupancy({ projectedTokens: 32_000, pressureTokens: 10, contextWindow: 100_000 }))
      .toEqual({ percent: 32, usedTokens: 32_000, contextWindow: 100_000 })
  })

  it('stays empty until both occupancy and capacity exist', () => {
    expect(contextOccupancy({ pressureTokens: 10 })).toBeNull()
    expect(contextOccupancy({ contextWindow: 100 })).toBeNull()
  })
})

describe('billingUrls', () => {
  it('tries DeepSeek /user/balance at the origin even when the catalog uses /v1', () => {
    expect(billingOrigin('https://api.deepseek.com/v1/')).toBe('https://api.deepseek.com')
    expect(billingUrls('https://api.deepseek.com/v1')).toContain('https://api.deepseek.com/user/balance')
  })
})

describe('parseBalanceBody', () => {
  it('reads DeepSeek user/balance', () => {
    expect(parseBalanceBody({
      is_available: true,
      balance_infos: [
        { currency: 'CNY', total_balance: '50.00', granted_balance: '0.00', topped_up_balance: '50.00' },
        { currency: 'USD', total_balance: '1.20' },
      ],
    })).toEqual({
      accountAvailable: true,
      balances: [
        { currency: 'CNY', total: '50.00', granted: '0.00', toppedUp: '50.00' },
        { currency: 'USD', total: '1.20' },
      ],
    })
  })

  it('reads a nested OpenAI-style credit grant', () => {
    expect(parseBalanceBody({
      total_available: '12.5',
      total_granted: '20',
      total_used: '7.5',
    })).toEqual({
      balances: [{ currency: '', total: '12.5', granted: '20', used: '7.5' }],
    })
  })

  it('reads SiliconFlow-style data.balance', () => {
    expect(parseBalanceBody({ code: 20000, data: { balance: '0.88', status: 'normal' } }))
      .toEqual({ accountAvailable: true, balances: [{ currency: '', total: '0.88' }] })
  })

  it('rejects unknown JSON instead of inventing a zero', () => {
    expect(parseBalanceBody({ ok: true })).toBeNull()
    expect(parseBalanceBody('nope')).toBeNull()
  })
})

describe('formatMoney', () => {
  it('uses ¥ / $ without repeating the currency code', () => {
    expect(formatMoney({ currency: 'CNY', total: '50.00' })).toBe('¥50.00')
    expect(formatMoney({ currency: 'USD', total: '1.2' })).toBe('$1.2')
  })
})

describe('spentFromRow', () => {
  it('uses an explicit used field', () => {
    expect(spentFromRow({ currency: 'USD', total: '12.5', used: '7.5' })).toBe('7.5')
  })

  it('derives spend from topped-up plus granted minus remaining', () => {
    expect(spentFromRow({
      currency: 'CNY',
      total: '9.10',
      granted: '0.00',
      toppedUp: '10.00',
    })).toBe('0.90')
  })

  it('does not invent spend when the payload has no cost basis', () => {
    expect(spentFromRow({ currency: 'CNY', total: '9.10' })).toBeUndefined()
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function ctx(options?: {
  selection?: { provider: string; model: string; reasoningEffort?: string }
  session?: { provider: string; model: string }
  settings?: Record<string, unknown>
  key?: string
}) {
  const settings = options?.settings ?? { 'llm-deepseek': { apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: 'https://api.deepseek.com' } }
  return {
    llm: {
      listProviders: () => [{ id: 'deepseek-official' }],
      listConfigurableProviders: () => [{ provider: 'deepseek-official', displayName: 'DeepSeek' }],
      listModels: async () => [{ id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' }],
      resolveModelInfo: async () => ({ name: 'DeepSeek-V4-Pro' }),
    },
    agentDefaultModel: {
      currentSelection: () => options?.selection ?? {
        provider: 'deepseek-official',
        model: 'deepseek-v4-pro',
        reasoningEffort: 'high',
      },
    },
    get: (name: string) => {
      if (name === 'settings') return { get: (ns: string) => settings[ns] }
      if (name === 'credentials') {
        return {
          resolve: async () => options?.key === undefined ? undefined : { value: options.key },
        }
      }
      if (name === 'agents' && options?.session !== undefined) {
        return {
          get: () => ({
            session: {
              requestHeader: () => ({ config: options.session }),
            },
          }),
        }
      }
      return undefined
    },
  }
}

describe('readProviderUsage', () => {
  it('shows the default model and DeepSeek balance', async () => {
    const seen: string[] = []
    const snapshot = await readProviderUsage(ctx({ key: 'sk-test-key' }) as never, undefined, {
      now: () => 1_700_000_000_000,
      fetch: async (url) => {
        seen.push(url)
        return jsonResponse({
          is_available: true,
          balance_infos: [{ currency: 'CNY', total_balance: '9.10', granted_balance: '0', topped_up_balance: '9.10' }],
        })
      },
    })
    expect(snapshot.providerName).toBe('DeepSeek')
    expect(snapshot.modelName).toBe('DeepSeek-V4-Pro')
    expect(snapshot.source).toBe('default')
    expect(snapshot.balanceStatus).toBe('ok')
    expect(snapshot.accountAvailable).toBe(true)
    expect(snapshot.balances[0]?.total).toBe('9.10')
    expect(snapshot.endpoint).toBe('api.deepseek.com')
    expect(JSON.stringify(snapshot)).not.toContain('sk-test-key')
    expect(seen[0]).toBe('https://api.deepseek.com/user/balance')
  })

  it('prefers the model last used in the session', async () => {
    const snapshot = await readProviderUsage(ctx({
      key: 'sk-test-key',
      session: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }) as never, 'sess-1', {
      fetch: async () => jsonResponse({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '1' }] }),
    })
    expect(snapshot.model).toBe('deepseek-v4-flash')
    expect(snapshot.source).toBe('session')
  })

  it('explains a missing key without calling the provider', async () => {
    let called = 0
    const snapshot = await readProviderUsage(ctx() as never, undefined, {
      fetch: async () => {
        called += 1
        return jsonResponse({})
      },
    })
    expect(snapshot.balanceStatus).toBe('no_key')
    expect(called).toBe(0)
  })

  it('maps 401 to a key-rejected status', async () => {
    const snapshot = await readProviderUsage(ctx({ key: 'sk-bad' }) as never, undefined, {
      fetch: async () => jsonResponse({ error: { message: 'invalid api key sk-bad' } }, 401),
    })
    expect(snapshot.balanceStatus).toBe('auth')
    expect(JSON.stringify(snapshot)).not.toContain('sk-bad')
  })

  it('treats only-404 providers as unsupported rather than failed', async () => {
    const snapshot = await readProviderUsage(ctx({ key: 'sk-ok' }) as never, undefined, {
      fetch: async () => jsonResponse({ message: 'no' }, 404),
    })
    expect(snapshot.balanceStatus).toBe('unsupported')
  })
})
