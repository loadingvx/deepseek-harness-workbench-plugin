import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { GitClient } from '../api.ts'
import { fail } from '../../shared/errors.ts'
import { buildFilterTree, normalizeFileFilter, type FilterNode } from '../../shared/file-filter.ts'
import { isExternalEditorId, type ExternalEditorId, type ExternalEditorInfo, type FsDirEntry, type GitFail } from '../../shared/types.ts'
import { FileKindIcon } from './file-icons.tsx'
import { IconButton } from './IconButton.tsx'
import { IconChevron, IconClose, IconExternal, IconEye, IconRefresh, IconSearch } from './icons.tsx'
import type { Translate } from './types.ts'
import css from './FileTree.module.css'

const EDITOR_PREF_KEY = 'dsh-workbench-external-editor'

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

type Notice =
  | { kind: 'error'; fail: GitFail }
  | { kind: 'info'; text: string }

function isHiddenName(name: string): boolean {
  return name.startsWith('.')
}

function readPref(): ExternalEditorId | undefined {
  try {
    const raw = localStorage.getItem(EDITOR_PREF_KEY)
    if (raw !== null && isExternalEditorId(raw)) return raw
  } catch {
    // private mode / blocked storage
  }
  return undefined
}

function writePref(id: ExternalEditorId): void {
  try { localStorage.setItem(EDITOR_PREF_KEY, id) } catch { /* ignore */ }
}

function fileName(path: string): string {
  const parts = path.split('/').filter(part => part !== '')
  return parts[parts.length - 1] ?? path
}

function editorLabel(t: Translate, id: ExternalEditorId, fallback?: string): string {
  return t(`tree.editor.${id}`) || fallback || id
}

function pickPreferred(editors: ExternalEditorInfo[], pref?: ExternalEditorId): ExternalEditorId | undefined {
  const available = editors.filter(item => item.available)
  if (available.length === 0) return undefined
  if (pref !== undefined) {
    const remembered = available.find(item => item.id === pref)
    if (remembered !== undefined) return remembered.id
  }
  return available[0]?.id
}

