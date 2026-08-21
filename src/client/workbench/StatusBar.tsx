import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { GitClient } from '../api.ts'
import type { PluginUpdateSnapshot } from '../../shared/types.ts'
import { redactSecrets } from '../../shared/redact.ts'
import { formatStatusBalance } from '../../shared/usage-format.ts'
import { PLUGIN_ISSUES_URL, PLUGIN_PAGE_URL, PLUGIN_REPO_URL } from '../../shared/version.ts'
import {
  BOTTOM_SPANS,
  DEFAULT_BOTTOM_SPAN,
  DEFAULT_TERM_DOCK,
  TERM_DOCKS,
  bottomSpanDisabledReason,
  statusBarVisibleTabs,
  type BottomSpan,
  type TermDock,
} from './bottom-layout.ts'
import { EDITOR_MODES, type EditorModeId } from './editor-mode.ts'
import { IconChevron, IconFeedback, IconGithub, IconNpm, IconSparkle } from './icons.tsx'
import { readNearbyGit, retainNearbyGit, subscribeNearbyGit } from './nearby-git.ts'
import { readGitLiveStatus, retainGitLive, subscribeGitLive } from './git-live.ts'
import { fileName, showEditorStatusChrome, statusMenuAnchorStyle, tabStripOverflow, tabStripScrollDelta } from './status-bar.ts'
import { browserTabLabel, terminalTabLabel, type FileTab, type Translate } from './types.ts'
import { readUsageLive, retainUsageLive, subscribeUsageLive } from './usage-live.ts'
import css from './StatusBar.module.css'

function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * Status-bar popup menu, pinned to the viewport and portaled to document.body.
 *
 * Why portal + fixed (not just fixed inside the bar):
 * 1. The bar sits in [data-git-ide-panel=bottom] (overflow:hidden, z-index:4).
 *    Absolute menus are clipped when the strip is only the 24px bar.
 * 2. Fixed alone is not enough: the bottom strip's z-index creates a stacking
 *    context, so the menu still loses to the sticky chat composer (which often
 *    participates at a higher root-level z-index). Product rule: layout / mode
 *    menus must sit above the session input. Portal escapes that trap.
 */
function StatusMenu({
  open,
  anchor,
  extraClass,
  label,
  onClose,
  children,
}: {
  open: boolean
  anchor: HTMLElement | null
  extraClass?: string
  label: string
  onClose: () => void
  children: ReactNode
}) {
  const [style, setStyle] = useState<CSSProperties | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setStyle(null)
      return
    }
    if (anchor === null) return
    setStyle(statusMenuAnchorStyle(
      anchor.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
    ))
  }, [open, anchor])

  if (!open || style === null) return null
  return createPortal(
    <>
      <div className={css.menuBackdrop} onClick={onClose} />
      <div
        className={extraClass === undefined ? `${css.menu} ${css.menuFixed}` : `${css.menu} ${css.menuFixed} ${extraClass}`}
        style={style}
        role="menu"
        aria-label={label}
        onMouseDown={(event) => { event.stopPropagation() }}
      >
        {children}
      </div>
    </>,
    document.body,
  )
}

