import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { GitClient } from '../api.ts'
import type { GitStatusSnapshot, PluginUpdateSnapshot } from '../../shared/types.ts'
import { redactSecrets } from '../../shared/redact.ts'
import { formatStatusBalance } from '../../shared/usage-format.ts'
import { PLUGIN_ISSUES_URL, PLUGIN_PAGE_URL, PLUGIN_REPO_URL } from '../../shared/version.ts'
import { IconChevron, IconFeedback, IconGithub, IconNpm, IconSparkle } from './icons.tsx'
import { EDITOR_MODES, type EditorModeId } from './editor-mode.ts'
import { fileName, shortPath, tabStripOverflow, tabStripScrollDelta } from './status-bar.ts'
import { terminalTabLabel, type FileTab, type Translate } from './types.ts'
import { readUsageLive, retainUsageLive, subscribeUsageLive } from './usage-live.ts'
import css from './StatusBar.module.css'

function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function StatusBar({
  client,
  workspaceId,
  workspacePath,
  sessionId,
  active,
  plugin,
  tabs,
  aiTermIds,
  editorMode,
  onEditorModeChange,
  onActivate,
  onPrepareUpdate,
  t,
}: {
  client: GitClient
  workspaceId?: string
  workspacePath?: string
  sessionId?: string
  active?: FileTab | null
  plugin: PluginUpdateSnapshot | null
  tabs?: FileTab[]
  aiTermIds?: readonly string[]
  editorMode?: EditorModeId
  onEditorModeChange?: (mode: EditorModeId) => void
  onActivate?: (id: string) => void
  onPrepareUpdate?: () => void
  t: Translate
}) {
  const [status, setStatus] = useState<GitStatusSnapshot | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [updateNote, setUpdateNote] = useState<string | null>(null)
  const usage = useSyncExternalStore(subscribeUsageLive, readUsageLive, () => null)

  useEffect(() => retainUsageLive(client, sessionId), [client, sessionId])

  useEffect(() => {
    if (!modeMenuOpen) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setModeMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [modeMenuOpen])

  useEffect(() => {
    if (workspaceId === undefined) {
      setStatus(null)
      return
    }
    let live = true
    let hasRemote = false
    const load = (): void => {
      void client.status(workspaceId).then((result) => {
        if (!live) return
        if (!result.ok && result.code === 'BUSY') return
        if (result.ok) {
          hasRemote = result.value.probe.remote !== undefined
          setStatus(result.value)
          return
        }
        setStatus(null)
      })
    }
    const fetchRemote = (): void => {
      if (!hasRemote) return
      void client.fetch(workspaceId).then((result) => {
        if (!live || !result.ok) return
        load()
      })
    }
    void client.status(workspaceId).then((result) => {
      if (!live) return
      if (!result.ok) {
        if (result.code !== 'BUSY') setStatus(null)
        return
      }
      hasRemote = result.value.probe.remote !== undefined
      setStatus(result.value)
      fetchRemote()
    })
    const statusTimer = window.setInterval(load, 8000)
    const fetchTimer = window.setInterval(fetchRemote, 60_000)
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') fetchRemote()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      live = false
      window.clearInterval(statusTimer)
      window.clearInterval(fetchTimer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [client, workspaceId])

  const probe = status?.probe
  const dirty = (status?.staged.length ?? 0) + (status?.unstaged.length ?? 0) + (status?.untracked.length ?? 0)
  const cwd = workspacePath !== undefined && workspacePath !== '' ? shortPath(workspacePath) : t('status.noWorkspace')
  const cwdFull = workspacePath !== undefined ? redactSecrets(workspacePath) : t('status.noWorkspace')
  const version = plugin?.current ?? '—'
  const branch = probe === undefined
    ? t('status.noGit')
    : !probe.gitAvailable
      ? t('status.noGit')
      : !probe.isRepo
        ? t('status.notRepo')
        : probe.detached
          ? t('panel.detached')
          : (probe.branch ?? t('status.noGit'))
  const openTabs = tabs ?? []
  const balanceText = formatStatusBalance(usage)
  const balanceOk = usage !== null && usage.balanceStatus === 'ok' && usage.balances[0] !== undefined
  const balanceTitle = balanceOk
    ? t('status.balanceTitle', { amount: balanceText })
    : t('status.balanceUnavailable')

  return (
    <footer
      className={css.bar}
      data-git-ide-panel="status"
      aria-label={t('status.label')}
    >
      <StatusTabs tabs={openTabs} activeId={active?.id} aiTermIds={aiTermIds} onActivate={onActivate} t={t} />
      <span className={css.grow} />
      <span className={`${css.item} ${css.itemLead}`}>
        <span className={css.balance} title={balanceTitle} aria-label={balanceTitle}>
          {balanceText}
        </span>
        <button
          type="button"
          className={css.version}
          title={t('status.feedbackTitle')}
          aria-label={t('status.feedbackTitle')}
          onClick={() => { openExternal(PLUGIN_ISSUES_URL) }}
        >
          <IconFeedback size={12} />
          {t('status.feedback')}
        </button>
        <button
          type="button"
          className={css.version}
          title={t('status.versionTitle', { version })}
          aria-label={t('status.versionTitle', { version })}
          onClick={() => { openExternal(PLUGIN_REPO_URL) }}
        >
          <IconGithub size={12} />
          {t('status.version', { version })}
        </button>
        {plugin?.outdated && plugin.latest !== null ? (
          <span className={css.warnWrap}>
            <button
              type="button"
              className={css.warn}
              title={updateNote ?? t('status.updateTitle', { latest: plugin.latest })}
              aria-label={t('status.updateTitle', { latest: plugin.latest })}
              onClick={() => { openExternal(PLUGIN_PAGE_URL) }}
            >
              <IconNpm size={12} />
              {t('status.update', { latest: plugin.latest })}
            </button>
            <button
              type="button"
              className={css.warnMore}
              data-open={menuOpen || undefined}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title={t('status.updateMenu')}
              aria-label={t('status.updateMenu')}
              onClick={() => { setMenuOpen(open => !open) }}
            >
              <IconChevron open />
            </button>
            {menuOpen ? (
              <>
                <div className={css.menuBackdrop} onClick={() => { setMenuOpen(false) }} />
                <div className={css.menu} role="menu" aria-label={t('status.updateMenu')}>
                  <button
                    type="button"
                    className={css.menuItem}
                    role="menuitem"
                    title={t('status.updatePageHint', { latest: plugin.latest })}
                    onClick={() => {
                      setMenuOpen(false)
                      openExternal(PLUGIN_PAGE_URL)
                    }}
                  >
                    <IconNpm size={12} />
                    {t('status.updatePage')}
                  </button>
                  <button
                    type="button"
                    className={css.menuItem}
                    role="menuitem"
                    disabled={workspaceId === undefined}
                    title={workspaceId === undefined ? t('status.updateNoWorkspace') : t('status.updateRunHint')}
                    onClick={() => {
                      if (workspaceId === undefined) return
                      setMenuOpen(false)
                      onPrepareUpdate?.()
                      window.setTimeout(() => {
                        void client.writeTerm(workspaceId, `${plugin.command}\n`).then((result) => {
                          setUpdateNote(result.ok ? t('status.updateSent') : (result.messageZh || t('status.updateFailed')))
                          window.setTimeout(() => { setUpdateNote(null) }, 4000)
                        })
                      }, 80)
                    }}
                  >
                    {t('status.updateRun', { latest: plugin.latest })}
                  </button>
                </div>
              </>
            ) : null}
          </span>
        ) : null}
      </span>
      <span className={css.item} title={cwdFull}>{t('status.cwd', { path: cwd })}</span>
      <span className={css.item} title={branch}>
        {t('status.branch', { name: branch })}
        {probe !== undefined && probe.ahead > 0 ? ` ${t('panel.ahead', { count: probe.ahead })}` : ''}
        {probe !== undefined && probe.behind > 0 ? ` ${t('panel.behind', { count: probe.behind })}` : ''}
      </span>
      <span className={css.item} title={dirty > 0 ? t('status.dirtyTitle', { count: dirty }) : t('status.cleanTitle')}>
        {dirty > 0 ? t('status.dirty', { count: dirty }) : t('status.clean')}
      </span>
      {active?.kind === 'file' && editorMode !== undefined ? (
        <span className={css.modeWrap}>
          <button
            type="button"
            className={css.mode}
            data-open={modeMenuOpen || undefined}
            aria-haspopup="menu"
            aria-expanded={modeMenuOpen}
            title={t('editor.modeMenu')}
            aria-label={t('editor.mode', { name: t(`editor.mode.${editorMode}`) })}
            onClick={() => { setModeMenuOpen(open => !open) }}
          >
            {t(`editor.mode.${editorMode}`)}
            <IconChevron open={modeMenuOpen} />
          </button>
          {modeMenuOpen ? (
            <>
              <div className={css.menuBackdrop} onClick={() => { setModeMenuOpen(false) }} />
              <div className={css.menu} role="menu" aria-label={t('editor.modeMenu')}>
                {EDITOR_MODES.map(mode => (
                  <button
                    key={mode}
                    type="button"
                    role="menuitem"
                    className={css.menuItem}
                    data-active={editorMode === mode || undefined}
                    title={t(`editor.mode.${mode}Hint`)}
                    onClick={() => {
                      setModeMenuOpen(false)
                      onEditorModeChange?.(mode)
                    }}
                  >
                    <span className={css.modeName}>{t(`editor.mode.${mode}`)}</span>
                    <span className={css.modeHint}>{t(`editor.mode.${mode}Hint`)}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </span>
      ) : null}
    </footer>
  )
}

function StatusTabs({
  tabs,
  activeId,
  aiTermIds,
  onActivate,
  t,
}: {
  tabs: FileTab[]
  activeId?: string
  aiTermIds?: readonly string[]
  onActivate?: (id: string) => void
  t: Translate
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState({ canLeft: false, canRight: false })
  const tabKey = tabs.map(tab => `${tab.id}\0${tab.title ?? tab.path}`).join('|')

  const measure = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    setOverflow(tabStripOverflow(el.scrollLeft, el.clientWidth, el.scrollWidth))
  }, [])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const run = (): void => { measure() }
    run()
    const frame = window.requestAnimationFrame(run)
    const ro = new ResizeObserver(run)
    ro.observe(el)
    el.addEventListener('scroll', run, { passive: true })
    return () => {
      window.cancelAnimationFrame(frame)
      ro.disconnect()
      el.removeEventListener('scroll', run)
    }
  }, [measure, tabKey])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el || activeId === undefined) return
    const btn = el.querySelector(`[data-tab="${CSS.escape(activeId)}"]`)
    if (btn instanceof HTMLElement) {
      btn.scrollIntoView({ inline: 'nearest', block: 'nearest' })
    }
    measure()
  }, [activeId, measure])

  const scroll = (dir: -1 | 1): void => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollBy({ left: dir * tabStripScrollDelta(el.clientWidth), behavior: 'smooth' })
  }

  return (
    <div className={css.tabStrip}>
      {overflow.canLeft ? (
        <button
          type="button"
          className={css.nudge}
          data-dir="left"
          aria-label={t('status.tabsPrev')}
          title={t('status.tabsPrev')}
          onClick={() => { scroll(-1) }}
        />
      ) : null}
      <div className={css.tabs} ref={scrollerRef} role="tablist" aria-label={t('status.files')}>
        {tabs.length === 0 ? (
          <span className={css.item}>{t('status.noFile')}</span>
        ) : tabs.map(tab => {
          const label = tab.kind === 'terminal'
            ? terminalTabLabel(tab, t)
            : tab.kind === 'diff' || tab.kind === 'commitDiff'
              ? t('status.diff', { name: fileName(tab.path) })
              : fileName(tab.path)
          const title = tab.kind === 'file' || tab.kind === 'preview'
            || tab.kind === 'diff' || tab.kind === 'commitDiff'
            ? redactSecrets(tab.path)
            : tab.kind === 'terminal' && aiTermIds?.includes(tab.id)
              ? t('term.ai.modeOn')
              : label
          const aiOn = tab.kind === 'terminal' && aiTermIds?.includes(tab.id) === true
          return (
            <button
              key={tab.id}
              type="button"
              className={css.tab}
              data-tab={tab.id}
              data-active={tab.id === activeId || undefined}
              data-ai={aiOn || undefined}
              data-ignored={tab.ignored === true || undefined}
              role="tab"
              title={tab.ignored === true ? t('tree.ignored') : title}
              onClick={() => { onActivate?.(tab.id) }}
            >
              {aiOn ? (
                <span className={css.aiMark} aria-label={t('term.ai.mode')}>
                  <IconSparkle size={11} />
                </span>
              ) : null}
              {label}
            </button>
          )
        })}
      </div>
      {overflow.canRight ? (
        <button
          type="button"
          className={css.nudge}
          data-dir="right"
          aria-label={t('status.tabsNext')}
          title={t('status.tabsNext')}
          onClick={() => { scroll(1) }}
        />
      ) : null}
    </div>
  )
}