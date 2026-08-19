import { afterEach, describe, expect, it } from 'vitest'
import {
  ackMany,
  ackSession,
  ackSnapshot,
  countAttention,
  countRunning,
  getAckVersion,
  getBeepOn,
  groupSessions,
  isAcked,
  isUnread,
  pendingLabelKey,
  projectOf,
  relativeTime,
  resetAckStore,
  resetBeepStore,
  sessionStatsOf,
  setBeepOn,
  subscribeAck,
  subscribeBeep,
  type SessionListLike,
  type SessionRowLike,
} from '../src/client/workbench/session-monitor.ts'

function session(overrides: Partial<SessionRowLike> & { id: string }): SessionRowLike {
  return {
    displayTitle: overrides.id,
    running: false,
    blank: false,
    updatedAt: 0,
    ...overrides,
  }
}

function list(rows: SessionRowLike[], current?: string): SessionListLike {
  const byId: Record<string, SessionRowLike> = {}
  const ids: string[] = []
  for (const row of rows) {
    byId[row.id] = row
    ids.push(row.id)
  }
  return { ids, byId, current }
}

const emptyAck = new Set<string>()

afterEach(() => {
  resetAckStore()
  resetBeepStore()
})

describe('isUnread', () => {
  it('treats a completed session away from current as unread', () => {
    const s = session({ id: 'a', completed: true })
    expect(isUnread(s, undefined, emptyAck)).toBe(true)
    expect(isUnread(s, 'b', emptyAck)).toBe(true)
  })

  it('excludes the session being viewed and acked sessions', () => {
    const s = session({ id: 'a', completed: true })
    expect(isUnread(s, 'a', emptyAck)).toBe(false)
    expect(isUnread(s, undefined, new Set(['a']))).toBe(false)
  })

  it('is false for running or ordinary sessions', () => {
    expect(isUnread(session({ id: 'a', running: true }), undefined, emptyAck)).toBe(false)
    expect(isUnread(session({ id: 'a' }), undefined, emptyAck)).toBe(false)
  })
})

describe('countRunning / countAttention', () => {
  const rows = [
    session({ id: 'a', running: true }),
    session({ id: 'b', running: true }),
    session({ id: 'c', completed: true }),
    session({ id: 'd', pendingInteraction: 'approval' }),
    session({ id: 'sub', parentId: 'a', origin: 'subagent', running: true }),
    session({ id: 'blank', blank: true, running: true }),
  ]

  it('counts only top-level running sessions (subagent/blank excluded)', () => {
    expect(countRunning(list(rows))).toBe(2)
  })

  it('counts attention as pending + unread completed, excluding current', () => {
    expect(countAttention(list(rows), emptyAck)).toBe(2) // c + d
    expect(countAttention(list(rows, 'd'), emptyAck)).toBe(1) // 仅 c（当前会话不计）
    expect(countAttention(list(rows, 'c'), emptyAck)).toBe(1) // 仅 d（c 是当前会话，不算未读）
  })

  it('respects acked sessions in the attention count', () => {
    expect(countAttention(list(rows), new Set(['c']))).toBe(1)
  })

  it('excludes archived sessions from running and attention counts', () => {
    const archived = new Set(['a', 'd'])
    expect(countRunning(list(rows), archived)).toBe(1) // 仅 b（a 已归档）
    expect(countAttention(list(rows), emptyAck, archived)).toBe(1) // 仅 c（d 已归档）
  })
})

