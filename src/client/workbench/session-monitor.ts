/**
 * 会话提醒 · 纯逻辑层（无 React、无 DOM，可单测）
 *
 * 数据来源：shell 标准 props 的 useSessions / useWorkspaces 快照选择器 hook（实时推送，无需轮询）。
 * 会话状态语义复用侧边栏：
 *   running             → 运行中
 *   completed           → 完成但未选择未打开（侧边栏绿色"完成"提醒）＝完成未查看
 *   pendingInteraction  → 等待用户交互（approval 审批 / plan-review 方案确认 / question 提问）
 *
 * 顶层会话 = 无 parentId 且非 subagent 子项（子任务不重复计入）。
 * 已归档会话（host workspace.archiveSession 归档集）不进入计数——与官方分组表面一致。
 * 未读判定：会话在非当前查看期间完成即记为"完成待查看"，直到打开该会话或显式标为已读。
 * "已读"记认与提示音开关均为页面会话期内存态（刷新重置）。
 *
 * 面板改造后只保留计数与开关：需要你注意 / 运行中列表已删除，整体提示信息交由原生左侧
 * 会话列表的状态点机制承担；此处仅驱动提示音与标签角标计数。
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
}

export interface SessionListLike {
  ids?: string[]
  byId?: Record<string, SessionRowLike>
  current?: string
  phase?: string
}

export interface WorkspaceListLike {
  items?: {
    workspaceId: string
    path: string
    title: string
    sessionIds: string[]
  }[]
  recentWorkspaceId?: string
  /**
   * registry-global archive set（host `workspace.archiveSession`）：
   * 已归档会话从所有分组表面消失，但保留会话日志与工作区账目槽位。
   * 官方分组 UI（WorkspaceBrowser）以该集合过滤，本监控须保持一致。
   */
  archivedSessionIds?: string[]
}

/** 未读 = 完成且未查看：completed 事实由运行时维护（打开会话即清除），本地 ack 只记显式记认。 */
export function isUnread(
  s: SessionRowLike,
  current: string | undefined,
  acked: ReadonlySet<string>,
): boolean {
  return s.completed === true && s.id !== current && !acked.has(s.id)
}

function topRows(list: SessionListLike, archived?: ReadonlySet<string>): SessionRowLike[] {
  const rows = (list.ids ?? [])
    .map((id) => list.byId?.[id])
    .filter((s): s is SessionRowLike => s !== undefined && !s.blank)
  return rows.filter(
    (s) => !s.parentId && s.origin !== 'subagent' && (archived === undefined || !archived.has(s.id)),
  )
}

/** 运行中顶层会话数。 */
export function countRunning(list: SessionListLike, archived?: ReadonlySet<string>): number {
  let n = 0
  for (const s of topRows(list, archived)) {
    if (s.running) n += 1
  }
  return n
}

/** 需要注意的顶层会话数（提示音与标签角标用），已读不重复计数。 */
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

/** 提示音开关：设置面板 🔔 按钮与工作台提示音效果共享同一状态（页面会话期内有效）。 */
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

