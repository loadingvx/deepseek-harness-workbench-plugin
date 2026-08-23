import { laneColor } from './graph-lanes.ts'
import { branchOff, branchRightAt, GRAPH_SEAM_PAD } from './graph-rail.ts'
import type { ThreadFeedItem, ThreadPost } from './trajectory-thread.ts'

export const SPINE_X = 10
export const BRANCH_STEP = 20
/** @deprecated 请用 anchorCy */
export const THREAD_DOT_CY = 15
export const THREAD_DOT_R = 3.5
export const THREAD_RAIL_W = SPINE_X + BRANCH_STEP * 2 + 12
/** 轨迹横枝圆角半径（略大于 Git graph，直角圆弯更柔和） */
export const THREAD_CURVE_R = 6
/** @deprecated 与 THREAD_CURVE_R 一致 */
export const CORNER_R = THREAD_CURVE_R

export interface ThreadRowMetric {
  y: number
  height: number
}

export interface ThreadTreeStroke {
  key: string
  d: string
  depth: number
  kind: 'spine' | 'branch'
}

export interface ThreadTreeDot {
  x: number
  y: number
  r: number
  depth: number
}

export interface ThreadSpineDraw {
  width: number
  height: number
  strokes: ThreadTreeStroke[]
  dots: ThreadTreeDot[]
}

export interface OuterSpineRow {
  key: string
  depth: 0 | 1
}

export interface SpineAnchor {
  key: string
  depth: 0 | 1 | 2
  y: number
  height: number
  episodeId?: string
  role?: 'user' | 'context' | 'step' | 'header' | 'tool' | 'reply'
}

export interface InnerSpineOptions {
  skipDotsAt?: readonly number[]
}

export interface FishboneRowRailSpec {
  key: string
  depth: 0 | 1 | 2
  role: NonNullable<SpineAnchor['role']>
  episodeId?: string
  openAbove: [boolean, boolean, boolean]
  openBelow: [boolean, boolean, boolean]
}

export interface FishboneRowRailDraw {
  width: number
  height: number
  strokes: ThreadTreeStroke[]
  dot: ThreadTreeDot
}

export function railRoleFromPost(post: ThreadPost): FishboneRowRailSpec['role'] {
  if (post.author === 'user') return 'user'
  if (post.author === 'system') return post.title === 'Context 注入' ? 'context' : 'step'
  if (post.author === 'tool') return 'tool'
  if (post.depth === 2) return 'tool'
  return 'reply'
}

function nodeLane(spec: Pick<FishboneRowRailSpec, 'depth' | 'role'>): 0 | 1 | 2 {
  if (spec.depth === 0) return 0
  if (spec.role === 'tool') return 2
  if (spec.role === 'reply') return 2
  if (spec.role === 'header') return 1
  return spec.depth === 2 ? 2 : 1
}

function dotDepth(spec: Pick<FishboneRowRailSpec, 'depth' | 'role'>): number {
  if (spec.depth === 0) return 0
  if (spec.role === 'tool') return 2
  if (spec.role === 'header') return 1
  return 1
}

function laneX(lane: 0 | 1 | 2): number {
  return lane === 0 ? SPINE_X : branchX(lane)
}

export function flattenFishboneRailRows(
  feed: readonly ThreadFeedItem[],
  expandedEpisodes: ReadonlySet<string>,
): Array<Omit<FishboneRowRailSpec, 'openAbove' | 'openBelow'>> {
  const rows: Array<Omit<FishboneRowRailSpec, 'openAbove' | 'openBelow'>> = []
  for (const item of feed) {
    if (item.kind === 'post') {
      rows.push({
        key: item.post.id,
        depth: item.post.depth,
        role: railRoleFromPost(item.post),
      })
      continue
    }
    const { id, header, children } = item.episode
    rows.push({
      key: `${id}-header`,
      depth: 1,
      role: 'header',
      episodeId: id,
    })
    if (expandedEpisodes.has(id)) {
      for (const child of children) {
        rows.push({
          key: child.id,
          depth: child.depth,
          role: railRoleFromPost(child),
          episodeId: id,
        })
      }
    }
  }
  return rows
}

