import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { redactSecrets } from '../../shared/redact.ts'
import {
  formatBrowserBytes,
  formatBrowserDuration,
  type BrowserAppInfo,
  type BrowserCssSheet,
  type BrowserCssVar,
  type BrowserFileEntry,
  type BrowserNetEntry,
  type BrowserNetType,
  type BrowserStoreRow,
} from '../../shared/browser-devtools.ts'
import {
  loadDevtoolsPane,
  saveDevtoolsPane,
  type DevtoolsDock,
  type DevtoolsPane,
} from './browser-dock.ts'
import {
  clearBrowserConsole,
  clearBrowserNetwork,
  getActiveBrowserId,
  readActiveBrowserTab,
  requestBrowserEval,
  requestBrowserProbe,
  subscribeBrowserSession,
  type BrowserConsoleLine,
} from './browser-session.ts'
import { IconButton } from './IconButton.tsx'
import { IconDockBottom, IconRefresh, IconSidePanel, IconTrash } from './icons.tsx'
import type { Translate } from './types.ts'
import css from './DevToolsPanel.module.css'

const DASH = '—'

type ConsoleFilter = 'all' | 'warn' | 'error'
type NetFilter = 'all' | 'xhr' | 'script' | 'stylesheet' | 'image' | 'other'
type AppSection = 'cookies' | 'local' | 'session' | 'db'

function clock(at: number): string {
  const d = new Date(at)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function lineVisible(line: BrowserConsoleLine, filter: ConsoleFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'error') return line.level === 'error'
  return line.level === 'warn' || line.level === 'error'
}

function prefixOf(line: BrowserConsoleLine): string {
  if (line.kind === 'command') return '>'
  if (line.kind === 'result') return '←'
  return ''
}

function typeLabel(kind: BrowserNetType, t: Translate): string {
  return t(`browser.info.type.${kind}`)
}

function netVisible(entry: BrowserNetEntry, filter: NetFilter, query: string): boolean {
  if (query !== '' && !entry.url.toLowerCase().includes(query)) return false
  if (filter === 'all') return true
  if (filter === 'xhr') return entry.resourceType === 'xhr' || entry.resourceType === 'fetch' || entry.resourceType === 'websocket'
  if (filter === 'script') return entry.resourceType === 'script'
  if (filter === 'stylesheet') return entry.resourceType === 'stylesheet'
  if (filter === 'image') return entry.resourceType === 'image'
  return entry.resourceType !== 'xhr'
    && entry.resourceType !== 'fetch'
    && entry.resourceType !== 'websocket'
    && entry.resourceType !== 'script'
    && entry.resourceType !== 'stylesheet'
    && entry.resourceType !== 'image'
}

function statusKind(entry: BrowserNetEntry): 'ok' | 'warn' | 'fail' | 'wait' | '' {
  if (entry.pending) return 'wait'
  if (entry.failed || entry.status >= 400) return 'fail'
  if (entry.status >= 300) return 'warn'
  if (entry.status === 101 || entry.status >= 200) return 'ok'
  return ''
}

function statusLabel(entry: BrowserNetEntry, t: Translate): string {
  if (entry.pending) return t('browser.info.networkPending')
  if (entry.failed && entry.status <= 0) return t('browser.info.networkFailed')
  if (entry.status <= 0) return DASH
  return String(entry.status)
}

function bytesOrDash(n: number): string {
  return formatBrowserBytes(n) || DASH
}

function timeOrDash(n: number): string {
  return formatBrowserDuration(n) || DASH
}

function EmptyNeedPage({ t }: { t: Translate }) {
  return <p className={css.empty}>{t('browser.devtoolsEmpty')}</p>
}

