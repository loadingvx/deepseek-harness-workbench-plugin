import { useEffect, useRef, useState } from 'react'
import type { GitClient } from '../api.ts'
import type { GitFail, GitFileChange, GitLogEntry } from '../../shared/types.ts'
import { formatCommitTooltip } from './commit-stamp.ts'
import { toRefMark } from './git-refs.ts'
import type { Translate } from './types.ts'
import css from './GitSidebar.module.css'

const KIND_MARK: Record<string, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  conflict: 'C',
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.left = '-9999px'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      return ok
    } catch {
      return false
    }
  }
}

export function GitGraph({
  entries, emptyLabel, compact, client, workspaceId, onOpenCommitDiff, t,
}: {
  entries: GitLogEntry[]
  emptyLabel: string
  compact?: boolean
  client: GitClient
  workspaceId?: string
  onOpenCommitDiff: (hash: string, path: string) => void
  t: Translate
}) {
  const [flash, setFlash] = useState<{ hash: string; ok: boolean } | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [files, setFiles] = useState<Record<string, GitFileChange[]>>({})
  const [filesLoading, setFilesLoading] = useState<Record<string, boolean>>({})
  const [filesError, setFilesError] = useState<Record<string, GitFail | null>>({})
  const timerRef = useRef<number | null>(null)
  const loadingRef = useRef<Record<string, boolean>>({})

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  const copyHash = (hash: string): void => {
    void writeClipboard(hash).then((ok) => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      setFlash({ hash, ok })
      timerRef.current = window.setTimeout(() => { setFlash(null) }, 1600)
    })
  }

  const toggleCommit = (hash: string): void => {
    const open = !expanded[hash]
    setExpanded(current => ({ ...current, [hash]: open }))
    if (!open || files[hash] !== undefined || loadingRef.current[hash] === true || workspaceId === undefined) return
    loadingRef.current[hash] = true
    setFilesLoading(current => ({ ...current, [hash]: true }))
    setFilesError(current => ({ ...current, [hash]: null }))
    void client.commitFiles(workspaceId, hash).then((result) => {
      loadingRef.current[hash] = false
      setFilesLoading(current => ({ ...current, [hash]: false }))
      if (result.ok) {
        setFiles(current => ({ ...current, [hash]: result.value }))
      } else {
        setFilesError(current => ({ ...current, [hash]: result }))
      }
    })
  }

  if (entries.length === 0) {
    return <p className={css.hint}>{emptyLabel}</p>
  }
  return (
    <ol className={css.graph} data-compact={compact || undefined} aria-label={t('section.graph')}>
      {entries.map((entry, index) => {
        const when = formatCommitTooltip(entry.date)
        const justCopied = flash?.hash === entry.hash && flash.ok
        const justFailed = flash?.hash === entry.hash && !flash.ok
        const open = expanded[entry.hash] === true
        const fileList = files[entry.hash]
        const fileLoading = filesLoading[entry.hash] === true
        const fileError = filesError[entry.hash]
        return (
          <li key={entry.hash} className={css.graphRow} data-head={entry.head || undefined} data-open={open || undefined}>
            <span className={css.graphRail} aria-hidden>
              {index < entries.length - 1 ? <span className={css.graphLine} /> : null}
              <span className={css.graphDot} data-head={entry.head || undefined} title={entry.head ? t('graph.head') : entry.shortHash} />
            </span>
            <div className={css.graphBody} title={when || undefined}>
              <button
                type="button"
                className={css.graphToggle}
                aria-expanded={open || undefined}
                title={open ? t('graph.collapse') : t('graph.expand')}
                onClick={() => { toggleCommit(entry.hash) }}
              >
                <span className={css.graphTop}>
                  <span
                    className={css.graphSubject}
                    title={compact ? compactTitle(entry, when) : entry.subject}
                  >
                    {entry.subject}
                  </span>
                  {entry.refs.map((raw, refIndex) => {
                    const ref = toRefMark(raw)
                    if (ref === null) return null
                    return (
                      <span
                        key={`${ref.kind}:${ref.name}:${refIndex}`}
                        className={css.refPill}
                        data-kind={ref.kind}
                        title={ref.kind === 'tag' ? `tag ${ref.name}` : ref.name}
                      >
                        {ref.name}
                      </span>
                    )
                  })}
                  {open && fileList !== undefined ? (
                    <span className={css.graphFileCount}>{t('graph.commitFiles', { count: fileList.length })}</span>
                  ) : null}
                </span>
                {compact ? null : (
                  <span className={css.graphMeta}>
                    <span className={css.graphAuthor} title={entry.author}>{entry.author}</span>
                    <button
                      type="button"
                      className={css.hash}
                      data-copied={justCopied || undefined}
                      title={justCopied ? t('graph.hashCopied') : justFailed ? t('graph.hashCopyFailed') : t('graph.hashCopy')}
                      onClick={(event) => {
                        event.stopPropagation()
                        copyHash(entry.hash)
                      }}
                    >
                      {justCopied ? t('graph.hashCopied') : justFailed ? t('graph.hashCopyFailed') : entry.shortHash}
                    </button>
                    <span className={css.graphChevron} data-open={open || undefined} aria-hidden>
                      {open ? '▾' : '▸'}
                    </span>
                  </span>
                )}
              </button>
              {open ? (
                <div className={css.graphFiles}>
                  {fileLoading ? <p className={css.graphFilesHint}>{t('graph.filesLoading')}</p> : null}
                  {fileError !== null ? (
                    <div className={css.banner}>
                      <div>{fileError.messageZh}</div>
                      <div className={css.bannerHint}>{fileError.hintZh}</div>
                    </div>
                  ) : null}
                  {!fileLoading && fileError === null && (fileList === undefined || fileList.length === 0) ? (
                    <p className={css.graphFilesHint}>{t('graph.filesEmpty')}</p>
                  ) : null}
                  {fileList !== undefined && fileList.length > 0 ? (
                    <ul className={css.graphFileList}>
                      {fileList.map(file => (
                        <li key={file.path} className={css.graphFile}>
                          <span className={css.fileKind} data-kind={file.kind} title={file.labelZh}>
                            {KIND_MARK[file.kind] ?? '?'}
                          </span>
                          <button
                            type="button"
                            className={css.graphFilePath}
                            title={t('graph.openCommitDiff', { name: file.path })}
                            onClick={() => { onOpenCommitDiff(entry.hash, file.path) }}
                          >
                            {file.path}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function compactTitle(entry: GitLogEntry, when: string): string {
  return [entry.subject, entry.author, entry.shortHash, when].filter(Boolean).join(' · ')
}
