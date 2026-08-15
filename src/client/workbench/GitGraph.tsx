import { useEffect, useRef, useState } from 'react'
import type { GitLogEntry } from '../../shared/types.ts'
import { formatCommitTooltip } from './commit-stamp.ts'
import { toRefMark } from './git-refs.ts'
import type { Translate } from './types.ts'
import css from './GitSidebar.module.css'

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
  entries, emptyLabel, compact, t,
}: {
  entries: GitLogEntry[]
  emptyLabel: string
  compact?: boolean
  t: Translate
}) {
  const [flash, setFlash] = useState<{ hash: string; ok: boolean } | null>(null)
  const timerRef = useRef<number | null>(null)

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

  if (entries.length === 0) {
    return <p className={css.hint}>{emptyLabel}</p>
  }
  return (
    <ol className={css.graph} data-compact={compact || undefined} aria-label={t('section.graph')}>
      {entries.map((entry, index) => {
        const when = formatCommitTooltip(entry.date)
        const justCopied = flash?.hash === entry.hash && flash.ok
        const justFailed = flash?.hash === entry.hash && !flash.ok
        return (
          <li key={entry.hash} className={css.graphRow} data-head={entry.head || undefined}>
            <span className={css.graphRail} aria-hidden>
              {index < entries.length - 1 ? <span className={css.graphLine} /> : null}
              <span className={css.graphDot} data-head={entry.head || undefined} title={entry.head ? t('graph.head') : entry.shortHash} />
            </span>
            <div className={css.graphBody} title={when || undefined}>
              <div className={css.graphTop}>
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
              </div>
              {compact ? null : (
                <div className={css.graphMeta}>
                  <span className={css.graphAuthor} title={entry.author}>{entry.author}</span>
                  <button
                    type="button"
                    className={css.hash}
                    data-copied={justCopied || undefined}
                    title={justCopied ? t('graph.hashCopied') : justFailed ? t('graph.hashCopyFailed') : t('graph.hashCopy')}
                    onClick={() => { copyHash(entry.hash) }}
                  >
                    {justCopied ? t('graph.hashCopied') : justFailed ? t('graph.hashCopyFailed') : entry.shortHash}
                  </button>
                </div>
              )}
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
