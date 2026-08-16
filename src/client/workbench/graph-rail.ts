import { LANE_COL_W, type GraphLaneRow } from './graph-lanes.ts'

/**
 * Collapsed GRAPH row — must match `.graphBody` + subject + meta in GitSidebar.module.css:
 * 4 padding-top + 16 subject + 2 gap + 16 meta + 8 padding-bottom.
 */
export const GRAPH_ROW_H = 46
/** Compact: 2 padding-top + 16 subject + 2 padding-bottom. */
export const GRAPH_ROW_H_COMPACT = 20
/** Node sits on the subject midline: padding-top 4 + subject 16 / 2. */
export const GRAPH_NODE_CY = 12
/** Compact: padding-top 2 + subject 16 / 2. */
export const GRAPH_NODE_CY_COMPACT = 10
export const GRAPH_NODE_R = 4
export const GRAPH_NODE_R_COMPACT = 3.5
/** Overlap adjacent rows so a 1px hairline does not appear at the seam. */
export const GRAPH_SEAM_PAD = 0.5

export interface GraphRailMetrics {
  cy: number
  r: number
  rowH: number
}

export function graphRailMetrics(compact: boolean): GraphRailMetrics {
  return compact
    ? { cy: GRAPH_NODE_CY_COMPACT, r: GRAPH_NODE_R_COMPACT, rowH: GRAPH_ROW_H_COMPACT }
    : { cy: GRAPH_NODE_CY, r: GRAPH_NODE_R, rowH: GRAPH_ROW_H }
}

export function laneX(index: number): number {
  return index * LANE_COL_W + LANE_COL_W / 2
}

export interface GraphRailStroke {
  key: string
  d: string
  lane: number
}

export interface GraphRailDraw {
  width: number
  height: number
  strokes: GraphRailStroke[]
  dot: { x: number; y: number; r: number; lane: number }
}

export function buildGraphRailDraw(
  row: GraphLaneRow,
  lanes: number,
  opts: { height: number; compact: boolean; isLast: boolean },
): GraphRailDraw {
  const { cy, r } = graphRailMetrics(opts.compact)
  const height = Math.max(opts.height, cy + r + 1)
  const width = Math.max(1, lanes) * LANE_COL_W
  const drawDown = !opts.isLast
  const top = -GRAPH_SEAM_PAD
  const bottom = height + GRAPH_SEAM_PAD
  const strokes: GraphRailStroke[] = []

  for (const index of row.passing) {
    strokes.push({
      key: `pass-${index}`,
      d: `M ${laneX(index)} ${top} V ${drawDown ? bottom : cy}`,
      lane: index,
    })
  }
  if (row.fromAbove) {
    strokes.push({
      key: `up-${row.lane}`,
      d: `M ${laneX(row.lane)} ${top} V ${cy}`,
      lane: row.lane,
    })
  }
  for (const index of row.incoming) {
    strokes.push({
      key: `in-${index}`,
      d: bend(laneX(index), 0, laneX(row.lane), cy),
      lane: index,
    })
  }
  if (drawDown) {
    for (const [edgeIndex, edge] of row.outgoing.entries()) {
      strokes.push({
        key: `out-${edgeIndex}`,
        d: edge.from === edge.to
          ? `M ${laneX(edge.from)} ${cy} V ${bottom}`
          : bend(laneX(edge.from), cy, laneX(edge.to), bottom),
        lane: edge.to,
      })
    }
  }

  return {
    width,
    height,
    strokes,
    dot: { x: laneX(row.lane), y: cy, r, lane: row.lane },
  }
}

export function bend(x1: number, y1: number, x2: number, y2: number): string {
  const midY = (y1 + y2) / 2
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`
}