function lastLlmEpisodeId(feed: readonly ThreadFeedItem[]): string | undefined {
  for (let index = feed.length - 1; index >= 0; index--) {
    const item = feed[index]!
    if (item.kind === 'llmEpisode') return item.episode.id
  }
  return undefined
}

export function layoutFishboneRailSpecs(
  feed: readonly ThreadFeedItem[],
  expandedEpisodes: ReadonlySet<string>,
): FishboneRowRailSpec[] {
  const flat = flattenFishboneRailRows(feed, expandedEpisodes)
  const specs: FishboneRowRailSpec[] = []
  const terminalLlmId = lastLlmEpisodeId(feed)
  for (let index = 0; index < flat.length; index++) {
    const row = flat[index]!
    const hasMore = index < flat.length - 1
    const openAbove: [boolean, boolean, boolean] = index === 0
      ? [true, false, false]
      : [...specs[index - 1]!.openBelow]

    const openBelow: [boolean, boolean, boolean] = [hasMore, false, false]

    if (row.role === 'header' && row.episodeId !== undefined) {
      // 最后一个 LLM# 之后无后续节：蓝轴在横枝处结束，仅紫干向下
      openBelow[0] = row.episodeId !== terminalLlmId
    } else if (row.episodeId !== undefined) {
      openBelow[0] = false
    }

    if (row.role === 'header' && row.episodeId !== undefined && expandedEpisodes.has(row.episodeId)) {
      openBelow[1] = flat.slice(index + 1).some(next => next.episodeId === row.episodeId)
    } else if (row.episodeId !== undefined) {
      openBelow[1] = flat.slice(index + 1).some(
        next => next.episodeId === row.episodeId && (next.role === 'tool' || next.role === 'reply'),
      )
    }

    if (row.role === 'tool' && row.episodeId !== undefined) {
      openBelow[2] = flat.slice(index + 1).some(
        next => next.episodeId === row.episodeId && next.role === 'tool',
      )
    }

    specs.push({ ...row, openAbove, openBelow })
  }
  return specs
}

/**
 * 单行导轨（Git Graph 同款）：蓝轴从上方下来 → 圆角拐弯 → 实心圆点，再按需向下 / 横枝。
 */
export function buildFishboneRowRailDraw(
  spec: FishboneRowRailSpec,
  opts: { height: number; isLast: boolean },
): FishboneRowRailDraw {
  const strokes: ThreadTreeStroke[] = []
  const height = Math.max(opts.height, THREAD_DOT_R * 2 + 2)
  const cy = height / 2
  const top = -GRAPH_SEAM_PAD
  const bottom = height + GRAPH_SEAM_PAD
  const drawDown = !opts.isLast
  const { openAbove, openBelow, role } = spec
  const nl = nodeLane(spec)

  const push = (key: string, d: string, depth: number, kind: ThreadTreeStroke['kind']): void => {
    pushStroke(strokes, key, d, depth, kind)
  }

  if (openAbove[0] && openBelow[0] && nl !== 0) {
    push('pass-0', `M ${fmt(laneX(0))} ${fmt(top)} V ${fmt(drawDown ? bottom : cy)}`, 0, 'spine')
  } else if (openAbove[0] && !openBelow[0] && nl !== 0) {
    push('up-0-junction', `M ${fmt(laneX(0))} ${fmt(top)} V ${fmt(cy)}`, 0, 'spine')
  } else if (openAbove[0] && nl === 0) {
    push('up-0', `M ${fmt(laneX(0))} ${fmt(top)} V ${fmt(cy)}`, 0, 'spine')
  }
  if (drawDown && openBelow[0] && nl === 0) {
    push('down-0', `M ${fmt(laneX(0))} ${fmt(cy)} V ${fmt(bottom)}`, 0, 'spine')
  }

  if (openAbove[1] && openBelow[1] && nl !== 1) {
    push('pass-1', `M ${fmt(laneX(1))} ${fmt(top)} V ${fmt(bottom)}`, 1, 'branch')
  } else if (openAbove[1] && nl === 1) {
    push('up-1', `M ${fmt(laneX(1))} ${fmt(top)} V ${fmt(cy)}`, 1, 'branch')
  } else if (openAbove[1] && nl !== 1 && !openBelow[1] && (role === 'tool' || role === 'reply')) {
    push('in-1', `M ${fmt(laneX(1))} ${fmt(top)} V ${fmt(cy)}`, 1, 'branch')
  } else if (openBelow[1] && role === 'header') {
    push('purple-down', `M ${fmt(laneX(1))} ${fmt(cy)} V ${fmt(drawDown ? bottom : cy)}`, 1, 'branch')
  }

  if (openAbove[2] && openBelow[2] && nl !== 2) {
    push('pass-2', `M ${fmt(laneX(2))} ${fmt(top)} V ${fmt(bottom)}`, 2, 'branch')
  } else if (openAbove[2] && nl === 2) {
    push('up-2', `M ${fmt(laneX(2))} ${fmt(top)} V ${fmt(cy)}`, 2, 'branch')
  }
  if (drawDown && openBelow[2] && nl === 2) {
    push('down-2', `M ${fmt(laneX(2))} ${fmt(cy)} V ${fmt(bottom)}`, 2, 'branch')
  }

  if (role === 'header') {
    push('rib-h', branchRightAt(SPINE_X, cy, branchX(1), THREAD_CURVE_R), 1, 'branch')
  } else if (role === 'tool') {
    push('rib-t', branchRightAt(branchX(1), cy, branchX(2), THREAD_CURVE_R), 2, 'branch')
  } else if (role === 'reply') {
    push('rib-r', branchRightAt(branchX(1), cy, branchX(2), THREAD_CURVE_R), 1, 'branch')
  }

  return {
    width: THREAD_RAIL_W,
    height,
    strokes,
    dot: {
      x: laneX(nl),
      y: cy,
      r: THREAD_DOT_R,
      depth: dotDepth(spec),
    },
  }
}


