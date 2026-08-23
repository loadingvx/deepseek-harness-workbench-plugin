import { describe, expect, it } from 'vitest'
import type { TrajectoryGraph } from '../src/shared/trajectory.ts'
import { buildThreadFeed, flattenThreadPosts } from '../src/client/workbench/trajectory-thread.ts'
import {
  buildFishboneRowRailDraw,
  buildInnerSpineDraw,
  buildOuterSpineDraw,
  buildUnifiedSpineDraw,
  layoutFishboneRailSpecs,
  SPINE_X,
  type SpineAnchor,
} from '../src/client/workbench/trajectory-thread-rail.ts'

const minimalGraph: TrajectoryGraph = {
  userTurns: [{ id: 'u1', text: 'hello', stepIds: ['s1'] }],
  steps: [{ id: 's1', title: 'Step', status: 'done', llmTurnIds: ['l1'], toolCallIds: ['t1'] }],
  llmTurns: [{
    id: 'l1',
    index: 0,
    parentStepId: 's1',
    status: 'done',
    messages: [{ role: 'assistant', content: 'hi', fullText: 'hi' }],
    responseFull: 'hi',
    toolCallIds: ['t1'],
  }],
  toolCalls: [{
    id: 't1',
    stepId: 's1',
    llmTurnId: 'l1',
    toolName: 'read',
    status: 'done',
    argsRaw: '{}',
    resultRaw: 'ok',
  }],
}

describe('buildUnifiedSpineDraw', () => {
  it('节点圆点落在行垂直居中', () => {
    const draw = buildUnifiedSpineDraw([
      { key: 'u1', depth: 0, y: 0, height: 40, role: 'user' },
    ])
    expect(draw.dots[0]?.y).toBe(20)
  })

  it('蓝色时间主轴贯穿全程，LLM 之间无紫色竖连', () => {
    const draw = buildUnifiedSpineDraw([
      { key: 'u1', depth: 0, y: 0, height: 40, role: 'user' },
      { key: 'a', depth: 1, y: 48, height: 30, role: 'header' },
      { key: 'b', depth: 1, y: 96, height: 30, role: 'header' },
    ])
    expect(draw.strokes.some(s => s.key === 'time-spine')).toBe(true)
    expect(draw.strokes.some(s => s.key.startsWith('trunk-'))).toBe(false)
    expect(draw.strokes.filter(s => s.key.startsWith('rib-'))).toHaveLength(2)
  })

  it('LLM 头圆点在紫干，横枝为 joinIn 直角圆弯', () => {
    const draw = buildUnifiedSpineDraw([
      { key: 'l1-header', depth: 1, y: 0, height: 30, role: 'header' },
    ])
    expect(draw.dots[0]?.x).toBe(30)
    const rib = draw.strokes.find(s => s.key === 'rib-l1-header')
    expect(rib?.d).toContain(' V ')
    expect(rib?.d).toContain(' A ')
  })

  it('仅展开节内画紫/橙竖干', () => {
    const collapsed = buildUnifiedSpineDraw([
      { key: 'l1-header', depth: 1, y: 0, height: 30, episodeId: 'l1', role: 'header' },
    ])
    expect(collapsed.strokes.some(s => s.key.startsWith('trunk-'))).toBe(false)

    const expanded = buildUnifiedSpineDraw([
      { key: 'l1-header', depth: 1, y: 0, height: 30, episodeId: 'l1', role: 'header' },
      { key: 't1', depth: 2, y: 40, height: 28, episodeId: 'l1', role: 'tool' },
      { key: 't2', depth: 2, y: 72, height: 28, episodeId: 'l1', role: 'tool' },
      { key: 'l1-reply', depth: 1, y: 104, height: 30, episodeId: 'l1', role: 'reply' },
    ])
    expect(expanded.strokes.some(s => s.key === 'trunk-1-l1')).toBe(true)
    expect(expanded.strokes.some(s => s.key === 'trunk-2-l1')).toBe(true)
  })

  it('蓝轴 + 用户 + LLM 头 + 展开后紫/橙竖干', () => {
    const anchors: SpineAnchor[] = [
      { key: 'u1', depth: 0, y: 0, height: 40, role: 'user' },
      { key: 'l1-header', depth: 1, y: 48, height: 36, episodeId: 'l1', role: 'header' },
      { key: 't1', depth: 2, y: 96, height: 32, episodeId: 'l1', role: 'tool' },
      { key: 't2', depth: 2, y: 136, height: 32, episodeId: 'l1', role: 'tool' },
      { key: 'l1-reply', depth: 1, y: 176, height: 36, episodeId: 'l1', role: 'reply' },
    ]
    const draw = buildUnifiedSpineDraw(anchors)

    expect(draw.dots.some(d => d.depth === 0)).toBe(true)
    expect(draw.strokes.some(s => s.key === 'trunk-1-l1')).toBe(true)
    expect(draw.strokes.some(s => s.key === 'trunk-2-l1')).toBe(true)
    expect(draw.strokes.filter(s => s.key.startsWith('rib-')).length).toBeGreaterThanOrEqual(2)
  })

  it('Agent 回复从紫干圆角横枝拐到右侧，不从蓝轴拉枝', () => {
    const draw = buildUnifiedSpineDraw([
      { key: 'l1-header', depth: 1, y: 0, height: 30, episodeId: 'l1', role: 'header' },
      { key: 'l1-reply', depth: 1, y: 40, height: 30, episodeId: 'l1', role: 'reply' },
    ])
    const replyRib = draw.strokes.find(s => s.key === 'rib-l1-reply')
    expect(replyRib).toBeDefined()
    expect(replyRib?.d).toContain(' V ')
    expect(replyRib?.d).toContain(' A ')
    expect(replyRib?.d.startsWith(`M ${SPINE_X} `)).toBe(false)
    expect(draw.dots.find(d => d.y === 55)?.x).toBe(50)
  })
})

