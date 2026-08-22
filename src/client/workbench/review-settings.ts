/**
 * 改动确认（Keep / Undo）开关：页面级偏好，localStorage 持久化，默认开启。
 *
 * 关闭后：侧栏不再出现待确认列表，host 也不再为 write/edit 采集基线。
 */
import { useEffect, useState } from 'react'
import { readBoolFlag, writeBoolFlag } from './ui-flags.ts'

export const REVIEW_ON_KEY = 'dsh-workbench-review-on'

/** 出厂默认：开启（与 Cursor/Trae 式 Keep·Undo 工作流一致）。 */
export const DEFAULT_REVIEW_ON = true

let reviewOn = readBoolFlag(REVIEW_ON_KEY, DEFAULT_REVIEW_ON)
const listeners = new Set<(on: boolean) => void>()

/** Optional host sync (wired while review-live is retained). */
let hostSync: ((on: boolean) => void) | null = null

export function getReviewOn(): boolean {
  return reviewOn
}

export function setReviewOn(value: boolean): void {
  if (reviewOn === value) return
  reviewOn = value
  writeBoolFlag(REVIEW_ON_KEY, value)
  for (const fn of listeners) fn(value)
  hostSync?.(value)
}

export function subscribeReviewOn(fn: (on: boolean) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function useReviewOn(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(getReviewOn)
  useEffect(() => subscribeReviewOn(setOn), [])
  return [on, setReviewOn]
}

/**
 * Bind a callback that pushes the preference to the host process.
 * Returns unbind; only the latest bind is active (refcount callers share one).
 */
export function bindReviewHostSync(sync: (on: boolean) => void): () => void {
  hostSync = sync
  sync(reviewOn)
  return () => {
    if (hostSync === sync) hostSync = null
  }
}

/** @internal test helper */
export function resetReviewOn(): void {
  reviewOn = DEFAULT_REVIEW_ON
  writeBoolFlag(REVIEW_ON_KEY, reviewOn)
  for (const fn of listeners) fn(reviewOn)
}