function branchX(depth: number): number {
  return SPINE_X + depth * BRANCH_STEP
}

function pushStroke(
  strokes: ThreadTreeStroke[],
  key: string,
  d: string,
  depth: number,
  kind: ThreadTreeStroke['kind'],
): void {
  if (d.trim() === '') return
  strokes.push({ key, d, depth, kind })
}

function fmt(value: number): string {
  return (Math.round(value * 100) / 100).toString()
}

export function anchorCy(anchor: SpineAnchor): number {
  return anchor.y + anchor.height / 2
}

function anchorBottom(anchor: SpineAnchor): number {
  return anchor.y + anchor.height
}

function cyAt(rows: readonly ThreadRowMetric[], index: number): number {
  const row = rows[index]!
  return row.y + row.height / 2
}

function verticalBetween(x: number, y1: number, y2: number): string {
  if (Math.abs(y2 - y1) < 0.5) return ''
  const top = Math.min(y1, y2)
  const bottom = Math.max(y1, y2)
  return `M ${fmt(x)} ${fmt(top)} V ${fmt(bottom)}`
}

/**
 * 鱼骨拓扑：
 * - 蓝色时间主轴贯穿全程（用户 → 所有 LLM 行）
 * - 每个 LLM 节头：蓝轴横枝拐到紫干，圆点在紫干（不在蓝轴上）
 * - 节展开后：紫干仅在该节内部（header → 工具 → 回复）；橙干仅节内多工具
 */
