import { useEffect, useState } from 'react'
import type { GitClient } from '../api.ts'
import type { FsDirEntry, GitFail } from '../../shared/types.ts'
import { FileKindIcon } from './file-icons.tsx'
import { browserTabLabel, terminalTabLabel, type FileTab, type Translate } from './types.ts'
import { breadcrumbParts } from './breadcrumb-path.ts'
import css from './PathBreadcrumb.module.css'

function parentPath(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

export function PathBreadcrumb({
  client, workspaceId, workspaceTitle, active, onOpenFile, t,
}: {
  client: GitClient
  workspaceId?: string
  workspaceTitle?: string
  active: FileTab | null
  onOpenFile: (path: string) => void
  t: Translate
}) {
  const [openPath, setOpenPath] = useState<string | null>(null)
  const [entries, setEntries] = useState<FsDirEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<GitFail | null>(null)

  const rootLabel = workspaceTitle?.trim() || t('editor.breadcrumbWorkspace')
  const parts = active?.kind === 'file' || active?.kind === 'preview'
    || active?.kind === 'diff' || active?.kind === 'commitDiff'
    ? breadcrumbParts(active.path)
    : []

  useEffect(() => {
    setOpenPath(null)
  }, [active?.id, workspaceId])

  useEffect(() => {
    if (openPath === null || workspaceId === undefined) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void client.listDir(workspaceId, openPath).then(result => {
      if (cancelled) return
      setLoading(false)
      if (!result.ok) {
        setEntries([])
        setError(result)
        return
      }
      setEntries(result.value.entries.filter(item => !item.hidden))
    })
    return () => { cancelled = true }
  }, [client, openPath, workspaceId])

  const toggleFolder = (path: string): void => {
    setOpenPath(current => current === path ? null : path)
  }

  return (
    <nav className={css.root} aria-label={t('editor.breadcrumb')}>
      <ol className={css.list}>
        <li className={css.item}>
          <button
            type="button"
            className={css.crumb}
            data-current={parts.length === 0 && active?.kind !== 'terminal' && active?.kind !== 'browser' ? true : undefined}
            data-active={openPath === '' || undefined}
            title={t('editor.breadcrumbFolder', { name: rootLabel })}
            disabled={workspaceId === undefined}
            onClick={() => { toggleFolder('') }}
          >
            {rootLabel}
          </button>
        </li>
        {active?.kind === 'terminal' ? (
          <li className={css.item}>
            <span className={css.sep} aria-hidden>/</span>
            <span className={css.crumb} data-current>{terminalTabLabel(active, t)}</span>
          </li>
        ) : null}
        {active?.kind === 'browser' ? (
          <li className={css.item}>
            <span className={css.sep} aria-hidden>/</span>
            <span className={css.crumb} data-current>{browserTabLabel(active, t)}</span>
          </li>
        ) : null}
        {parts.map((part, index) => {
          const last = index === parts.length - 1
          const folder = !last || active?.kind === 'diff' || active?.kind === 'commitDiff'
          return (
            <li key={part.path} className={css.item}>
              <span className={css.sep} aria-hidden>/</span>
              {folder ? (
                <button
                  type="button"
                  className={css.crumb}
                  data-active={openPath === part.path || undefined}
                  title={t('editor.breadcrumbFolder', { name: part.name })}
                  onClick={() => { toggleFolder(part.path) }}
                >
                  {part.name}
                </button>
              ) : (
                <span className={css.crumb} data-current title={active?.path}>{part.name}</span>
              )}
              {last && (active?.kind === 'diff' || active?.kind === 'commitDiff') ? (
                <>
                  <span className={css.sep} aria-hidden>/</span>
                  <span className={css.crumb} data-current>
                    {active?.kind === 'commitDiff' ? t('editor.commitDiffTab') : t('editor.diffTab')}
                  </span>
                </>
              ) : null}
            </li>
          )
        })}
      </ol>
      {openPath !== null ? (
        <>
          <div className={css.backdrop} onClick={() => { setOpenPath(null) }} />
          <div className={css.menu} role="menu" aria-label={t('editor.breadcrumbFolder', { name: openPath || rootLabel })}>
            {openPath !== '' ? (
              <button
                type="button"
                className={css.choice}
                onClick={() => { setOpenPath(parentPath(openPath)) }}
              >
                <span className={css.up}>‹</span>
                <span>{t('editor.breadcrumbUp')}</span>
              </button>
            ) : null}
            {loading ? <p className={css.hint}>{t('tree.loading')}</p> : null}
            {error !== null ? (
              <div className={css.fail}>
                <div>{error.messageZh}</div>
                <div>{error.hintZh}</div>
              </div>
            ) : null}
            {!loading && error === null && entries.length === 0 ? (
              <p className={css.hint}>{t('tree.empty')}</p>
            ) : null}
            {entries.map(entry => (
              <button
                key={entry.path}
                type="button"
                role="menuitem"
                className={css.choice}
                data-ignored={entry.ignored === true || undefined}
                title={entry.ignored === true
                  ? t('tree.ignored')
                  : entry.kind === 'directory'
                    ? t('editor.breadcrumbFolder', { name: entry.name })
                    : t('editor.breadcrumbOpen', { name: entry.name })}
                onClick={() => {
                  if (entry.kind === 'directory') {
                    setOpenPath(entry.path)
                    return
                  }
                  setOpenPath(null)
                  onOpenFile(entry.path)
                }}
              >
                <FileKindIcon kind={entry.kind} name={entry.name} />
                <span className={css.choiceName}>{entry.name}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </nav>
  )
}