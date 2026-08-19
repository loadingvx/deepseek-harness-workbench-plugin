// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_GIT_AUTO_REFRESH,
  GIT_AUTO_REFRESH_KEY,
  getGitAutoRefresh,
  resetGitAutoRefresh,
  setGitAutoRefresh,
  subscribeGitAutoRefresh,
} from '../src/client/workbench/git-auto-refresh.ts'

afterEach(() => {
  resetGitAutoRefresh()
  try { localStorage.removeItem(GIT_AUTO_REFRESH_KEY) } catch { /* ignore */ }
})

describe('git auto-refresh switch', () => {
  it('defaults to on (legacy behavior)', () => {
    expect(DEFAULT_GIT_AUTO_REFRESH).toBe(true)
    expect(getGitAutoRefresh()).toBe(true)
  })

  it('persists the choice to localStorage and restores it', () => {
    setGitAutoRefresh(false)
    expect(localStorage.getItem(GIT_AUTO_REFRESH_KEY)).toBe('0')
    // 模拟刷新：重新读取持久化值
    expect(getGitAutoRefresh()).toBe(false)
  })

  it('notifies subscribers only on actual change', () => {
    const seen: boolean[] = []
    const off = subscribeGitAutoRefresh((on) => { seen.push(on) })
    setGitAutoRefresh(false)
    setGitAutoRefresh(false) // 无变化不通知
    setGitAutoRefresh(true)
    expect(seen).toEqual([false, true])
    off()
  })
})