function NetworkPane({
  hasPage,
  activeId,
  rows,
  t,
}: {
  hasPage: boolean
  activeId: string | null
  rows: BrowserNetEntry[]
  t: Translate
}) {
  const [filter, setFilter] = useState<NetFilter>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const q = query.trim().toLowerCase()
  const visible = rows.filter(row => netVisible(row, filter, q))
  const selected = visible.find(row => row.id === selectedId) ?? null

  if (!hasPage) return <EmptyNeedPage t={t} />

  return (
    <div className={css.split}>
      <p className={css.note}>{t('browser.info.networkHint')}</p>
      <div className={css.toolbar}>
        <div className={css.filters}>
          {([
            ['all', t('browser.info.consoleFilterAll')],
            ['xhr', t('browser.info.networkFilterXhr')],
            ['script', t('browser.info.networkFilterScript')],
            ['stylesheet', t('browser.info.networkFilterCss')],
            ['image', t('browser.info.networkFilterImg')],
            ['other', t('browser.info.networkFilterOther')],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={css.filter}
              data-active={filter === id || undefined}
              onClick={() => { setFilter(id) }}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          className={css.search}
          value={query}
          placeholder={t('browser.info.networkSearch')}
          aria-label={t('browser.info.networkSearch')}
          spellCheck={false}
          onChange={(event) => { setQuery(event.target.value) }}
        />
        <IconButton
          label={t('browser.info.networkClear')}
          disabled={rows.length === 0}
          onClick={() => {
            if (activeId !== null) clearBrowserNetwork(activeId)
            setSelectedId(null)
          }}
        >
          <IconTrash />
        </IconButton>
      </div>
      <div className={css.tableWrap}>
        {visible.length === 0 ? (
          <p className={css.empty}>
            {rows.length === 0 ? t('browser.info.networkEmpty') : t('browser.info.networkEmptyFilter')}
          </p>
        ) : (
          <table className={css.table}>
            <thead>
              <tr>
                <th className={css.colMethod}>{t('browser.info.networkMethod')}</th>
                <th className={css.colStatus}>{t('browser.info.networkStatus')}</th>
                <th className={css.colType}>{t('browser.info.networkType')}</th>
                <th className={css.colTime}>{t('browser.info.networkTime')}</th>
                <th className={css.colSize}>{t('browser.info.networkSize')}</th>
                <th>{t('browser.info.networkUrl')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(row => {
                const kind = statusKind(row)
                return (
                  <tr
                    key={row.id}
                    className={css.row}
                    data-active={selected?.id === row.id || undefined}
                    onClick={() => { setSelectedId(row.id) }}
                  >
                    <td>{row.method}</td>
                    <td className={kind === 'ok' ? css.statusOk : kind === 'fail' ? css.statusFail : kind === 'warn' ? css.statusWarn : kind === 'wait' ? css.statusWait : undefined}>
                      {statusLabel(row, t)}
                    </td>
                    <td>{typeLabel(row.resourceType, t)}</td>
                    <td>{timeOrDash(row.durationMs)}</td>
                    <td>{bytesOrDash(row.size)}</td>
                    <td className={css.urlCell} title={row.url}>{row.url}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      {selected !== null ? (
        <div className={css.detail}>
          <p className={css.detailRow}>
            <span className={css.k}>{t('browser.info.networkMethod')}</span>
            <span>{selected.method}</span>
          </p>
          <p className={css.detailRow}>
            <span className={css.k}>{t('browser.info.networkStatus')}</span>
            <span>{statusLabel(selected, t)}</span>
          </p>
          <p className={css.detailRow}>
            <span className={css.k}>{t('browser.info.networkType')}</span>
            <span>{typeLabel(selected.resourceType, t)}</span>
          </p>
          <p className={css.detailRow}>
            <span className={css.k}>{t('browser.info.networkTime')}</span>
            <span>{timeOrDash(selected.durationMs)}</span>
          </p>
          <p className={css.detailRow}>
            <span className={css.k}>{t('browser.info.networkSize')}</span>
            <span>{bytesOrDash(selected.size)}</span>
          </p>
          <p className={css.detailRow}>
            <span className={css.k}>{t('browser.info.networkUrl')}</span>
            <span className={css.v}>{selected.url}</span>
          </p>
        </div>
      ) : null}
    </div>
  )
}

function StoreTable({
  rows,
  empty,
  t,
}: {
  rows: BrowserStoreRow[]
  empty: string
  t: Translate
}) {
  if (rows.length === 0) return <p className={css.empty}>{empty}</p>
  return (
    <table className={css.table}>
      <thead>
        <tr>
          <th className={css.colKind}>{t('browser.info.appName')}</th>
          <th>{t('browser.info.appValue')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.name}:${index}`}>
            <td className={css.urlCell} title={row.name}>{row.name || DASH}</td>
            <td className={css.v}>
              {row.value || DASH}
              {row.truncated ? <span className={css.chip}>{t('browser.info.appTruncated')}</span> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ApplicationPane({
  hasPage,
  app,
  t,
}: {
  hasPage: boolean
  app: BrowserAppInfo | null
  t: Translate
}) {
  const [section, setSection] = useState<AppSection>('cookies')
  if (!hasPage) return <EmptyNeedPage t={t} />
  const data = app ?? { cookies: [], localStorage: [], sessionStorage: [], databases: [] }
  return (
    <div className={css.split}>
      <p className={css.note}>{t('browser.info.appHint')}</p>
      <div className={css.toolbar}>
        <div className={css.filters}>
          {([
            ['cookies', t('browser.info.appCookies')],
            ['local', t('browser.info.appLocal')],
            ['session', t('browser.info.appSession')],
            ['db', t('browser.info.appDb')],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={css.filter}
              data-active={section === id || undefined}
              onClick={() => { setSection(id) }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className={css.tableWrap}>
        {section === 'cookies' ? (
          <StoreTable rows={data.cookies} empty={t('browser.info.appEmptyCookies')} t={t} />
        ) : section === 'local' ? (
          <StoreTable rows={data.localStorage} empty={t('browser.info.appEmptyLocal')} t={t} />
        ) : section === 'session' ? (
          <StoreTable rows={data.sessionStorage} empty={t('browser.info.appEmptySession')} t={t} />
        ) : data.databases.length === 0 ? (
          <p className={css.empty}>{t('browser.info.appEmptyDb')}</p>
        ) : (
          <ul className={css.log}>
            {data.databases.map(name => (
              <li key={name} className={css.logItem}>
                <span className={css.logText}>{name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function CssPane({
  hasPage,
  sheets,
  vars,
  t,
}: {
  hasPage: boolean
  sheets: BrowserCssSheet[]
  vars: BrowserCssVar[]
  t: Translate
}) {
  if (!hasPage) return <EmptyNeedPage t={t} />
  return (
    <div className={css.body}>
      <p className={css.bodyNote}>{t('browser.info.cssHint')}</p>
      <h3 className={css.sectionTitle}>{t('browser.info.cssSheets')}</h3>
      {sheets.length === 0 ? (
        <p className={css.empty}>{t('browser.info.cssEmptySheets')}</p>
      ) : sheets.map((sheet, index) => {
        const href = sheet.href || t('browser.info.cssInline')
        const bits: string[] = []
        if (sheet.disabled) bits.push(t('browser.info.cssDisabled'))
        if (sheet.blocked) bits.push(t('browser.info.cssBlocked'))
        else if (sheet.ruleCount !== null) bits.push(`${sheet.ruleCount} ${t('browser.info.cssRules')}`)
        return (
          <div key={`${href}:${index}`} className={css.sheet}>
            <p className={css.sheetTitle} title={href}>{sheet.title ? `${sheet.title} · ${href}` : href}</p>
            <p className={css.sheetMeta}>{bits.join(' · ') || DASH}</p>
          </div>
        )
      })}
      <h3 className={css.sectionTitle}>{t('browser.info.cssVars')}</h3>
      {vars.length === 0 ? (
        <p className={css.empty}>{t('browser.info.cssEmptyVars')}</p>
      ) : (
        <dl className={css.grid}>
          {vars.map(row => (
            <div key={row.name} className={css.pair}>
              <dt className={css.k}>{row.name}</dt>
              <dd className={css.v}>{row.value || DASH}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

function FilesPane({
  hasPage,
  files,
  t,
}: {
  hasPage: boolean
  files: BrowserFileEntry[]
  t: Translate
}) {
  const [filter, setFilter] = useState<NetFilter>('all')
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const visible = files.filter(row => netVisible({
    id: 1,
    method: 'GET',
    url: row.url,
    resourceType: row.kind,
    status: 0,
    durationMs: row.durationMs,
    size: row.size,
    pending: false,
    failed: false,
    startAt: 0,
  }, filter, q))

  if (!hasPage) return <EmptyNeedPage t={t} />

  return (
    <div className={css.split}>
      <p className={css.note}>{t('browser.info.filesHint')}</p>
      <div className={css.toolbar}>
        <div className={css.filters}>
          {([
            ['all', t('browser.info.consoleFilterAll')],
            ['script', t('browser.info.networkFilterScript')],
            ['stylesheet', t('browser.info.networkFilterCss')],
            ['image', t('browser.info.networkFilterImg')],
            ['other', t('browser.info.networkFilterOther')],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={css.filter}
              data-active={filter === id || undefined}
              onClick={() => { setFilter(id) }}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          className={css.search}
          value={query}
          placeholder={t('browser.info.networkSearch')}
          aria-label={t('browser.info.networkSearch')}
          spellCheck={false}
          onChange={(event) => { setQuery(event.target.value) }}
        />
      </div>
      <div className={css.tableWrap}>
        {visible.length === 0 ? (
          <p className={css.empty}>
            {files.length === 0 ? t('browser.info.filesEmpty') : t('browser.info.networkEmptyFilter')}
          </p>
        ) : (
          <table className={css.table}>
            <thead>
              <tr>
                <th className={css.colKind}>{t('browser.info.filesKind')}</th>
                <th className={css.colSize}>{t('browser.info.networkSize')}</th>
                <th className={css.colTime}>{t('browser.info.networkTime')}</th>
                <th>{t('browser.info.networkUrl')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(row => (
                <tr key={row.url}>
                  <td>{typeLabel(row.kind, t)}</td>
                  <td>{bytesOrDash(row.size)}</td>
                  <td>{timeOrDash(row.durationMs)}</td>
                  <td className={css.urlCell} title={row.url}>{row.url}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export function DevToolsPanel({
  dock,
  onDock,
  t,
}: {
  dock: DevtoolsDock
  onDock: (dock: DevtoolsDock) => void
  t: Translate
}) {
  const state = useSyncExternalStore(subscribeBrowserSession, readActiveBrowserTab, readActiveBrowserTab)
  const activeId = useSyncExternalStore(subscribeBrowserSession, getActiveBrowserId, getActiveBrowserId)
  const page = state.page
  const hasPage = activeId !== null && state.committed !== ''
  const [pane, setPane] = useState<DevtoolsPane>(() => loadDevtoolsPane())
  const [filter, setFilter] = useState<ConsoleFilter>('all')
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLUListElement | null>(null)
  const lines = Array.isArray(state.console) ? state.console : []
  const visible = lines.filter(line => lineVisible(line, filter))
  const network = Array.isArray(state.network) ? state.network : []
  const sheets = Array.isArray(state.cssSheets) ? state.cssSheets : []
  const vars = Array.isArray(state.cssVars) ? state.cssVars : []
  const files = Array.isArray(state.files) ? state.files : []

  useEffect(() => {
    const el = logRef.current
    if (el === null) return
    el.scrollTop = el.scrollHeight
  }, [visible.length, pane])

  useEffect(() => {
    if (!hasPage || activeId === null) return
    if (pane === 'console') return
    requestBrowserProbe(activeId)
  }, [pane, hasPage, activeId, state.committed])

  const runEval = (): void => {
    if (activeId === null || !hasPage) return
    const code = draft.trim()
    if (code === '') return
    requestBrowserEval(activeId, code)
    setDraft('')
  }

  const changePane = (next: DevtoolsPane): void => {
    setPane(next)
    saveDevtoolsPane(next)
  }

  const tabs: Array<{ id: DevtoolsPane; label: string }> = [
    { id: 'console', label: t('browser.info.console') },
    { id: 'network', label: t('browser.info.network') },
    { id: 'application', label: t('browser.info.application') },
    { id: 'css', label: t('browser.info.css') },
    { id: 'files', label: t('browser.info.files') },
    { id: 'page', label: t('browser.info.page') },
  ]

  const showRefresh = hasPage && pane !== 'console'

  return (
    <section className={css.root} aria-label={t('browser.devtools')}>
      <div className={css.head}>
        <div className={css.panes} role="tablist">
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              className={css.pane}
              role="tab"
              aria-selected={pane === tab.id}
              data-active={pane === tab.id || undefined}
              onClick={() => { changePane(tab.id) }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {showRefresh ? (
          <IconButton
            label={t('browser.info.refresh')}
            onClick={() => { if (activeId !== null) requestBrowserProbe(activeId) }}
          >
            <IconRefresh />
          </IconButton>
        ) : null}
        {dock === 'bottom' ? (
          <IconButton label={t('browser.devtoolsToSide')} onClick={() => { onDock('side') }}>
            <IconSidePanel />
          </IconButton>
        ) : (
          <IconButton label={t('browser.devtoolsToBottom')} onClick={() => { onDock('bottom') }}>
            <IconDockBottom />
          </IconButton>
        )}
      </div>
      {pane === 'network' ? (
        <NetworkPane hasPage={hasPage} activeId={activeId} rows={network} t={t} />
      ) : pane === 'application' ? (
        <ApplicationPane hasPage={hasPage} app={state.app} t={t} />
      ) : pane === 'css' ? (
        <CssPane hasPage={hasPage} sheets={sheets} vars={vars} t={t} />
      ) : pane === 'files' ? (
        <FilesPane hasPage={hasPage} files={files} t={t} />
      ) : pane === 'page' ? (
        <div className={css.body}>
          {!hasPage ? (
            <EmptyNeedPage t={t} />
          ) : (
            <dl className={css.grid}>
              <dt className={css.k}>{t('browser.info.url')}</dt>
              <dd className={css.v}>{redactSecrets(page?.url || state.committed) || DASH}</dd>
              <dt className={css.k}>{t('browser.info.title')}</dt>
              <dd className={css.v}>{page?.title || state.title || DASH}</dd>
              <dt className={css.k}>{t('browser.info.viewport')}</dt>
              <dd className={css.v}>
                {page !== null && page.viewport.w > 0
                  ? `${page.viewport.w} × ${page.viewport.h}`
                  : DASH}
              </dd>
              <dt className={css.k}>{t('browser.info.secure')}</dt>
              <dd className={css.v}>
                {page?.secure === true ? t('browser.info.secureYes') : t('browser.info.secureNo')}
              </dd>
              <dt className={css.k}>{t('browser.info.cookiesEnabled')}</dt>
              <dd className={css.v}>
                {page?.cookiesEnabled === false ? t('browser.info.no') : t('browser.info.yes')}
              </dd>
              <dt className={css.k}>{t('browser.info.ua')}</dt>
              <dd className={css.v}>{page?.ua || (typeof navigator !== 'undefined' ? navigator.userAgent : DASH)}</dd>
            </dl>
          )}
        </div>
      ) : (
        <>
          <div className={css.toolbar}>
            <div className={css.filters}>
              {([
                ['all', t('browser.info.consoleFilterAll')],
                ['warn', t('browser.info.consoleFilterWarn')],
                ['error', t('browser.info.consoleFilterError')],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={css.filter}
                  data-active={filter === id || undefined}
                  onClick={() => { setFilter(id) }}
                >
                  {label}
                </button>
              ))}
            </div>
            <IconButton
              label={t('browser.info.consoleClear')}
              disabled={lines.length === 0}
              onClick={() => { if (activeId !== null) clearBrowserConsole(activeId) }}
            >
              <IconTrash />
            </IconButton>
          </div>
          <ul ref={logRef} className={css.log} aria-live="polite">
            {visible.length === 0 ? (
              <li className={css.logEmpty}>
                {hasPage ? t('browser.info.consoleEmpty') : t('browser.devtoolsEmpty')}
              </li>
            ) : (
              visible.map(line => {
                const prefix = prefixOf(line)
                return (
                  <li
                    key={line.id}
                    className={css.logItem}
                    data-level={line.level}
                    data-kind={line.kind}
                  >
                    {prefix !== '' ? <span className={css.prefix}>{prefix}</span> : null}
                    <span className={css.logText}>{line.text || DASH}</span>
                    <span className={css.time}>{clock(line.at)}</span>
                  </li>
                )
              })
            )}
          </ul>
          <form
            className={css.prompt}
            onSubmit={(event) => {
              event.preventDefault()
              runEval()
            }}
          >
            <span className={css.promptMark} aria-hidden>{'>'}</span>
            <input
              className={css.promptInput}
              value={draft}
              disabled={!hasPage}
              placeholder={hasPage ? t('browser.info.consoleEvalPlaceholder') : t('browser.info.consoleEvalNeedPage')}
              aria-label={t('browser.info.consoleEval')}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onChange={(event) => { setDraft(event.target.value) }}
            />
          </form>
        </>
      )}
    </section>
  )
}