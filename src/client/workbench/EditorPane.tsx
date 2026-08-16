import { useEffect, useState, type ReactNode } from 'react'
import type { GitClient } from '../api.ts'
import type { GitFail } from '../../shared/types.ts'
import { IconButton } from './IconButton.tsx'
import { joinWorkspaceFile, suggestNewFileDir, termIdFromTabId } from '../../shared/new-file-path.ts'
import { IconClose, IconDiff, IconEditor, IconEye, IconMore, IconPanelOff, IconPlus, IconSave, IconSplit, IconTerminal } from './icons.tsx'
import { PathBreadcrumb } from './PathBreadcrumb.tsx'
import { TerminalView } from './TerminalView.tsx'
import { TERMINAL_TAB_ID, terminalTabLabel, type FileBuffer, type FileTab, type Translate } from './types.ts'
import { CodeEditor } from './CodeEditor.tsx'
import { isMarkdownPath } from './code-language.ts'
import { FilePreview } from './FilePreview.tsx'
import { MarkdownPreview } from './MarkdownPreview.tsx'
import css from './EditorPane.module.css'

export interface EditorPaneProps {
  client: GitClient
  workspaceId?: string
  tabs: FileTab[]
  activeId: string | null
  buffers: Record<string, FileBuffer>
  onOpenFile: (path: string) => void
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onCloseMany: (ids: string[]) => void
  onDraft: (path: string, draft: string) => void
  onSaved: (path: string, content: string) => void
  onCollapse?: () => void
  notice?: GitFail | null
  termSeed?: string
  workspaceTitle?: string
  leadingSash?: ReactNode
  onNewTerminal?: () => void
  onCreateFile?: (path: string) => Promise<GitFail | null>
  aiTermIds?: readonly string[]
  onAiModeChange?: (tabId: string, open: boolean) => void
  t: Translate
}

function fileName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

function parseDiff(text: string): Array<{ kind: 'add' | 'del' | 'hunk' | 'meta' | 'ctx'; text: string }> {
  if (text.trim() === '') return []
  return text.split(/\r?\n/).map((line) => {
    if (
      line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ')
      || line.startsWith('index ') || line.startsWith('new file ') || line.startsWith('deleted file ')
      || line.startsWith('old mode ') || line.startsWith('new mode ')
      || line.startsWith('rename from ') || line.startsWith('rename to ')
      || line.startsWith('copy from ') || line.startsWith('copy to ')
      || line.startsWith('similarity index') || line.startsWith('Binary files ')
    ) {
      return { kind: 'meta' as const, text: line }
    }
    if (line.startsWith('@@')) return { kind: 'hunk' as const, text: line }
    if (line.startsWith('+')) return { kind: 'add' as const, text: line }
    if (line.startsWith('-')) return { kind: 'del' as const, text: line }
    return { kind: 'ctx' as const, text: line }
  })
}

function isBinaryDiff(text: string): boolean {
  return /^Binary files /m.test(text)
}

function isNewEmptyDiff(
  text: string,
  rows: Array<{ kind: 'add' | 'del' | 'hunk' | 'meta' | 'ctx' }>,
): boolean {
  if (rows.some(row => row.kind === 'add' || row.kind === 'del')) return false
  return /^new file /m.test(text) || /^--- \/dev\/null$/m.test(text)
}

type MdViewMode = 'edit' | 'preview' | 'split'

