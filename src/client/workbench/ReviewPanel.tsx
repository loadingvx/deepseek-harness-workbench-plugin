import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { GitClient } from '../api.ts'
import type { GitResult, ReviewFileSnapshot, ReviewSnapshot } from '../../shared/types.ts'
import { IconButton } from './IconButton.tsx'
import { IconRefresh, IconReview } from './icons.tsx'
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

  const requestUndoFile = (file: ReviewFileSnapshot): void => {
    if (file.manualEdited) setUndoAsk({ kind: 'file', path: file.path })
    else void run(() => client.reviewUndo(workspaceId!, file.path))
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
      <div className={css.head}>
        <div className={css.title}>
          <IconReview />
          <span>{t('review.title')}</span>
          {!empty ? <span className={css.count}>{files.length}</span> : null}
        </div>
        <div className={css.headActions}>
          <IconButton label={t('review.refresh')} disabled={busy} onClick={() => { void refresh() }}>
            <IconRefresh />
          </IconButton>
          <button
            type="button"
            className={css.textBtn}
            disabled={busy || empty}
            onClick={() => { void run(() => client.reviewKeep(workspaceId)) }}
          >
            {t('review.keepAll')}
          </button>
          <button
            type="button"
            className={css.textBtn}
            disabled={busy || empty}
            onClick={requestUndoAll}
          >
            {t('review.undoAll')}
          </button>
        </div>
      </div>
      <p className={css.hint}>{t('review.hintShort')}</p>
      {error !== null ? <pre className={css.error}>{error}</pre> : null}
      {empty ? (
        <p className={css.empty}>{t('review.empty')}</p>
      ) : (
        <ul className={css.list}>
          {files.map(file => (
            <li key={file.path} className={css.row} data-path={file.path}>
              <button
                type="button"
                className={css.fileBtn}
                title={file.path}
                onClick={() => { onOpenFile(file.path) }}
              >
                <span className={css.name}>{fileName(file.path)}</span>
                <span className={css.meta}>
                  <span className={css.stats}>+{file.addedLines} −{file.removedLines}</span>
                  {file.created ? <span className={css.chip}>{t('review.created')}</span> : null}
                  {file.manualEdited ? <span className={css.chipWarn}>{t('review.manualEdited')}</span> : null}
                </span>
                <span className={css.path}>{file.path}</span>
              </button>
              <div className={css.rowActions}>
                <button
                  type="button"
                  className={css.fileAction}
                  disabled={busy}
                  title={t('review.keepFile')}
                  onClick={() => { void run(() => client.reviewKeep(workspaceId, file.path)) }}
                >
                  {t('review.keep')}
                </button>
                <button
                  type="button"
                  className={css.fileAction}
                  disabled={busy}
                  title={t('review.undoFile')}
                  onClick={() => { requestUndoFile(file) }}
                >
                  {t('review.undo')}
                </button>
              </div>
            </li>
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
              <button type="button" className={css.dialogOk} disabled={busy} onClick={confirmUndo}>
                {t('review.undoConfirmOk')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
