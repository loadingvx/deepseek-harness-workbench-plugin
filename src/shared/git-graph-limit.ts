/** GRAPH / git log 一次最多取多少条提交。 */

export const GRAPH_LIMIT_DEFAULT = 256
export const GRAPH_LIMIT_MIN = 20
export const GRAPH_LIMIT_MAX = 2000
export const GRAPH_LIMIT_KEY = 'dsh-workbench-graph-limit'
export const GRAPH_LIMIT_PRESETS = [80, 256, 500, 1000] as const

export type GraphLimitParseFail = 'empty' | 'invalid' | 'low' | 'high'

/** Host / 对话工具：1…MAX。测试里 `git.log(root, 5)` 仍然有效。 */
export function clampGitLogLimit(raw: number): number {
  if (!Number.isFinite(raw)) return GRAPH_LIMIT_DEFAULT
  return Math.min(GRAPH_LIMIT_MAX, Math.max(1, Math.floor(raw)))
}

/** 设置弹窗：只接受 20…2000 的整数。 */
export function parseGraphLimitInput(raw: string):
  { ok: true; value: number } | { ok: false; error: GraphLimitParseFail } {
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: false, error: 'empty' }
  if (!/^\d+$/.test(trimmed)) return { ok: false, error: 'invalid' }
  const value = Number(trimmed)
  if (value < GRAPH_LIMIT_MIN) return { ok: false, error: 'low' }
  if (value > GRAPH_LIMIT_MAX) return { ok: false, error: 'high' }
  return { ok: true, value }
}

/** `/git/log?limit=`：缺省 256；非法或越界返回 null，由接口给出可读错误。 */
export function parseHttpLogLimit(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return GRAPH_LIMIT_DEFAULT
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  if (value < 1 || value > GRAPH_LIMIT_MAX) return null
  return value
}

export function readGraphLimit(): number {
  try {
    const raw = localStorage.getItem(GRAPH_LIMIT_KEY)
    if (raw === null || raw.trim() === '') return GRAPH_LIMIT_DEFAULT
    const parsed = parseGraphLimitInput(raw)
    if (parsed.ok) return parsed.value
    const n = Number(raw)
    if (Number.isFinite(n)) {
      return Math.min(GRAPH_LIMIT_MAX, Math.max(GRAPH_LIMIT_MIN, Math.floor(n)))
    }
  } catch { /* private mode */ }
  return GRAPH_LIMIT_DEFAULT
}

export function writeGraphLimit(value: number): number {
  const next = Math.min(GRAPH_LIMIT_MAX, Math.max(GRAPH_LIMIT_MIN, Math.floor(value)))
  try { localStorage.setItem(GRAPH_LIMIT_KEY, String(next)) } catch { /* quota */ }
  return next
}
