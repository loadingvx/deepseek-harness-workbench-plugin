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
  /** Columns this row must reserve so rails line up. */
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
 */
export function layoutGraphLanes(commits: readonly GraphNode[]): GraphLaneRow[] {
  const rows: GraphLaneRow[] = []
  let open: (string | null)[] = []

  for (const commit of commits) {
    let lane = open.indexOf(commit.hash)
    const fromAbove = lane !== -1
    if (lane === -1) {
      lane = firstEmpty(open)
      if (lane === -1) {
        open.push(commit.hash)
        lane = open.length - 1
      } else {
        open[lane] = commit.hash
      }
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
      const existing = next.indexOf(parent)
      if (existing !== -1) {
        outgoing.push({ from: lane, to: existing })
        continue
      }
      if (index === 0) {
        next[lane] = parent
        outgoing.push({ from: lane, to: lane })
        continue
      }
      const slot = firstEmpty(next)
      if (slot === -1) {
        next.push(parent)
        outgoing.push({ from: lane, to: next.length - 1 })
      } else {
        next[slot] = parent
        outgoing.push({ from: lane, to: slot })
      }
    }

    while (next.length > 0 && next[next.length - 1] === null) next.pop()
    const laneCount = Math.max(next.length, open.length, lane + 1, 1)
    rows.push({ lane, laneCount, fromAbove, passing, incoming, outgoing })
    open = next
  }

  return rows
}

function firstEmpty(lanes: readonly (string | null)[]): number {
  return lanes.findIndex(hash => hash === null)
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
