import { useEffect, useMemo, useRef, useState } from 'react'
import type { GitClient } from '../api.ts'
import type { GitFail, GitFileChange, GitLogEntry } from '../../shared/types.ts'
import { formatCommitTooltip } from './commit-stamp.ts'
import { toRefMark } from './git-refs.ts'
import {
  graphNodesFromEntries, LANE_COL_W, laneColor, layoutGraphLanes, type GraphLaneRow,
} from './graph-lanes.ts'
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

  const layouts = useMemo(() => layoutGraphLanes(graphNodesFromEntries(entries)), [entries])
  const railLanes = Math.max(1, ...layouts.map(row => row.laneCount))

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
        const row = layouts[index]
        return (
          <li key={entry.hash} className={css.graphRow} data-head={entry.head || undefined} data-open={open || undefined}>
            {row !== undefined ? (
              <GraphRail
                row={row}
                lanes={railLanes}
                compact={compact === true}
                isLast={index === entries.length - 1}
                head={entry.head}
                title={entry.head ? t('graph.head') : entry.shortHash}
              />
            ) : null}
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
                    const title = ref.kind === 'tag'
                      ? `tag ${ref.name}`
                      : ref.kind === 'remote'
                        ? t('graph.remoteRef', { name: ref.name })
                        : ref.name
                    return (
                      <span
                        key={`${ref.kind}:${ref.name}:${refIndex}`}
                        className={css.refPill}
                        data-kind={ref.kind}
                        title={title}
                      >
                        {ref.kind === 'remote' ? <RemoteCloudIcon /> : null}
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

function GraphRail({
  row, lanes, compact, isLast, head, title,
}: {
  row: GraphLaneRow
  lanes: number
  compact: boolean
  isLast: boolean
  head: boolean
  title: string
}) {
  const width = Math.max(1, lanes) * LANE_COL_W
  const headH = compact ? 18 : 22
  const cy = compact ? 10 : 12
  const r = compact ? 3.5 : 4
  const color = (index: number): string => laneColor(index)
  const xOf = (index: number): number => index * LANE_COL_W + LANE_COL_W / 2
  const drawDown = !isLast

  return (
    <span className={css.graphRail} style={{ width }} aria-hidden title={title}>
      {row.passing.map(index => (
        <span
          key={`pass-${index}`}
          className={css.graphStem}
          style={{ left: xOf(index) - 1, background: color(index), top: 0, bottom: drawDown ? 0 : cy }}
        />
      ))}
      {drawDown
        ? row.outgoing.map((edge, edgeIndex) => (
          <span
            key={`down-${edgeIndex}`}
            className={css.graphStem}
            style={{ left: xOf(edge.to) - 1, background: color(edge.to), top: headH, bottom: 0 }}
          />
        ))
        : null}
      <svg className={css.graphBends} width={width} height={headH} viewBox={`0 0 ${width} ${headH}`}>
        {row.incoming.map(index => (
          <path
            key={`in-${index}`}
            d={bend(xOf(index), 0, xOf(row.lane), cy)}
            fill="none"
            stroke={color(index)}
            strokeWidth="2"
          />
        ))}
        {drawDown
          ? row.outgoing.map((edge, edgeIndex) => (
            <path
              key={`out-${edgeIndex}`}
              d={edge.from === edge.to
                ? `M ${xOf(edge.from)} ${cy} V ${headH}`
                : bend(xOf(edge.from), cy, xOf(edge.to), headH)}
              fill="none"
              stroke={color(edge.to)}
              strokeWidth="2"
            />
          ))
          : null}
        <circle
          cx={xOf(row.lane)}
          cy={cy}
          r={r}
          fill={head ? 'transparent' : color(row.lane)}
          stroke={color(row.lane)}
          strokeWidth={head ? 2 : 0}
        />
      </svg>
    </span>
  )
}

function bend(x1: number, y1: number, x2: number, y2: number): string {
  const midY = (y1 + y2) / 2
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`
}

function RemoteCloudIcon() {
  return (
    <svg className={css.refPillIcon} viewBox="0 0 16 16" width="10" height="10" aria-hidden>
      <path
        fill="currentColor"
        d="M12.2 7.1A3.1 3.1 0 0 0 6.4 5.6 3 3 0 0 0 3 8.6c0 .1 0 .3.1.4A2.6 2.6 0 0 0 4.6 13h7.2A2.7 2.7 0 0 0 14.4 10.4a2.6 2.6 0 0 0-2.2-3.3z"
      />
    </svg>
  )
}
