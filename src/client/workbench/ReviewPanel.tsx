import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { GitClient } from '../api.ts'
import type { GitResult, ReviewFileSnapshot, ReviewSnapshot } from '../../shared/types.ts'
import { IconButton } from './IconButton.tsx'
import { IconCheck, IconClose, IconRefresh, IconReview } from './icons.tsx'
import {
  applyReviewLiveSnapshot,
  readReviewLive,
  refreshReviewLive,
  retainReviewLive,
  subscribeReviewLive,
} from './review-live.ts'
import type { Translate } from './types.ts'
import css from './ReviewPanel.module.css'

type UndoAsk = { kind: 'file'; path: string } | { kind: 'all' } | null

function fileName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

function failText(result: { messageZh?: string; hintZh?: string }): string {
  const message = result.messageZh ?? ''
  const hint = result.hintZh ?? ''
  if (message === '') return hint
  if (hint === '') return message
  return `${message}\n${hint}`
}

export function ReviewPanel({
  client, workspaceId, onOpenFile, t,
}: {
  client: GitClient
  workspaceId?: string
  onOpenFile: (path: string) => void
  t: Translate
}) {
  const snap = useSyncExternalStore(subscribeReviewLive, readReviewLive, readReviewLive)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [undoAsk, setUndoAsk] = useState<UndoAsk>(null)

  useEffect(() => retainReviewLive(client, workspaceId), [client, workspaceId])

  const refresh = useCallback(async (): Promise<void> => {
    await refreshReviewLive()
  }, [])

  const run = async (action: () => Promise<GitResult<ReviewSnapshot>>): Promise<void> => {
    if (busy || workspaceId === undefined) return
    setBusy(true)
    setError(null)
    try {
      const result = await action()
      if (!result.ok) {
        setError(failText(result))
        return
      }
      applyReviewLiveSnapshot(result.value)
    } finally {
      setBusy(false)
    }
  }

  const requestUndoFile = (path: string, manualEdited: boolean): void => {
    if (manualEdited) setUndoAsk({ kind: 'file', path })
    else void run(() => client.reviewUndo(workspaceId!, path))
  }

  const requestUndoAll = (): void => {
    if (snap.files.some(f => f.manualEdited)) setUndoAsk({ kind: 'all' })
    else void run(() => client.reviewUndo(workspaceId!))
  }

  const confirmUndo = (): void => {
    if (undoAsk === null || workspaceId === undefined) return
    const ask = undoAsk
    setUndoAsk(null)
    if (ask.kind === 'all') void run(() => client.reviewUndo(workspaceId))
    else void run(() => client.reviewUndo(workspaceId, ask.path))
  }

  if (workspaceId === undefined) {
    return <p className={css.empty}>{t('review.noWorkspace')}</p>
  }

  const files = snap.files
  const empty = files.length === 0

  return (
    <div className={css.root} data-review-panel="">
      <div className={css.toolbar}>
        <div className={css.title}>
          <IconReview />
          <span>{t('review.title')}</span>
          {!empty ? <span className={css.badge}>{files.length}</span> : null}
        </div>
        <div className={css.actions}>
          <IconButton label={t('review.refresh')} disabled={busy} onClick={() => { void refresh() }}>
            <IconRefresh />
          </IconButton>
          <button
            type="button"
            className={css.keepAll}
            disabled={busy || empty}
            onClick={() => { void run(() => client.reviewKeep(workspaceId)) }}
          >
            {t('review.keepAll')}
          </button>
          <button
            type="button"
            className={css.undoAll}
            disabled={busy || empty}
            onClick={requestUndoAll}
          >
            {t('review.undoAll')}
          </button>
        </div>
      </div>
      <p className={css.hint}>{t('review.hint')}</p>
      {error !== null ? <pre className={css.error}>{error}</pre> : null}
      {empty ? (
        <p className={css.empty}>{t('review.empty')}</p>
      ) : (
        <ul className={css.list}>
          {files.map(file => (
            <ReviewFileRow
              key={file.path}
              file={file}
              expanded={expanded === file.path}
              busy={busy}
              t={t}
              onToggle={() => { setExpanded(current => current === file.path ? null : file.path) }}
              onOpen={() => { onOpenFile(file.path) }}
              onKeepFile={() => { void run(() => client.reviewKeep(workspaceId, file.path)) }}
              onUndoFile={() => { requestUndoFile(file.path, file.manualEdited) }}
              onKeepHunk={(hunkId) => { void run(() => client.reviewKeep(workspaceId, file.path, hunkId)) }}
              onUndoHunk={(hunkId) => { void run(() => client.reviewUndo(workspaceId, file.path, hunkId)) }}
            />
          ))}
        </ul>
      )}

      {undoAsk !== null ? (
        <div
          className={css.dialogMask}
          onClick={() => { setUndoAsk(null) }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setUndoAsk(null)
          }}
        >
          <div
            className={css.dialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="review-undo-title"
            onClick={(event) => { event.stopPropagation() }}
          >
            <h2 id="review-undo-title">{t('review.undoConfirmTitle')}</h2>
            <p>
              {undoAsk.kind === 'all'
                ? t('review.undoConfirmAllBody')
                : t('review.undoConfirmFileBody', { name: fileName(undoAsk.path) })}
            </p>
            <div className={css.dialogRow}>
              <button type="button" className={css.dialogCancel} disabled={busy} onClick={() => { setUndoAsk(null) }}>
                {t('review.undoConfirmCancel')}
              </button>
              <button type="button" className={css.dialogDanger} disabled={busy} onClick={confirmUndo}>
                {t('review.undoConfirmOk')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ReviewFileRow({
  file, expanded, busy, t, onToggle, onOpen, onKeepFile, onUndoFile, onKeepHunk, onUndoHunk,
}: {
  file: ReviewFileSnapshot
  expanded: boolean
  busy: boolean
  t: Translate
  onToggle: () => void
  onOpen: () => void
  onKeepFile: () => void
  onUndoFile: () => void
  onKeepHunk: (id: string) => void
  onUndoHunk: (id: string) => void
}) {
  const hunkLocked = file.manualEdited
  return (
    <li className={css.file} data-path={file.path} data-manual={file.manualEdited ? '1' : '0'}>
      <div className={css.fileHead}>
        <button type="button" className={css.fileName} onClick={onToggle} title={file.path}>
          <span className={css.chevron} data-open={expanded ? '1' : '0'}>▸</span>
          <span className={css.name}>{fileName(file.path)}</span>
          <span className={css.path}>{file.path}</span>
        </button>
        <span className={css.stats}>
          +{file.addedLines} −{file.removedLines}
          {file.created ? <span className={css.tag}>{t('review.created')}</span> : null}
          {file.manualEdited ? <span className={css.tagManual}>{t('review.manualEdited')}</span> : null}
        </span>
        <div className={css.fileActions}>
          <button type="button" className={css.link} disabled={busy} onClick={onOpen}>{t('review.open')}</button>
          <button type="button" className={css.keep} disabled={busy} onClick={onKeepFile} title={t('review.keepFile')}>
            <IconCheck /> {t('review.keep')}
          </button>
          <button type="button" className={css.undo} disabled={busy} onClick={onUndoFile} title={t('review.undoFile')}>
            <IconClose /> {t('review.undo')}
          </button>
        </div>
      </div>
      {expanded ? (
        <div className={css.hunks}>
          {hunkLocked ? <p className={css.emptyHunk}>{t('review.hunkLocked')}</p> : null}
          {file.hunks.length === 0 ? (
            <p className={css.emptyHunk}>{t('review.noHunks')}</p>
          ) : file.hunks.map((hunk, index) => (
            <div key={hunk.id} className={css.hunk} data-hunk={hunk.id}>
              <div className={css.hunkBar}>
                <span>{t('review.hunk', { n: index + 1 })}</span>
                <div className={css.hunkActions}>
                  <button
                    type="button"
                    className={css.keep}
                    disabled={busy || hunkLocked}
                    onClick={() => { onKeepHunk(hunk.id) }}
                  >
                    {t('review.keepHunk')}
                  </button>
                  <button
                    type="button"
                    className={css.undo}
                    disabled={busy || hunkLocked}
                    onClick={() => { onUndoHunk(hunk.id) }}
                  >
                    {t('review.undoHunk')}
                  </button>
                </div>
              </div>
              <pre className={css.diff}>
                {hunk.oldText !== null ? hunk.oldText.split('\n').map((line, i) => (
                  <div key={`d${i}`} className={css.del}>-{line}</div>
                )) : null}
                {hunk.newText.split('\n').map((line, i) => (
                  <div key={`a${i}`} className={css.add}>+{line}</div>
                ))}
              </pre>
            </div>
          ))}
        </div>
      ) : null}
    </li>
  )
}
