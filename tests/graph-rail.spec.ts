import { describe, expect, it } from 'vitest'
import { layoutGraphLanes } from '../src/client/workbench/graph-lanes.ts'
import {
  buildGraphRailDraw, GRAPH_NODE_CY, GRAPH_NODE_CY_COMPACT, GRAPH_ROW_H, GRAPH_ROW_H_COMPACT,
  GRAPH_SEAM_PAD, graphRailMetrics, laneX,
} from '../src/client/workbench/graph-rail.ts'

describe('graphRailMetrics', () => {
  it('pins the node to the subject midline of the locked row', () => {
    expect(graphRailMetrics(false)).toMatchObject({ cy: GRAPH_NODE_CY, rowH: GRAPH_ROW_H })
    expect(graphRailMetrics(true)).toMatchObject({ cy: GRAPH_NODE_CY_COMPACT, rowH: GRAPH_ROW_H_COMPACT })
    expect(GRAPH_NODE_CY).toBe(4 + 16 / 2)
    expect(GRAPH_NODE_CY_COMPACT).toBe(2 + 16 / 2)
    expect(GRAPH_ROW_H).toBe(4 + 16 + 2 + 16 + 8)
    expect(GRAPH_ROW_H_COMPACT).toBe(2 + 16 + 2)
  })
})

describe('buildGraphRailDraw', () => {
  const linear = layoutGraphLanes([
    { hash: 'c3', parents: ['c2'] },
    { hash: 'c2', parents: ['c1'] },
    { hash: 'c1', parents: [] },
  ])

  it('fills the gap above each continued node so adjacent 46px rows meet', () => {
    const upper = buildGraphRailDraw(linear[0]!, 1, { height: GRAPH_ROW_H, compact: false, isLast: false })
    const lower = buildGraphRailDraw(linear[1]!, 1, { height: GRAPH_ROW_H, compact: false, isLast: false })
    const x = laneX(0)
    expect(upper.dot).toMatchObject({ x, y: GRAPH_NODE_CY })
    expect(upper.strokes.some(stroke => stroke.d === `M ${x} ${GRAPH_NODE_CY} V ${GRAPH_ROW_H + GRAPH_SEAM_PAD}`)).toBe(true)
    expect(lower.strokes.some(stroke => stroke.d === `M ${x} ${-GRAPH_SEAM_PAD} V ${GRAPH_NODE_CY}`)).toBe(true)
    expect(lower.strokes.some(stroke => stroke.d === `M ${x} ${GRAPH_NODE_CY} V ${GRAPH_ROW_H + GRAPH_SEAM_PAD}`)).toBe(true)
  })

  it('still meets at the seam when the upper row is expanded', () => {
    const expanded = 180
    const upper = buildGraphRailDraw(linear[0]!, 1, { height: expanded, compact: false, isLast: false })
    const lower = buildGraphRailDraw(linear[1]!, 1, { height: GRAPH_ROW_H, compact: false, isLast: true })
    const x = laneX(0)
    expect(upper.strokes.some(stroke => stroke.d === `M ${x} ${GRAPH_NODE_CY} V ${expanded + GRAPH_SEAM_PAD}`)).toBe(true)
    expect(lower.strokes.some(stroke => stroke.d === `M ${x} ${-GRAPH_SEAM_PAD} V ${GRAPH_NODE_CY}`)).toBe(true)
    expect(lower.strokes.every(stroke => !stroke.d.includes(`V ${GRAPH_ROW_H + GRAPH_SEAM_PAD}`))).toBe(true)
  })

  it('does not draw a stem above a new branch tip', () => {
    const rows = layoutGraphLanes([
      { hash: 'local', parents: ['base'] },
      { hash: 'remote', parents: ['base'] },
      { hash: 'base', parents: [] },
    ])
    expect(rows[1]?.fromAbove).toBe(false)
    const draw = buildGraphRailDraw(rows[1]!, 2, { height: GRAPH_ROW_H, compact: false, isLast: false })
    expect(draw.strokes.some(stroke => stroke.key === `up-${rows[1]!.lane}`)).toBe(false)
    expect(draw.strokes.some(stroke => stroke.key === 'pass-0')).toBe(true)
  })
})
