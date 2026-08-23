/**
 * HEAD 身份判定：git status 探针 → 当前 HEAD 的可观测身份（分支名 / 分离 / 是否有提交）。
 * GitSidebar 用它检测分支变动（模型 git_branch 工具、终端或外部操作），
 * 在轮询到 HEAD 变化时重新加载 branches 与 log，让 GRAPH 与顶部下拉框对齐。
 */
import type { GitProbe } from '../../shared/types.ts'

/** HEAD 可观测身份；非仓库或 git 不可用时为 null。 */
export type HeadKey = { branch?: string; detached: boolean; hasHead: boolean } | null

export function headKeyOf(probe: GitProbe): HeadKey {
  return probe.gitAvailable && probe.isRepo
    ? { branch: probe.branch, detached: probe.detached, hasHead: probe.hasHead }
    : null
}

/** HEAD 身份是否发生了可观测变动（需先见过旧身份，避免首次轮询误触发）。 */
export function headChangedOf(prev: HeadKey, next: HeadKey): boolean {
  return prev !== null && next !== null && (
    prev.branch !== next.branch
    || prev.detached !== next.detached
    || prev.hasHead !== next.hasHead
  )
}
