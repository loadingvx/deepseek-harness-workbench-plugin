import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { GitClient } from '../api.ts'
import type { GitFail } from '../../shared/types.ts'
import { IconButton } from './IconButton.tsx'
import { IconClose, IconDiff, IconMore, IconPanelOff, IconSave } from './icons.tsx'
import type { FileBuffer, FileTab, Translate } from './types.ts'
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
  leadingSash?: ReactNode
  t: Translate
}

function fileName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

function parseDiff(text: string): Array<{ kind: 'add' | 'del' | 'hunk' | 'meta' | 'ctx'; text: string }> {
  if (text.trim() === '') return []
  return text.split(/\r?\n/).map((line) => {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ')) {
      return { kind: 'meta' as const, text: line }
    }
    if (line.startsWith('@@')) return { kind: 'hunk' as const, text: line }
    if (line.startsWith('+')) return { kind: 'add' as const, text: line }
    if (line.startsWith('-')) return { kind: 'del' as const, text: line }
    return { kind: 'ctx' as const, text: line }
  })
}

/** Center editor: explorer + tabs + text/diff, with unsaved-close confirmation. */
export function EditorPane({
  client, workspaceId, tabs, activeId, buffers,
  onOpenFile, onActivate, onClose, onCloseMany, onDraft, onSaved, onCollapse, notice, leadingSash, t,
}: EditorPaneProps) {
  const active = tabs.find(tab => tab.id === activeId) ?? null
  const buffer = active?.kind === 'file' ? buffers[active.path] : undefined
  const dirty = buffer !== undefined && buffer.draft !== buffer.original
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<GitFail | null>(null)
  const [pendingClose, setPendingClose] = useState<{ ids: string[]; names: string[] } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [diffText, setDiffText] = useState('')
  const [diffLoading, setDiffLoading] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (active?.kind !== 'diff' || workspaceId === undefined) {
      setDiffText('')
      return
    }
    setDiffLoading(true)
    void client.diff(workspaceId, active.path, active.staged === true).then((result) => {
      setDiffLoading(false)
      if (result.ok) {
        setError(null)
        setDiffText(result.value.text)
      } else {
        setError(result)
        setDiffText('')
      }
    })
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

  const lines = useMemo(() => (buffer?.draft.split(/\n/).length ?? 1), [buffer?.draft])

  const activeIndex = activeId === null ? -1 : tabs.findIndex(tab => tab.id === activeId)
  const tabIds = tabs.map(tab => tab.id)
  const closeAllIds = tabIds
  const closeOthersIds = activeIndex >= 0 ? tabIds.filter((_, index) => index !== activeIndex) : []
  const closeLeftIds = activeIndex > 0 ? tabIds.slice(0, activeIndex) : []
  const closeRightIds = activeIndex >= 0 && activeIndex < tabIds.length - 1 ? tabIds.slice(activeIndex + 1) : []

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [menuOpen])

  let body: ReactNode
  if (active === null) {
    body = (
      <div className={css.empty}>
        <p className={css.emptyTitle}>{t('editor.empty')}</p>
        <p className={css.emptyHint}>{t('editor.emptyHint')}</p>
      </div>
    )
  } else if (active.kind === 'diff') {
    const rows = parseDiff(diffText)
    body = (
      <div className={css.editor}>
        {diffLoading ? <p className={css.hint}>{t('panel.loading')}</p> : null}
        {!diffLoading && rows.length === 0 ? <p className={css.hint}>{t('diff.empty')}</p> : null}
        {rows.length > 0 ? (
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
  } else if (buffer === undefined) {
    body = <p className={css.hint}>{t('panel.loading')}</p>
  } else {
    body = (
      <div className={css.editor}>
        <div className={css.gutter} ref={gutterRef} aria-hidden>
          {Array.from({ length: lines }, (_, index) => <span key={index}>{index + 1}</span>)}
        </div>
        <textarea
          ref={areaRef}
          className={css.textarea}
          spellCheck={false}
          value={buffer.draft}
          onChange={(event) => { onDraft(active.path, event.target.value) }}
          onScroll={(event) => {
            if (gutterRef.current !== null) gutterRef.current.scrollTop = event.currentTarget.scrollTop
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 's') {
              event.preventDefault()
              void save()
            }
          }}
        />
      </div>
    )
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
    <section className={css.root} aria-label={t('editor.empty')} data-git-ide-panel="editor">
      {leadingSash}
      <div className={css.main}>
        <div className={css.tabBar}>
          <div className={css.tabs} role="tablist">
            {tabs.map(tab => {
              const tabDirty = tab.kind === 'file' && buffers[tab.path] !== undefined
                && buffers[tab.path]!.draft !== buffers[tab.path]!.original
              return (
                <div key={tab.id} className={css.tab} data-active={tab.id === activeId || undefined} role="tab">
                  <button type="button" className={css.tabName} onClick={() => { onActivate(tab.id) }}>
                    {tab.kind === 'diff' ? `${fileName(tab.path)} · ${t('editor.diffTab')}` : fileName(tab.path)}
                  </button>
                  {tabDirty ? <span className={css.dirtyDot} title={t('editor.dirty')} /> : null}
                  <IconButton label={t('editor.close')} onClick={() => { requestClose(tab.id) }}>
                    <IconClose />
                  </IconButton>
                </div>
              )
            })}
          </div>
          <div className={css.tabActions}>
            <div className={css.menuWrap}>
              <IconButton
                label={t('editor.tabsMenu')}
                active={menuOpen}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => { setMenuOpen(open => !open) }}
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
        {active !== null ? (
          <div className={css.toolbar}>
            <span className={css.path}>{active.path}</span>
            {active.kind === 'file' ? (
              <IconButton
                label={saveReason ?? (dirty ? t('editor.save') : t('editor.saved'))}
                disabled={saveReason !== null}
                onClick={() => { void save() }}
              >
                <IconSave />
              </IconButton>
            ) : (
              <IconButton label={t('editor.fileTab')} onClick={() => { onOpenFile(active.path) }}>
                <IconDiff />
              </IconButton>
            )}
            {onCollapse !== undefined ? (
              <IconButton label={t('ide.hideEditor')} onClick={onCollapse}>
                <IconPanelOff />
              </IconButton>
            ) : null}
          </div>
        ) : null}
        <div className={css.body}>
          {error !== null || notice != null ? (
            <div className={css.banner}>
              <div>{(error ?? notice)!.messageZh}</div>
              <div>{(error ?? notice)!.hintZh}</div>
            </div>
          ) : null}
          {body}
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
