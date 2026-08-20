/**
 * Left-to-right agent structure: main Agent on the left, then fork right with
 * up/down branches. Strokes use git-graph curve style; junction dots mark forks.
 */
import type { ControlPlaneNode } from '../../shared/control-plane.ts'
import { GRAPH_CURVE_R } from './graph-rail.ts'
import { laneColor } from './graph-lanes.ts'

const RAIL = new Set([
  'agent', 'subagent', 'llm', 'tools', 'prompt', 'memory', 'inbox', 'ambient',
])

const CAP_ORDER: Record<string, number> = {
  llm: 0,
  tools: 1,
  prompt: 2,
  memory: 3,
  inbox: 4,
}

export const NODE_W = 108
export const NODE_H = 34
export const AGENT_W = 132
export const AGENT_H = 40
/** Agent right edge → vertical fork rail. */
export const STEM = 36
/** Vertical rail → child left edge. */
export const BRANCH = 40
export const V_GAP = 18
export const CLUSTER_GAP = 64
export const PAD = 36
export const JUNCTION_R = 4

export interface TopoNodeBox {
  id: string
  node: ControlPlaneNode
  x: number
  y: number
  w: number
  h: number
}

export interface TopoEdge {
  id: string
  from: string
  to: string
  d: string
  colorIndex: number
}

export interface TopoJunction {
  id: string
  x: number
  y: number
  colorIndex: number
}

export interface TopoLayout {
  nodes: TopoNodeBox[]
  edges: TopoEdge[]
  junctions: TopoJunction[]
  width: number
  height: number
}

function childrenOf(
  byParent: Map<string | undefined, ControlPlaneNode[]>,
  id: string,
): ControlPlaneNode[] {
  return (byParent.get(id) ?? []).filter(n => RAIL.has(n.kind))
}

function sizeOf(node: ControlPlaneNode): { w: number; h: number } {
  if (node.kind === 'agent' || node.kind === 'subagent') return { w: AGENT_W, h: AGENT_H }
  return { w: NODE_W, h: NODE_H }
}

function curveRadius(x1: number, y1: number, x2: number, y2: number): number {
  return Math.max(0.5, Math.min(GRAPH_CURVE_R, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2))
}

/**
 * Fork from rail (x1,y1) down/up then right into a child (x2,y2).
 * Same elbow language as joinIn, bidirectional on Y for up/down fans.
 */
export function forkToChild(x1: number, y1: number, x2: number, y2: number): string {
  if (Math.abs(y1 - y2) < 0.5) return `M ${x1} ${y1} H ${x2}`
  if (Math.abs(x1 - x2) < 0.5) return `M ${x1} ${y1} V ${y2}`
  const r = curveRadius(x1, y1, x2, y2)
  const vSign = y2 > y1 ? 1 : -1
  // Down→right: clockwise quarter (sweep 0); up→right: counterclockwise (sweep 1).
  const sweep = y2 > y1 ? 0 : 1
  return `M ${x1} ${y1} V ${y2 - vSign * r} A ${r} ${r} 0 0 ${sweep} ${x1 + r} ${y2} H ${x2}`
}

/** @deprecated alias — prefer forkToChild. */
export function branchRight(x1: number, y1: number, x2: number, y2: number): string {
  return forkToChild(x1, y1, x2, y2)
}

export function edgeColor(index: number): string {
  return laneColor(index)
}

export function gitStyleEdge(
  px: number, py: number,
  cx: number, cy: number,
): string {
  return forkToChild(px, py, cx, cy)
}

interface Cluster {
  boxes: TopoNodeBox[]
  /** Local junctions (absolute after shift). */
  junctions: Array<{ id: string; x: number; y: number; colorIndex: number }>
  edges: Array<{ id: string; from: string; to: string; d: string; colorIndex: number }>
  width: number
  height: number
  rootId: string
  /** Agent center Y in local coords (for chaining). */
  rootCy: number
}

let colorSeq = 0
function nextColor(): number {
  return colorSeq++
}

/**
 * Place agent on the left; children fan up/down on a right-hand vertical rail.
 * Nested subagents expand further to the right the same way.
 */
