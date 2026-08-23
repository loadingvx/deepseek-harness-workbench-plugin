/**
 * 从 harness 会话 nodes / runningCalls 抽取工具块，补全 trajectory 的 I/O。
 */
import type { TrajToolCall, TrajectoryGraph } from './trajectory.ts'
import { formatToolDisplay } from './trajectory-tool-display.ts'
import { isSessionToolRow } from './trajectory-session-parse.ts'
import {
  isRicherArgsRaw,
  pickRicherArgsRaw,
  resolveArgsRaw,
  resolveCallId,
  resolveResultRaw,
  resolveToolName,
} from './trajectory-tool-extract.ts'

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export interface SessionToolBlock {
  callId: string
  toolName: string
  argsRaw: string
  resultRaw?: string
  isError?: boolean
  status: 'running' | 'done' | 'error'
}

function toolBlockFromRow(row: Record<string, unknown>, fallbackId: string): SessionToolBlock | null {
  const nested = asRecord(row.block)
  const source = nested !== null
    ? {
      ...row,
      ...nested,
      call: row.call ?? nested.call,
      content: row.content ?? nested.content,
    }
    : row

  if (!isSessionToolRow(source)) return null

  const toolName = resolveToolName(source)
  if (toolName === undefined || toolName === '') return null

  const callId = resolveCallId(source) ?? fallbackId
  const argsRaw = resolveArgsRaw(source)

  const settled = source.kind !== undefined || source.content !== undefined || source.isError !== undefined
  const resultRaw = resolveResultRaw(source)

  const isError = source.isError === true
  const status: SessionToolBlock['status'] = !settled && resultRaw === undefined
    ? 'running'
    : (isError ? 'error' : 'done')

  return {
    callId,
    toolName,
    argsRaw,
    resultRaw,
    isError,
    status,
  }
}

function mergeToolBlock(prev: SessionToolBlock, next: SessionToolBlock): void {
  prev.argsRaw = pickRicherArgsRaw(next.argsRaw, prev.argsRaw)
  if (next.resultRaw !== undefined) prev.resultRaw = next.resultRaw
  if (next.status !== 'running') prev.status = next.status
  if (next.isError === true) prev.isError = true
  if (next.toolName !== '') prev.toolName = next.toolName
}

/** 深度遍历 session nodes，收集工具块。 */
export function collectSessionToolBlocks(nodes: readonly unknown[] | undefined): SessionToolBlock[] {
  const toolBlocks: SessionToolBlock[] = []
  const byCallId = new Map<string, SessionToolBlock>()
  let fallbackSeq = 0

  const walk = (items: readonly unknown[], depth = 0): void => {
    if (depth > 24) return
    for (const item of items) {
      const row = asRecord(item)
      if (row === null) continue

      const tool = toolBlockFromRow(row, `session-tool-${fallbackSeq++}`)
      if (tool !== null) {
        const existing = byCallId.get(tool.callId)
        if (existing === undefined) {
          byCallId.set(tool.callId, tool)
          toolBlocks.push(tool)
        } else {
          mergeToolBlock(existing, tool)
        }
      }

      for (const key of ['blocks', 'children', 'items', 'nodes', 'toolCalls', 'tool_calls'] as const) {
        const nested = row[key]
        if (Array.isArray(nested)) walk(nested, depth + 1)
      }
    }
  }

  if (nodes !== undefined) walk(nodes)
  return toolBlocks
}

function knownCallIds(
  graph: TrajectoryGraph,
  runningCalls: readonly unknown[] | undefined,
): Set<string> {
  const ids = new Set(graph.toolCalls.map(tool => tool.id))
  for (const raw of runningCalls ?? []) {
    const row = asRecord(raw)
    if (row === null) continue
    const id = resolveCallId(row)
    if (id !== undefined) ids.add(id)
  }
  return ids
}

function enrichTool(tool: TrajToolCall, block: SessionToolBlock): TrajToolCall {
  const argsRaw = pickRicherArgsRaw(block.argsRaw, tool.argsRaw)
  const toolName = block.toolName || tool.toolName
  const display = formatToolDisplay(toolName, argsRaw)
  return {
    ...tool,
    toolName,
    argsRaw,
    resultRaw: block.resultRaw ?? tool.resultRaw,
    status: block.status === 'running' ? 'streaming' : (block.isError ? 'error' : tool.status),
    isError: block.isError ?? tool.isError,
    displayTitle: display.title,
    displayTag: display.tag,
    inputDisplay: display.inputText,
  }
}

function matchBlocksToTools(
  toolCalls: readonly TrajToolCall[],
  blocks: readonly SessionToolBlock[],
): Map<string, SessionToolBlock> {
  const matched = new Map<string, SessionToolBlock>()
  const orphans = [...blocks]

  const takeOrphan = (predicate: (block: SessionToolBlock) => boolean): SessionToolBlock | undefined => {
    const index = orphans.findIndex(predicate)
    if (index < 0) return undefined
    const [block] = orphans.splice(index, 1)
    return block
  }

  for (const tool of toolCalls) {
    const byId = blocks.find(block => block.callId === tool.id)
    if (byId !== undefined) {
      matched.set(tool.id, byId)
      const orphanIndex = orphans.findIndex(block => block.callId === byId.callId)
      if (orphanIndex >= 0) orphans.splice(orphanIndex, 1)
      continue
    }

    const byName = takeOrphan(block => (
      block.toolName.toLowerCase() === tool.toolName.toLowerCase()
      && (isRicherArgsRaw(block.argsRaw, tool.argsRaw) || isRicherArgsRaw(tool.argsRaw, block.argsRaw) || block.argsRaw === tool.argsRaw)
    )) ?? takeOrphan(block => block.toolName.toLowerCase() === tool.toolName.toLowerCase())

    if (byName !== undefined) matched.set(tool.id, byName)
  }

  return matched
}

/** 仅补全 graph 里已有工具的 I/O，不向图中注入未知工具。 */
export function enrichTrajectoryFromSession(
  graph: TrajectoryGraph,
  nodes: readonly unknown[] | undefined,
  runningCalls: readonly unknown[] | undefined,
): TrajectoryGraph {
  if (graph.toolCalls.length === 0 && (runningCalls === undefined || runningCalls.length === 0)) {
    return graph
  }

  const allowed = knownCallIds(graph, runningCalls)
  const toolBlocks = collectSessionToolBlocks(nodes).filter(block => allowed.has(block.callId))
  let fallbackSeq = 0

  for (const raw of runningCalls ?? []) {
    const row = asRecord(raw)
    if (row === null) continue
    const block = toolBlockFromRow(row, `live-tool-${fallbackSeq++}`)
    if (block === null || !allowed.has(block.callId)) continue
    const existing = toolBlocks.find(item => item.callId === block.callId)
    if (existing === undefined) {
      toolBlocks.push(block)
    } else {
      mergeToolBlock(existing, block)
    }
  }

  if (toolBlocks.length === 0) return graph

  const matches = matchBlocksToTools(graph.toolCalls, toolBlocks)
  const toolCalls = graph.toolCalls.map((tool) => {
    const block = matches.get(tool.id)
    if (block !== undefined) return enrichTool(tool, block)
    return tool
  })

  return {
    ...graph,
    toolCalls,
    generatedAt: Date.now(),
  }
}
