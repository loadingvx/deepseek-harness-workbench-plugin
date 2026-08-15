import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitClient } from '../api.ts'
import type { GitStatusSnapshot, PluginUpdateSnapshot } from '../../shared/types.ts'
import { redactSecrets } from '../../shared/redact.ts'
import { PLUGIN_PAGE_URL, PLUGIN_REPO_URL } from '../../shared/version.ts'
import { IconChevron, IconGithub, IconNpm } from './icons.tsx'
import { fileName, shortPath, tabStripOverflow, tabStripScrollDelta } from './status-bar.ts'
import { terminalTabLabel, type FileTab, type Translate } from './types.ts'
import css from './StatusBar.module.css'

function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function StatusBar({
  client,
  workspaceId,
  workspacePath,
  active,
  plugin,
  tabs,
  onActivate,
  onPrepareUpdate,
  t,
}: {
  client: GitClient
  workspaceId?: string
  workspacePath?: string
  active?: FileTab | null
  plugin: PluginUpdateSnapshot | null
  tabs?: FileTab[]
  onActivate?: (id: string) => void
  onPrepareUpdate?: () => void
  t: Translate
}) {
  const [status, setStatus] = useState<GitStatusSnapshot | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [updateNote, setUpdateNote] = useState<string | null>(null)

  useEffect(() => {
    if (workspaceId === undefined) {
      setStatus(null)
      return
    }
    let live = true
    const load = (): void => {
      void client.status(workspaceId).then((result) => {
        if (!live) return
        setStatus(result.ok ? result.value : null)
      })
    }
    load()
    const timer = window.setInterval(load, 8000)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [client, workspaceId])

  const probe = status?.probe
  const dirty = (status?.staged.length ?? 0) + (status?.unstaged.length ?? 0) + (status?.untracked.length ?? 0)
  const cwd = workspacePath !== undefined && workspacePath !== '' ? shortPath(workspacePath) : t('status.noWorkspace')
  const cwdFull = workspacePath !== undefined ? redactSecrets(workspacePath) : t('status.noWorkspace')
  const version = plugin?.current ?? '—'
  const branch = probe === undefined
    ? t('status.noGit')
    : !probe.gitAvailable || !probe.isRepo
      ? t('status.notRepo')
      : probe.detached
        ? t('panel.detached')
        : (probe.branch ?? t('status.noGit'))
  const openTabs = tabs ?? []

  return (
    <footer
      className={css.bar}
      data-git-ide-panel="status"
      aria-label={t('status.label')}
    >
      <StatusTabs tabs={openTabs} activeId={active?.id} onActivate={onActivate} t={t} />
      <span className={css.grow} />
      <span className={`${css.item} ${css.itemLead}`}>
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
    </footer>
  )
}

function StatusTabs({
  tabs,
  activeId,
  onActivate,
  t,
}: {
  tabs: FileTab[]
  activeId?: string
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
            : tab.kind === 'diff'
              ? t('status.diff', { name: fileName(tab.path) })
              : fileName(tab.path)
          const title = tab.kind === 'file' || tab.kind === 'diff' ? redactSecrets(tab.path) : label
          return (
            <button
              key={tab.id}
              type="button"
              className={css.tab}
              data-tab={tab.id}
              data-active={tab.id === activeId || undefined}
              role="tab"
              title={title}
              onClick={() => { onActivate?.(tab.id) }}
            >
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