/** Lazy workspace explorer. Hidden files stay off until the user asks. */
export function FileTree({ client, workspaceId, workspaceTitle, activePath, onOpenFile, t }: FileTreeProps) {
  const [showHidden, setShowHidden] = useState(false)
  const [openDirs, setOpenDirs] = useState<Record<string, boolean>>({ '': true })
  const [branches, setBranches] = useState<Record<string, Branch>>({})
  const [editors, setEditors] = useState<ExternalEditorInfo[]>([])
  const [editorsReady, setEditorsReady] = useState(false)
  const [pref, setPref] = useState<ExternalEditorId | undefined>(() => readPref())
  const [menuOpen, setMenuOpen] = useState(false)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterDraft, setFilterDraft] = useState('')
  const [filterQuery, setFilterQuery] = useState('')
  const [filterHits, setFilterHits] = useState<FsDirEntry[]>([])
  const [filterLoading, setFilterLoading] = useState(false)
  const [filterError, setFilterError] = useState<GitFail | null>(null)
  const [filterTruncated, setFilterTruncated] = useState(false)
  const [filterCollapsed, setFilterCollapsed] = useState<Record<string, boolean>>({})
  const filterInput = useRef<HTMLInputElement | null>(null)
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchGen = useRef(0)

  const chosen = pickPreferred(editors, pref)

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

  const loadEditors = useCallback(async (): Promise<ExternalEditorInfo[]> => {
    const result = await client.listEditors()
    if (!result.ok) {
      setEditorsReady(true)
      setNotice({ kind: 'error', fail: result })
      return []
    }
    setEditors(result.value.editors)
    setEditorsReady(true)
    return result.value.editors
  }, [client])

  const closeFilter = useCallback((): void => {
    setFilterOpen(false)
    setFilterDraft('')
    setFilterQuery('')
    setFilterHits([])
    setFilterError(null)
    setFilterTruncated(false)
    setFilterLoading(false)
    setFilterCollapsed({})
  }, [])

  useEffect(() => {
    setBranches({})
    setOpenDirs({ '': true })
    setNotice(null)
    closeFilter()
    if (workspaceId !== undefined) void load('')
  }, [workspaceId, load, closeFilter])

  useEffect(() => {
    if (!filterOpen) return
    const timer = window.setTimeout(() => {
      setFilterQuery(normalizeFileFilter(filterDraft))
    }, 180)
    return () => { window.clearTimeout(timer) }
  }, [filterDraft, filterOpen])

  useEffect(() => {
    if (!filterOpen) return
    filterInput.current?.focus()
  }, [filterOpen])

  useEffect(() => {
    if (!filterOpen || workspaceId === undefined) return
    if (filterQuery === '') {
      searchGen.current += 1
      setFilterHits([])
      setFilterError(null)
      setFilterTruncated(false)
      setFilterLoading(false)
      return
    }
    const gen = searchGen.current + 1
    searchGen.current = gen
    setFilterLoading(true)
    setFilterError(null)
    void client.searchFiles(workspaceId, filterQuery, showHidden || filterQuery.startsWith('.')).then(result => {
      if (searchGen.current !== gen) return
      setFilterLoading(false)
      if (!result.ok) {
        setFilterHits([])
        setFilterError(result)
        setFilterTruncated(false)
        return
      }
      setFilterHits(result.value.hits)
      setFilterTruncated(result.value.truncated)
    })
  }, [client, filterOpen, filterQuery, showHidden, workspaceId])

  useEffect(() => {
    void loadEditors()
  }, [loadEditors])

  useEffect(() => () => {
    if (clearTimer.current !== null) clearTimeout(clearTimer.current)
  }, [])

  const showInfo = (text: string): void => {
    setNotice({ kind: 'info', text })
    if (clearTimer.current !== null) clearTimeout(clearTimer.current)
    clearTimer.current = setTimeout(() => {
      setNotice(current => current?.kind === 'info' ? null : current)
    }, 3200)
  }

  const openExternal = async (path: string, app?: ExternalEditorId): Promise<void> => {
    if (workspaceId === undefined || busyPath !== null) return
    const listed = editors.length > 0 ? editors : await loadEditors()
    const nextApp = app ?? pickPreferred(listed, pref)
    if (nextApp === undefined) {
      setNotice({ kind: 'error', fail: fail('EDITOR_NOT_FOUND') })
      return
    }
    if (app !== undefined) {
      setPref(app)
      writePref(app)
    }
    setBusyPath(path)
    setNotice({ kind: 'info', text: t('tree.opening', { app: editorLabel(t, nextApp) }) })
    const result = await client.openExternal(workspaceId, path, nextApp)
    setBusyPath(null)
    if (!result.ok) {
      setNotice({ kind: 'error', fail: result })
      return
    }
    showInfo(t('tree.opened', { app: editorLabel(t, result.value.app) }))
  }

  const toggleDir = (path: string): void => {
    setOpenDirs(current => {
      const nextOpen = !current[path]
      if (nextOpen && branches[path] === undefined) void load(path)
      return { ...current, [path]: nextOpen }
    })
  }

  const toggleFilterDir = (path: string): void => {
    setFilterCollapsed(current => ({ ...current, [path]: !current[path] }))
  }

  const renderEntryRow = (
    entry: { name: string; path: string; kind: 'file' | 'directory' },
    depth: number,
    open: boolean,
  ): ReactNode => {
    const rowLabel = chosen === undefined
      ? t('tree.pickEditor')
      : t('tree.openExternalFile', { app: editorLabel(t, chosen), name: entry.name })
    return (
      <div
        className={css.rowWrap}
        data-active={activePath === entry.path || undefined}
      >
        <button
          type="button"
          className={css.row}
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => {
            if (entry.kind === 'directory') {
              if (filterQuery !== '') toggleFilterDir(entry.path)
              else toggleDir(entry.path)
              return
            }
            onOpenFile(entry.path)
          }}
        >
          <span className={css.chevron}>{entry.kind === 'directory' ? (open ? '▾' : '▸') : ''}</span>
          <FileKindIcon kind={entry.kind} name={entry.name} open={open} />
          <span className={css.name}>{entry.name}</span>
        </button>
        <button
          type="button"
          className={css.rowOpen}
          title={rowLabel}
          aria-label={rowLabel}
          disabled={busyPath !== null}
          onClick={(event) => {
            event.stopPropagation()
            void openExternal(entry.path)
          }}
        >
          <IconExternal />
        </button>
      </div>
    )
  }

  const headerTarget = activePath ?? ''
  const headerLabel = chosen === undefined
    ? t('tree.pickEditor')
    : headerTarget === ''
      ? t('tree.openWorkspace', { app: editorLabel(t, chosen) })
      : t('tree.openExternalFile', { app: editorLabel(t, chosen), name: fileName(headerTarget) })

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
              {renderEntryRow(entry, depth, open)}
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

  const renderFilterNodes = (nodes: FilterNode[], depth: number): ReactNode => (
    <>
      {nodes.map(node => {
        const open = node.kind === 'directory' && !filterCollapsed[node.path]
        return (
          <div key={node.path}>
            {renderEntryRow(node, depth, open)}
            {node.kind === 'directory' && open ? renderFilterNodes(node.children, depth + 1) : null}
          </div>
        )
      })}
    </>
  )

  const renderFilterBody = (): ReactNode => {
    if (filterQuery === '') {
      return <p className={css.hint}>{t('tree.filterPlaceholder')}</p>
    }
    if (filterLoading && filterHits.length === 0) {
      return <p className={css.hint}>{t('tree.filterLoading')}</p>
    }
    if (filterError !== null) {
      return (
        <div className={css.banner}>
          <div>{filterError.messageZh}</div>
          <div>{filterError.hintZh}</div>
        </div>
      )
    }
    if (filterHits.length === 0) {
      return (
        <div className={css.hint}>
          <div>{t('tree.filterEmpty')}</div>
          <div>{t('tree.filterEmptyHint')}</div>
        </div>
      )
    }
    return (
      <>
        <p className={css.filterMeta}>{t('tree.filterCount', { count: filterHits.length })}</p>
        {renderFilterNodes(buildFilterTree(filterHits), 0)}
        {filterTruncated ? (
          <p className={css.hint}>{t('tree.filterTruncated', { count: filterHits.length })}</p>
        ) : null}
      </>
    )
  }

  const submitFilter = (): void => {
    const files = filterHits.filter(item => item.kind === 'file')
    if (files.length === 1 && files[0] !== undefined) onOpenFile(files[0].path)
  }

  return (
    <nav className={css.root} aria-label={t('tree.title')}>
      <header className={css.head}>
        <div className={css.headRow}>
          <span className={css.title}>{workspaceTitle ?? t('tree.workspaceFallback')}</span>
          <IconButton
            label={headerLabel}
            disabled={workspaceId === undefined || busyPath !== null}
            onClick={() => { void openExternal(headerTarget) }}
          >
            <IconExternal />
          </IconButton>
          <div className={css.menuWrap}>
            <IconButton
              label={t('tree.pickEditor')}
              active={menuOpen}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={workspaceId === undefined}
              onClick={() => {
                const next = !menuOpen
                setMenuOpen(next)
                if (next) void loadEditors()
              }}
            >
              <IconChevron open={menuOpen} />
            </IconButton>
            {menuOpen ? (
              <>
                <div className={css.menuBackdrop} onClick={() => { setMenuOpen(false) }} />
                <div className={css.menu} role="menu" aria-label={t('tree.pickEditor')}>
                  {!editorsReady ? (
                    <p className={css.menuHint}>{t('tree.loading')}</p>
                  ) : null}
                  {editors.map(item => {
                    const label = editorLabel(t, item.id, item.label)
                    const mark = item.available ? t('tree.editorInstalled') : t('tree.editorMissing')
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitem"
                        className={css.menuItem}
                        data-active={chosen === item.id || undefined}
                        disabled={!item.available || busyPath !== null}
                        title={item.available ? t('tree.openExternal', { app: label }) : mark}
                        onClick={() => {
                          setMenuOpen(false)
                          void openExternal(headerTarget, item.id)
                        }}
                      >
                        <span className={css.menuName}>{label}</span>
                        <span className={css.menuMark}>{mark}</span>
                      </button>
                    )
                  })}
                  <div className={css.menuSep} />
                  <button
                    type="button"
                    role="menuitem"
                    className={css.menuItem}
                    disabled={chosen === undefined || busyPath !== null}
                    onClick={() => {
                      setMenuOpen(false)
                      void openExternal('')
                    }}
                  >
                    <span className={css.menuName}>{t('tree.openWorkspaceNow')}</span>
                  </button>
                  <p className={css.menuHint}>{t('tree.editorHint')}</p>
                </div>
              </>
            ) : null}
          </div>
          <IconButton
            label={t('tree.filter')}
            active={filterOpen || filterQuery !== ''}
            disabled={workspaceId === undefined}
            onClick={() => {
              if (filterOpen) {
                closeFilter()
                return
              }
              setFilterOpen(true)
            }}
          >
            <IconSearch />
          </IconButton>
          <IconButton
            label={t('tree.hidden')}
            active={showHidden}
            onClick={() => { setShowHidden(value => !value) }}
          >
            <IconEye />
          </IconButton>
        </div>
        {filterOpen ? (
          <div className={css.filterBar}>
            <input
              ref={filterInput}
              className={css.filterInput}
              value={filterDraft}
              placeholder={t('tree.filterPlaceholder')}
              aria-label={t('tree.filter')}
              disabled={workspaceId === undefined}
              onChange={event => { setFilterDraft(event.target.value) }}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  if (filterDraft !== '') {
                    setFilterDraft('')
                    setFilterQuery('')
                    return
                  }
                  closeFilter()
                  return
                }
                if (event.key === 'Enter') {
                  event.preventDefault()
                  submitFilter()
                }
              }}
            />
            {filterDraft !== '' ? (
              <IconButton
                label={t('tree.filterClear')}
                onClick={() => {
                  setFilterDraft('')
                  setFilterQuery('')
                  filterInput.current?.focus()
                }}
              >
                <IconClose />
              </IconButton>
            ) : null}
          </div>
        ) : null}
        {notice !== null ? (
          <div className={notice.kind === 'error' ? css.banner : css.status} role={notice.kind === 'error' ? 'alert' : 'status'}>
            {notice.kind === 'error' ? (
              <>
                <div>{notice.fail.messageZh}</div>
                <div className={css.bannerHint}>{notice.fail.hintZh}</div>
              </>
            ) : notice.text}
          </div>
        ) : null}
      </header>
      <div className={css.body}>
        {workspaceId === undefined
          ? <p className={css.hint}>{t('panel.noWorkspace')}</p>
          : filterQuery !== '' || (filterOpen && filterDraft.trim() !== '')
            ? renderFilterBody()
            : renderBranch('', 0)}
      </div>
    </nav>
  )
}
