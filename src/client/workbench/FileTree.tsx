import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { GitClient } from '../api.ts'
import type { FsDirEntry, GitFail } from '../../shared/types.ts'
import { IconButton } from './IconButton.tsx'
import { IconEye, IconRefresh } from './icons.tsx'
import type { Translate } from './types.ts'
import css from './FileTree.module.css'

export interface FileTreeProps {
  client: GitClient
  workspaceId?: string
  workspaceTitle?: string
  activePath?: string
  onOpenFile: (path: string) => void
  t: Translate
}

interface Branch {
  entries: FsDirEntry[]
  truncated: boolean
  loading: boolean
  error: GitFail | null
}

function isHiddenName(name: string): boolean {
  return name.startsWith('.')
}

/** Lazy workspace explorer. Hidden files stay off until the user asks. */
export function FileTree({ client, workspaceId, workspaceTitle, activePath, onOpenFile, t }: FileTreeProps) {
  const [showHidden, setShowHidden] = useState(false)
  const [openDirs, setOpenDirs] = useState<Record<string, boolean>>({ '': true })
  const [branches, setBranches] = useState<Record<string, Branch>>({})

  const load = useCallback(async (dir: string): Promise<void> => {
    if (workspaceId === undefined) return
    setBranches(current => ({
      ...current,
      [dir]: { entries: current[dir]?.entries ?? [], truncated: false, loading: true, error: null },
    }))
    const result = await client.listDir(workspaceId, dir)
    setBranches(current => ({
      ...current,
      [dir]: result.ok
        ? { entries: result.value.entries, truncated: result.value.truncated, loading: false, error: null }
        : { entries: [], truncated: false, loading: false, error: result },
    }))
  }, [client, workspaceId])

  useEffect(() => {
    setBranches({})
    setOpenDirs({ '': true })
    if (workspaceId !== undefined) void load('')
  }, [workspaceId, load])

  const toggleDir = (path: string): void => {
    setOpenDirs(current => {
      const nextOpen = !current[path]
      if (nextOpen && branches[path] === undefined) void load(path)
      return { ...current, [path]: nextOpen }
    })
  }

  const renderBranch = (dir: string, depth: number): ReactNode => {
    const branch = branches[dir]
    if (branch === undefined) return null
    if (branch.loading && branch.entries.length === 0) {
      return <p className={css.hint} style={{ paddingLeft: 10 + depth * 12 }}>{t('tree.loading')}</p>
    }
    if (branch.error !== null) {
      return (
        <div className={css.banner} style={{ marginLeft: 8 + depth * 8 }}>
          <div>{branch.error.messageZh}</div>
          <div>{branch.error.hintZh}</div>
          <IconButton label={t('panel.retry')} onClick={() => { void load(dir) }}><IconRefresh /></IconButton>
        </div>
      )
    }
    const entries = branch.entries.filter(entry => showHidden || !isHiddenName(entry.name))
    if (entries.length === 0) {
      return <p className={css.hint} style={{ paddingLeft: 10 + depth * 12 }}>{t('tree.empty')}</p>
    }
    return (
      <>
        {entries.map(entry => {
          const open = Boolean(openDirs[entry.path])
          return (
            <div key={entry.path}>
              <button
                type="button"
                className={css.row}
                data-active={activePath === entry.path || undefined}
                style={{ paddingLeft: 8 + depth * 12 }}
                onClick={() => {
                  if (entry.kind === 'directory') toggleDir(entry.path)
                  else onOpenFile(entry.path)
                }}
              >
                <span className={css.chevron}>{entry.kind === 'directory' ? (open ? '▾' : '▸') : '·'}</span>
                <span className={css.name}>{entry.name}</span>
              </button>
              {entry.kind === 'directory' && open ? renderBranch(entry.path, depth + 1) : null}
            </div>
          )
        })}
        {branch.truncated ? (
          <p className={css.hint} style={{ paddingLeft: 10 + depth * 12 }}>
            {t('tree.truncated', { count: branch.entries.length })}
          </p>
        ) : null}
      </>
    )
  }

  return (
    <nav className={css.root} aria-label={t('tree.title')}>
      <header className={css.head}>
        <div className={css.headRow}>
          <span className={css.title}>{workspaceTitle ?? t('tree.workspaceFallback')}</span>
          <IconButton
            label={t('tree.hidden')}
            active={showHidden}
            onClick={() => { setShowHidden(value => !value) }}
          >
            <IconEye />
          </IconButton>
        </div>
      </header>
      <div className={css.body}>
        {workspaceId === undefined ? <p className={css.hint}>{t('panel.noWorkspace')}</p> : renderBranch('', 0)}
      </div>
    </nav>
  )
}
