import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { GitClient } from '../api.ts'
import type { TrajectoryGraph } from '../../shared/trajectory.ts'
import {
  buildTrajectoryFromSession,
  liveOverlayFromSession,
  overlayLiveTrajectory,
} from '../../shared/trajectory-build.ts'
import { supplementTrajectoryFromSession } from '../../shared/trajectory-session-supplement.ts'
import {
  buildThreadFeed,
  threadStats,
  type ThreadFeedItem,
  type ThreadLlmEpisode,
  type ThreadPost,
} from './trajectory-thread.ts'
import {
  buildFishboneRowRailDraw,
  layoutFishboneRailSpecs,
  laneColor,
  THREAD_RAIL_W,
  type FishboneRowRailSpec,
} from './trajectory-thread-rail.ts'
import type { Translate } from './types.ts'
import css from './TrajectoryView.module.css'

type SessionHook = <T>(selector: (state: {
  nodes?: readonly unknown[]
  partial?: unknown
  running?: boolean
  runningCalls?: readonly unknown[]
}) => T) => T

export interface TrajectoryViewProps {
  client: GitClient
  sessionId?: string
  useSession?: SessionHook
  t: Translate
}

function avatarLetter(author: ThreadPost['author']): string {
  if (author === 'user') return 'U'
  if (author === 'agent') return 'A'
  if (author === 'tool') return 'T'
  return '·'
}