describe('groupSessions', () => {
  it('splits rows into attention → running → others with total', () => {
    const rows = [
      session({ id: 'a', running: true, updatedAt: 100 }),
      session({ id: 'b', completed: true, updatedAt: 300 }),
      session({ id: 'c', pendingInteraction: 'question', updatedAt: 200 }),
      session({ id: 'd', updatedAt: 400 }),
      session({ id: 'e', updatedAt: 500 }),
    ]
    const groups = groupSessions(list(rows), emptyAck)
    expect(groups.total).toBe(5)
    expect(groups.running.map((s) => s.id)).toEqual(['a'])
    expect(groups.pending.map((s) => s.id)).toEqual(['c'])
    expect(groups.completed.map((s) => s.id)).toEqual(['b'])
    expect(groups.attention.map((s) => s.id)).toEqual(['c', 'b'])
    // others 按 updatedAt 倒序
    expect(groups.others.map((s) => s.id)).toEqual(['e', 'd'])
  })

  it('excludes subagent children and blank rows entirely', () => {
    const rows = [
      session({ id: 'a' }),
      session({ id: 'sub', parentId: 'a', origin: 'subagent' }),
      session({ id: 'blank', blank: true }),
    ]
    const groups = groupSessions(list(rows), emptyAck)
    expect(groups.total).toBe(1)
    expect(groups.others.map((s) => s.id)).toEqual(['a'])
  })

  it('drops acked completed sessions out of attention into others', () => {
    const rows = [
      session({ id: 'a', completed: true, updatedAt: 100 }),
      session({ id: 'b', updatedAt: 200 }),
    ]
    const groups = groupSessions(list(rows), new Set(['a']))
    expect(groups.completed).toHaveLength(0)
    expect(groups.attention).toHaveLength(0)
    expect(groups.others.map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('excludes archived sessions from every group and the total', () => {
    const rows = [
      session({ id: 'a', running: true, updatedAt: 100 }),
      session({ id: 'b', completed: true, updatedAt: 300 }),
      session({ id: 'c', pendingInteraction: 'question', updatedAt: 200 }),
      session({ id: 'd', updatedAt: 400 }),
      session({ id: 'e', updatedAt: 500 }),
    ]
    const archived = new Set(['a', 'd'])
    const groups = groupSessions(list(rows), emptyAck, archived)
    expect(groups.total).toBe(3)
    expect(groups.running).toHaveLength(0)
    expect(groups.pending.map((s) => s.id)).toEqual(['c'])
    expect(groups.completed.map((s) => s.id)).toEqual(['b'])
    expect(groups.attention.map((s) => s.id)).toEqual(['c', 'b'])
    expect(groups.others.map((s) => s.id)).toEqual(['e'])
  })

  it('keeps behavior unchanged when no archived set is supplied', () => {
    const rows = [
      session({ id: 'a', running: true }),
      session({ id: 'b', updatedAt: 10 }),
    ]
    const groups = groupSessions(list(rows), emptyAck)
    expect(groups.total).toBe(2)
    expect(groups.running.map((s) => s.id)).toEqual(['a'])
    expect(groups.others.map((s) => s.id)).toEqual(['b'])
  })
})

describe('sessionStatsOf', () => {
  it('returns turns/steps from the host sessionStats projection', () => {
    const s = session({ id: 'a', projectionValues: { sessionStats: { turns: 3, steps: 12 } } })
    expect(sessionStatsOf(s)).toEqual({ turns: 3, steps: 12 })
  })

  it('returns null while a session has no closed steps or no projection', () => {
    expect(sessionStatsOf(session({ id: 'a' }))).toBeNull()
    expect(sessionStatsOf(session({ id: 'a', projectionValues: { sessionStats: { turns: 0, steps: 0 } } }))).toBeNull()
    expect(sessionStatsOf(session({ id: 'a', projectionValues: {} }))).toBeNull()
  })

  it('sanitizes non-finite numbers to null-equivalent (no steps)', () => {
    const s = session({ id: 'a', projectionValues: { sessionStats: { turns: NaN, steps: NaN } } })
    expect(sessionStatsOf(s)).toBeNull()
  })
})

describe('pendingLabelKey', () => {
  it('maps approval / plan-review / others to distinct keys', () => {
    expect(pendingLabelKey('approval')).toBe('sessions.pending.approval')
    expect(pendingLabelKey('plan-review')).toBe('sessions.pending.planReview')
    expect(pendingLabelKey('question')).toBe('sessions.pending.question')
    expect(pendingLabelKey(undefined)).toBe('sessions.pending.question')
  })
})

describe('relativeTime', () => {
  const now = 1_000_000_000_000

  it('renders just now / minutes / hours buckets', () => {
    expect(relativeTime(now - 1000, now)).toEqual({ kind: 'key', key: 'sessions.justNow' })
    expect(relativeTime(now - 60_000 * 5, now)).toEqual({ kind: 'key', key: 'sessions.minutesAgo', vars: { n: 5 } })
    expect(relativeTime(now - 3_600_000 * 2, now)).toEqual({ kind: 'key', key: 'sessions.hoursAgo', vars: { n: 2 } })
  })

  it('falls back to a date for 24h+ and null for missing timestamps', () => {
    expect(relativeTime(now - 3_600_000 * 30, now)?.kind).toBe('date')
    expect(relativeTime(undefined, now)).toBeNull()
    expect(relativeTime(0, now)).toBeNull()
  })
})

describe('projectOf', () => {
  const ws = [
    { workspaceId: 'w1', path: '/repo/app', title: '我的应用', sessionIds: ['s1'] },
    { workspaceId: 'w2', path: '/repo/lib', title: 'lib', sessionIds: [] },
  ]

  it('prefers the workspace sessionIds ledger', () => {
    expect(projectOf(session({ id: 's1', cwd: '/elsewhere' }), ws)).toBe('我的应用')
  })

  it('matches cwd exactly then by longest path prefix', () => {
    expect(projectOf(session({ id: 's2', cwd: '/repo/lib' }), ws)).toBe('lib')
    expect(projectOf(session({ id: 's2', cwd: '/repo/app/deep' }), ws)).toBe('我的应用')
  })

  it('falls back to the cwd basename and to empty', () => {
    expect(projectOf(session({ id: 's2', cwd: '/tmp/some-project' }), ws)).toBe('some-project')
    expect(projectOf(session({ id: 's2' }), ws)).toBe('')
  })

  it('hides the project when the title is already the project name', () => {
    const s = session({ id: 's2', cwd: '/tmp/some-project', displayTitle: 'some-project' })
    expect(projectOf(s, ws)).toBe('some-project')
    expect(projectOf(s, ws) !== s.displayTitle).toBe(false)
  })
})

describe('page-session ack store', () => {
  it('records and clears acknowledgements with version bumps and notifications', () => {
    let notified = 0
    const off = subscribeAck(() => { notified += 1 })
    const v0 = getAckVersion()
    ackSession('a')
    expect(isAcked('a')).toBe(true)
    expect(getAckVersion()).toBe(v0 + 1)
    expect(notified).toBe(1)
    ackSession('a') // 重复记认不重复通知
    expect(getAckVersion()).toBe(v0 + 1)
    expect(notified).toBe(1)
    ackMany(['b', 'c'])
    expect(isAcked('b') && isAcked('c')).toBe(true)
    expect(getAckVersion()).toBe(v0 + 2)
    resetAckStore()
    expect(isAcked('a')).toBe(false)
    expect(ackSnapshot().size).toBe(0)
    off()
  })
})

describe('page-session beep store', () => {
  it('defaults on, toggles and notifies subscribers', () => {
    const seen: boolean[] = []
    const off = subscribeBeep((on) => { seen.push(on) })
    expect(getBeepOn()).toBe(true)
    setBeepOn(false)
    expect(getBeepOn()).toBe(false)
    setBeepOn(true)
    expect(seen).toEqual([false, true])
    off()
  })
})
