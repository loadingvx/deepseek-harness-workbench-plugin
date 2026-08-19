/**
 * 全局会话监控 · 标签内容区
 *
 * 由 session-orb（会话状态球）迁移：取消悬浮球，改为右侧栏「全局会话监控」标签页。
 * 保留的分组与行交互与悬浮球弹窗一致（需要你注意 → 运行中 → 其他会话），
 * 但「其他会话」不再分页（原 1 页 8 条），整表随面板滚动条滚动。
 * 点击会话行跳转到该会话；完成未查看可"全部标为已读"（页面会话期内本地记认）。
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactElement } from 'react'
import {
  REMINDER_INTERVAL_MAX,
  REMINDER_INTERVAL_MIN,
} from './reminder-settings.ts'
import {
  ackMany,
  ackSession,
  ackSnapshot,
  groupSessions,
  pendingLabelKey,
  projectOf,
  relativeTime,
  sessionStatsOf,
  type SessionListLike,
  type SessionRowLike,
  type WorkspaceListLike,
} from './session-monitor.ts'
import type { Translate } from './types.ts'
import { useAckVersion, useBeepOn, useLoopReminder, useReminderInterval, type SessionSelectorHook, type WorkspaceSelectorHook } from './useSessionMonitor.ts'
import { IconButton } from './IconButton.tsx'
import { IconBell, IconTimer } from './icons.tsx'
import { SoundSettings } from './SoundSettings.tsx'
import css from './SessionsPanel.module.css'

export function SessionsPanel({
  useSessions, useWorkspaces, openSession, t,
}: {
  useSessions: SessionSelectorHook
  useWorkspaces: WorkspaceSelectorHook
  openSession: (id: string) => void
  t: Translate
}) {
  useAckVersion()
  const list = useSessions((s) => s) as SessionListLike
  const wsSnapshot = useWorkspaces((s) => s) as WorkspaceListLike
  const wsItems = wsSnapshot.items ?? []
  const archivedIds = wsSnapshot.archivedSessionIds ?? []
  const [beepOn, setBeepOn] = useBeepOn()
  const [loopOn, setLoopOn] = useLoopReminder()
  const [intervalSec, setIntervalSec] = useReminderInterval()
  // 循环提醒生效 = 提示音总闸开启 且 循环提醒子开关开启（提示音关闭时联动失效，UI 与行为一致）
  const loopActive = beepOn && loopOn
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  // 间隔输入草稿：键入过程中不写偏好，失焦 / Enter 才提交，非法输入回退
  const [intervalDraft, setIntervalDraft] = useState<string | null>(null)
  const intervalDraftRef = useRef<string | null>(null)
  const updateIntervalDraft = (value: string): void => {
    intervalDraftRef.current = value
    setIntervalDraft(value)
  }
  const commitInterval = (): void => {
    const draft = intervalDraftRef.current
    intervalDraftRef.current = null
    setIntervalDraft(null)
    if (draft === null) return
    const trimmed = draft.trim()
    if (trimmed === '') return
    const n = Number(trimmed)
    if (!Number.isFinite(n)) return
    setIntervalSec(n)
  }

  // 每秒刷新"刚刚 / N 分钟前"等相对时间（仅面板打开期间计时）
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const archivedSet = useMemo(() => (archivedIds.length === 0 ? undefined : new Set(archivedIds)), [archivedIds])
  const groups = groupSessions(list, ackSnapshot(), archivedSet)

  const copyPath = (event: ReactMouseEvent, path: string, id: string): void => {
    event.stopPropagation()
    if (typeof navigator === 'undefined' || navigator.clipboard?.writeText === undefined) return
    navigator.clipboard.writeText(path).then(() => {
      setCopiedId(id)
      window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500)
    }).catch(() => { /* 剪贴板被拒：静默，不影响其他交互 */ })
  }

  const open = (id: string): void => {
    ackSession(id)
    openSession(id)
  }

  const relText = (s: SessionRowLike): string => {
    const rel = relativeTime(s.updatedAt, now)
    if (rel === null) return ''
    return rel.kind === 'key' ? t(rel.key, rel.vars) : rel.text
  }

  const row = (s: SessionRowLike, dot: string, label?: string, labelCls?: string): ReactElement => {
    const project = projectOf(s, wsItems)
    const showProject = project !== '' && project !== s.displayTitle
    const hasCwd = typeof s.cwd === 'string' && s.cwd.length > 0
    const stats = sessionStatsOf(s)
    const title = (showProject ? t('sessions.project', { name: project }) + ' · ' : '') + t('sessions.openTitle', { name: s.displayTitle })
    return (
      <div key={s.id} className={css.row} onClick={() => open(s.id)} title={title}>
        <span className={dot === '' ? css.dot : `${css.dot} ${css[dot]}`} />
        <span className={css.rowTitle}>{s.displayTitle}</span>
        {label !== undefined ? <span className={`${css.rowLabel}${labelCls !== undefined ? ` ${css[labelCls]}` : ''}`}>{label}</span> : null}
        <span className={css.rowSub}>
          {stats !== null ? (
            <span className={css.rowStats}>{t('sessions.turnsSteps', { turns: stats.turns, steps: stats.steps })}</span>
          ) : null}
          {showProject ? <span className={css.rowProject}>{project}</span> : null}
          <span className={css.rowMeta}>{relText(s)}</span>
          {hasCwd ? (
            <button
              type="button"
              className={`${css.copy}${copiedId === s.id ? ` ${css.done}` : ''}`}
              onClick={(event) => copyPath(event, s.cwd as string, s.id)}
              title={t('sessions.copyPathTitle', { path: s.cwd as string })}
              aria-label={t('sessions.copyPath')}
            >
              {copiedId === s.id ? '✓' : '⧉'}
            </button>
          ) : null}
        </span>
      </div>
    )
  }

  const pendingRows = groups.pending.map((s) => row(s, 'pending', t(pendingLabelKey(s.pendingInteraction)), 'pending'))
  const doneRows = groups.completed.map((s) => row(s, 'done', t('sessions.completed'), 'done'))
  const runRows = groups.running
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map((s) => row(s, 'running'))
  const otherRows = groups.others.map((s) => row(s, ''))

  return (
    <div className={css.root}>
      <div className={css.head}>
        <span className={css.title}>{t('sessions.title')}</span>
        <span className={css.chip}>{t('sessions.total', { n: groups.total })}</span>
        {groups.running.length > 0 ? (
          <span className={css.chipWarm}>{t('sessions.running', { n: groups.running.length })}</span>
        ) : null}
        {groups.attention.length > 0 ? (
          <span className={css.chipHot}>{t('sessions.attention', { n: groups.attention.length })}</span>
        ) : null}
      </div>
      <div className={css.reminder}>
        <IconButton
          dense
          label={beepOn ? t('sessions.beepOff') : t('sessions.beepOn')}
          active={beepOn}
          onClick={() => setBeepOn(!beepOn)}
          title={beepOn ? t('sessions.beepOnHint') : t('sessions.beepOffHint')}
          aria-pressed={beepOn}
        >
          <IconBell />
        </IconButton>
        <SoundSettings t={t} />
        <IconButton
          dense
          label={!beepOn ? t('sessions.loopDisabledHint') : loopOn ? t('sessions.loopOff') : t('sessions.loopOn')}
          active={loopActive}
          disabled={!beepOn}
          onClick={() => setLoopOn(!loopOn)}
          title={!beepOn ? t('sessions.loopDisabledHint') : loopOn ? t('sessions.loopOnHint', { n: intervalSec }) : t('sessions.loopOffHint')}
          aria-pressed={loopActive}
        >
          <IconTimer />
        </IconButton>
        {loopActive ? (
          <label className={css.interval} title={t('sessions.intervalHint', { min: REMINDER_INTERVAL_MIN, max: REMINDER_INTERVAL_MAX })}>
            <span>{t('sessions.intervalLabel')}</span>
            <input
              type="number"
              className={css.intervalInput}
              min={REMINDER_INTERVAL_MIN}
              max={REMINDER_INTERVAL_MAX}
              step={5}
              value={intervalDraft ?? String(intervalSec)}
              onChange={(event) => { updateIntervalDraft(event.target.value) }}
              onBlur={commitInterval}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') {
                  intervalDraftRef.current = null
                  setIntervalDraft(null)
                  event.currentTarget.blur()
                }
              }}
              aria-label={t('sessions.intervalLabel')}
            />
            <span>{t('sessions.intervalUnit')}</span>
          </label>
        ) : null}
      </div>
      <div className={css.body}>
        <section className={css.section}>
          <h4 className={css.sectionTitle}>{t('sessions.section.attention')}</h4>
          {pendingRows.length + doneRows.length > 0
            ? <div className={css.rows}>{pendingRows.concat(doneRows)}</div>
            : <div className={css.empty}>{t('sessions.empty.attention')}</div>}
        </section>
        <section className={css.section}>
          <h4 className={css.sectionTitle}>{t('sessions.section.running')}</h4>
          {runRows.length > 0
            ? <div className={css.rows}>{runRows}</div>
            : <div className={css.empty}>{t('sessions.empty.running')}</div>}
        </section>
        <section className={css.section}>
          <h4 className={css.sectionTitle}>{t('sessions.section.others')}</h4>
          {otherRows.length > 0
            ? <div className={css.rows}>{otherRows}</div>
            : <div className={css.empty}>{t('sessions.empty.others')}</div>}
        </section>
      </div>
      <div className={css.foot}>
        <span>{t('sessions.sync')}</span>
        {groups.completed.length > 0 ? (
          <button
            type="button"
            className={css.markread}
            onClick={() => ackMany(groups.completed.map((s) => s.id))}
          >
            {t('sessions.markRead')}
          </button>
        ) : null}
      </div>
    </div>
  )
}
