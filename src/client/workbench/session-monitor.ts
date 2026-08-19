/**
 * 全局会话监控 · 纯逻辑层（无 React、无 DOM，可单测）
 *
 * 数据来源：shell 标准 props 的 useSessions / useWorkspaces 快照选择器 hook（实时推送，无需轮询）。
 * 会话状态语义复用侧边栏：
 *   running             → 运行中
 *   completed           → 完成但未选择未打开（侧边栏绿色"完成"提醒）＝完成未查看
 *   pendingInteraction  → 等待用户交互（approval 审批 / plan-review 方案确认 / question 提问）
 *
 * 顶层会话 = 无 parentId 且非 subagent 子项（子任务不重复计入徽标）。
 * 已归档会话（host workspace.archiveSession 归档集）不进入任何分组与计数——与官方分组表面一致。
 * 未读判定：会话在非当前查看期间完成即记为"完成待查看"，直到打开该会话或显式标为已读。
 * "已读"记认与提示音开关均为页面会话期内存态（刷新重置，与悬浮球行为一致）。
 */

export interface SessionRowLike {
  id: string
  title?: string
  displayTitle: string
  cwd?: string
  parentId?: string
  origin?: 'subagent'
  running: boolean
  pendingInteraction?: string
  completed?: boolean
  blank: boolean
  updatedAt: number
  /** Host 计算的会话投影值（随列表实时推送）：sessionStats 提供整日志轮次/步数。 */
  projectionValues?: {
    sessionStats?: {
      turns?: number
      steps?: number
      llmMs?: number
      toolMs?: number
      ttftMs?: number
      ttftSteps?: number
      decodeMs?: number
      decodeTokens?: number
    }
  }
}

export interface SessionListLike {
  ids?: string[]
  byId?: Record<string, SessionRowLike>
  current?: string
  phase?: string
}

export interface WorkspaceItemLike {
  workspaceId: string
  path: string
  title: string
  sessionIds: string[]
}

export interface WorkspaceListLike {
  items?: WorkspaceItemLike[]
  recentWorkspaceId?: string
  /**
   * registry-global archive set（host `workspace.archiveSession`）：
   * 已归档会话从所有分组表面消失，但保留会话日志与工作区账目槽位。
   * 官方分组 UI（WorkspaceBrowser）以该集合过滤，本监控须保持一致。
   */
  archivedSessionIds?: string[]
}

export interface SessionGroups {
  /** 顶层会话总数（不含 subagent 子任务）。 */
  total: number
  running: SessionRowLike[]
  /** 完成且未查看（未读），按列表顺序。 */
  completed: SessionRowLike[]
  /** 等待交互（审批 / 方案确认 / 提问），不含当前会话。 */
  pending: SessionRowLike[]
  /** pending + completed —— 标签角标与提示音的依据。 */
  attention: SessionRowLike[]
  /** 其余会话，按 updatedAt 时间倒序。 */
  others: SessionRowLike[]
  current: string | undefined
}

/** 未读 = 完成且未查看：壳层 completed（运行时维护，打开会话即清除）+ 插件持久化记认（跨页面会话）双重来源，本地 ack 只记显式记认。 */
export function isUnread(
  s: SessionRowLike,
  current: string | undefined,
  acked: ReadonlySet<string>,
): boolean {
  return (s.completed === true || isPersistedUnread(s.id)) && s.id !== current && !acked.has(s.id)
}

function topRows(list: SessionListLike, archived?: ReadonlySet<string>): SessionRowLike[] {
  const rows = (list.ids ?? [])
    .map((id) => list.byId?.[id])
    .filter((s): s is SessionRowLike => s !== undefined && !s.blank)
  return rows.filter(
    (s) => !s.parentId && s.origin !== 'subagent' && (archived === undefined || !archived.has(s.id)),
  )
}

