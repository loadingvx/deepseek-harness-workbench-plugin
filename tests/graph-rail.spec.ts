import { describe, expect, it } from 'vitest'
import { LANE_COL_W, layoutGraphLanes } from '../src/client/workbench/graph-lanes.ts'
import {
  branchOff, branchRightAt, buildGraphRailDraw, fishboneRib, GRAPH_CURVE_R, GRAPH_NODE_CY, GRAPH_NODE_CY_COMPACT,
  GRAPH_ROW_H, GRAPH_ROW_H_COMPACT, GRAPH_SEAM_PAD, graphRailMetrics, joinIn, laneX,
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

  it('sizes each row to its own lanes so commit titles indent with the graph', () => {
    const rows = layoutGraphLanes([
      { hash: 'head', parents: ['base'] },
      { hash: 'side', parents: ['base'] },
      { hash: 'base', parents: [] },
    ], { headHash: 'head' })
    const head = buildGraphRailDraw(rows[0]!, rows[0]!.laneCount, { height: GRAPH_ROW_H, compact: false, isLast: false })
    const side = buildGraphRailDraw(rows[1]!, rows[1]!.laneCount, { height: GRAPH_ROW_H, compact: false, isLast: false })
    expect(head.width).toBe(LANE_COL_W)
    expect(side.width).toBeGreaterThan(head.width)
    expect(side.dot.x).toBeGreaterThan(head.dot.x)
  })

  it('peels a merge parent off with a rounded elbow instead of a stretched S-curve', () => {
    const rows = layoutGraphLanes([
      { hash: 'merge', parents: ['left', 'right'] },
      { hash: 'left', parents: ['base'] },
      { hash: 'right', parents: ['base'] },
      { hash: 'base', parents: [] },
    ])
    const merge = buildGraphRailDraw(rows[0]!, rows[0]!.laneCount, { height: GRAPH_ROW_H, compact: false, isLast: false })
    const fork = merge.strokes.find(stroke => stroke.key === 'out-1')
    expect(fork?.d).toBe(branchOff(laneX(0), GRAPH_NODE_CY, laneX(1), GRAPH_ROW_H + GRAPH_SEAM_PAD))
    expect(fork?.d.includes(' C ')).toBe(false)
    expect(fork?.d.includes(' A ')).toBe(true)

    const join = buildGraphRailDraw(rows[3]!, rows[3]!.laneCount, { height: GRAPH_ROW_H, compact: false, isLast: true })
    const incoming = join.strokes.find(stroke => stroke.key === 'in-1')
    expect(incoming?.d).toBe(joinIn(laneX(1), -GRAPH_SEAM_PAD, laneX(0), GRAPH_NODE_CY))
  })
})

describe('branch elbows', () => {
  it('turns right then down from the node', () => {
    const d = branchOff(6, 12, 18, 46)
    expect(d.startsWith('M 6 12 H ')).toBe(true)
    expect(d.includes(`A ${GRAPH_CURVE_R} ${GRAPH_CURVE_R}`)).toBe(true)
    expect(d.endsWith('V 46')).toBe(true)
  })

  it('comes down then turns into the node', () => {
    const d = joinIn(18, -0.5, 6, 12)
    expect(d.startsWith('M 18 -0.5 V ')).toBe(true)
    expect(d.endsWith('H 6')).toBe(true)
  })

  it('branches right at row center with joinIn-style elbow', () => {
    const d = branchRightAt(10, 20, 30)
    expect(d.startsWith('M 10 10 V ')).toBe(true)
    expect(d.includes(' A ')).toBe(true)
    expect(d.endsWith('H 30')).toBe(true)
  })

  it('fishbone rib stays horizontal with rounded outer elbow', () => {
    const d = fishboneRib(10, 20, 30)
    expect(d.startsWith('M 10 20 H ')).toBe(true)
    expect(d.includes(' A ')).toBe(true)
    expect(d.includes(' V ')).toBe(false)
  })
})
