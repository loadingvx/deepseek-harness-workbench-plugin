import { useLayoutEffect, useSyncExternalStore, type ReactNode } from 'react'
import type { GitClient } from '../api.ts'
import type { PluginUpdateSnapshot } from '../../shared/types.ts'
import type { SideTab } from './auto-open.ts'
import { FileTree } from './FileTree.tsx'
import { GitSidebar } from './GitSidebar.tsx'
import { IconButton } from './IconButton.tsx'
import { IconFiles, IconGit, IconPanelOff, IconSlash, IconUsage } from './icons.tsx'
import type { Translate } from './types.ts'
import { UpdateBanner } from './UpdateBanner.tsx'
import { UsagePanel } from './UsagePanel.tsx'
import { SlashPanel } from '../ultra-slash/SlashPanel.tsx'
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
  client, workspaceId, workspaceTitle, workspacePath, sessionId, running, useProjection, activePath, selected, tab, onTab, onOpenFile, onOpenDiff, onOpenCommitDiff, onRenamed, onDeleted, onCollapse, leadingSash, update, onDismissUpdate, t,
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
}) {
  const dock = useSyncExternalStore(subscribeUsageDock, readUsageDock, defaultUsageDock)
  const navReady = useSyncExternalStore(subscribeNavHost, isNavHostReady, () => false)
  const showUsageTab = usageTabVisible(dock, navReady)

  useLayoutEffect(() => {
    if (!showUsageTab && tab === 'usage') onTab('files')
  }, [showUsageTab, tab, onTab])

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
        {showUsageTab ? (
          <IconButton label={t('ide.usage')} active={tab === 'usage'} onClick={() => { onTab('usage') }}>
            <IconUsage />
          </IconButton>
        ) : null}
        <IconButton label={t('ide.slash')} active={tab === 'slash'} onClick={() => { onTab('slash') }}>
          <IconSlash />
        </IconButton>
        <span className={css.spacer} />
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
        ) : tab === 'usage' && showUsageTab ? (
          <UsagePanel
            client={client}
            sessionId={sessionId}
            running={running}
            useProjection={useProjection}
            t={t}
          />
        ) : tab === 'slash' ? (
          <SlashPanel />
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