/** 运行中顶层会话数（标签暖色角标用）。 */
export function countRunning(list: SessionListLike, archived?: ReadonlySet<string>): number {
  let n = 0
  for (const s of topRows(list, archived)) {
    if (s.running) n += 1
  }
  return n
}

/** 需要注意的顶层会话数（标签红色角标与提示音用），已读不重复计数。 */
export function countAttention(
  list: SessionListLike,
  acked: ReadonlySet<string>,
  archived?: ReadonlySet<string>,
): number {
  let n = 0
  for (const s of topRows(list, archived)) {
    if (s.id === list.current) continue
    if (s.pendingInteraction !== undefined || isUnread(s, list.current, acked)) n += 1
  }
  return n
}

export function groupSessions(
  list: SessionListLike,
  acked: ReadonlySet<string>,
  archived?: ReadonlySet<string>,
): SessionGroups {
  const current = list.current
  const top = topRows(list, archived)
  const running = top.filter((s) => s.running)
  const completed = top.filter((s) => isUnread(s, current, acked))
  const pending = top.filter((s) => s.pendingInteraction !== undefined && s.id !== current)
  const attention = pending.concat(completed)
  const others = top
    .filter((s) => !s.running && s.pendingInteraction === undefined && !isUnread(s, current, acked))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  return { total: top.length, running, completed, pending, attention, others, current }
}

/** pendingInteraction 状态 → 展示文案的 locale key。 */
export function pendingLabelKey(status: string | undefined): string {
  if (status === 'approval') return 'sessions.pending.approval'
  if (status === 'plan-review') return 'sessions.pending.planReview'
  return 'sessions.pending.question'
}

/**
 * 会话轮次/步数（host `sessionStats` 投影，随列表实时推送）。
 * turns 至少含一个已关闭 step 的轮次；steps 为已关闭 step 数（完成/失败/取消均计）。
 * 二者均为 0（新会话/无投影单元）时返回 null，调用方不展示。
 */
export function sessionStatsOf(
  s: SessionRowLike,
): { turns: number; steps: number } | null {
  const stats = s.projectionValues?.sessionStats
  const steps = typeof stats?.steps === 'number' && Number.isFinite(stats.steps) ? stats.steps : 0
  const turns = typeof stats?.turns === 'number' && Number.isFinite(stats.turns) ? stats.turns : 0
  if (steps <= 0) return null
  return { turns, steps }
}

export type RelativeTime =
  | { kind: 'key'; key: string; vars?: Record<string, string | number> }
  | { kind: 'date'; text: string }

/** 相对时间：<2min 刚刚；<1h N 分钟前；<24h N 小时前；更早返回本地日期。 */
export function relativeTime(ts: number | undefined, now: number): RelativeTime | null {
  if (ts === undefined || ts <= 0) return null
  const d = Math.max(0, now - ts)
  if (d < 120000) return { kind: 'key', key: 'sessions.justNow' }
  const m = Math.floor(d / 60000)
  if (m < 60) return { kind: 'key', key: 'sessions.minutesAgo', vars: { n: m } }
  const h = Math.floor(m / 60)
  if (h < 24) return { kind: 'key', key: 'sessions.hoursAgo', vars: { n: h } }
  return { kind: 'date', text: new Date(ts).toLocaleDateString() }
}

/** 归属项目解析（三级来源，与悬浮球一致）：① 工作区 sessionIds 权威账目 → 工作区 title；② cwd 与工作区 path 精确/最长前缀匹配；③ cwd 目录名兜底。 */
export function projectOf(s: SessionRowLike, wsItems: readonly WorkspaceItemLike[]): string {
  const wsBySession: Record<string, string> = {}
  const wsByPath: Record<string, string> = {}
  for (const ws of wsItems) {
    for (const sid of ws.sessionIds ?? []) wsBySession[sid] = ws.title
    if (ws.path) wsByPath[ws.path] = ws.title
  }
  if (wsBySession[s.id] !== undefined) return wsBySession[s.id]
  if (s.cwd !== undefined && s.cwd !== '') {
    if (wsByPath[s.cwd] !== undefined) return wsByPath[s.cwd]
    const cwd = s.cwd.endsWith('/') ? s.cwd : s.cwd + '/'
    let best = ''
    for (const p of Object.keys(wsByPath)) {
      const prefix = p.endsWith('/') ? p : p + '/'
      if (cwd.startsWith(prefix) && p.length > best.length) best = p
    }
    if (best !== '') return wsByPath[best]
    const base = s.cwd.replace(/[/\\]+$/, '').split(/[/\\]/).pop()
    if (base !== undefined && base !== '') return base
  }
  return ''
}

