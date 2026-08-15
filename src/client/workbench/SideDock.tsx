import type { ReactNode } from 'react'
import type { GitClient } from '../api.ts'
import { FileTree } from './FileTree.tsx'
import { GitSidebar } from './GitSidebar.tsx'
import { IconButton } from './IconButton.tsx'
import { IconFiles, IconGit, IconPanelOff } from './icons.tsx'
import type { Translate } from './types.ts'
import css from './SideDock.module.css'

export type SideTab = 'files' | 'git'

export function SideDock({
  client, workspaceId, workspaceTitle, activePath, selected, tab, onTab, onOpenFile, onOpenDiff, onCollapse, leadingSash, t,
}: {
  client: GitClient
  workspaceId?: string
  workspaceTitle?: string
  activePath?: string
  selected?: { path: string; staged: boolean } | null
  tab: SideTab
  onTab: (tab: SideTab) => void
  onOpenFile: (path: string) => void
  onOpenDiff: (path: string, staged: boolean) => void
  onCollapse: () => void
  leadingSash?: ReactNode
  t: Translate
}) {
  return (
    <aside className={css.root} data-git-ide-panel="side">
      {leadingSash}
      <div className={css.tabs} role="tablist">
        <IconButton label={t('ide.files')} active={tab === 'files'} onClick={() => { onTab('files') }}>
          <IconFiles />
        </IconButton>
        <IconButton label={t('ide.git')} active={tab === 'git'} onClick={() => { onTab('git') }}>
          <IconGit />
        </IconButton>
        <span className={css.spacer} />
        <IconButton label={t('ide.hideSide')} onClick={onCollapse}>
          <IconPanelOff />
        </IconButton>
      </div>
      <div className={css.body}>
        {tab === 'files' ? (
          <FileTree
            client={client}
            workspaceId={workspaceId}
            workspaceTitle={workspaceTitle}
            activePath={activePath}
            onOpenFile={onOpenFile}
            t={t}
          />
        ) : (
          <GitSidebar
            client={client}
            workspaceId={workspaceId}
            selected={selected}
            onOpenDiff={onOpenDiff}
            t={t}
          />
        )}
      </div>
    </aside>
  )
}