function layoutAgent(
  agent: ControlPlaneNode,
  byParent: Map<string | undefined, ControlPlaneNode[]>,
): Cluster {
  const a = sizeOf(agent)
  const kids = childrenOf(byParent, agent.id)
  const caps = [...kids.filter(n => n.kind !== 'agent' && n.kind !== 'subagent')]
    .sort((left, right) => (CAP_ORDER[left.kind] ?? 50) - (CAP_ORDER[right.kind] ?? 50))
  const subs = kids.filter(n => n.kind === 'agent' || n.kind === 'subagent')

  // Build fan entries: plain caps as fixed-size rows; subagents as nested clusters.
  type FanEntry =
    | { kind: 'cap'; node: ControlPlaneNode; w: number; h: number }
    | { kind: 'sub'; node: ControlPlaneNode; cluster: Cluster }

  const fan: FanEntry[] = [
    ...caps.map(node => ({ kind: 'cap' as const, node, ...sizeOf(node) })),
    ...subs.map(node => ({ kind: 'sub' as const, node, cluster: layoutAgent(node, byParent) })),
  ]

  const fanHeights = fan.map((entry) => {
    if (entry.kind === 'cap') return entry.h
    return entry.cluster.height
  })
  const fanH = fanHeights.length === 0
    ? a.h
    : fanHeights.reduce((s, h) => s + h, 0) + V_GAP * (fanHeights.length - 1)

  const fanMaxW = fan.reduce((max, entry) => {
    if (entry.kind === 'cap') return Math.max(max, entry.w)
    return Math.max(max, entry.cluster.width)
  }, 0)

  const forkX = a.w + STEM
  const childX = forkX + BRANCH
  const width = fan.length === 0
    ? a.w
    : childX + fanMaxW

  // Vertical center of agent aligns with vertical center of the fan column.
  const fanTop = 0
  const agentY = Math.max(0, (fanH - a.h) / 2)
  const agentCy = agentY + a.h / 2
  const height = Math.max(agentY + a.h, fanH)

  const boxes: TopoNodeBox[] = [{
    id: agent.id,
    node: agent,
    x: 0,
    y: agentY,
    w: a.w,
    h: a.h,
  }]
  const junctions: Cluster['junctions'] = []
  const edges: Cluster['edges'] = []

  // Stem junction at agent height on the fork rail.
  const stemColor = nextColor()
  const stemJid = `j:${agent.id}:stem`
  junctions.push({ id: stemJid, x: forkX, y: agentCy, colorIndex: stemColor })
  edges.push({
    id: `${agent.id}->${stemJid}`,
    from: agent.id,
    to: stemJid,
    d: `M ${a.w} ${agentCy} H ${forkX}`,
    colorIndex: stemColor,
  })

  if (fan.length === 0) {
    return { boxes, junctions, edges, width: a.w, height, rootId: agent.id, rootCy: agentCy }
  }

  // Place fan entries top → bottom; first half goes "up" relative to agentCy visually.
  let y = fanTop
  const childCenters: number[] = []
  for (let i = 0; i < fan.length; i++) {
    const entry = fan[i]!
    const h = fanHeights[i]!
    if (entry.kind === 'cap') {
      boxes.push({
        id: entry.node.id,
        node: entry.node,
        x: childX,
        y,
        w: entry.w,
        h: entry.h,
      })
      childCenters.push(y + entry.h / 2)
    } else {
      // Nested cluster: shift so its rootCy aligns with this row's center band.
      const rowCy = y + h / 2
      const dy = rowCy - entry.cluster.rootCy
      const dx = childX
      for (const box of entry.cluster.boxes) {
        boxes.push({ ...box, x: box.x + dx, y: box.y + dy })
      }
      for (const j of entry.cluster.junctions) {
        junctions.push({ ...j, x: j.x + dx, y: j.y + dy })
      }
      for (const e of entry.cluster.edges) {
        edges.push({
          ...e,
          d: translatePath(e.d, dx, dy),
        })
      }
      childCenters.push(rowCy)
    }
    y += h + V_GAP
  }

  // From stem junction: peel up/down the rail then right into each child (git elbow).
  for (let i = 0; i < fan.length; i++) {
    const entry = fan[i]!
    const cy = childCenters[i]!
    const color = nextColor()
    const jid = `j:${agent.id}:${entry.node.id}`
    junctions.push({ id: jid, x: forkX, y: cy, colorIndex: color })

    const targetId = entry.node.id
    const targetBox = boxes.find(b => b.id === targetId)!
    const tx = targetBox.x
    const ty = targetBox.y + targetBox.h / 2
    edges.push({
      id: `${stemJid}->${targetId}`,
      from: agent.id,
      to: targetId,
      d: forkToChild(forkX, agentCy, tx, ty),
      colorIndex: color,
    })
  }

  return { boxes, junctions, edges, width, height, rootId: agent.id, rootCy: agentCy }
}