// —— 持久化"完成未查看"提醒（跨页面会话，满足全局语义）——
//
// 壳层 dsh 的 completed 提醒是页面会话期内存态：刷新/重开页面后，已 idle 会话的
// 完成提醒不会重新武装，导致"实际需要被注意但列表不显示"。插件在 localStorage 持久化
// 自己的完成记认，来源有二：
//   ① running→idle 边沿（prevRunning 落盘，跨页面会话也能检测到：上页运行 → 本页 idle）；
//   ② 壳层 completed 出现（本页武装）时兜底记入，防后续刷新丢失。
// 清除时机：会话再次运行、会话成为当前（被查看）、显式标为已读、会话从列表消失。

const ATTENTION_PERSIST_KEY = 'dsh-workbench-attention-persist-v1'

interface PersistedAttention {
  /** 上次观察到的 running 位（跨页面会话检测完成边沿）。 */
  prevRunning: Record<string, boolean>
  /** 完成未查看：sessionId -> 完成时间戳。 */
  completedUnread: Record<string, number>
}

function loadPersistedAttention(): PersistedAttention {
  try {
    if (typeof localStorage === 'undefined') return { prevRunning: {}, completedUnread: {} }
    const raw = localStorage.getItem(ATTENTION_PERSIST_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<PersistedAttention>
      return {
        prevRunning: parsed.prevRunning ?? {},
        completedUnread: parsed.completedUnread ?? {},
      }
    }
  } catch { /* 存储不可用：静默降级为会话内态 */ }
  return { prevRunning: {}, completedUnread: {} }
}

function savePersistedAttention(): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(ATTENTION_PERSIST_KEY, JSON.stringify(persistedAttention))
  } catch { /* 存储不可用：静默降级 */ }
}

let persistedAttention = loadPersistedAttention()
let persistVersion = 0
const persistListeners = new Set<() => void>()

function bumpPersist(): void {
  persistVersion += 1
  for (const fn of persistListeners) fn()
}

/** 持久化记认版本订阅（React useSyncExternalStore 用）。 */
export function subscribePersist(fn: () => void): () => void {
  persistListeners.add(fn)
  return () => { persistListeners.delete(fn) }
}

export function getPersistVersion(): number {
  return persistVersion
}

/** 持久化记认的完成未查看是否包含该会话。 */
export function isPersistedUnread(id: string): boolean {
  return persistedAttention.completedUnread[id] !== undefined
}

/** 测试辅助：清空持久化提醒状态（含 localStorage）。 */
export function resetPersistedAttention(): void {
  persistedAttention = { prevRunning: {}, completedUnread: {} }
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(ATTENTION_PERSIST_KEY)
  } catch { /* ignore */ }
  bumpPersist()
}

/**
 * 从最新列表快照协调持久化提醒状态（挂在始终渲染的 WorkbenchInner 上调用）。
 * ① running→idle 边沿（含跨页面会话）且非当前会话 → 记完成未查看；
 * ② 壳层 completed 出现 → 记入持久化兜底；
 * ③ 当前会话（被查看）→ 清除；再次运行 → 清除；会话消失 → 清理残留。
 */
