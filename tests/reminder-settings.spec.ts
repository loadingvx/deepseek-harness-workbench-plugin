// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_LOOP_REMINDER,
  DEFAULT_REMINDER_INTERVAL,
  LOOP_REMINDER_KEY,
  REMINDER_INTERVAL_KEY,
  REMINDER_INTERVAL_MAX,
  REMINDER_INTERVAL_MIN,
  clampReminderInterval,
  getLoopReminder,
  getReminderInterval,
  resetReminderSettings,
  setLoopReminder,
  setReminderInterval,
  subscribeLoopReminder,
  subscribeReminderInterval,
} from '../src/client/workbench/reminder-settings.ts'

afterEach(() => {
  resetReminderSettings()
  try {
    localStorage.removeItem(LOOP_REMINDER_KEY)
    localStorage.removeItem(REMINDER_INTERVAL_KEY)
  } catch { /* ignore */ }
})

describe('loop reminder defaults', () => {
  it('defaults to on with a 10s interval', () => {
    expect(DEFAULT_LOOP_REMINDER).toBe(true)
    expect(DEFAULT_REMINDER_INTERVAL).toBe(10)
    expect(getLoopReminder()).toBe(true)
    expect(getReminderInterval()).toBe(10)
  })
})

describe('loop reminder persistence', () => {
  it('persists the switch and interval to localStorage and restores them', () => {
    setLoopReminder(false)
    setReminderInterval(30)
    expect(localStorage.getItem(LOOP_REMINDER_KEY)).toBe('0')
    expect(localStorage.getItem(REMINDER_INTERVAL_KEY)).toBe('30')
    expect(getLoopReminder()).toBe(false)
    expect(getReminderInterval()).toBe(30)
  })

  it('ignores a corrupted stored interval and falls back to the default', async () => {
    localStorage.setItem(REMINDER_INTERVAL_KEY, 'abc')
    vi.resetModules()
    const fresh = await import('../src/client/workbench/reminder-settings.ts')
    expect(fresh.getReminderInterval()).toBe(DEFAULT_REMINDER_INTERVAL)
    // 低于下限的持久化值同样被拒（防手改 localStorage）
    localStorage.setItem(REMINDER_INTERVAL_KEY, '2')
    vi.resetModules()
    const fresh2 = await import('../src/client/workbench/reminder-settings.ts')
    expect(fresh2.getReminderInterval()).toBe(DEFAULT_REMINDER_INTERVAL)
  })
})

describe('clampReminderInterval', () => {
  it('clamps to the 5–3600 range and rounds', () => {
    expect(clampReminderInterval(2)).toBe(REMINDER_INTERVAL_MIN)
    expect(clampReminderInterval(99999)).toBe(REMINDER_INTERVAL_MAX)
    expect(clampReminderInterval(12.6)).toBe(13)
    expect(clampReminderInterval(5)).toBe(5)
    expect(clampReminderInterval(3600)).toBe(3600)
  })

  it('falls back to the default for non-finite input', () => {
    expect(clampReminderInterval(NaN)).toBe(DEFAULT_REMINDER_INTERVAL)
    expect(clampReminderInterval(Infinity)).toBe(DEFAULT_REMINDER_INTERVAL)
  })

  it('setReminderInterval stores the clamped value', () => {
    setReminderInterval(2)
    expect(getReminderInterval()).toBe(REMINDER_INTERVAL_MIN)
    setReminderInterval(7200)
    expect(getReminderInterval()).toBe(REMINDER_INTERVAL_MAX)
    expect(localStorage.getItem(REMINDER_INTERVAL_KEY)).toBe(String(REMINDER_INTERVAL_MAX))
  })
})

describe('subscribers', () => {
  it('notify only on actual change', () => {
    const seenLoop: boolean[] = []
    const seenInterval: number[] = []
    const off1 = subscribeLoopReminder((on) => { seenLoop.push(on) })
    const off2 = subscribeReminderInterval((sec) => { seenInterval.push(sec) })
    setLoopReminder(false)
    setLoopReminder(false) // 无变化不通知
    setLoopReminder(true)
    setReminderInterval(30)
    setReminderInterval(30) // 无变化不通知
    setReminderInterval(60)
    expect(seenLoop).toEqual([false, true])
    expect(seenInterval).toEqual([30, 60])
    off1()
    off2()
  })

  it('stops notifying after unsubscribe', () => {
    const seen: number[] = []
    const off = subscribeReminderInterval((sec) => { seen.push(sec) })
    off()
    setReminderInterval(20)
    expect(seen).toEqual([])
  })
})