export function buildUnifiedSpineDraw(anchors: readonly SpineAnchor[]): ThreadSpineDraw {
  const strokes: ThreadTreeStroke[] = []
  const dots: ThreadTreeDot[] = []
  if (anchors.length === 0) {
    return { width: THREAD_RAIL_W, height: 0, strokes, dots }
  }

  const sorted = [...anchors].sort((a, b) => anchorCy(a) - anchorCy(b) || a.depth - b.depth)
  const allCy = sorted.map(anchorCy)
  const spineTop = Math.min(...allCy)
  const spineBottom = Math.max(...allCy)

  pushStroke(strokes, 'time-spine', verticalBetween(SPINE_X, spineTop, spineBottom), 0, 'spine')

  for (const anchor of sorted) {
    const y = anchorCy(anchor)
    if (anchor.depth === 0) {
      dots.push({ x: SPINE_X, y, r: THREAD_DOT_R, depth: 0 })
      continue
    }
    if (anchor.depth === 1) {
      if (anchor.role === 'reply') {
        dots.push({ x: branchX(2), y, r: THREAD_DOT_R, depth: 1 })
        pushStroke(
          strokes,
          `rib-${anchor.key}`,
          branchRightAt(branchX(1), y, branchX(2), THREAD_CURVE_R),
          1,
          'branch',
        )
      } else {
        dots.push({ x: branchX(1), y, r: THREAD_DOT_R, depth: 1 })
        pushStroke(strokes, `rib-${anchor.key}`, branchRightAt(SPINE_X, y, branchX(1), THREAD_CURVE_R), 1, 'branch')
      }
      continue
    }
    dots.push({ x: branchX(2), y, r: THREAD_DOT_R, depth: 2 })
    pushStroke(strokes, `rib-${anchor.key}`, branchRightAt(branchX(1), y, branchX(2), THREAD_CURVE_R), 2, 'branch')
  }

  const byEpisode = new Map<string, SpineAnchor[]>()
  for (const anchor of sorted) {
    if (anchor.episodeId === undefined) continue
    const list = byEpisode.get(anchor.episodeId) ?? []
    list.push(anchor)
    byEpisode.set(anchor.episodeId, list)
  }

  for (const [episodeId, episodeAnchors] of byEpisode) {
    const header = episodeAnchors.find(a => a.role === 'header')
    const bodyAnchors = episodeAnchors.filter(a => a.role === 'tool' || a.role === 'reply')
    if (header === undefined || bodyAnchors.length === 0) continue

    const headerY = anchorCy(header)
    const bodyBottom = Math.max(...bodyAnchors.map(anchorCy))
    if (bodyBottom <= headerY + 0.5) continue

    pushStroke(
      strokes,
      `trunk-1-${episodeId}`,
      branchOff(branchX(1), headerY, branchX(1), bodyBottom),
      1,
      'branch',
    )

    const tools = episodeAnchors.filter(a => a.role === 'tool').sort((a, b) => anchorCy(a) - anchorCy(b))
    if (tools.length >= 2) {
      const toolTop = anchorCy(tools[0]!)
      const toolBottom = anchorCy(tools[tools.length - 1]!)
      pushStroke(
        strokes,
        `trunk-2-${episodeId}`,
        verticalBetween(branchX(2), toolTop, toolBottom),
        2,
        'branch',
      )
    }
  }

  const feedBottom = Math.max(...sorted.map(anchorBottom))
  return { width: THREAD_RAIL_W, height: feedBottom, strokes, dots }
}

export function buildOuterSpineDraw(
  rows: readonly OuterSpineRow[],
  metrics: readonly ThreadRowMetric[],
): ThreadSpineDraw {
  const anchors: SpineAnchor[] = rows.map((row, index) => {
    const metric = metrics[index] ?? { y: 0, height: 0 }
    return {
      key: row.key,
      depth: row.depth,
      y: metric.y,
      height: metric.height,
      role: row.depth === 0 ? 'user' : 'header',
    }
  })
  return buildUnifiedSpineDraw(anchors)
}

export function buildInnerSpineDraw(
  children: readonly { id: string; depth: 0 | 1 | 2 }[],
  metrics: readonly ThreadRowMetric[],
  opts: InnerSpineOptions = {},
): ThreadSpineDraw {
  const skipDots = new Set(opts.skipDotsAt ?? [])
  const anchors: SpineAnchor[] = children.map((child, index) => {
    const metric = metrics[index] ?? { y: 0, height: 0 }
    return {
      key: child.id,
      depth: child.depth === 0 ? 0 : child.depth,
      y: metric.y,
      height: metric.height,
      episodeId: 'inner',
      role: child.depth === 2 ? 'tool' : (index === 0 ? 'header' : 'reply'),
    }
  }).filter((_, index) => !skipDots.has(index))
  return buildUnifiedSpineDraw(anchors)
}

/** @deprecated */
export function buildThreadSpineDraw(
  posts: readonly { id: string; depth: 0 | 1 | 2 }[],
  rows: readonly ThreadRowMetric[],
): ThreadSpineDraw {
  const outerRows: OuterSpineRow[] = posts.map(post => ({
    key: post.id,
    depth: post.depth === 0 ? 0 : 1,
  }))
  return buildOuterSpineDraw(outerRows, rows)
}

export { laneColor, cyAt, branchOff, branchRightAt }
