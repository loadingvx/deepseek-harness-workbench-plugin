import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ledgerEntryKey,
  readObservedSpend,
  resetObservedSpend,
  USAGE_LEDGER_KEY,
  writeObservedSpend,
} from '../src/shared/usage-ledger.ts'

function installStorage(initial: Record<string, string> = {}): void {
  const store = new Map(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: (k: string): string | null => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string): void => { store.set(k, v) },
    removeItem: (k: string): void => { store.delete(k) },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('usage ledger', () => {
  it('stores one entry per provider and currency', () => {
    installStorage()
    writeObservedSpend('deepseek-official', 'CNY', {
      lastTotal: '1.95',
      observedSpent: '0.40',
      updatedAt: 8,
    })
    expect(readObservedSpend('deepseek-official', 'CNY')?.observedSpent).toBe('0.40')
    expect(readObservedSpend('deepseek-official', 'USD')).toBeUndefined()
    expect(ledgerEntryKey('deepseek-official', 'cny')).toBe('deepseek-official:CNY')
    expect(localStorage.getItem(USAGE_LEDGER_KEY)).not.toContain('sk-')
  })

  it('reset keeps the latest balance as the new baseline', () => {
    installStorage()
    writeObservedSpend('deepseek-official', 'CNY', {
      lastTotal: '1.00',
      observedSpent: '4.80',
      updatedAt: 1,
    })
    resetObservedSpend('deepseek-official', 'CNY', '1.00', 2)
    expect(readObservedSpend('deepseek-official', 'CNY')).toEqual({
      lastTotal: '1.00',
      observedSpent: '0',
      updatedAt: 2,
    })
  })
})
