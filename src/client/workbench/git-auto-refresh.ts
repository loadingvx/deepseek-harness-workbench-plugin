/**
 * Git 自动刷新开关（页面级偏好，localStorage 持久化，刷新不丢）。
 *
 * 关闭后停止全部 Git 定时轮询（GitSidebar / StatusBar 的 8s git status、
 * 60s 远程核对 fetch、nearby 8s 附近仓库扫描），只保留：
 *   ① 挂载时的一次性加载；② GitSidebar 头部的手动刷新按钮；③ 回到前台（visibilitychange）时的刷新。
 * 用于性能优先场景（大工作区下 git 轮询是主要周期性开销，见 my-docs/79-其他评估）。
 * 余额用量轮询（usage-live，非 git）不受此开关影响。
 */
import { readBoolFlag, writeBoolFlag } from './ui-flags.ts'

export const GIT_AUTO_REFRESH_KEY = 'dsh-workbench-git-auto-refresh'

/** 出厂默认：自动刷新开启（与旧行为一致）。 */
export const DEFAULT_GIT_AUTO_REFRESH = true

let on = readBoolFlag(GIT_AUTO_REFRESH_KEY, DEFAULT_GIT_AUTO_REFRESH)
const listeners = new Set<(on: boolean) => void>()

export function getGitAutoRefresh(): boolean {
  return on
}

export function setGitAutoRefresh(value: boolean): void {
  if (on === value) return
  on = value
  writeBoolFlag(GIT_AUTO_REFRESH_KEY, value)
  for (const fn of listeners) fn(value)
}

/** React useSyncExternalStore 订阅（模块级单例，无 React 依赖）。 */
export function subscribeGitAutoRefresh(fn: (on: boolean) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** 测试辅助：复位到出厂默认并清空持久化。 */
export function resetGitAutoRefresh(): void {
  on = DEFAULT_GIT_AUTO_REFRESH
  writeBoolFlag(GIT_AUTO_REFRESH_KEY, on)
  for (const fn of listeners) fn(on)
}
