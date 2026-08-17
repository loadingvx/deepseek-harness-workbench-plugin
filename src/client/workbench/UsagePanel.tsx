import { useEffect, useRef, useState } from 'react'
import type { GitClient } from '../api.ts'
import type { GitFail, ProviderUsageSnapshot, SessionContextBreakdown, SessionContextPressure, SessionTokenUsage, UsageBalanceRow } from '../../shared/types.ts'
import {
  billedInputTokens,
  cacheHitPercent,
  contextOccupancy,
  formatMoney,
  formatTokenCount,
  hasTokenActivity,
  totalBilledTokens,
} from '../../shared/usage-format.ts'
import { IconButton } from './IconButton.tsx'
import { IconRefresh } from './icons.tsx'
import type { Translate } from './types.ts'
import css from './UsagePanel.module.css'

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
  const [error, setError] = useState<GitFail | null>(null)
  const [loading, setLoading] = useState(true)
  const loadGen = useRef(0)
  const wasRunning = useRef(false)

  const tokens = asTokenUsage(useProjection?.('tokenUsage'))
  const pressure = asContextPressure(useProjection?.('contextPressure'))
  const breakdown = asContextBreakdown(useProjection?.('contextBreakdown'))

  const load = (quiet = false): void => {
    const gen = ++loadGen.current
    if (!quiet) {
      setLoading(true)
      setError(null)
    }
    void client.usage(sessionId).then((result) => {
      if (gen !== loadGen.current) return
      setLoading(false)
      if (!result.ok) {
        if (!quiet) setError(result)
        return
      }
      setError(null)
      setSnapshot(result.value)
    })
  }

  useEffect(() => {
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

  const occupancy = contextOccupancy(pressure)
  const title = snapshot?.modelName ?? t('usage.title')

  return (
    <div className={css.root} data-git-chrome="usage">
      <header className={css.head}>
        <div className={css.headRow}>
          <span className={css.kicker}>{t('usage.kicker')}</span>
          <span className={css.title} title={title}>{title}</span>
          <IconButton label={t('usage.refresh')} disabled={loading} onClick={() => { load() }}>
            {loading ? <span className={css.spinner} aria-hidden /> : <IconRefresh />}
          </IconButton>
        </div>
        <p className={css.caption}>{t('usage.caption')}</p>
      </header>
      <div className={css.body}>
        {error !== null ? (
          <div className={css.banner} data-kind="danger" role="alert">
            <div>{error.messageZh}</div>
            <div className={css.bannerHint}>{error.hintZh}</div>
          </div>
        ) : null}
        {loading && snapshot === null && error === null ? (
          <p className={css.hint}>{t('usage.loading')}</p>
        ) : null}
        {snapshot !== null ? (
          <>
            <RouteCard snapshot={snapshot} t={t} />
            <BalanceCard snapshot={snapshot} t={t} />
          </>
        ) : null}
        <TokenCard usage={tokens} running={Boolean(running)} t={t} />
        <ContextCard occupancy={occupancy} breakdown={breakdown} t={t} />
      </div>
    </div>
  )
}

function RouteCard({ snapshot, t }: { snapshot: ProviderUsageSnapshot; t: Translate }) {
  return (
    <section className={css.card} aria-label={t('usage.section.route')}>
      <div className={css.cardHead}>
        <span className={css.cardTitle}>{t('usage.section.route')}</span>
      </div>
      <div className={css.hero}>
        <span className={css.heroValue} title={snapshot.modelName}>{snapshot.modelName}</span>
        <span className={css.heroLabel}>{snapshot.providerName}</span>
      </div>
      <div className={css.rows}>
        <InfoRow label={t('usage.provider')} value={snapshot.providerName} />
        <InfoRow label={t('usage.model')} value={snapshot.model} mono />
        {snapshot.reasoningEffort !== undefined ? (
          <InfoRow label={t('usage.effort')} value={effortLabel(snapshot.reasoningEffort, t)} />
        ) : null}
        {snapshot.endpoint !== undefined ? (
          <InfoRow label={t('usage.endpoint')} value={snapshot.endpoint} mono />
        ) : null}
      </div>
      <p className={css.hint}>
        {snapshot.source === 'session' ? t('usage.source.session') : t('usage.source.default')}
      </p>
    </section>
  )
}

function BalanceCard({ snapshot, t }: { snapshot: ProviderUsageSnapshot; t: Translate }) {
  const primary = snapshot.balances[0]
  const status = snapshot.balanceStatus
  const kind = status === 'ok'
    ? snapshot.accountAvailable === false ? 'warn' : 'ok'
    : status === 'unsupported' ? 'warn' : 'bad'
  return (
    <section className={css.card} aria-label={t('usage.section.balance')}>
      <div className={css.cardHead}>
        <span className={css.cardTitle}>{t('usage.section.balance')}</span>
        <span className={css.chip} data-kind={kind}>{balanceChip(snapshot, t)}</span>
      </div>
      {primary !== undefined ? (
        <>
          <div className={css.hero}>
            <span className={css.heroValue}>{formatMoney(primary)}</span>
            <span className={css.heroLabel}>{t('usage.balance.total')}</span>
          </div>
          {snapshot.balances.length > 1 ? (
            <div className={css.chips}>
              {snapshot.balances.slice(1).map(row => (
                <span key={`${row.currency}:${row.total}`} className={css.chip}>
                  {formatMoney(row)}
                </span>
              ))}
            </div>
          ) : null}
          <BalanceBreakdown rows={snapshot.balances} t={t} />
        </>
      ) : (
        <BalanceEmpty status={status} t={t} />
      )}
      {status === 'ok' && snapshot.accountAvailable === false ? (
        <div className={css.banner} data-kind="danger">
          <div>{t('usage.balance.unavailable')}</div>
          <div className={css.bannerHint}>{t('usage.balance.unavailableHint')}</div>
        </div>
      ) : null}
      <p className={css.hint}>{t('usage.balance.updated', { time: formatClock(snapshot.fetchedAt) })}</p>
    </section>
  )
}

function BalanceBreakdown({ rows, t }: { rows: UsageBalanceRow[]; t: Translate }) {
  const details = rows.flatMap((row) => {
    const items: Array<{ key: string; label: string; value: string }> = []
    if (row.toppedUp !== undefined) {
      items.push({ key: `${row.currency}-top`, label: t('usage.balance.toppedUp'), value: formatMoney({ currency: row.currency, total: row.toppedUp }) })
    }
    if (row.granted !== undefined) {
      items.push({ key: `${row.currency}-gift`, label: t('usage.balance.granted'), value: formatMoney({ currency: row.currency, total: row.granted }) })
    }
    if (row.used !== undefined) {
      items.push({ key: `${row.currency}-used`, label: t('usage.balance.used'), value: formatMoney({ currency: row.currency, total: row.used }) })
    }
    return items
  })
  if (details.length === 0) return null
  return (
    <div className={css.rows}>
      {details.map(item => (
        <InfoRow key={item.key} label={item.label} value={item.value} />
      ))}
    </div>
  )
}

function BalanceEmpty({ status, t }: { status: ProviderUsageSnapshot['balanceStatus']; t: Translate }) {
  if (status === 'ok') return <p className={css.hint}>{t('usage.balance.failed')}</p>
  const title = status === 'no_key'
    ? t('usage.balance.noKey')
    : status === 'auth'
      ? t('usage.balance.auth')
      : status === 'failed'
        ? t('usage.balance.failed')
        : t('usage.balance.unsupported')
  const hint = status === 'no_key'
    ? t('usage.balance.noKeyHint')
    : status === 'auth'
      ? t('usage.balance.authHint')
      : status === 'failed'
        ? t('usage.balance.failedHint')
        : t('usage.balance.unsupportedHint')
  return (
    <div className={css.banner} data-kind={status === 'unsupported' ? undefined : 'danger'}>
      <div>{title}</div>
      <div className={css.bannerHint}>{hint}</div>
    </div>
  )
}

function TokenCard({
  usage, running, t,
}: {
  usage: SessionTokenUsage | undefined
  running: boolean
  t: Translate
}) {
  const active = hasTokenActivity(usage)
  return (
    <section className={css.card} aria-label={t('usage.section.tokens')}>
      <div className={css.cardHead}>
        <span className={css.cardTitle}>{t('usage.section.tokens')}</span>
      </div>
      {active ? (
        <>
          <div className={css.hero}>
            <span className={css.heroValue}>{formatTokenCount(totalBilledTokens(usage))}</span>
            <span className={css.heroLabel}>{t('usage.tokens.total')}</span>
          </div>
          <div className={css.grid}>
            <Stat label={t('usage.tokens.input')} value={formatTokenCount(billedInputTokens(usage))} />
            <Stat label={t('usage.tokens.output')} value={formatTokenCount(usage.outputTokens)} />
            <Stat label={t('usage.tokens.cacheRead')} value={formatTokenCount(usage.cacheReadTokens)} />
            <Stat label={t('usage.tokens.cacheWrite')} value={formatTokenCount(usage.cacheWriteTokens)} />
          </div>
          {cacheHitPercent(usage) !== null ? (
            <InfoRow label={t('usage.tokens.cacheHit')} value={`${cacheHitPercent(usage)}%`} />
          ) : null}
        </>
      ) : (
        <div>
          <p className={css.hint}>{t('usage.tokens.empty')}</p>
          <p className={css.hint}>{t('usage.tokens.emptyHint')}</p>
        </div>
      )}
      {running ? <p className={css.hint}>{t('usage.tokens.running')}</p> : null}
    </section>
  )
}

function ContextCard({
  occupancy, breakdown, t,
}: {
  occupancy: { percent: number; usedTokens: number; contextWindow: number } | null
  breakdown: SessionContextBreakdown | undefined
  t: Translate
}) {
  return (
    <section className={css.card} aria-label={t('usage.section.context')}>
      <div className={css.cardHead}>
        <span className={css.cardTitle}>{t('usage.section.context')}</span>
        {occupancy !== null ? <span className={css.chip}>{occupancy.percent}%</span> : null}
      </div>
      {occupancy === null ? (
        <div>
          <p className={css.hint}>{t('usage.context.empty')}</p>
          <p className={css.hint}>{t('usage.context.emptyHint')}</p>
        </div>
      ) : (
        <>
          <div
            className={css.meter}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={occupancy.percent}
            aria-label={t('usage.context.used')}
          >
            <div
              className={css.meterFill}
              style={{ width: `${occupancy.percent}%` }}
              data-warn={occupancy.percent >= 80 || undefined}
              data-danger={occupancy.percent >= 95 || undefined}
            />
          </div>
          <InfoRow
            label={t('usage.context.used')}
            value={`${formatTokenCount(occupancy.usedTokens)} / ${formatTokenCount(occupancy.contextWindow)}`}
          />
        </>
      )}
      {breakdown !== undefined ? (
        <div className={css.grid}>
          <Stat label={t('usage.context.system')} value={formatTokenCount(breakdown.systemTokens)} />
          <Stat label={t('usage.context.tools')} value={formatTokenCount(breakdown.toolsTokens)} />
          <Stat label={t('usage.context.messages')} value={formatTokenCount(breakdown.messageTokens)} />
        </div>
      ) : null}
      <p className={css.hint}>{t('usage.context.note')}</p>
    </section>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className={css.row}>
      <span className={css.rowLabel}>{label}</span>
      <span className={css.rowValue} data-mono={mono || undefined} title={value}>{value}</span>
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

function effortLabel(effort: string, t: Translate): string {
  if (effort === 'off') return t('usage.effort.off')
  if (effort === 'high') return t('usage.effort.high')
  if (effort === 'max') return t('usage.effort.max')
  return effort
}

function balanceChip(snapshot: ProviderUsageSnapshot, t: Translate): string {
  if (snapshot.balanceStatus === 'ok') {
    return snapshot.accountAvailable === false ? t('usage.balance.unavailable') : t('usage.balance.available')
  }
  if (snapshot.balanceStatus === 'no_key') return t('usage.balance.noKey')
  if (snapshot.balanceStatus === 'auth') return t('usage.balance.auth')
  if (snapshot.balanceStatus === 'failed') return t('usage.balance.failed')
  return t('usage.balance.unsupported')
}

function formatClock(at: number): string {
  try {
    return new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return String(at)
  }
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

function asContextBreakdown(value: unknown): SessionContextBreakdown | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  if (!isCount(row.systemTokens) || !isCount(row.toolsTokens) || !isCount(row.messageTokens)) return undefined
  return {
    systemTokens: row.systemTokens,
    toolsTokens: row.toolsTokens,
    messageTokens: row.messageTokens,
  }
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function optionalCount(value: unknown): number | undefined {
  return isCount(value) ? value : undefined
}