function ThreadRowRail({
  spec,
  isLast,
}: {
  spec: FishboneRowRailSpec
  isLast: boolean
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(44)

  useLayoutEffect(() => {
    const el = hostRef.current
    if (el === null) return
    const sync = (): void => {
      const row = el.closest('li')
      const next = (row ?? el).getBoundingClientRect().height
      if (next > 0) {
        setHeight(prev => (Math.abs(prev - next) < 0.25 ? prev : next))
      }
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    const row = el.closest('li')
    if (row !== null) observer.observe(row)
    return () => { observer.disconnect() }
  }, [spec.key])

  const draw = useMemo(
    () => buildFishboneRowRailDraw(spec, { height, isLast }),
    [spec, height, isLast],
  )

  return (
    <div ref={hostRef} className={css.railCell} aria-hidden>
      <svg
        className={css.railBends}
        width={draw.width}
        height={draw.height}
        viewBox={`0 0 ${draw.width} ${draw.height}`}
      >
        {draw.strokes.map(stroke => (
          <path
            key={stroke.key}
            d={stroke.d}
            fill="none"
            stroke={laneColor(stroke.depth)}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={stroke.kind === 'spine' ? 0.9 : 0.75}
          />
        ))}
        <circle
          cx={draw.dot.x}
          cy={draw.dot.y}
          r={draw.dot.r}
          fill={laneColor(draw.dot.depth)}
        />
      </svg>
    </div>
  )
}

function IoPanel({
  label,
  text,
  empty,
}: {
  label: string
  text: string
  empty: string
}) {
  const trimmed = text.trim()
  const isPlaceholder = trimmed === '{}' || trimmed === '[]'
  const preview = isPlaceholder
    ? '（参数未解析，展开查看原始内容）'
    : (trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed)

  if (trimmed === '') {
    return (
      <div className={css.ioDetails}>
        <div className={css.ioSummary}>
          <span className={css.ioLabel}>{label}</span>
          <span className={css.ioPreview}>{empty}</span>
        </div>
      </div>
    )
  }

  return (
    <details className={css.ioDetails}>
      <summary className={css.ioSummary}>
        <span className={css.ioLabel}>{label}</span>
        <span className={css.ioPreview}>{preview}</span>
      </summary>
      <pre className={css.ioPre}>{trimmed}</pre>
    </details>
  )
}

function PostHeader({
  post,
  streaming,
  t,
}: {
  post: ThreadPost
  streaming: boolean
  t: Translate
}) {
  return (
    <header className={css.headRow}>
      <span className={css.avatar} data-author={post.author} aria-hidden>
        {avatarLetter(post.author)}
      </span>
      <span className={css.author}>{post.title}</span>
      {post.subtitle ? <span className={css.subtitle}>{post.subtitle}</span> : null}
      {streaming ? (
        <span className={css.status} data-state={post.status}>{t('trajectory.status.streaming')}</span>
      ) : null}
      {post.status === 'error' ? (
        <span className={css.status} data-state="error">失败</span>
      ) : null}
    </header>
  )
}

function PostBody({
  post,
  streaming,
  t,
}: {
  post: ThreadPost
  streaming: boolean
  t: Translate
}) {
  return (
    <>
      {post.body !== undefined && post.body.trim() !== '' ? (
        <p className={css.bodyText}>{post.body}</p>
      ) : null}

      {post.inputText !== undefined || post.outputText !== undefined ? (
        <div className={css.ioGroup}>
          <IoPanel
            label={t('trajectory.inspector.input')}
            text={post.inputText ?? ''}
            empty="—"
          />
          <IoPanel
            label={t('trajectory.inspector.output')}
            text={post.outputText ?? ''}
            empty={streaming ? t('trajectory.inspector.running') : t('trajectory.inspector.noOutput')}
          />
        </div>
      ) : null}

      {post.sections !== undefined && post.sections.length > 0 ? (
        <details className={css.details}>
          <summary className={css.detailsSummary}>
            {t('trajectory.inspector.sections')} ({post.sections.length})
          </summary>
          <div className={css.detailsBody}>
            {post.sections.map(section => (
              <IoPanel
                key={section.name}
                label={section.name}
                text={section.text || t('controlPlane.prompt.empty')}
                empty={t('controlPlane.prompt.empty')}
              />
            ))}
          </div>
        </details>
      ) : null}

      {post.messages !== undefined && post.messages.length > 0 ? (
        <details className={css.details}>
          <summary className={css.detailsSummary}>
            {t('trajectory.inspector.messages')} ({post.messages.length})
          </summary>
          <div className={css.detailsBody}>
            {post.messages.map((msg, msgIndex) => (
              <div key={`${msg.role}-${msgIndex}`} className={css.msgBlock}>
                <div className={css.msgRole}>
                  {msg.role}{msg.toolName !== undefined ? ` · ${msg.toolName}` : ''}
                </div>
                <IoPanel label={msg.role} text={msg.fullText ?? ''} empty="—" />
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </>
  )
}

function ThreadPostView({
  post,
  rowRef,
  t,
  foldDefault = false,
  variant = 'outer',
  railSpec,
  railIsLast = false,
}: {
  post: ThreadPost
  rowRef?: (el: HTMLLIElement | null) => void
  t: Translate
  foldDefault?: boolean
  variant?: 'outer' | 'inner'
  railSpec?: FishboneRowRailSpec
  railIsLast?: boolean
}) {
  const streaming = post.status === 'streaming' || post.status === 'active'
  const fold = variant === 'inner'
    ? post.author === 'tool'
    : (foldDefault || post.depth >= 1 || post.author === 'system')
  const rowClass = variant === 'inner' ? css.innerPostRow : css.postRow

  if (variant === 'outer') {
    if (fold) {
      return (
        <li
          ref={rowRef}
          className={rowClass}
          data-depth={post.depth}
          data-author={post.author}
        >
          {railSpec ? <ThreadRowRail spec={railSpec} isLast={railIsLast} /> : <div className={css.railCell} aria-hidden />}
          <details className={css.postFold} open={false}>
            <summary className={css.postFoldSummary}>
              <PostHeader post={post} streaming={streaming} t={t} />
            </summary>
            <div className={css.postFoldBody}>
              <PostBody post={post} streaming={streaming} t={t} />
            </div>
          </details>
        </li>
      )
    }

    return (
      <li
        ref={rowRef}
        className={rowClass}
        data-depth={post.depth}
        data-author={post.author}
      >
        {railSpec ? <ThreadRowRail spec={railSpec} isLast={railIsLast} /> : <div className={css.railCell} aria-hidden />}
        <article className={css.post}>
          <div className={css.postBody}>
            <PostHeader post={post} streaming={streaming} t={t} />
            <PostBody post={post} streaming={streaming} t={t} />
          </div>
        </article>
      </li>
    )
  }

  if (fold) {
    return (
      <li
        ref={rowRef}
        className={rowClass}
        data-depth={post.depth}
        data-author={post.author}
      >
        {railSpec ? <ThreadRowRail spec={railSpec} isLast={railIsLast} /> : null}
        <details className={css.postFold} open={false}>
          <summary className={css.postFoldSummary}>
            <PostHeader post={post} streaming={streaming} t={t} />
          </summary>
          <div className={css.postFoldBody}>
            <PostBody post={post} streaming={streaming} t={t} />
          </div>
        </details>
      </li>
    )
  }

  return (
    <li
      ref={rowRef}
      className={rowClass}
      data-depth={post.depth}
      data-author={post.author}
    >
      {railSpec ? <ThreadRowRail spec={railSpec} isLast={railIsLast} /> : null}
      <article className={css.post}>
        <div className={css.postBody}>
          <PostHeader post={post} streaming={streaming} t={t} />
          <PostBody post={post} streaming={streaming} t={t} />
        </div>
      </article>
    </li>
  )
}

function LlmEpisodeView({
  episode,
  rowRef,
  t,
  expanded,
  onExpandedChange,
  headerSpec,
  headerIsLast,
  childSpecs,
}: {
  episode: ThreadLlmEpisode
  rowRef: (el: HTMLLIElement | null) => void
  t: Translate
  expanded: boolean
  onExpandedChange: (episodeId: string, open: boolean) => void
  headerSpec?: FishboneRowRailSpec
  headerIsLast: boolean
  childSpecs: Array<{ post: ThreadPost; spec?: FishboneRowRailSpec; isLast: boolean }>
}) {
  const innerRowRefs = useRef<Array<HTMLLIElement | null>>([])
  const { header, children } = episode
  const episodeId = episode.id
  const streaming = header.status === 'streaming' || header.status === 'active'
  const hasReplyChild = children.some(child => child.title === 'Agent 回复')

  const setInnerRowRef = useCallback((index: number) => (el: HTMLLIElement | null) => {
    innerRowRefs.current[index] = el
  }, [])

  return (
    <Fragment>
      <li ref={rowRef} className={css.episodeRow} data-depth="1">
        {headerSpec ? <ThreadRowRail spec={headerSpec} isLast={headerIsLast} /> : <div className={css.railCell} aria-hidden />}
        <details
          className={css.episodeFold}
          open={expanded}
          onToggle={(event) => { onExpandedChange(episodeId, event.currentTarget.open) }}
        >
          <summary className={css.episodeSummary}>
            <PostHeader post={header} streaming={streaming} t={t} />
          </summary>
          {expanded && !hasReplyChild && (header.messages !== undefined || header.sections !== undefined) ? (
            <div className={css.episodeMetaOnly}>
              <PostBody post={header} streaming={streaming} t={t} />
            </div>
          ) : null}
        </details>
      </li>
      {expanded && children.length === 0 ? (
        <li className={css.episodeEmptyRow}>
          <div className={css.railCell} aria-hidden />
          <p className={css.episodeEmpty}>本轮无工具调用</p>
        </li>
      ) : null}
      {expanded ? childSpecs.map((child, index) => (
        <ThreadPostView
          key={child.post.id}
          post={child.post}
          rowRef={setInnerRowRef(index)}
          t={t}
          foldDefault={child.post.author === 'tool'}
          variant="inner"
          railSpec={child.spec}
          railIsLast={child.isLast}
        />
      )) : null}
    </Fragment>
  )
}

function ThreadFeed({
  feed,
  t,
}: {
  feed: readonly ThreadFeedItem[]
  t: Translate
}) {
  const [expandedEpisodes, setExpandedEpisodes] = useState<ReadonlySet<string>>(() => new Set())

  const railSpecs = useMemo(
    () => layoutFishboneRailSpecs(feed, expandedEpisodes),
    [feed, expandedEpisodes],
  )

  const railByKey = useMemo(() => {
    const map = new Map<string, { spec: FishboneRowRailSpec; isLast: boolean }>()
    railSpecs.forEach((spec, index) => {
      map.set(spec.key, { spec, isLast: index === railSpecs.length - 1 })
    })
    return map
  }, [railSpecs])

  const setEpisodeExpanded = useCallback((episodeId: string, open: boolean) => {
    setExpandedEpisodes((prev) => {
      const next = new Set(prev)
      if (open) next.add(episodeId)
      else next.delete(episodeId)
      return next
    })
  }, [])

  return (
    <ol
      className={css.thread}
      role="feed"
      style={{ '--thread-rail-w': `${THREAD_RAIL_W}px` } as CSSProperties}
    >
      {feed.map((item) => {
        if (item.kind === 'llmEpisode') {
          const episodeId = item.episode.id
          const headerKey = `${episodeId}-header`
          const headerRail = railByKey.get(headerKey)
          const expanded = expandedEpisodes.has(episodeId)
          const childSpecs = expanded
            ? item.episode.children.map((post) => {
              const rail = railByKey.get(post.id)
              return {
                post,
                spec: rail?.spec,
                isLast: rail?.isLast ?? false,
              }
            })
            : []

          return (
            <LlmEpisodeView
              key={episodeId}
              episode={item.episode}
              rowRef={() => {}}
              t={t}
              expanded={expanded}
              onExpandedChange={setEpisodeExpanded}
              headerSpec={headerRail?.spec}
              headerIsLast={headerRail?.isLast ?? false}
              childSpecs={childSpecs}
            />
          )
        }

        const rail = railByKey.get(item.post.id)
        return (
          <ThreadPostView
            key={item.post.id}
            post={item.post}
            t={t}
            foldDefault={item.post.depth >= 1 || item.post.author === 'system'}
            railSpec={rail?.spec}
            railIsLast={rail?.isLast ?? false}
          />
        )
      })}
    </ol>
  )
}

export function TrajectoryView({ client, sessionId, useSession, t }: TrajectoryViewProps) {
  const [base, setBase] = useState<TrajectoryGraph | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const sessionNodes = useSession?.(s => s.nodes) as readonly unknown[] | undefined
  const sessionRunning = Boolean(useSession?.(s => s.running))
  const sessionCalls = useSession?.(s => s.runningCalls) as readonly unknown[] | undefined
  const sessionPartial = useSession?.(s => s.partial)

  const reload = useCallback(async (): Promise<void> => {
    const result = await client.controlPlaneTrajectory(sessionId)
    if (!result.ok) {
      setLoadError(result.messageZh || t('trajectory.loadFail'))
      return
    }
    setLoadError(null)
    setBase(result.value)
  }, [client, sessionId, t])

  useEffect(() => {
    void reload()
    const timer = window.setInterval(() => { void reload() }, 4_000)
    return () => { window.clearInterval(timer) }
  }, [reload])

  const graph = useMemo(() => {
    try {
      const fromSession = base !== null && base.llmTurns.length === 0
        ? buildTrajectoryFromSession([], sessionNodes, {
          sessionId: sessionId ?? null,
          running: sessionRunning,
          modelLine: base.modelLine,
        })
        : (base ?? buildTrajectoryFromSession([], sessionNodes, { sessionId: sessionId ?? null, running: sessionRunning }))
      const merged = base !== null && base.llmTurns.length > 0 ? base : fromSession
      const live = overlayLiveTrajectory(merged, liveOverlayFromSession({
        running: sessionRunning,
        runningCalls: sessionCalls,
        partial: sessionPartial,
      }))
      return supplementTrajectoryFromSession(live, sessionNodes, sessionCalls)
    } catch (error) {
      console.error('[trajectory]', error)
      return base !== null
        ? base
        : buildTrajectoryFromSession([], sessionNodes, { sessionId: sessionId ?? null, running: sessionRunning })
    }
  }, [base, sessionCalls, sessionId, sessionNodes, sessionPartial, sessionRunning])

  const feed = useMemo(() => buildThreadFeed(graph, { sessionNodes }), [graph, sessionNodes])
  const stats = useMemo(() => threadStats(graph), [graph])

  return (
    <div className={css.root}>
      {stats.steps.length > 0 ? (
        <div className={css.todoBar}>
          {stats.steps.map(step => (
            <span key={step.id} className={css.todoChip} data-status={step.status}>
              {step.title}
            </span>
          ))}
        </div>
      ) : null}

      <div className={css.scroll}>
        {loadError ? <p className={css.error} role="alert">{loadError}</p> : null}

        {feed.length === 0 ? (
          <p className={css.empty}>{graph.noticeZh ?? t('trajectory.empty')}</p>
        ) : (
          <ThreadFeed feed={feed} t={t} />
        )}
      </div>
    </div>
  )
}
