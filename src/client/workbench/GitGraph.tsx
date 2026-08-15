import type { GitLogEntry } from '../../shared/types.ts'
import type { Translate } from './types.ts'
import css from './GitSidebar.module.css'

export function GitGraph({
  entries, emptyLabel, t,
}: {
  entries: GitLogEntry[]
  emptyLabel: string
  t: Translate
}) {
  if (entries.length === 0) {
    return <p className={css.hint}>{emptyLabel}</p>
  }
  return (
    <ol className={css.graph} aria-label={t('section.graph')}>
      {entries.map((entry, index) => (
        <li key={entry.hash} className={css.graphRow} data-head={entry.head || undefined}>
          <span className={css.graphRail} aria-hidden>
            {index < entries.length - 1 ? <span className={css.graphLine} /> : null}
            <span className={css.graphDot} data-head={entry.head || undefined} title={entry.head ? t('graph.head') : entry.shortHash} />
          </span>
          <div className={css.graphBody}>
            <div className={css.graphTop}>
              <span className={css.graphSubject} title={entry.subject}>{entry.subject}</span>
              {entry.refs.map(ref => (
                <span key={ref} className={css.refPill} title={ref}>{ref}</span>
              ))}
            </div>
            <div className={css.graphMeta}>
              <span>{entry.author}</span>
              <span className={css.hash}>{entry.shortHash}</span>
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}