/** Translate path commands produced by this module. */
export function translatePath(d: string, dx: number, dy: number): string {
  return d.replace(
    /([MVH])\s*(-?\d+(?:\.\d+)?)(?:\s+(-?\d+(?:\.\d+)?))?/g,
    (_m, cmd: string, a: string, b?: string) => {
      if (cmd === 'M' && b !== undefined) return `M ${Number(a) + dx} ${Number(b) + dy}`
      if (cmd === 'V') return `V ${Number(a) + dy}`
      if (cmd === 'H') return `H ${Number(a) + dx}`
      return _m
    },
  ).replace(
    /A\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g,
    (_m, rx, ry, rot, large, sweep, x, y) => (
      `A ${rx} ${ry} ${rot} ${large} ${sweep} ${Number(x) + dx} ${Number(y) + dy}`
    ),
  )
}

/** Full canvas: root agents LTR, ambient as a right-side branch of the primary agent. */
export function layoutControlPlaneTopology(nodes: readonly ControlPlaneNode[]): TopoLayout {
  colorSeq = 0
  const byParent = new Map<string | undefined, ControlPlaneNode[]>()
  for (const node of nodes) {
    const list = byParent.get(node.parentId) ?? []
    list.push(node)
    byParent.set(node.parentId, list)
  }

  const roots = (byParent.get(undefined) ?? []).filter(n => n.kind === 'agent' || n.kind === 'subagent')
  const ambient = (byParent.get(undefined) ?? []).find(n => n.kind === 'ambient')

  // Attach ambient as a synthetic fan child of the first root for visual continuity.
  if (ambient !== undefined && roots[0] !== undefined) {
    const list = byParent.get(roots[0]!.id) ?? []
    list.push({ ...ambient, parentId: roots[0]!.id })
    byParent.set(roots[0]!.id, list)
  }

  const clusters = roots.map(root => layoutAgent(root, byParent))

  const boxes: TopoNodeBox[] = []
  const junctions: TopoJunction[] = []
  const edges: TopoEdge[] = []

  let x = PAD
  let maxH = 0
  let maxRight = PAD

  for (const cluster of clusters) {
    // Vertically pad so each cluster sits mid-canvas relative to the tallest.
    const dy = PAD
    const dx = x
    for (const box of cluster.boxes) {
      boxes.push({ ...box, x: box.x + dx, y: box.y + dy })
    }
    for (const j of cluster.junctions) {
      junctions.push({ ...j, x: j.x + dx, y: j.y + dy })
    }
    for (const e of cluster.edges) {
      edges.push({ ...e, d: translatePath(e.d, dx, dy) })
    }
    maxH = Math.max(maxH, cluster.height + PAD * 2)
    maxRight = Math.max(maxRight, dx + cluster.width)
    x += cluster.width + CLUSTER_GAP
  }

  return {
    nodes: boxes,
    edges,
    junctions,
    width: Math.max(maxRight + PAD, 420),
    height: Math.max(maxH, 280),
  }
}

export function topologyRailNodes(nodes: readonly ControlPlaneNode[]): ControlPlaneNode[] {
  return nodes.filter(n => RAIL.has(n.kind))
}
