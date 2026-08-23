import type { SessionContextPressure, SessionTokenUsage, UsageBalanceRow } from './types.ts'

/** Compact token count: 517 / 12.2K / 1.2M. */
export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  if (n < 1_000) return String(Math.round(n))
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

/** Prompt-side billed tokens: uncached + cache read + cache write. */
export function billedInputTokens(usage: SessionTokenUsage): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

export function totalBilledTokens(usage: SessionTokenUsage): number {
  return billedInputTokens(usage) + usage.outputTokens
}

export function hasTokenActivity(usage: SessionTokenUsage | undefined): usage is SessionTokenUsage {
  return usage !== undefined && (billedInputTokens(usage) > 0 || usage.outputTokens > 0)
}

/** Cache-hit share of prompt-side input; null when nothing was billed. */
export function cacheHitPercent(usage: SessionTokenUsage): number | null {
  const denominator = billedInputTokens(usage)
  if (denominator === 0) return null
  return Math.round(usage.cacheReadTokens / denominator * 100)
}

export function contextOccupancy(pressure: SessionContextPressure | undefined): {
  percent: number
  usedTokens: number
  contextWindow: number
} | null {
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  if (usedTokens === undefined || pressure?.contextWindow === undefined || pressure.contextWindow <= 0) {
    return null
  }
  return {
    percent: Math.min(100, Math.round(usedTokens / pressure.contextWindow * 100)),
    usedTokens,
    contextWindow: pressure.contextWindow,
  }
}

export function currencySymbol(currency: string): string {
  const code = currency.trim().toUpperCase()
  if (code === 'CNY' || code === 'RMB') return '¥'
  if (code === 'USD') return '$'
  if (code === 'EUR') return '€'
  if (code === '') return ''
  return `${code} `
}

export function formatMoney(row: Pick<UsageBalanceRow, 'currency' | 'total'>): string {
  return `${currencySymbol(row.currency)}${row.total}`
}

const STATUS_DASH = '—'

/** Compact status-bar balance: `¥1.95` / `$2.00`, or a dash when the API is unreachable. */
export function formatStatusBalance(
  snapshot: { balanceStatus: string; balances: readonly UsageBalanceRow[] } | null,
): string {
  if (snapshot === null) return STATUS_DASH
  const row = snapshot.balances[0]
  const symbol = row === undefined ? '' : currencySymbol(row.currency)
  if (snapshot.balanceStatus !== 'ok' || row === undefined) {
    return symbol === '' ? STATUS_DASH : `${symbol}${STATUS_DASH}`
  }
  return formatMoney(row)
}

function parseAmount(value: string): number | undefined {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function decimalPlaces(value: string): number {
  const dot = value.indexOf('.')
  return dot === -1 ? 0 : value.length - dot - 1
}

function formatAmount(n: number, samples: readonly string[]): string {
  const places = Math.min(4, Math.max(2, ...samples.map(decimalPlaces)))
  return n.toFixed(places)
}

const SPEND_EPS = 0.005

/** True when remaining ≈ granted + topped-up: composition, not historical spend. */
function isRemainingComposition(row: UsageBalanceRow): boolean {
  const total = parseAmount(row.total)
  const granted = parseAmount(row.granted ?? '0')
  const toppedUp = parseAmount(row.toppedUp ?? '')
  if (total === undefined || granted === undefined || toppedUp === undefined) return false
  return Math.abs(granted + toppedUp - total) < SPEND_EPS
}

/** Account spend in the same currency, when the billing payload can support it. */
export function spentFromRow(row: UsageBalanceRow): string | undefined {
  if (row.used !== undefined) return row.used
  if (isRemainingComposition(row)) return undefined
  const total = parseAmount(row.total)
  const granted = parseAmount(row.granted ?? '0') ?? 0
  const toppedUp = parseAmount(row.toppedUp ?? '')
  if (total === undefined || toppedUp === undefined) return undefined
  const spent = granted + toppedUp - total
  if (!Number.isFinite(spent) || spent < SPEND_EPS) return undefined
  return formatAmount(spent, [row.total, row.granted ?? '0', row.toppedUp ?? '0'])
}

/** Running total of balance drops observed on this machine. Not provider lifetime spend. */
export interface ObservedSpend {
  lastTotal: string
  observedSpent: string
  updatedAt: number
}

export function foldObservedSpend(
  prev: ObservedSpend | undefined,
  total: string,
  now: number,
): ObservedSpend {
  if (prev === undefined) {
    return { lastTotal: total, observedSpent: '0', updatedAt: now }
  }
  const last = parseAmount(prev.lastTotal)
  const current = parseAmount(total)
  const already = parseAmount(prev.observedSpent) ?? 0
  if (last === undefined || current === undefined) {
    return { lastTotal: total, observedSpent: prev.observedSpent, updatedAt: now }
  }
  const drop = last - current
  const nextSpent = drop > SPEND_EPS ? already + drop : already
  return {
    lastTotal: total,
    observedSpent: formatAmount(Math.max(0, nextSpent), [prev.lastTotal, total, prev.observedSpent]),
    updatedAt: now,
  }
}

export function hasObservedSpend(entry: ObservedSpend | undefined): boolean {
  if (entry === undefined) return false
  const n = parseAmount(entry.observedSpent)
  return n !== undefined && n >= SPEND_EPS
}

/** Strip a trailing /v1 so DeepSeek-style `/user/balance` can be tried at the origin. */
export function billingOrigin(baseURL: string): string {
  return baseURL.replace(/\/+$/, '').replace(/\/v1$/i, '')
}

export function uniqueUrls(urls: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const url of urls) {
    if (url === '' || seen.has(url)) continue
    seen.add(url)
    out.push(url)
  }
  return out
}