describe('buildFishboneRowRailDraw', () => {
  it('LLM 头行：圆点在紫干，蓝轴仅横枝连接', () => {
    const draw = buildFishboneRowRailDraw({
      key: 'l1-header',
      depth: 1,
      role: 'header',
      episodeId: 'l1',
      openAbove: [true, false, false],
      openBelow: [true, false, false],
    }, { height: 44, isLast: false })

    expect(draw.dot.x).toBe(30)
    expect(draw.strokes.some(s => s.key === 'pass-0')).toBe(true)
    expect(draw.strokes.some(s => s.key === 'up-0')).toBe(false)
    expect(draw.strokes.some(s => s.key === 'rib-h')).toBe(true)
    expect(draw.strokes.find(s => s.key === 'rib-h')?.d).toContain(' A ')
  })

  it('Agent 回复行：圆点在橙干，紫干圆角横枝连接', () => {
    const draw = buildFishboneRowRailDraw({
      key: 'l1-reply',
      depth: 1,
      role: 'reply',
      episodeId: 'l1',
      openAbove: [true, true, false],
      openBelow: [true, false, false],
    }, { height: 40, isLast: false })

    expect(draw.dot.x).toBe(50)
    expect(draw.strokes.some(s => s.key === 'in-1')).toBe(true)
    expect(draw.strokes.some(s => s.key === 'rib-r')).toBe(true)
  })

  it('最后 LLM 头行蓝轴止于拐弯、紫干可向下', () => {
    const draw = buildFishboneRowRailDraw({
      key: 'l1-header',
      depth: 1,
      role: 'header',
      episodeId: 'l1',
      openAbove: [true, false, false],
      openBelow: [false, true, false],
    }, { height: 44, isLast: false })

    expect(draw.strokes.some(s => s.key === 'pass-0')).toBe(false)
    expect(draw.strokes.some(s => s.key === 'up-0-junction')).toBe(true)
    expect(draw.strokes.some(s => s.key === 'purple-down')).toBe(true)
    expect(draw.strokes.some(s => s.key === 'rib-h')).toBe(true)
  })
})

describe('layoutFishboneRailSpecs', () => {
  it('展开节后包含工具与回复导轨行', () => {
    const feed = buildThreadFeed(minimalGraph)
    const episode = feed.find(item => item.kind === 'llmEpisode')
    expect(episode?.kind).toBe('llmEpisode')
    if (episode?.kind !== 'llmEpisode') return

    const collapsed = layoutFishboneRailSpecs(feed, new Set())
    expect(collapsed.some(row => row.role === 'tool')).toBe(false)

    const expanded = layoutFishboneRailSpecs(feed, new Set([episode.episode.id]))
    expect(expanded.some(row => row.role === 'tool')).toBe(true)
    expect(expanded.some(row => row.role === 'reply')).toBe(true)
  })

  it('最后一个 LLM 节头蓝轴不再向下延伸', () => {
    const feed = buildThreadFeed(minimalGraph)
    const episode = feed.find(item => item.kind === 'llmEpisode')
    expect(episode?.kind).toBe('llmEpisode')
    if (episode?.kind !== 'llmEpisode') return

    const expanded = layoutFishboneRailSpecs(feed, new Set([episode.episode.id]))
    const header = expanded.find(row => row.key === `${episode.episode.id}-header`)
    expect(header?.openBelow[0]).toBe(false)
    expect(header?.openBelow[1]).toBe(true)
  })
})

describe('buildOuterSpineDraw', () => {
  it('外层仅蓝轴与用户、LLM 摘要', () => {
    const feed = buildThreadFeed(minimalGraph)
    const outerRows = feed.map(item => ({
      key: item.kind === 'post' ? item.post.id : item.episode.id,
      depth: (item.kind === 'post' && item.post.depth === 0 ? 0 : 1) as 0 | 1,
    }))
    const metrics = outerRows.map((_, index) => ({ y: index * 48, height: 40 }))
    const draw = buildOuterSpineDraw(outerRows, metrics)

    expect(outerRows).toHaveLength(2)
    expect(draw.strokes.some(s => s.key.startsWith('trunk-'))).toBe(false)
  })
})

describe('buildInnerSpineDraw', () => {
  it('节内鱼骨含紫干与橙干', () => {
    const feed = buildThreadFeed(minimalGraph)
    const episode = feed.find(item => item.kind === 'llmEpisode')
    expect(episode?.kind).toBe('llmEpisode')
    if (episode?.kind !== 'llmEpisode') return

    const children = [
      { id: episode.episode.header.id, depth: 1 as const },
      ...episode.episode.children,
      { id: 't-extra', depth: 2 as const },
    ]
    const metrics = children.map((_, index) => ({ y: index * 44, height: 36 }))
    const draw = buildInnerSpineDraw(children, metrics)

    expect(draw.strokes.some(s => s.key === 'trunk-1-inner')).toBe(true)
    expect(draw.strokes.some(s => s.key === 'trunk-2-inner')).toBe(true)
  })
})

describe('buildThreadFeed', () => {
  it('LLM 工具与回复收纳在 episode 内', () => {
    const posts = flattenThreadPosts(buildThreadFeed(minimalGraph))
    expect(posts.some(p => p.author === 'user')).toBe(true)
    expect(posts.some(p => p.title.startsWith('LLM #'))).toBe(true)
    expect(posts.some(p => p.author === 'tool')).toBe(true)
  })
})
