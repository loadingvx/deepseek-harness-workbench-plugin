/** Newest-first commit used by the GRAPH rail. */
export interface GraphNode {
  hash: string
  parents: string[]
}

export interface GraphLaneEdge {
  from: number
  to: number
}

export interface GraphLaneRow {
  /** Column of this commit's node. */
  lane: number
  /** Columns this row must reserve so the title sits just after the rails. */
  laneCount: number
  /** A parent above already reserved this commit — draw a stem from the row top to the node. */
  fromAbove: boolean
  /** Open lanes that pass through without a node. */
  passing: number[]
  /** Other lanes that also pointed at this commit (join in from above). */
  incoming: number[]
  /** Lines from this node down toward its parents. */
  outgoing: GraphLaneEdge[]
}

export interface GraphLaneOptions {
  /** HEAD commit — its first-parent chain stays on lane 0 as a straight line. */
  headHash?: string
}

export const LANE_COLORS = ['#3b82f6', '#a855f7', '#f59e0b', '#10b981', '#06b6d4', '#f43f5e'] as const
export const LANE_COL_W = 12

export function laneColor(index: number): string {
  const safe = ((index % LANE_COLORS.length) + LANE_COLORS.length) % LANE_COLORS.length
  return LANE_COLORS[safe] ?? LANE_COLORS[0]
}

/**
 * Host 新版本带 parents；旧进程没有时按列表顺序当成一条直线，避免每条都新开泳道。
 */
export function graphNodesFromEntries(entries: ReadonlyArray<{ hash: string; parents?: string[] }>): GraphNode[] {
  const typed = entries.some(entry => Array.isArray(entry.parents) && entry.parents.length > 0)
  return entries.map((entry, index) => ({
    hash: entry.hash,
    parents: typed
      ? unique((entry.parents ?? []).filter(Boolean))
      : (entries[index + 1] !== undefined ? [entries[index + 1]!.hash] : []),
  }))
}

/**
 * Assign swimlanes for a newest-first topo log (same order as `git log --topo-order`).
 *
 * Classic git-graph rules:
 * - HEAD 的第一父链固定在第 0 列，画成直线
 * - 其余分支只往右侧开新列，在汇合处拐回来
 * - 第一父提交继续走当前列，不把当前分支拐去别人已经占的列
 */
export function layoutGraphLanes(commits: readonly GraphNode[], opts?: GraphLaneOptions): GraphLaneRow[] {
  const currentLine = firstParentLine(commits, opts?.headHash)
  const rows: GraphLaneRow[] = []
  let open: (string | null)[] = []

  for (let commitIndex = 0; commitIndex < commits.length; commitIndex++) {
    const commit = commits[commitIndex]!
    const isCurrent = currentLine.has(commit.hash)
    const reserveLeft = currentLine.size > 0 && commits.slice(commitIndex).some(item => currentLine.has(item.hash))

    let lane = open.indexOf(commit.hash)
    let fromAbove = lane !== -1
    if (isCurrent) {
      const wasOnZero = lane === 0
      if (lane !== 0) {
        while (open.length < 1) open.push(null)
        open[0] = commit.hash
        lane = 0
        fromAbove = wasOnZero
      }
    } else if (lane === -1) {
      lane = allocLane(open, reserveLeft ? 1 : 0)
      open[lane] = commit.hash
    }

    const incoming = open
      .map((hash, index) => hash === commit.hash && index !== lane ? index : -1)
      .filter(index => index >= 0)
    const passing = open
      .map((hash, index) => hash !== null && hash !== commit.hash ? index : -1)
      .filter(index => index >= 0)

    const next = open.map(hash => hash === commit.hash ? null : hash)
    const outgoing: GraphLaneEdge[] = []
    const parents = unique(commit.parents.filter(hash => hash.length > 0))

    for (const [index, parent] of parents.entries()) {
      if (index === 0) {
        while (next.length <= lane) next.push(null)
        next[lane] = parent
        outgoing.push({ from: lane, to: lane })
        continue
      }
      const existing = next.indexOf(parent)
      if (existing !== -1) {
        outgoing.push({ from: lane, to: existing })
        continue
      }
      const slot = allocLane(next, lane + 1)
      next[slot] = parent
      outgoing.push({ from: lane, to: slot })
    }

    while (next.length > 0 && next[next.length - 1] === null) next.pop()
    const laneCount = Math.max(next.length, open.length, lane + 1, 1)
    rows.push({ lane, laneCount, fromAbove, passing, incoming, outgoing })
    open = next
  }

  return rows
}

function firstParentLine(commits: readonly GraphNode[], headHash?: string): Set<string> {
  const line = new Set<string>()
  if (headHash === undefined || headHash === '') return line
  const byHash = new Map(commits.map(commit => [commit.hash, commit] as const))
  let current: string | undefined = headHash
  while (current !== undefined && byHash.has(current) && !line.has(current)) {
    line.add(current)
    current = byHash.get(current)?.parents[0]
  }
  return line
}

function allocLane(lanes: (string | null)[], minIndex: number): number {
  const start = Math.max(0, minIndex)
  while (lanes.length < start) lanes.push(null)
  for (let index = start; index < lanes.length; index++) {
    if (lanes[index] === null) return index
  }
  lanes.push(null)
  return lanes.length - 1
}

function unique(items: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}
