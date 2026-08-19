import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { GitClient } from '../api.ts'
import type { ProviderUsageSnapshot, SessionContextPressure, SessionTokenUsage } from '../../shared/types.ts'
import {
  billedInputTokens,
  cacheHitPercent,
  contextOccupancy,
  foldObservedSpend,
  formatMoney,
  formatTokenCount,
  hasObservedSpend,
  spentFromRow,
  totalBilledTokens,
  type ObservedSpend,
} from '../../shared/usage-format.ts'
import { readObservedSpend, resetObservedSpend, writeObservedSpend } from '../../shared/usage-ledger.ts'
import { IconButton } from './IconButton.tsx'
import { IconPin, IconRefresh } from './icons.tsx'
import type { Translate } from './types.ts'
import {
  clampNavUsageHeight,
  isNavUsageCompact,
  NAV_USAGE_DEFAULT_H,
  readNavUsageHeight,
  writeNavUsageHeight,
} from './nav-usage-layout.ts'
import {
  readUsageLive,
  refreshUsageLive,
  retainUsageLive,
  subscribeUsageLive,
} from './usage-live.ts'
import {
  ensureNavDockHost,
  findNavSidebarRoot,
  measureNavSettingsHeight,
  navHostIsSeated,
  defaultUsageDock,
  readUsageDock,
  releaseNavDockHost,
  subscribeUsageDock,
  syncNavDockHostBox,
  writeUsageDock,
} from './usage-dock.ts'
import css from './UsagePanel.module.css'

const DASH = '—'
const DEEPSEEK_PROVIDER = 'deepseek-official'
const OFFICIAL_USAGE_URL = 'https://platform.deepseek.com/usage'

type UsagePanelProps = {
  client: GitClient
  sessionId?: string
  running?: boolean
  useProjection?: (key: string, selector?: (value: unknown) => unknown) => unknown
  t: Translate
}

export function UsageNavPortal(props: UsagePanelProps) {
  const dock = useSyncExternalStore(subscribeUsageDock, readUsageDock, defaultUsageDock)
  const [host, setHost] = useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    if (dock !== 'nav') {
      setHost(null)
      releaseNavDockHost()
      return
    }
    const sync = (): void => {
      const next = ensureNavDockHost()
      setHost((current) => {
        if (current !== null && next === current && navHostIsSeated(current)) return current
        return next
      })
    }
    sync()
    let raf = 0
    const onMut = (): void => {
      if (raf !== 0) return
      raf = window.requestAnimationFrame(() => {
        raf = 0
        sync()
      })
    }
    const observer = new MutationObserver(onMut)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      if (raf !== 0) window.cancelAnimationFrame(raf)
    }
  }, [dock])

  if (dock !== 'nav' || host === null) return null
  return createPortal(<UsagePanel {...props} />, host)
}

