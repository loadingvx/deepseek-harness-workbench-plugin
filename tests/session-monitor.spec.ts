import { afterEach, describe, expect, it, vi } from 'vitest'
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
  isPersistedUnread,
  isUnread,
  pendingLabelKey,
  projectOf,
  reconcilePersistedAttention,
  relativeTime,
  resetAckStore,
  resetBeepStore,
  resetPersistedAttention,
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
  resetPersistedAttention()
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

describe('persisted attention (跨页面会话的完成未查看记认)', () => {
  it('arms completed-unread on the running→idle edge and feeds isUnread/countAttention', () => {
    // 页面 1：b 正在运行（首次观察记录 running 位）
    reconcilePersistedAttention(list([session({ id: 'b', running: true })], 'a'))
    expect(isPersistedUnread('b')).toBe(false)
    // b 完成（非当前会话）
    reconcilePersistedAttention(list([session({ id: 'b', running: false })], 'a'))
    expect(isPersistedUnread('b')).toBe(true)
    // 即使壳层 completed 未标记，插件记认也计入未读
    expect(isUnread(session({ id: 'b', running: false }), undefined, emptyAck)).toBe(true)
    expect(countAttention(list([session({ id: 'b' })], 'a'), emptyAck)).toBe(1)
    const groups = groupSessions(list([session({ id: 'b' })], 'a'), emptyAck)
    expect(groups.completed.map((s) => s.id)).toEqual(['b'])
  })

  it('restores completed-unread across a page reload via localStorage', async () => {
    // 安装 localStorage mock（node 环境默认无）
    const store = new Map<string, string>()
    const localStorageMock = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
      clear: () => { store.clear() },
      key: () => null,
      length: 0,
    }
    ;(globalThis as Record<string, unknown>).localStorage = localStorageMock
    try {
      // 页面 1：观察 b 运行 → 完成（记入并持久化）
      reconcilePersistedAttention(list([session({ id: 'b', running: true })], 'a'))
      reconcilePersistedAttention(list([session({ id: 'b', running: false })], 'a'))
      expect(isPersistedUnread('b')).toBe(true)
      expect(store.size).toBeGreaterThan(0)

      // 页面 2：全新模块实例（模拟刷新），从 localStorage 恢复
      vi.resetModules()
      const fresh = await import('../src/client/workbench/session-monitor.ts')
      expect(fresh.isPersistedUnread('b')).toBe(true)
      // 恢复后 isUnread 依然成立（壳层 completed 是 undefined）
      expect(fresh.isUnread({ id: 'b' } as never, undefined, new Set())).toBe(true)
    } finally {
      ;(globalThis as Record<string, unknown>).localStorage = undefined
    }
  })

  it('clears on explicit ack (open / mark-read) and on re-run or becoming current', () => {
    reconcilePersistedAttention(list([session({ id: 'b', running: true })], 'a'))
    reconcilePersistedAttention(list([session({ id: 'b', running: false })], 'a'))
    expect(isPersistedUnread('b')).toBe(true)

    // 显式记认（打开会话 / 全部标为已读）
    ackSession('b')
    expect(isPersistedUnread('b')).toBe(false)
    reconcilePersistedAttention(list([session({ id: 'b', running: false })], 'a'))
    reconcilePersistedAttention(list([session({ id: 'c', running: true })], 'a'))
    reconcilePersistedAttention(list([session({ id: 'c', running: false })], 'a'))
    expect(isPersistedUnread('c')).toBe(true)
    ackMany(['c'])
    expect(isPersistedUnread('c')).toBe(false)

    // 再次运行清除
    reconcilePersistedAttention(list([session({ id: 'd', running: true })], 'a'))
    reconcilePersistedAttention(list([session({ id: 'd', running: false })], 'a'))
    expect(isPersistedUnread('d')).toBe(true)
    reconcilePersistedAttention(list([session({ id: 'd', running: true })], 'a'))
    expect(isPersistedUnread('d')).toBe(false)

    // 成为当前会话（被查看）清除
    reconcilePersistedAttention(list([session({ id: 'e', running: true })], 'a'))
    reconcilePersistedAttention(list([session({ id: 'e', running: false })], 'a'))
    expect(isPersistedUnread('e')).toBe(true)
    reconcilePersistedAttention(list([session({ id: 'e', running: false })], 'e'))
    expect(isPersistedUnread('e')).toBe(false)
  })

  it('backs up the shell completed flag into the persisted record and drops vanished sessions', () => {
    // 壳层本页武装 completed → 持久化兜底
    reconcilePersistedAttention(list([session({ id: 'c', completed: true })], 'a'))
    expect(isPersistedUnread('c')).toBe(true)
    // 会话从列表消失 → 清理残留
    reconcilePersistedAttention(list([session({ id: 'x' })], 'a'))
    expect(isPersistedUnread('c')).toBe(false)
  })
})
