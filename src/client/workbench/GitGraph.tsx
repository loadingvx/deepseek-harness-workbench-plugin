import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { GitClient } from '../api.ts'
import type { GitFail, GitFileChange, GitLogEntry } from '../../shared/types.ts'
import { formatCommitTooltip } from './commit-stamp.ts'
import { toRefMark } from './git-refs.ts'
import {
  graphNodesFromEntries, laneColor, layoutGraphLanes, type GraphLaneRow,
} from './graph-lanes.ts'
import { buildGraphRailDraw, graphRailMetrics } from './graph-rail.ts'
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
  const metrics = graphRailMetrics(compact === true)

  if (entries.length === 0) {
    return <p className={css.hint}>{emptyLabel}</p>
  }
  return (
    <ol
      className={css.graph}
      data-compact={compact || undefined}
      aria-label={t('section.graph')}
      style={{ ['--dsw-graph-row-h' as string]: `${metrics.rowH}px` }}
    >
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
  const hostRef = useRef<HTMLSpanElement>(null)
  const fallbackH = graphRailMetrics(compact).rowH
  const [height, setHeight] = useState(fallbackH)

  useLayoutEffect(() => {
    const el = hostRef.current
    if (el === null) return
    const sync = (): void => {
      const next = el.getBoundingClientRect().height
      if (next > 0) setHeight(prev => (Math.abs(prev - next) < 0.25 ? prev : next))
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [compact])

  const draw = buildGraphRailDraw(row, lanes, { height, compact, isLast })

  return (
    <span ref={hostRef} className={css.graphRail} style={{ width: draw.width }} aria-hidden title={title}>
      <svg
        className={css.graphBends}
        width={draw.width}
        height={draw.height}
        viewBox={`0 0 ${draw.width} ${draw.height}`}
      >
        {draw.strokes.map(stroke => (
          <path
            key={stroke.key}
            d={stroke.d}
            fill="none"
            stroke={laneColor(stroke.lane)}
            strokeWidth="2"
          />
        ))}
        <circle
          cx={draw.dot.x}
          cy={draw.dot.y}
          r={draw.dot.r}
          fill={head ? 'transparent' : laneColor(draw.dot.lane)}
          stroke={laneColor(draw.dot.lane)}
          strokeWidth={head ? 2 : 0}
        />
      </svg>
    </span>
  )
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
