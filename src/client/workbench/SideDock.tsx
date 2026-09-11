import { useEffect, useLayoutEffect, useSyncExternalStore, type ReactNode } from 'react'
import type { GitClient } from '../api.ts'
import type { PluginUpdateSnapshot } from '../../shared/types.ts'
import type { SideTab } from './auto-open.ts'
import { IconButton } from './IconButton.tsx'
import type { DevtoolsDock } from './browser-dock.ts'
import type { NetRefSnapshot } from '../../shared/browser-net-ref.ts'
import { DevToolsPanel } from './DevToolsPanel.tsx'
import { IconDevtools, IconPanelOff, IconReview, IconSettings } from './icons.tsx'
import type { Translate } from './types.ts'
import { ReviewPanel } from './ReviewPanel.tsx'
import {
  readReviewPendingCount,
  retainReviewLive,
  subscribeReviewLive,
} from './review-live.ts'
import { getReviewOn, subscribeReviewOn } from './review-settings.ts'
import { SettingsPanel } from './SettingsPanel.tsx'
import { UpdateBanner } from './UpdateBanner.tsx'
import css from './SideDock.module.css'

export type { SideTab }

/**
 * Legacy thin dock for settings / review / optional DevTools.
 * Files, Git, and usage live in the official ui-sidebar-right (or StatusBar popover).
 */
export function SideDock({
  client, workspaceId, sessionId, running, useProjection, tab, onTab, onOpenFile, onOpenReviewFile, onCollapse, leadingSash, update, onDismissUpdate, t, devtoolsDock = 'side', onDevtoolsDock, showDevtoolsTab = false, onAddNetToChat, onAddTextToChat,
}: {
  client: GitClient
  workspaceId?: string
  workspaceTitle?: string
  workspacePath?: string
  sessionId?: string
  running?: boolean
  useProjection?: (key: string, selector?: (value: unknown) => unknown) => unknown
  activePath?: string
  selected?: { path: string; staged: boolean } | null
  tab: SideTab
  onTab: (tab: SideTab) => void
  onOpenFile: (path: string) => void
  onOpenReviewFile?: (path: string) => void
  onOpenDiff?: (path: string, staged: boolean, repo?: string) => void
  onOpenCommitDiff?: (hash: string, path: string, repo?: string) => void
  onRenamed?: (from: string, to: string) => void
  onDeleted?: (path: string) => void
  onCollapse: () => void
  leadingSash?: ReactNode
  update?: PluginUpdateSnapshot | null
  onDismissUpdate?: () => void
  t: Translate
  devtoolsDock?: DevtoolsDock
  onDevtoolsDock?: (dock: DevtoolsDock) => void
  showDevtoolsTab?: boolean
  onAddNetToChat?: (snapshot: NetRefSnapshot) => boolean
  onAddTextToChat?: (text: string) => boolean
}) {
  void sessionId
  void running
  void useProjection

  const pendingCount = useSyncExternalStore(subscribeReviewLive, readReviewPendingCount, () => 0)
  const reviewOn = useSyncExternalStore(subscribeReviewOn, getReviewOn, getReviewOn)
  const showReviewTab = reviewOn && pendingCount > 0

  useEffect(() => retainReviewLive(client, workspaceId), [client, workspaceId])

  useLayoutEffect(() => {
    if (!showDevtoolsTab && tab === 'devtools') onTab('settings')
  }, [showDevtoolsTab, tab, onTab])

  useLayoutEffect(() => {
    if (!showReviewTab && tab === 'review') onTab('settings')
  }, [showReviewTab, tab, onTab])

  return (
    <aside className={css.root} data-git-ide-panel="side">
      {leadingSash}
      <UpdateBanner info={update ?? null} onDismiss={onDismissUpdate ?? (() => {})} t={t} />
      <div className={css.tabs} role="tablist">
        {showReviewTab ? (
          <span className={css.tabWrap}>
            <IconButton label={t('ide.review')} active={tab === 'review'} onClick={() => { onTab('review') }}>
              <IconReview />
            </IconButton>
            <span className={css.tabBadge} aria-hidden>{pendingCount > 99 ? '99+' : pendingCount}</span>
          </span>
        ) : null}
        {showDevtoolsTab ? (
          <IconButton label={t('ide.devtools')} active={tab === 'devtools'} onClick={() => { onTab('devtools') }}>
            <IconDevtools />
          </IconButton>
        ) : null}
        <span className={css.spacer} />
        <IconButton label={t('ide.settings')} active={tab === 'settings'} onClick={() => { onTab('settings') }}>
          <IconSettings />
        </IconButton>
        <IconButton label={t('ide.hideSide')} onClick={onCollapse}>
          <IconPanelOff />
        </IconButton>
      </div>
      <div className={css.body}>
        {tab === 'review' && showReviewTab ? (
          <ReviewPanel
            client={client}
            workspaceId={workspaceId}
            onOpenFile={onOpenReviewFile ?? onOpenFile}
            t={t}
          />
        ) : tab === 'devtools' ? (
          <DevToolsPanel
            dock={devtoolsDock}
            onDock={(next) => { onDevtoolsDock?.(next) }}
            t={t}
            onAddNetToChat={onAddNetToChat}
            onAddTextToChat={onAddTextToChat}
          />
        ) : (
          <SettingsPanel t={t} />
        )}
      </div>
    </aside>
  )
}
