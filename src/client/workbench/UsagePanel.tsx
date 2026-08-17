import { useEffect, useRef, useState } from 'react'
import type { GitClient } from '../api.ts'
import type { ProviderUsageSnapshot, SessionContextPressure, SessionTokenUsage } from '../../shared/types.ts'
import {
  billedInputTokens,
  cacheHitPercent,
  contextOccupancy,
  formatMoney,
  formatTokenCount,
  spentFromRow,
  totalBilledTokens,
} from '../../shared/usage-format.ts'
import { IconButton } from './IconButton.tsx'
import { IconRefresh } from './icons.tsx'
import type { Translate } from './types.ts'
import css from './UsagePanel.module.css'

const DASH = '—'

export function UsagePanel({
  client, sessionId, running, useProjection, t,
}: {
  client: GitClient
  sessionId?: string
  running?: boolean
  useProjection?: (key: string, selector?: (value: unknown) => unknown) => unknown
  t: Translate
}) {
  const [snapshot, setSnapshot] = useState<ProviderUsageSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const loadGen = useRef(0)
  const wasRunning = useRef(false)

  const tokens = asTokenUsage(useProjection?.('tokenUsage'))
  const occupancy = contextOccupancy(asContextPressure(useProjection?.('contextPressure')))

  const load = (quiet = false): void => {
    const gen = ++loadGen.current
    if (!quiet) setLoading(true)
    void client.usage(sessionId).then((result) => {
      if (gen !== loadGen.current) return
      setLoading(false)
      if (result.ok) setSnapshot(result.value)
    })
  }

  useEffect(() => {
    setSnapshot(null)
    load()
    const timer = window.setInterval(() => { load(true) }, 60_000)
    return () => {
      loadGen.current += 1
      window.clearInterval(timer)
    }
  }, [client, sessionId])

  useEffect(() => {
    if (wasRunning.current && running === false) load(true)
    wasRunning.current = Boolean(running)
  }, [running])

  const idle = snapshot === null
    || snapshot.balanceStatus === 'no_key'
    || snapshot.balanceStatus === 'auth'
  const primary = snapshot?.balances[0]
  const balance = primary === undefined ? DASH : formatMoney(primary)
  const spentRaw = primary === undefined ? undefined : spentFromRow(primary)
  const spent = spentRaw === undefined || primary === undefined
    ? DASH
    : formatMoney({ currency: primary.currency, total: spentRaw })
  const tokenTotal = tokens === undefined ? 0 : totalBilledTokens(tokens)
  const input = tokens === undefined ? 0 : billedInputTokens(tokens)
  const output = tokens?.outputTokens ?? 0
  const cacheRead = tokens?.cacheReadTokens ?? 0
  const cacheWrite = tokens?.cacheWriteTokens ?? 0
  const hit = tokens === undefined ? null : cacheHitPercent(tokens)
  const model = snapshot === undefined || snapshot === null ? '' : snapshot.modelName

  return (
    <div className={css.root} data-git-chrome="usage" data-idle={idle || undefined}>
      <header className={css.head}>
        <span className={css.title}>{t('usage.title')}</span>
        {model !== '' ? <span className={css.model} title={model}>{model}</span> : null}
        <IconButton label={t('usage.refresh')} disabled={loading} onClick={() => { load() }}>
          {loading ? <span className={css.spinner} aria-hidden /> : <IconRefresh />}
        </IconButton>
      </header>
      <div className={css.body}>
        <section className={css.money} aria-label={t('usage.section.money')}>
          <Metric label={t('usage.balance')} value={idle ? DASH : balance} />
          <Metric label={t('usage.spend')} value={idle ? DASH : spent} />
        </section>
        <section className={css.block} aria-label={t('usage.section.tokens')}>
          <div className={css.blockHead}>
            <span className={css.blockTitle}>{t('usage.section.tokens')}</span>
            <span className={css.blockValue}>{formatTokenCount(tokenTotal)}</span>
          </div>
          <div className={css.grid}>
            <Stat label={t('usage.tokens.input')} value={formatTokenCount(input)} />
            <Stat label={t('usage.tokens.output')} value={formatTokenCount(output)} />
            <Stat label={t('usage.tokens.cacheRead')} value={formatTokenCount(cacheRead)} />
            <Stat label={t('usage.tokens.cacheWrite')} value={formatTokenCount(cacheWrite)} />
          </div>
          {hit !== null ? (
            <div className={css.row}>
              <span className={css.rowLabel}>{t('usage.tokens.cacheHit')}</span>
              <span className={css.rowValue}>{hit}%</span>
            </div>
          ) : null}
        </section>
        {occupancy !== null ? (
          <section className={css.block} aria-label={t('usage.section.context')}>
            <div className={css.blockHead}>
              <span className={css.blockTitle}>{t('usage.section.context')}</span>
              <span className={css.blockValue}>{occupancy.percent}%</span>
            </div>
            <div
              className={css.meter}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={occupancy.percent}
            >
              <div
                className={css.meterFill}
                style={{ width: `${occupancy.percent}%` }}
                data-warn={occupancy.percent >= 80 || undefined}
                data-danger={occupancy.percent >= 95 || undefined}
              />
            </div>
            <div className={css.row}>
              <span className={css.rowLabel}>{t('usage.context.used')}</span>
              <span className={css.rowValue}>
                {formatTokenCount(occupancy.usedTokens)} / {formatTokenCount(occupancy.contextWindow)}
              </span>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={css.metric}>
      <span className={css.metricLabel}>{label}</span>
      <span className={css.metricValue}>{value}</span>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={css.stat}>
      <span className={css.statLabel}>{label}</span>
      <span className={css.statValue}>{value}</span>
    </div>
  )
}

function asTokenUsage(value: unknown): SessionTokenUsage | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  if (!isCount(row.uncachedInputTokens) || !isCount(row.outputTokens)) return undefined
  if (!isCount(row.cacheReadTokens) || !isCount(row.cacheWriteTokens)) return undefined
  return {
    uncachedInputTokens: row.uncachedInputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
  }
}

function asContextPressure(value: unknown): SessionContextPressure | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  const pressureTokens = optionalCount(row.pressureTokens)
  const projectedTokens = optionalCount(row.projectedTokens)
  const contextWindow = optionalCount(row.contextWindow)
  if (pressureTokens === undefined && projectedTokens === undefined && contextWindow === undefined) return undefined
  return {
    ...pressureTokens === undefined ? {} : { pressureTokens },
    ...projectedTokens === undefined ? {} : { projectedTokens },
    ...contextWindow === undefined ? {} : { contextWindow },
  }
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function optionalCount(value: unknown): number | undefined {
  return isCount(value) ? value : undefined
}
