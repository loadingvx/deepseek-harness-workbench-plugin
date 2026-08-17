import type { ObservedSpend } from './usage-format.ts'

export const USAGE_LEDGER_KEY = 'dsh-workbench-usage-ledger'

export function ledgerEntryKey(provider: string, currency: string): string {
  const cur = currency.trim() === '' ? '_' : currency.trim().toUpperCase()
  return `${provider}:${cur}`
}

function asEntry(value: unknown): ObservedSpend | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  if (typeof row.lastTotal !== 'string' || row.lastTotal.trim() === '') return undefined
  if (typeof row.observedSpent !== 'string' || row.observedSpent.trim() === '') return undefined
  if (typeof row.updatedAt !== 'number' || !Number.isFinite(row.updatedAt)) return undefined
  return { lastTotal: row.lastTotal, observedSpent: row.observedSpent, updatedAt: row.updatedAt }
}

function readAll(): Record<string, ObservedSpend> {
  try {
    const text = localStorage.getItem(USAGE_LEDGER_KEY)
    if (text === null || text.trim() === '') return {}
    const parsed = JSON.parse(text) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const out: Record<string, ObservedSpend> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = asEntry(value)
      if (entry !== undefined) out[key] = entry
    }
    return out
  } catch {
    return {}
  }
}

function writeAll(entries: Record<string, ObservedSpend>): void {
  try {
    localStorage.setItem(USAGE_LEDGER_KEY, JSON.stringify(entries))
  } catch { /* quota / private mode */ }
}

export function readObservedSpend(provider: string, currency: string): ObservedSpend | undefined {
  return readAll()[ledgerEntryKey(provider, currency)]
}

export function writeObservedSpend(
  provider: string,
  currency: string,
  entry: ObservedSpend,
): void {
  const all = readAll()
  all[ledgerEntryKey(provider, currency)] = entry
  writeAll(all)
}

export function resetObservedSpend(provider: string, currency: string, lastTotal: string, now: number): void {
  writeObservedSpend(provider, currency, { lastTotal, observedSpent: '0', updatedAt: now })
}