export function reconcilePersistedAttention(list: SessionListLike, archived?: ReadonlySet<string>): void {
  const current = list.current
  const prev = persistedAttention.prevRunning
  const unread = persistedAttention.completedUnread
  let changed = false
  const seen = new Set<string>()
  for (const s of topRows(list, archived)) {
    seen.add(s.id)
    const wasRunning = prev[s.id]
    if (wasRunning === true && !s.running) {
      // 完成边沿（上页运行 / 本页刚停）→ 记完成未查看
      if (s.id !== current && unread[s.id] === undefined) {
        unread[s.id] = Date.now()
        changed = true
      }
    } else if (s.running) {
      if (unread[s.id] !== undefined) {
        delete unread[s.id]
        changed = true
      }
    }
    if (s.completed === true && unread[s.id] === undefined) {
      // 壳层本页武装的 completed → 持久化兜底，防后续刷新丢失
      unread[s.id] = Date.now()
      changed = true
    }
    if (s.id === current && unread[s.id] !== undefined) {
      // 当前会话 = 正在查看 → 消费完成提醒（与壳层 select 即清除语义一致）
      delete unread[s.id]
      changed = true
    }
    if (prev[s.id] !== s.running) {
      prev[s.id] = s.running
      changed = true
    }
  }
  for (const id of Object.keys(prev)) {
    if (!seen.has(id)) {
      delete prev[id]
      changed = true
    }
  }
  for (const id of Object.keys(unread)) {
    if (!seen.has(id)) {
      delete unread[id]
      changed = true
    }
  }
  if (changed) {
    savePersistedAttention()
    bumpPersist()
  }
}

// —— 页面会话期共享状态（刷新后重置，与悬浮球的内存态一致）——

let ackVersion = 0
const ackIds = new Set<string>()
const ackListeners = new Set<() => void>()

function bumpAck(): void {
  ackVersion += 1
  for (const fn of ackListeners) fn()
}

/** 已读记认变化订阅（React useSyncExternalStore 用）。 */
export function subscribeAck(fn: () => void): () => void {
  ackListeners.add(fn)
  return () => { ackListeners.delete(fn) }
}

export function getAckVersion(): number {
  return ackVersion
}

/** 当前已读记认的只读视图（渲染期间读取；配合 getAckVersion 订阅使用）。 */
export function ackSnapshot(): ReadonlySet<string> {
  return ackIds
}

export function isAcked(id: string): boolean {
  return ackIds.has(id)
}

export function ackSession(id: string): void {
  if (ackIds.has(id) && persistedAttention.completedUnread[id] === undefined) return
  ackIds.add(id)
  if (persistedAttention.completedUnread[id] !== undefined) {
    delete persistedAttention.completedUnread[id]
    savePersistedAttention()
  }
  bumpAck()
}

export function ackMany(ids: Iterable<string>): void {
  let changed = false
  for (const id of ids) {
    if (!ackIds.has(id)) {
      ackIds.add(id)
      changed = true
    }
    if (persistedAttention.completedUnread[id] !== undefined) {
      delete persistedAttention.completedUnread[id]
      changed = true
    }
  }
  if (changed) {
    savePersistedAttention()
    bumpAck()
  }
}

/** 测试辅助：清空页面会话期的已读记认。 */
export function resetAckStore(): void {
  ackIds.clear()
  bumpAck()
}

let beepOn = true
const beepListeners = new Set<(on: boolean) => void>()

export function getBeepOn(): boolean {
  return beepOn
}

/** 提示音开关：面板 🔔 按钮与工作台提示音效果共享同一状态（页面会话期内有效）。 */
export function setBeepOn(on: boolean): void {
  beepOn = on
  for (const fn of beepListeners) fn(on)
}

export function subscribeBeep(fn: (on: boolean) => void): () => void {
  beepListeners.add(fn)
  return () => { beepListeners.delete(fn) }
}

/** 测试辅助：恢复提示音默认开启。 */
export function resetBeepStore(): void {
  setBeepOn(true)
}