/** Candidate billing URLs for one configured endpoint. Never includes credentials. */
export function billingUrls(baseURL: string): string[] {
  const origin = billingOrigin(baseURL)
  const raw = baseURL.replace(/\/+$/, '')
  return uniqueUrls([
    `${origin}/user/balance`,
    `${raw}/user/balance`,
    `${raw}/user/info`,
    `${origin}/user/info`,
    `${raw}/dashboard/billing/credit_grants`,
    `${origin}/v1/dashboard/billing/credit_grants`,
  ])
}

function asAmount(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Number.isInteger(value)) return String(value)
    return String(value)
  }
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '' || !/^-?\d+(\.\d+)?$/.test(trimmed)) return undefined
  return trimmed
}

function rowFromRecord(record: Record<string, unknown>, fallbackCurrency = ''): UsageBalanceRow | null {
  const total = asAmount(
    record.total_balance
    ?? record.totalBalance
    ?? record.total_available
    ?? record.balance
    ?? record.credit
    ?? record.total,
  )
  if (total === undefined) return null
  const currency = typeof record.currency === 'string' && record.currency.trim() !== ''
    ? record.currency.trim()
    : fallbackCurrency
  const granted = asAmount(record.granted_balance ?? record.grantedBalance ?? record.total_granted)
  const toppedUp = asAmount(record.topped_up_balance ?? record.toppedUpBalance ?? record.chargeBalance)
  const used = asAmount(record.total_used ?? record.used ?? record.used_balance)
  return {
    currency,
    total,
    ...granted === undefined ? {} : { granted },
    ...toppedUp === undefined ? {} : { toppedUp },
    ...used === undefined ? {} : { used },
  }
}

export interface ParsedProviderBalance {
  accountAvailable?: boolean
  balances: UsageBalanceRow[]
}

/**
 * Accept known provider billing JSON. Unknown shapes return null so the
 * caller can try the next URL instead of showing a blank number.
 */
export function parseBalanceBody(body: unknown): ParsedProviderBalance | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const root = body as Record<string, unknown>
  const nested = typeof root.data === 'object' && root.data !== null && !Array.isArray(root.data)
    ? root.data as Record<string, unknown>
    : undefined

  const infos = Array.isArray(root.balance_infos)
    ? root.balance_infos
    : Array.isArray(nested?.balance_infos)
      ? nested.balance_infos
      : undefined
  if (infos !== undefined) {
    const balances: UsageBalanceRow[] = []
    for (const item of infos) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
      const row = rowFromRecord(item as Record<string, unknown>, 'CNY')
      if (row !== null) balances.push(row)
    }
    if (balances.length === 0) return null
    const available = root.is_available
    return {
      balances,
      ...typeof available === 'boolean' ? { accountAvailable: available } : {},
    }
  }

  const source = nested ?? root
  const row = rowFromRecord(source)
  if (row === null) return null
  const status = source.status
  const accountAvailable = typeof root.is_available === 'boolean'
    ? root.is_available
    : typeof status === 'string' && status !== ''
      ? !/disabled|banned|exhausted|insufficient/i.test(status)
      : undefined
  return {
    balances: [row],
    ...accountAvailable === undefined ? {} : { accountAvailable },
  }
}