/** Center editor: explorer + tabs + text/diff, with unsaved-close confirmation. */
export function EditorPane({
  client, workspaceId, tabs, activeId, buffers,
  onOpenFile, onActivate, onClose, onCloseMany, onDraft, onSaved, onCollapse, notice, termSeed, workspaceTitle, leadingSash, onNewTerminal, onCreateFile, aiTermIds, onAiModeChange, t,
}: EditorPaneProps) {
  const active = tabs.find(tab => tab.id === activeId) ?? null
  const buffer = active?.kind === 'file' ? buffers[active.path] : undefined
  const dirty = buffer !== undefined && buffer.draft !== buffer.original
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<GitFail | null>(null)
  const [pendingClose, setPendingClose] = useState<{ ids: string[]; names: string[] } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [newFileOpen, setNewFileOpen] = useState(false)
  const [newFileDir, setNewFileDir] = useState('')
  const [newFileName, setNewFileName] = useState('未命名.txt')
  const [newFileBusy, setNewFileBusy] = useState(false)
  const [newFileError, setNewFileError] = useState<string | null>(null)
  const [diffText, setDiffText] = useState('')
  const [diffLoading, setDiffLoading] = useState(false)
  const [mdView, setMdView] = useState<Record<string, MdViewMode>>({})

  useEffect(() => {
    if ((active?.kind !== 'diff' && active?.kind !== 'commitDiff') || workspaceId === undefined) {
      setDiffText('')
      setDiffLoading(false)
      return
    }
    let cancelled = false
    setDiffLoading(true)
    const load = active.kind === 'commitDiff'
      ? client.commitDiff(workspaceId, active.hash ?? '', active.path)
      : client.diff(workspaceId, active.path, active.staged === true)
    void load.then((result) => {
      if (cancelled) return
      setDiffLoading(false)
      if (result.ok) {
        setError(null)
        setDiffText(result.value.text)
      } else {
        setError(result)
        setDiffText('')
      }
    })
    return () => { cancelled = true }
  }, [active, client, workspaceId])

  const requestClose = (id: string): void => {
    const tab = tabs.find(item => item.id === id)
    if (tab?.kind === 'file') {
      const current = buffers[tab.path]
      if (current !== undefined && current.draft !== current.original) {
        setPendingClose({ ids: [id], names: [fileName(tab.path)] })
        return
      }
    }
    onClose(id)
  }

  const requestCloseMany = (ids: string[]): void => {
    if (ids.length === 0) return
    const names: string[] = []
    for (const id of ids) {
      const tab = tabs.find(item => item.id === id)
      if (tab?.kind !== 'file') continue
      const current = buffers[tab.path]
      if (current !== undefined && current.draft !== current.original) names.push(fileName(tab.path))
    }
    if (names.length > 0) {
      setPendingClose({ ids, names })
      return
    }
    onCloseMany(ids)
  }

  const save = async (): Promise<void> => {
    if (workspaceId === undefined || active?.kind !== 'file' || buffer === undefined || !dirty || saving) return
    setSaving(true)
    const result = await client.writeFile(workspaceId, active.path, buffer.draft)
    setSaving(false)
    if (!result.ok) {
      setError(result)
      return
    }
    setError(null)
    onSaved(active.path, buffer.draft)
  }

  const markdownOpen = active?.kind === 'file' && buffer !== undefined && isMarkdownPath(active.path)
  const mdMode: MdViewMode = markdownOpen && active !== null ? (mdView[active.path] ?? 'edit') : 'edit'

  useEffect(() => {
    if (mdMode !== 'preview') return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 's' || !(event.ctrlKey || event.metaKey) || event.altKey) return
      event.preventDefault()
      void save()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [mdMode, active, buffer, dirty, saving, workspaceId])

  const submitNewFile = async (): Promise<void> => {
    if (onCreateFile === undefined) return
    const path = joinWorkspaceFile(newFileDir, newFileName)
    if (path === null) {
      setNewFileError(t('editor.addFileInvalid'))
      return
    }
    setNewFileBusy(true)
    const fail = await onCreateFile(path)
    setNewFileBusy(false)
    if (fail !== null) {
      setNewFileError(fail.messageZh)
      return
    }
    setNewFileOpen(false)
  }

  const activeIndex = activeId === null ? -1 : tabs.findIndex(tab => tab.id === activeId)
  const closableIds = tabs.filter(tab => tab.kind !== 'terminal').map(tab => tab.id)
  const closeAllIds = closableIds
  const closeOthersIds = activeIndex >= 0
    ? closableIds.filter(id => id !== activeId)
    : closableIds
  const closeLeftIds = activeIndex > 0
    ? tabs.slice(0, activeIndex).filter(tab => tab.kind !== 'terminal').map(tab => tab.id)
    : []
  const closeRightIds = activeIndex >= 0 && activeIndex < tabs.length - 1
    ? tabs.slice(activeIndex + 1).filter(tab => tab.kind !== 'terminal').map(tab => tab.id)
    : []

  useEffect(() => {
    if (!menuOpen && !addOpen && !newFileOpen) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      setAddOpen(false)
      if (!newFileBusy) setNewFileOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [addOpen, menuOpen, newFileBusy, newFileOpen])

  let body: ReactNode
  if (active?.kind === 'terminal') {
    body = (
      <TerminalView
        client={client}
        workspaceId={workspaceId}
        termId={termIdFromTabId(active.id)}
        injectComment={termSeed}
        t={t}
        aiOpen={aiTermIds?.includes(active.id) === true}
        onAiModeChange={(open) => { onAiModeChange?.(active.id, open) }}
      />
    )
  } else if (active === null) {
    body = (
      <div className={css.empty}>
        <p className={css.emptyTitle}>{t('editor.empty')}</p>
        <p className={css.emptyHint}>{t('editor.emptyHint')}</p>
      </div>
    )
  } else if (active.kind === 'diff' || active.kind === 'commitDiff') {
    const rows = parseDiff(diffText)
    const binary = !diffLoading && isBinaryDiff(diffText)
    const newEmpty = !diffLoading && isNewEmptyDiff(diffText, rows)
    const empty = !diffLoading && rows.length === 0 && !binary && !newEmpty
    const hint = diffLoading
      ? t('panel.loading')
      : binary
        ? t('diff.binary')
        : newEmpty
          ? t('diff.newEmpty')
          : empty
            ? t('diff.empty')
            : null
    body = (
      <div className={css.diffPane}>
        {hint !== null ? <p className={css.diffHint}>{hint}</p> : null}
        {rows.length > 0 && !binary && !newEmpty ? (
          <pre className={css.diff}>
            {rows.map((row, index) => (
              <div key={`${index}:${row.text.slice(0, 24)}`} className={css.diffLine} data-kind={row.kind}>
                {row.text === '' ? ' ' : row.text}
              </div>
            ))}
          </pre>
        ) : null}
      </div>
    )
  } else if (active.kind === 'preview') {
    body = (
      <FilePreview
        client={client}
        workspaceId={workspaceId}
        path={active.path}
        kind={active.preview ?? 'image'}
        t={t}
      />
    )
  } else if (buffer === undefined) {
    body = <p className={css.hint}>{t('panel.loading')}</p>
  } else {
    const editor = (
      <CodeEditor
        path={active.path}
        value={buffer.draft}
        label={fileName(active.path)}
        onChange={(next) => { onDraft(active.path, next) }}
        onSave={() => { void save() }}
      />
    )
    if (!markdownOpen) {
      body = editor
    } else {
      body = (
        <div className={css.mdShell} data-mode={mdMode}>
          {mdMode !== 'preview' ? <div className={css.mdEdit}>{editor}</div> : null}
          {mdMode !== 'edit' ? (
            <MarkdownPreview
              path={active.path}
              markdown={buffer.draft}
              onOpenFile={onOpenFile}
              t={t}
              workspaceId={workspaceId}
            />
          ) : null}
        </div>
      )
    }
  }

  const saveReason = workspaceId === undefined
    ? t('panel.noWorkspace')
    : saving
      ? t('editor.saveDisabledBusy')
      : !dirty
        ? t('editor.saveDisabledClean')
        : null

  const menuItem = (
    ids: string[],
    label: string,
    disabledReason: string,
  ) => (
    <button
      type="button"
      className={css.menuItem}
      role="menuitem"
      disabled={ids.length === 0}
      title={ids.length === 0 ? disabledReason : undefined}
      onClick={() => { setMenuOpen(false); requestCloseMany(ids) }}
    >
      {label}
    </button>
  )

  return (
    <section className={css.root} aria-label={active?.kind === 'terminal' ? t('term.title') : t('editor.empty')} data-git-ide-panel="editor">
      {leadingSash}
      <div className={css.main}>
        <div className={css.crumbRow}>
          <PathBreadcrumb
            client={client}
            workspaceId={workspaceId}
            workspaceTitle={workspaceTitle}
            active={active}
            onOpenFile={onOpenFile}
            t={t}
          />
          <div className={css.crumbActions}>
            {markdownOpen && active?.kind === 'file' ? (
              <span className={css.mdModes} role="group" aria-label={t('editor.mdPreview')}>
                <IconButton
                  label={t('editor.mdEdit')}
                  active={mdMode === 'edit'}
                  onClick={() => { setMdView(current => ({ ...current, [active.path]: 'edit' })) }}
                >
                  <IconEditor />
                </IconButton>
                <IconButton
                  label={t('editor.mdSplit')}
                  active={mdMode === 'split'}
                  onClick={() => { setMdView(current => ({ ...current, [active.path]: 'split' })) }}
                >
                  <IconSplit />
                </IconButton>
                <IconButton
                  label={t('editor.mdPreview')}
                  active={mdMode === 'preview'}
                  onClick={() => { setMdView(current => ({ ...current, [active.path]: 'preview' })) }}
                >
                  <IconEye />
                </IconButton>
              </span>
            ) : null}
            {active?.kind === 'file' ? (
              <IconButton
                label={saveReason ?? (dirty ? t('editor.save') : t('editor.saved'))}
                disabled={saveReason !== null}
                onClick={() => { void save() }}
              >
                <IconSave />
              </IconButton>
            ) : active?.kind === 'diff' || active?.kind === 'commitDiff' ? (
              <IconButton label={t('editor.fileTab')} onClick={() => { onOpenFile(active.path) }}>
                <IconDiff />
              </IconButton>
            ) : null}
            {onCollapse !== undefined ? (
              <IconButton label={t('ide.hideEditor')} onClick={onCollapse}>
                <IconPanelOff />
              </IconButton>
            ) : null}
          </div>
        </div>
        <div className={css.tabBar}>
          <div className={css.tabs} role="tablist">
            {tabs.map(tab => {
              const tabDirty = tab.kind === 'file' && buffers[tab.path] !== undefined
                && buffers[tab.path]!.draft !== buffers[tab.path]!.original
              return (
                <div
                  key={tab.id}
                  className={css.tab}
                  data-active={tab.id === activeId || undefined}
                  data-ignored={tab.ignored === true || undefined}
                  role="tab"
                >
                  <button
                    type="button"
                    className={css.tabName}
                    title={tab.ignored === true ? t('tree.ignored') : undefined}
                    onClick={() => { onActivate(tab.id) }}
                  >
                    {tab.kind === 'terminal'
                      ? terminalTabLabel(tab, t)
                      : tab.kind === 'diff'
                        ? `${fileName(tab.path)} · ${t('editor.diffTab')}`
                        : tab.kind === 'commitDiff'
                          ? `${fileName(tab.path)} · ${t('editor.commitDiffTab')}`
                          : fileName(tab.path)}
                  </button>
                  {tabDirty ? <span className={css.dirtyDot} title={t('editor.dirty')} /> : null}
                  {tab.kind === 'terminal' ? (
                    <span className={css.termMark} title={t('term.pinned')}><IconTerminal /></span>
                  ) : null}
                  {tab.kind === 'terminal' && tab.id === TERMINAL_TAB_ID ? null : (
                    <IconButton label={t('editor.close')} onClick={() => { requestClose(tab.id) }}>
                      <IconClose />
                    </IconButton>
                  )}
                </div>
              )
            })}
          </div>
          <div className={css.tabActions}>
            <div className={css.menuWrap}>
              <IconButton
                label={t('editor.add')}
                active={addOpen}
                aria-haspopup="menu"
                aria-expanded={addOpen}
                onClick={() => { setAddOpen(open => !open); setMenuOpen(false) }}
              >
                <IconPlus />
              </IconButton>
              {addOpen ? (
                <>
                  <div className={css.menuBackdrop} onClick={() => { setAddOpen(false) }} />
                  <div className={css.menu} role="menu" aria-label={t('editor.add')}>
                    <button
                      type="button"
                      className={css.menuItem}
                      role="menuitem"
                      onClick={() => {
                        setAddOpen(false)
                        onNewTerminal?.()
                      }}
                    >
                      {t('editor.addTerminal')}
                    </button>
                    <button
                      type="button"
                      className={css.menuItem}
                      role="menuitem"
                      disabled={workspaceId === undefined || onCreateFile === undefined}
                      title={workspaceId === undefined ? t('editor.addFileNoWorkspace') : undefined}
                      onClick={() => {
                        setAddOpen(false)
                        setNewFileDir(suggestNewFileDir(active?.path, active?.kind))
                        setNewFileName('未命名.txt')
                        setNewFileError(null)
                        setNewFileOpen(true)
                      }}
                    >
                      {t('editor.addFile')}
                    </button>
                  </div>
                </>
              ) : null}
            </div>
            <div className={css.menuWrap}>
              <IconButton
                label={t('editor.tabsMenu')}
                active={menuOpen}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => { setMenuOpen(open => !open); setAddOpen(false) }}
              >
                <IconMore />
              </IconButton>
              {menuOpen ? (
                <>
                  <div className={css.menuBackdrop} onClick={() => { setMenuOpen(false) }} />
                  <div className={css.menu} role="menu" aria-label={t('editor.tabsMenu')}>
                    {menuItem(closeAllIds, t('editor.closeAll'), t('editor.closeAllDisabled'))}
                    {menuItem(closeOthersIds, t('editor.closeOthers'), t('editor.closeOthersDisabled'))}
                    {menuItem(closeLeftIds, t('editor.closeLeft'), t('editor.closeLeftDisabled'))}
                    {menuItem(closeRightIds, t('editor.closeRight'), t('editor.closeRightDisabled'))}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
        <div className={css.body}>
          {error !== null || notice != null ? (
            <div className={css.banner}>
              <div>{(error ?? notice)!.messageZh}</div>
              <div>{(error ?? notice)!.hintZh}</div>
            </div>
          ) : null}
          {body}
          {newFileOpen ? (
            <div className={css.dialogMask}>
              <div className={css.dialog} role="dialog" aria-labelledby="git-new-file-title">
                <h2 id="git-new-file-title">{t('editor.addFileTitle')}</h2>
                <p>{t('editor.addFileHint')}</p>
                <label className={css.field}>
                  <span>{t('editor.addFileDir')}</span>
                  <input
                    className={css.fieldInput}
                    value={newFileDir}
                    placeholder={t('editor.addFileDirRoot')}
                    onChange={(event) => { setNewFileDir(event.target.value); setNewFileError(null) }}
                  />
                </label>
                <label className={css.field}>
                  <span>{t('editor.addFileName')}</span>
                  <input
                    className={css.fieldInput}
                    value={newFileName}
                    autoFocus
                    onChange={(event) => { setNewFileName(event.target.value); setNewFileError(null) }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void submitNewFile()
                      }
                    }}
                  />
                </label>
                {newFileError !== null ? <p className={css.fieldError}>{newFileError}</p> : null}
                <div className={css.dialogRow}>
                  <button type="button" className={css.keep} onClick={() => { setNewFileOpen(false) }}>
                    {t('editor.addFileCancel')}
                  </button>
                  <button
                    type="button"
                    className={css.create}
                    disabled={newFileBusy}
                    onClick={() => { void submitNewFile() }}
                  >
                    {t('editor.addFileCreate')}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {pendingClose !== null ? (
            <div className={css.dialogMask}>
              <div className={css.dialog} role="dialog" aria-labelledby="git-close-title">
                <h2 id="git-close-title">{t('editor.closeDirtyTitle')}</h2>
                <p>
                  {pendingClose.names.length === 1
                    ? t('editor.closeDirtyBody', { name: pendingClose.names[0]! })
                    : t('editor.closeDirtyBatchBody', { count: pendingClose.names.length })}
                </p>
                <div className={css.dialogRow}>
                  <button type="button" className={css.keep} onClick={() => { setPendingClose(null) }}>
                    {t('editor.keep')}
                  </button>
                  <button
                    type="button"
                    className={css.discard}
                    onClick={() => {
                      const ids = pendingClose.ids
                      setPendingClose(null)
                      onCloseMany(ids)
                    }}
                  >
                    {t('editor.discard')}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}