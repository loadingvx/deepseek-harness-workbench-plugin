import { afterEach, describe, expect, it } from 'vitest'
import {
  ackSnapshot,
  countAttention,
  countRunning,
  getAckVersion,
  getBeepOn,
  isUnread,
  resetAckStore,
  resetBeepStore,
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

describe('page-session ack store', () => {
  it('notifies subscribers and exposes the snapshot on reset', () => {
    let notified = 0
    const off = subscribeAck(() => { notified += 1 })
    const v0 = getAckVersion()
    resetAckStore()
    expect(notified).toBeGreaterThanOrEqual(1)
    expect(getAckVersion()).toBeGreaterThanOrEqual(v0)
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

