import { useEffect, useLayoutEffect, useSyncExternalStore, type ReactNode } from 'react'
import type { GitClient } from '../api.ts'
import type { PluginUpdateSnapshot } from '../../shared/types.ts'
import type { SideTab } from './auto-open.ts'
import { FileTree } from './FileTree.tsx'
import { GitSidebar } from './GitSidebar.tsx'
import { IconButton } from './IconButton.tsx'
import type { DevtoolsDock } from './browser-dock.ts'
import type { NetRefSnapshot } from '../../shared/browser-net-ref.ts'
import { DevToolsPanel } from './DevToolsPanel.tsx'
import { IconDevtools, IconFiles, IconGit, IconPanelOff, IconReview, IconSettings, IconUsage } from './icons.tsx'
import type { Translate } from './types.ts'
import { ReviewPanel } from './ReviewPanel.tsx'
import {
  readReviewPendingCount,
  retainReviewLive,
  subscribeReviewLive,
} from './review-live.ts'
import { SettingsPanel } from './SettingsPanel.tsx'
import { UpdateBanner } from './UpdateBanner.tsx'
import { UsagePanel } from './UsagePanel.tsx'
import {
  defaultUsageDock,
  isNavHostReady,
  readUsageDock,
  subscribeNavHost,
  subscribeUsageDock,
  usageTabVisible,
} from './usage-dock.ts'
import css from './SideDock.module.css'

export type { SideTab }

export function SideDock({
  client, workspaceId, workspaceTitle, workspacePath, sessionId, running, useProjection, activePath, selected, tab, onTab, onOpenFile, onOpenDiff, onOpenCommitDiff, onRenamed, onDeleted, onCollapse, leadingSash, update, onDismissUpdate, t, devtoolsDock = 'side', onDevtoolsDock, showDevtoolsTab = false, onAddNetToChat, onAddTextToChat,
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
  onOpenDiff: (path: string, staged: boolean, repo?: string) => void
  onOpenCommitDiff: (hash: string, path: string, repo?: string) => void
  onRenamed: (from: string, to: string) => void
  onDeleted: (path: string) => void
  onCollapse: () => void
  leadingSash?: ReactNode
  update?: PluginUpdateSnapshot | null
  onDismissUpdate?: () => void
  t: Translate
  devtoolsDock?: DevtoolsDock
  onDevtoolsDock?: (dock: DevtoolsDock) => void
  /** After the user opens DevTools from the browser toolbar, allow the sidebar tab. */
  showDevtoolsTab?: boolean
  /** DevTools 网络请求 → 会话胶囊 / 文本。 */
  onAddNetToChat?: (snapshot: NetRefSnapshot) => boolean
  onAddTextToChat?: (text: string) => boolean
}) {
  const dock = useSyncExternalStore(subscribeUsageDock, readUsageDock, defaultUsageDock)
  const navReady = useSyncExternalStore(subscribeNavHost, isNavHostReady, () => false)
  const showUsageTab = usageTabVisible(dock, navReady)
  const pendingCount = useSyncExternalStore(subscribeReviewLive, readReviewPendingCount, () => 0)
  const showReviewTab = pendingCount > 0

  useEffect(() => retainReviewLive(client, workspaceId), [client, workspaceId])

  useLayoutEffect(() => {
    if (!showUsageTab && tab === 'usage') onTab('files')
  }, [showUsageTab, tab, onTab])

  useLayoutEffect(() => {
    if (!showDevtoolsTab && tab === 'devtools') onTab('files')
  }, [showDevtoolsTab, tab, onTab])

  useLayoutEffect(() => {
    if (!showReviewTab && tab === 'review') onTab('files')
  }, [showReviewTab, tab, onTab])

  return (
    <aside className={css.root} data-git-ide-panel="side">
      {leadingSash}
      <UpdateBanner info={update ?? null} onDismiss={onDismissUpdate ?? (() => {})} t={t} />
      <div className={css.tabs} role="tablist">
        <IconButton label={t('ide.files')} active={tab === 'files'} onClick={() => { onTab('files') }}>
          <IconFiles />
        </IconButton>
        <IconButton label={t('ide.git')} active={tab === 'git'} onClick={() => { onTab('git') }}>
          <IconGit />
        </IconButton>
        {showReviewTab ? (
          <span className={css.tabWrap}>
            <IconButton label={t('ide.review')} active={tab === 'review'} onClick={() => { onTab('review') }}>
              <IconReview />
            </IconButton>
            <span className={css.tabBadge} aria-hidden>{pendingCount > 99 ? '99+' : pendingCount}</span>
          </span>
        ) : null}
        {showUsageTab ? (
          <IconButton label={t('ide.usage')} active={tab === 'usage'} onClick={() => { onTab('usage') }}>
            <IconUsage />
          </IconButton>
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
        {tab === 'git' ? (
          <GitSidebar
            client={client}
            workspaceId={workspaceId}
            selected={selected}
            onOpenDiff={onOpenDiff}
            onOpenCommitDiff={onOpenCommitDiff}
            t={t}
          />
        ) : tab === 'review' && showReviewTab ? (
          <ReviewPanel
            client={client}
            workspaceId={workspaceId}
            onOpenFile={onOpenFile}
            t={t}
          />
        ) : tab === 'usage' && showUsageTab ? (
          <UsagePanel
            client={client}
            sessionId={sessionId}
            running={running}
            useProjection={useProjection}
            t={t}
          />
        ) : tab === 'settings' ? (
          <SettingsPanel t={t} />
        ) : tab === 'devtools' ? (
          <DevToolsPanel
            dock={devtoolsDock}
            onDock={(next) => { onDevtoolsDock?.(next) }}
            t={t}
            onAddNetToChat={onAddNetToChat}
            onAddTextToChat={onAddTextToChat}
          />
        ) : (
          <FileTree
            client={client}
            workspaceId={workspaceId}
            workspaceTitle={workspaceTitle}
            workspacePath={workspacePath}
            activePath={activePath}
            onOpenFile={onOpenFile}
            onRenamed={onRenamed}
            onDeleted={onDeleted}
            t={t}
          />
        )}
      </div>
    </aside>
  )
}