export function StatusBar({
  client,
  workspaceId,
  sessionId,
  active,
  plugin,
  tabs,
  aiTermIds,
  editorMode,
  editorOpen = true,
  sideOpen = true,
  termDock = DEFAULT_TERM_DOCK,
  bottomSpan = DEFAULT_BOTTOM_SPAN,
  onEditorModeChange,
  onTermDockChange,
  onBottomSpanChange,
  onActivate,
  onPrepareUpdate,
  t,
}: {
  client: GitClient
  workspaceId?: string
  sessionId?: string
  active?: FileTab | null
  plugin: PluginUpdateSnapshot | null
  tabs?: FileTab[]
  aiTermIds?: readonly string[]
  editorMode?: EditorModeId
  /** When the editor column is a rail, hide file tabs, overflow triangles, and the mode menu. */
  editorOpen?: boolean
  sideOpen?: boolean
  termDock?: TermDock
  bottomSpan?: BottomSpan
  onEditorModeChange?: (mode: EditorModeId) => void
  onTermDockChange?: (dock: TermDock) => void
  onBottomSpanChange?: (span: BottomSpan) => void
  onActivate?: (id: string) => void
  onPrepareUpdate?: () => void
  t: Translate
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false)
  const [updateNote, setUpdateNote] = useState<string | null>(null)
  // Anchors for the popup menus: the bar's menus are pinned to the viewport so
  // they stay visible when the bottom strip collapses (terminal as editor tab).
  const warnWrapRef = useRef<HTMLSpanElement>(null)
  const modeWrapRef = useRef<HTMLSpanElement>(null)
  const layoutWrapRef = useRef<HTMLSpanElement>(null)
  const usage = useSyncExternalStore(subscribeUsageLive, readUsageLive, () => null)
  const nearby = useSyncExternalStore(subscribeNearbyGit, readNearbyGit, readNearbyGit)
  const status = useSyncExternalStore(subscribeGitLive, readGitLiveStatus, () => null)
  const repoId = nearby.selectedId

  useEffect(() => retainUsageLive(client, sessionId), [client, sessionId])
  useEffect(() => retainNearbyGit(client, workspaceId), [client, workspaceId])
  useEffect(() => retainGitLive(client, workspaceId, repoId), [client, workspaceId, repoId])

  useEffect(() => {
    if (!editorOpen) setModeMenuOpen(false)
  }, [editorOpen])

  useEffect(() => {
    if (!modeMenuOpen && !layoutMenuOpen) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setModeMenuOpen(false)
      setLayoutMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [layoutMenuOpen, modeMenuOpen])

  const probe = status?.probe
  const dirty = (status?.staged.length ?? 0) + (status?.unstaged.length ?? 0) + (status?.untracked.length ?? 0)
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
  const openTabs = statusBarVisibleTabs(tabs ?? [], { editorOpen, termDock })
  const balanceText = formatStatusBalance(usage)
  const balanceOk = usage !== null && usage.balanceStatus === 'ok' && usage.balances[0] !== undefined
  const balanceTitle = balanceOk
    ? t('status.balanceTitle', { amount: balanceText })
    : t('status.balanceUnavailable')

  return (
    <footer
      className={css.bar}
      data-git-ide-panel="status"
      data-editor={editorOpen ? 'on' : 'off'}
      aria-label={t('status.label')}
    >
      {openTabs.length > 0 ? (
        <StatusTabs tabs={openTabs} activeId={active?.id} aiTermIds={aiTermIds} onActivate={onActivate} t={t} />
      ) : null}
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
          <span className={css.warnWrap} ref={warnWrapRef}>
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
            <StatusMenu
              open={menuOpen}
              anchor={warnWrapRef.current}
              label={t('status.updateMenu')}
              onClose={() => { setMenuOpen(false) }}
            >
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
            </StatusMenu>
          </span>
        ) : null}
      </span>
      <span className={css.item} title={branch}>
        {t('status.branch', { name: branch })}
        {probe !== undefined && probe.ahead > 0 ? ` ${t('panel.ahead', { count: probe.ahead })}` : ''}
        {probe !== undefined && probe.behind > 0 ? ` ${t('panel.behind', { count: probe.behind })}` : ''}
      </span>
      <span className={css.item} title={dirty > 0 ? t('status.dirtyTitle', { count: dirty }) : t('status.cleanTitle')}>
        {dirty > 0 ? t('status.dirty', { count: dirty }) : t('status.clean')}
      </span>
      <LayoutMenu
        open={layoutMenuOpen}
        anchorRef={layoutWrapRef}
        termDock={termDock}
        bottomSpan={bottomSpan}
        editorOpen={editorOpen}
        sideOpen={sideOpen}
        onToggle={() => {
          setLayoutMenuOpen(open => !open)
          setModeMenuOpen(false)
          setMenuOpen(false)
        }}
        onClose={() => { setLayoutMenuOpen(false) }}
        onTermDockChange={onTermDockChange}
        onBottomSpanChange={onBottomSpanChange}
        t={t}
      />
      {showEditorStatusChrome(editorOpen) && active?.kind === 'file' && editorMode !== undefined ? (
        <span className={css.modeWrap} ref={modeWrapRef}>
          <button
            type="button"
            className={css.mode}
            data-open={modeMenuOpen || undefined}
            aria-haspopup="menu"
            aria-expanded={modeMenuOpen}
            title={t('editor.modeMenu')}
            aria-label={t('editor.mode', { name: t(`editor.mode.${editorMode}`) })}
            onClick={() => { setModeMenuOpen(open => !open); setLayoutMenuOpen(false); setMenuOpen(false) }}
          >
            {t(`editor.mode.${editorMode}`)}
            <IconChevron open={modeMenuOpen} />
          </button>
          <StatusMenu
            open={modeMenuOpen}
            anchor={modeWrapRef.current}
            label={t('editor.modeMenu')}
            onClose={() => { setModeMenuOpen(false) }}
          >
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
          </StatusMenu>
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
            : tab.kind === 'browser'
              ? browserTabLabel(tab, t)
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

function LayoutMenu({
  open,
  anchorRef,
  termDock,
  bottomSpan,
  editorOpen,
  sideOpen,
  onToggle,
  onClose,
  onTermDockChange,
  onBottomSpanChange,
  t,
}: {
  open: boolean
  anchorRef: RefObject<HTMLSpanElement>
  termDock: TermDock
  bottomSpan: BottomSpan
  editorOpen: boolean
  sideOpen: boolean
  onToggle: () => void
  onClose: () => void
  onTermDockChange?: (dock: TermDock) => void
  onBottomSpanChange?: (span: BottomSpan) => void
  t: Translate
}) {
  const columns = { editor: editorOpen, side: sideOpen }
  return (
    <span className={css.layoutWrap} ref={anchorRef}>
      <button
        type="button"
        className={css.mode}
        data-open={open || undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('layout.menuTitle')}
        aria-label={t('layout.menuTitle')}
        onClick={onToggle}
      >
        {t('layout.menu')}
        <IconChevron open={open} />
      </button>
      <StatusMenu
        open={open}
        anchor={anchorRef.current}
        extraClass={css.layoutMenu}
        label={t('layout.menu')}
        onClose={onClose}
      >
            <div className={css.layoutSection}>{t('layout.termSection')}</div>
            {TERM_DOCKS.map(dock => (
              <button
                key={dock}
                type="button"
                role="menuitem"
                className={`${css.menuItem} ${css.layoutItem}`}
                data-active={termDock === dock || undefined}
                title={t(`layout.term.${dock}Hint`)}
                onClick={() => {
                  onClose()
                  onTermDockChange?.(dock)
                }}
              >
                <span className={css.layoutName}>{t(`layout.term.${dock}`)}</span>
                <span className={css.layoutHint}>{t(`layout.term.${dock}Hint`)}</span>
              </button>
            ))}
            <div className={css.layoutSection}>{t('layout.spanSection')}</div>
            {termDock !== 'bottom' ? (
              <div className={css.layoutNote}>{t('layout.span.tabLocked')}</div>
            ) : BOTTOM_SPANS.map(span => {
              const disabled = bottomSpanDisabledReason(span, columns, t, termDock)
              return (
                <button
                  key={span}
                  type="button"
                  role="menuitem"
                  className={`${css.menuItem} ${css.layoutItem}`}
                  data-active={bottomSpan === span || undefined}
                  disabled={disabled !== null}
                  title={disabled ?? t(`layout.span.${span}Hint`)}
                  onClick={() => {
                    if (disabled !== null) return
                    onClose()
                    onBottomSpanChange?.(span)
                  }}
                >
                  <span className={css.layoutName}>{t(`layout.span.${span}`)}</span>
                  <span className={css.layoutHint}>{disabled ?? t(`layout.span.${span}Hint`)}</span>
                </button>
              )
            })}
      </StatusMenu>
    </span>
  )
}