function useNavUsageFrame(enabled: boolean): {
  compact: boolean
  height: number
  dragging: boolean
  beginResize: (event: ReactPointerEvent<HTMLButtonElement>) => void
  resetHeight: () => void
  rootRef: RefObject<HTMLDivElement | null>
} {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [desired, setDesired] = useState(readNavUsageHeight)
  const [box, setBox] = useState({ width: 0, sidebarH: 0, settingsH: 40 })
  const [dragging, setDragging] = useState(false)
  const compact = enabled && isNavUsageCompact(box.width)
  const height = enabled
    ? clampNavUsageHeight(desired, box.sidebarH, box.settingsH, compact)
    : 0

  useLayoutEffect(() => {
    if (!enabled) return
    const root = rootRef.current
    const host = root?.parentElement
    if (host == null) return
    const sidebar = findNavSidebarRoot(host)
    const apply = (): void => {
      syncNavDockHostBox(host)
      const next = {
        width: (sidebar?.clientWidth || host.clientWidth),
        sidebarH: sidebar?.clientHeight ?? 0,
        settingsH: measureNavSettingsHeight(),
      }
      setBox((current) => (
        current.width === next.width
        && current.sidebarH === next.sidebarH
        && current.settingsH === next.settingsH
          ? current
          : next
      ))
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(host)
    if (sidebar !== null) observer.observe(sidebar)
    window.addEventListener('resize', apply)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', apply)
    }
  }, [enabled])

  useLayoutEffect(() => {
    if (!enabled) return
    const host = rootRef.current?.parentElement
    if (host == null) return
    host.style.height = `${height}px`
    syncNavDockHostBox(host)
  }, [enabled, height])

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    // Capture the pointer so pointermove/pointerup keep arriving even when
    // the cursor leaves the window or moves over an iframe (BrowserView);
    // without capture a lost pointerup strands the drag listeners forever.
    const handle = event.currentTarget
    const pointerId = event.pointerId
    try { handle.setPointerCapture(pointerId) } catch { /* pointer already inactive */ }
    const startY = event.clientY
    const startH = height
    const host = rootRef.current?.parentElement
    const sidebar = host === null ? null : findNavSidebarRoot(host)
    let latest = startH
    setDragging(true)
    const move = (next: PointerEvent): void => {
      const liveSidebar = sidebar?.clientHeight ?? box.sidebarH
      const liveSettings = measureNavSettingsHeight()
      const liveCompact = sidebar !== null && isNavUsageCompact(sidebar.clientWidth)
      latest = clampNavUsageHeight(startH + (startY - next.clientY), liveSidebar, liveSettings, liveCompact)
      setDesired(latest)
    }
    const end = (): void => {
      try { handle.releasePointerCapture(pointerId) } catch { /* already released */ }
      setDragging(false)
      writeNavUsageHeight(latest)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  const resetHeight = (): void => {
    const host = rootRef.current?.parentElement
    const sidebar = host === null ? null : findNavSidebarRoot(host)
    const next = clampNavUsageHeight(
      NAV_USAGE_DEFAULT_H,
      sidebar?.clientHeight ?? box.sidebarH,
      measureNavSettingsHeight(),
      compact,
    )
    setDesired(next)
    writeNavUsageHeight(next)
  }

  return { compact, height, dragging, beginResize, resetHeight, rootRef }
}

export function UsagePanel({
  client, sessionId, running, useProjection, t,
}: UsagePanelProps) {
  const dock = useSyncExternalStore(subscribeUsageDock, readUsageDock, defaultUsageDock)
  const snapshot = useSyncExternalStore(subscribeUsageLive, readUsageLive, () => null)
  const nav = useNavUsageFrame(dock === 'nav')
  const [loading, setLoading] = useState(true)
  const [observed, setObserved] = useState<ObservedSpend | undefined>(undefined)
  const [pinError, setPinError] = useState(false)
  const wasRunning = useRef(false)

  const tokens = asTokenUsage(useProjection?.('tokenUsage'))
  const occupancy = contextOccupancy(asContextPressure(useProjection?.('contextPressure')))

  const load = (quiet = false): void => {
    if (!quiet) setLoading(true)
    void refreshUsageLive().finally(() => { setLoading(false) })
  }

  useEffect(() => {
    setObserved(undefined)
    setPinError(false)
    setLoading(true)
    const stop = retainUsageLive(client, sessionId)
    void refreshUsageLive().finally(() => { setLoading(false) })
    return stop
  }, [client, sessionId])

  useEffect(() => {
    if (snapshot === null) {
      setObserved(undefined)
      return
    }
    const row = snapshot.balances[0]
    if (snapshot.balanceStatus !== 'ok' || row === undefined) {
      setObserved(undefined)
      return
    }
    const next = foldObservedSpend(
      readObservedSpend(snapshot.provider, row.currency),
      row.total,
      snapshot.fetchedAt,
    )
    writeObservedSpend(snapshot.provider, row.currency, next)
    setObserved(next)
  }, [snapshot])

  useEffect(() => {
    if (wasRunning.current && running === false) load(true)
    wasRunning.current = Boolean(running)
  }, [running])

  const moneyOk = snapshot !== null && snapshot.balanceStatus === 'ok'
  const primary = snapshot?.balances[0]
  const balance = primary === undefined ? DASH : formatMoney(primary)
  const apiSpend = primary === undefined ? undefined : spentFromRow(primary)
  const observedOn = hasObservedSpend(observed)
  const spendLabel = observedOn && apiSpend === undefined ? t('usage.observed') : t('usage.spend')
  const spend = !moneyOk
    ? DASH
    : apiSpend !== undefined && primary !== undefined
      ? formatMoney({ currency: primary.currency, total: apiSpend })
      : observedOn && observed !== undefined && primary !== undefined
        ? formatMoney({ currency: primary.currency, total: observed.observedSpent })
        : DASH
  const tokenTotal = tokens === undefined ? 0 : totalBilledTokens(tokens)
  const input = tokens === undefined ? 0 : billedInputTokens(tokens)
  const output = tokens?.outputTokens ?? 0
  const cacheRead = tokens?.cacheReadTokens ?? 0
  const cacheWrite = tokens?.cacheWriteTokens ?? 0
  const hit = tokens === undefined ? null : cacheHitPercent(tokens)
  const model = snapshot === undefined || snapshot === null ? '' : snapshot.modelName
  const deepseek = snapshot?.provider === DEEPSEEK_PROVIDER
  const pinLabel = dock === 'nav' ? t('usage.dock.toSide') : t('usage.dock.toNav')
  const pinTitle = pinError && dock !== 'nav' ? t('usage.dock.missing') : pinLabel

  const toggleDock = (): void => {
    if (dock === 'nav') {
      setPinError(false)
      writeUsageDock('side')
      return
    }
    const host = ensureNavDockHost()
    if (host === null) {
      setPinError(true)
      return
    }
    setPinError(false)
    writeUsageDock('nav')
  }

  const resetObserved = (): void => {
    if (snapshot === null || primary === undefined) return
    resetObservedSpend(snapshot.provider, primary.currency, primary.total, Date.now())
    setObserved(readObservedSpend(snapshot.provider, primary.currency))
  }

  const statusText = moneyStatus(snapshot, t)
  const parked = dock === 'nav'
  const compact = parked && nav.compact

  return (
    <div
      ref={nav.rootRef}
      className={css.root}
      data-git-chrome="usage"
      data-dock={parked ? 'nav' : 'side'}
      data-compact={compact || undefined}
    >
      {parked ? (
        <button
          type="button"
          className={css.sash}
          data-active={nav.dragging || undefined}
          aria-label={t('usage.resize')}
          title={t('usage.resize')}
          onPointerDown={nav.beginResize}
          onDoubleClick={nav.resetHeight}
        />
      ) : null}
      {compact ? (
        <div className={css.compact}>
          <IconButton label={pinTitle} active dense onClick={toggleDock}>
            <IconPin />
          </IconButton>
          <div className={css.compactMetrics}>
            <div className={css.compactTrack}>
            <span className={css.compactItem} title={`${t('usage.balance')} ${moneyOk ? balance : DASH}`}>
              <em>{t('usage.balance')}</em>
              <strong>{moneyOk ? balance : DASH}</strong>
            </span>
            <span className={css.compactItem} title={`${t('usage.spend')} ${spend}`}>
              <em>{t('usage.spend')}</em>
              <strong>{spend}</strong>
            </span>
            <span className={css.compactItem} title={`${t('usage.section.tokens')} ${formatTokenCount(tokenTotal)}`}>
              <em>{t('usage.compact.tokens')}</em>
              <strong>{formatTokenCount(tokenTotal)}</strong>
            </span>
            </div>
          </div>
          <IconButton label={t('usage.refresh')} dense disabled={loading} onClick={() => { load() }}>
            {loading ? <span className={css.spinner} aria-hidden /> : <IconRefresh />}
          </IconButton>
        </div>
      ) : (
        <>
      <header className={css.head}>
        <span className={css.title}>{t('usage.title')}</span>
        {model !== '' ? <span className={css.model} title={model}>{model}</span> : <span className={css.model} />}
        <IconButton label={pinTitle} active={parked} onClick={toggleDock}>
          <IconPin />
        </IconButton>
        <IconButton label={t('usage.refresh')} disabled={loading} onClick={() => { load() }}>
          {loading ? <span className={css.spinner} aria-hidden /> : <IconRefresh />}
        </IconButton>
      </header>
      <div className={css.body}>
        {pinError && dock !== 'nav' ? (
          <p className={css.warn} role="alert">{t('usage.dock.missing')}</p>
        ) : null}
        <section className={css.money} aria-label={t('usage.section.money')} data-idle={!moneyOk || undefined}>
          <Metric label={t('usage.balance')} value={moneyOk ? balance : DASH} />
          <Metric label={spendLabel} value={spend} />
        </section>
        {moneyOk && primary !== undefined && (primary.toppedUp !== undefined || primary.granted !== undefined) ? (
          <p className={css.mix}>
            {primary.toppedUp !== undefined ? (
              <span>{t('usage.toppedUp')} {formatMoney({ currency: primary.currency, total: primary.toppedUp })}</span>
            ) : null}
            {primary.granted !== undefined ? (
              <span>{t('usage.granted')} {formatMoney({ currency: primary.currency, total: primary.granted })}</span>
            ) : null}
          </p>
        ) : null}
        {statusText !== '' ? <p className={css.hint} role="status">{statusText}</p> : null}
        {snapshot?.accountAvailable === false && moneyOk ? (
          <p className={css.warn} role="alert">{t('usage.unavailable')}</p>
        ) : null}
        {moneyOk && apiSpend === undefined && observedOn ? (
          <p className={css.hint}>
            {t('usage.observedHint')}
            <button type="button" className={css.textBtn} onClick={resetObserved}>
              {t('usage.observedReset')}
            </button>
          </p>
        ) : moneyOk && apiSpend === undefined && !deepseek ? (
          <p className={css.hint}>{t('usage.spendUnavailable')}</p>
        ) : null}
        {deepseek ? (
          <a
            className={css.officialLink}
            href={OFFICIAL_USAGE_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('usage.officialOpen')}
          </a>
        ) : null}
        <section className={`${css.block} ${css.tokens}`} aria-label={t('usage.section.tokens')}>
          <div className={css.blockHead}>
            <span className={css.blockTitle}>{t('usage.section.tokens')}</span>
            <span className={css.blockValue}>{formatTokenCount(tokenTotal)}</span>
          </div>
          <p className={css.hint}>{t('usage.tokensHint')}</p>
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
          <section className={`${css.block} ${css.context}`} aria-label={t('usage.section.context')}>
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
        </>
      )}
    </div>
  )
}

function moneyStatus(snapshot: ProviderUsageSnapshot | null, t: Translate): string {
  if (snapshot === null) return ''
  if (snapshot.balanceStatus === 'no_key') return t('usage.status.no_key')
  if (snapshot.balanceStatus === 'auth') return t('usage.status.auth')
  if (snapshot.balanceStatus === 'failed') return t('usage.status.failed')
  if (snapshot.balanceStatus === 'unsupported') return t('usage.status.unsupported')
  return ''
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
