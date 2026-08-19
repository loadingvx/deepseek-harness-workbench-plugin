import { useState, type PointerEventHandler, type ReactNode } from 'react'
import type { GitClient } from '../api.ts'
import { termIdFromTabId } from '../../shared/new-file-path.ts'
import { RowSash } from './ColSash.tsx'
import { IconButton } from './IconButton.tsx'
import { IconClose, IconDevtools, IconEditor, IconFoldY, IconPlus, IconTerminal } from './icons.tsx'
import { TerminalView } from './TerminalView.tsx'
import { TERMINAL_TAB_ID, terminalTabLabel, type FileTab, type Translate } from './types.ts'
import type { TermCleanExitAction } from './term-session.ts'
import css from './TerminalPanel.module.css'

export function TerminalPanel({
  client,
  workspaceId,
  tabs,
  activeId,
  termSeed,
  aiTermIds,
  dragging,
  onActivate,
  onClose,
  onNewTerminal,
  onAiModeChange,
  onDockTab,
  expanded = true,
  onToggleExpand,
  onResizePointerDown,
  onResizeReset,
  onCleanExit,
  t,
  onAddTermToChat,
  devtools,
  devtoolsActive = false,
  onActivateDevtools,
}: {
  client: GitClient
  workspaceId?: string
  tabs: FileTab[]
  activeId: string | null
  termSeed?: string
  aiTermIds?: readonly string[]
  dragging?: boolean
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onNewTerminal?: () => void
  onAiModeChange?: (tabId: string, open: boolean) => void
  onDockTab?: () => void
  expanded?: boolean
  onToggleExpand: () => void
  onResizePointerDown: PointerEventHandler<HTMLButtonElement>
  onResizeReset: () => void
  onCleanExit?: (tabId: string) => TermCleanExitAction
  t: Translate
  /** 终端选中内容 / 输出 → 原生会话胶囊（带 pwd/shell 上下文）。 */
  onAddTermToChat?: (text: string, context?: string) => boolean
  devtools?: ReactNode
  devtoolsActive?: boolean
  onActivateDevtools?: () => void
}) {
  const active = tabs.find(tab => tab.id === activeId) ?? tabs[0] ?? null
  const [chromeHost, setChromeHost] = useState<HTMLDivElement | null>(null)
  const showDevtools = onActivateDevtools !== undefined
  const bodyIsDevtools = showDevtools && devtoolsActive && devtools !== undefined

  return (
    <section
      className={css.root}
      data-git-ide-panel="terminal"
      data-collapsed={expanded ? undefined : ''}
      aria-label={t('term.panel')}
    >
      {expanded ? (
        <RowSash
          label={t('term.resize')}
          active={dragging}
          onPointerDown={onResizePointerDown}
          onReset={onResizeReset}
        />
      ) : null}
      <div className={css.bar}>
        <div className={css.tabs} role="tablist" aria-label={t('term.panel')}>
          {tabs.map(tab => {
            const aiOn = aiTermIds?.includes(tab.id) === true
            return (
              <button
                key={tab.id}
                type="button"
                className={css.tab}
                role="tab"
                data-active={!devtoolsActive && tab.id === active?.id || undefined}
                data-ai={aiOn || undefined}
                aria-selected={!devtoolsActive && tab.id === active?.id}
                title={aiOn ? t('term.ai.modeOn') : terminalTabLabel(tab, t)}
                onClick={() => { onActivate(tab.id) }}
              >
                <span className={css.tabName}>{terminalTabLabel(tab, t)}</span>
                {tab.id === TERMINAL_TAB_ID
                  ? <IconTerminal />
                  : (
                    <IconButton
                      label={t('editor.close')}
                      onClick={(event) => { event.stopPropagation(); onClose(tab.id) }}
                    >
                      <IconClose />
                    </IconButton>
                  )}
              </button>
            )
          })}
          {showDevtools ? (
            <button
              type="button"
              className={css.tab}
              role="tab"
              data-active={devtoolsActive || undefined}
              aria-selected={devtoolsActive}
              title={t('ide.devtools')}
              onClick={() => { onActivateDevtools() }}
            >
              <span className={css.tabName}>{t('ide.devtools')}</span>
              <IconDevtools />
            </button>
          ) : null}
        </div>
        <div className={css.termChrome} ref={setChromeHost} hidden={bodyIsDevtools || undefined} />
        <div className={css.actions}>
          {onNewTerminal !== undefined ? (
            <IconButton label={t('editor.addTerminal')} onClick={onNewTerminal}>
              <IconPlus />
            </IconButton>
          ) : null}
          {onDockTab !== undefined ? (
            <IconButton label={t('term.dockToTab')} onClick={onDockTab}>
              <IconEditor />
            </IconButton>
          ) : null}
          <IconButton
            label={expanded ? t('term.collapsePanel') : t('term.expandPanel')}
            aria-expanded={expanded}
            onClick={onToggleExpand}
          >
            <IconFoldY expanded={expanded} />
          </IconButton>
        </div>
      </div>
      <div className={css.body} hidden={!expanded}>
        {bodyIsDevtools ? (
          <div className={css.devtools} data-git-ide-panel="devtools">{devtools}</div>
        ) : active !== null ? (
          <TerminalView
            client={client}
            workspaceId={workspaceId}
            termId={termIdFromTabId(active.id)}
            injectComment={termSeed}
            t={t}
            aiOpen={aiTermIds?.includes(active.id) === true}
            onAiModeChange={(open) => { onAiModeChange?.(active.id, open) }}
            chromeHost={chromeHost}
            onCleanExit={onCleanExit === undefined ? undefined : () => onCleanExit(active.id)}
            onAddTermToChat={onAddTermToChat}
          />
        ) : null}
      </div>
    </section>
  )
}
