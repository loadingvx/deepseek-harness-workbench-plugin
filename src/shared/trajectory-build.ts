/**
 * 从 harness 会话消息 / UI 节点构建执行轨迹图（host + client 共用）。
 */
import {
  emptyTrajectory,
  type TrajLlmTurn,
  type TrajMessage,
  type TrajPromptSection,
  type TrajStatus,
  type TrajStep,
  type TrajToolCall,
  type TrajUserTurn,
  type TrajectoryGraph,
} from './trajectory.ts'
import { formatToolDisplay } from './trajectory-tool-display.ts'
import { extractSessionMessages, resolveSessionMessageRole } from './trajectory-session-parse.ts'
import { argsToRaw, resolveArgsRaw } from './trajectory-tool-extract.ts'

export interface TrajectoryBuildOptions {
  sessionId?: string | null
  running?: boolean
  modelLine?: string
  promptSections?: TrajPromptSection[]
  noticeZh?: string
}

interface Mutable {
  userTurns: TrajUserTurn[]
  steps: TrajStep[]
  llmTurns: TrajLlmTurn[]
  toolCalls: TrajToolCall[]
  todos: Array<{ id: string; content: string; status: TrajStatus }>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function clip(text: string, max = 120): string {
  const one = text.replace(/\s+/g, ' ').trim()
  if (one.length <= max) return one
  return `${one.slice(0, max - 1)}…`
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block)
      continue
    }
    const row = asRecord(block)
    if (row === null) continue
    if (row.type === 'text' && typeof row.text === 'string') {
      parts.push(row.text)
      continue
    }
    if (typeof row.text === 'string') parts.push(row.text)
  }
  return parts.join('\n')
}

function parseJsonLoose(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

interface ParsedToolCall {
  id: string
  name: string
  argsRaw: string
}

function extractToolCalls(msg: Record<string, unknown>): ParsedToolCall[] {
  const out: ParsedToolCall[] = []
  const openAi = asArray(msg.tool_calls)
  for (const item of openAi) {
    const row = asRecord(item)
    if (row === null) continue
    const fn = asRecord(row.function)
    const name = typeof fn?.name === 'string'
      ? fn.name
      : (typeof row.name === 'string' ? row.name : 'tool')
    const id = typeof row.id === 'string' ? row.id : `tc-${out.length}`
    const argsRaw = fn?.arguments !== undefined
      ? argsToRaw(fn.arguments)
      : (row.input !== undefined ? argsToRaw(row.input) : resolveArgsRaw(row))
    out.push({ id, name, argsRaw })
  }
  for (const block of asArray(msg.content)) {
    const row = asRecord(block)
    if (row === null) continue
    if (row.type !== 'tool_use' && row.type !== 'tool-call') continue
    const id = typeof row.id === 'string' ? row.id : `tc-${out.length}`
    const name = typeof row.name === 'string' ? row.name : 'tool'
    const argsRaw = row.input !== undefined ? argsToRaw(row.input) : resolveArgsRaw(row)
    out.push({ id, name, argsRaw })
  }
  return out
}

function todoStatusOf(raw: unknown): TrajStatus {
  const text = String(raw ?? '').toLowerCase()
  if (text === 'completed' || text === 'done' || text === 'complete') return 'done'
  if (text === 'in_progress' || text === 'active' || text === 'running') return 'active'
  if (text === 'cancelled' || text === 'canceled') return 'error'
  return 'pending'
}

function syncStepsFromTodos(state: Mutable, stepPrefix: string): void {
  const existing = new Map(state.todos.map(t => [t.id, t]))
  state.steps = state.todos.map((todo, index) => {
    const prev = state.steps.find(s => s.todoId === todo.id)
    const llmTurnIds = prev?.llmTurnIds ?? []
    return {
      id: `${stepPrefix}-todo-${todo.id}`,
      index,
      title: todo.content || `Step ${index + 1}`,
      status: todo.status,
      todoId: todo.id,
      llmTurnIds,
    }
  })
  if (state.steps.length === 0 && state.userTurns.length > 0) {
    const turn = state.userTurns[state.userTurns.length - 1]!
    if (!state.steps.some(s => s.id === `${stepPrefix}-implicit`)) {
      state.steps.push({
        id: `${stepPrefix}-implicit`,
        index: 0,
        title: '推理轮次',
        status: 'active',
        llmTurnIds: [],
      })
      turn.stepIds = [state.steps[0]!.id]
    }
  }
}

function activeStepId(state: Mutable): string {
  const active = state.steps.find(s => s.status === 'active')
  if (active !== undefined) return active.id
  const pending = state.steps.find(s => s.status === 'pending')
  if (pending !== undefined) return pending.id
  const last = state.steps[state.steps.length - 1]
  if (last !== undefined) return last.id
  const implicit = {
    id: 'step-implicit',
    index: 0,
    title: '推理轮次',
    status: 'active' as TrajStatus,
    llmTurnIds: [] as string[],
  }
  state.steps.push(implicit)
  const turn = state.userTurns[state.userTurns.length - 1]
  if (turn !== undefined && !turn.stepIds.includes(implicit.id)) {
    turn.stepIds.push(implicit.id)
  }
  return implicit.id
}

function applyTodoWrite(state: Mutable, argsRaw: string, stepPrefix: string): void {
  const parsed = asRecord(parseJsonLoose(argsRaw))
  const todos = asArray(parsed?.todos)
  if (todos.length === 0) return
  const next: Array<{ id: string; content: string; status: TrajStatus }> = []
  for (const item of todos) {
    const row = asRecord(item)
    if (row === null) continue
    const id = typeof row.id === 'string' ? row.id : `todo-${next.length}`
    const content = typeof row.content === 'string' ? row.content : ''
    next.push({ id, content, status: todoStatusOf(row.status) })
  }
  if (next.length > 0) state.todos = next
  syncStepsFromTodos(state, stepPrefix)
}

function enrichToolCall(
  partial: Omit<TrajToolCall, 'displayTitle' | 'displayTag' | 'inputDisplay'>,
): TrajToolCall {
  const display = formatToolDisplay(partial.toolName, partial.argsRaw)
  return {
    ...partial,
    displayTitle: display.title,
    displayTag: display.tag,
    inputDisplay: display.inputText,
  }
}

function pushLlmTurn(
  state: Mutable,
  opts: {
    id: string
    messages: TrajMessage[]
    responseFull?: string
    status: TrajStatus
    modelLine?: string
    promptSections?: TrajPromptSection[]
    toolCalls?: ParsedToolCall[]
  },
): TrajLlmTurn {
  const stepId = activeStepId(state)
  const step = state.steps.find(s => s.id === stepId)
  const turn: TrajLlmTurn = {
    id: opts.id,
    index: state.llmTurns.length,
    model: opts.modelLine?.split('/').pop()?.trim(),
    provider: opts.modelLine?.split('/')[0]?.trim(),
    status: opts.status,
    messages: opts.messages,
    promptSections: opts.promptSections,
    responsePreview: opts.responseFull !== undefined ? clip(opts.responseFull, 80) : undefined,
    responseFull: opts.responseFull,
    toolCallIds: [],
    parentStepId: stepId,
  }
  state.llmTurns.push(turn)
  if (step !== undefined && !step.llmTurnIds.includes(turn.id)) {
    step.llmTurnIds.push(turn.id)
  }
  const tools = opts.toolCalls ?? []
  tools.forEach((tool, parallelIndex) => {
    const call = enrichToolCall({
      id: tool.id,
      toolName: tool.name,
      argsRaw: tool.argsRaw,
      status: 'done',
      parentLlmId: turn.id,
      parallelIndex,
    })
    state.toolCalls.push(call)
    turn.toolCallIds.push(call.id)
    if (tool.name === 'TodoWrite') applyTodoWrite(state, tool.argsRaw, `turn-${state.userTurns.length}`)
  })
  return turn
}

function attachToolResults(state: Mutable, msg: Record<string, unknown>): void {
  const callId = typeof msg.tool_call_id === 'string'
    ? msg.tool_call_id
    : (typeof msg.tool_use_id === 'string' ? msg.tool_use_id : undefined)
  const result = extractText(msg.content)
  const toolName = typeof msg.name === 'string' ? msg.name : undefined
  let call = callId !== undefined ? state.toolCalls.find(c => c.id === callId) : undefined
  if (call === undefined && toolName !== undefined) {
    call = [...state.toolCalls].reverse().find(c => (
      c.toolName === toolName && (c.resultRaw === undefined || c.resultRaw === '')
    ))
  }
  if (call === undefined) return
  call.resultRaw = result
  call.status = 'done'
  if (call.toolName === 'TodoWrite') {
    applyTodoWrite(state, call.argsRaw, `turn-${Math.max(1, state.userTurns.length)}`)
  }
}

function messagesFromUnknown(source: unknown): Record<string, unknown>[] {
  if (!Array.isArray(source)) return []
  const out: Record<string, unknown>[] = []
  for (const item of source) {
    const row = asRecord(item)
    if (row === null) continue
    const role = resolveSessionMessageRole(row)
    if (role !== null) out.push({ ...row, role })
  }
  return out
}

function flattenSessionBlocks(nodes: readonly unknown[]): Record<string, unknown>[] {
  return extractSessionMessages(nodes)
}

export function buildTrajectoryFromMessages(
  messages: unknown[],
  opts: TrajectoryBuildOptions = {},
): TrajectoryGraph {
  const state: Mutable = { userTurns: [], steps: [], llmTurns: [], toolCalls: [], todos: [] }
  const promptSections = opts.promptSections ?? []
  let llmCounter = 0
  let currentMessages: TrajMessage[] = []

  const pushUser = (text: string): void => {
    const trimmed = text.trim()
    if (trimmed === '') return
    const turn: TrajUserTurn = {
      id: `user-${state.userTurns.length}`,
      index: state.userTurns.length,
      text: trimmed,
      stepIds: [],
    }
    state.userTurns.push(turn)
    state.steps = []
    state.todos = []
    const stepId = `turn-${turn.index}-implicit`
    state.steps.push({
      id: stepId,
      index: 0,
      title: '推理轮次',
      status: 'active',
      llmTurnIds: [],
    })
    turn.stepIds.push(stepId)
    currentMessages = [{ role: 'user', preview: clip(trimmed), fullText: trimmed }]
  }

  for (const msg of messagesFromUnknown(messages)) {
    const role = String(msg.role)
    if (role === 'user') {
      pushUser(extractText(msg.content))
      continue
    }
    if (role === 'system') {
      const full = extractText(msg.content)
      currentMessages.push({ role: 'system', preview: clip(full), fullText: full })
      continue
    }
    if (role === 'assistant') {
      const full = extractText(msg.content)
      const toolCalls = extractToolCalls(msg)
      const trajMsg: TrajMessage = {
        role: 'assistant',
        preview: full !== '' ? clip(full) : (toolCalls.length > 0 ? `[${toolCalls.length} 个工具调用]` : '（空回复）'),
        fullText: full,
      }
      const batch = [...currentMessages, trajMsg]
      pushLlmTurn(state, {
        id: `llm-${llmCounter++}`,
        messages: batch,
        responseFull: full,
        status: toolCalls.length > 0 ? 'done' : 'done',
        modelLine: opts.modelLine,
        promptSections: promptSections.length > 0 ? promptSections : undefined,
        toolCalls,
      })
      currentMessages = batch
      if (full !== '') {
        currentMessages.push({
          role: 'assistant',
          preview: clip(full),
          fullText: full,
        })
      }
      continue
    }
    if (role === 'tool') {
      attachToolResults(state, msg)
      const full = extractText(msg.content)
      const toolName = typeof msg.name === 'string' ? msg.name : undefined
      currentMessages.push({
        role: 'tool',
        preview: clip(full, 80),
        fullText: full,
        toolName,
      })
    }
  }

  if (state.userTurns.length === 0 && state.llmTurns.length === 0) {
    return {
      ...emptyTrajectory(opts.sessionId ?? null),
      running: opts.running === true,
      modelLine: opts.modelLine,
      noticeZh: opts.noticeZh,
      generatedAt: Date.now(),
    }
  }

  return {
    sessionId: opts.sessionId ?? null,
    running: opts.running === true,
    modelLine: opts.modelLine,
    userTurns: state.userTurns,
    steps: state.steps,
    llmTurns: state.llmTurns,
    toolCalls: state.toolCalls,
    generatedAt: Date.now(),
    noticeZh: opts.noticeZh,
  }
}

export function buildTrajectoryFromSession(
  messages: unknown[],
  sessionNodes: readonly unknown[] | undefined,
  opts: TrajectoryBuildOptions = {},
): TrajectoryGraph {
  const primary = messages.length > 0 ? messages : []
  const fromNodes = sessionNodes !== undefined ? flattenSessionBlocks(sessionNodes) : []
  const merged = primary.length > 0 ? primary : fromNodes
  return buildTrajectoryFromMessages(merged, opts)
}

export interface LiveTrajectoryOverlay {
  running?: boolean
  runningCalls?: readonly unknown[]
  partialText?: string
}

export function overlayLiveTrajectory(
  graph: TrajectoryGraph,
  live: LiveTrajectoryOverlay,
): TrajectoryGraph {
  const running = live.running === true
  const next: TrajectoryGraph = {
    ...graph,
    running,
    llmTurns: graph.llmTurns.map(t => ({ ...t, messages: [...t.messages] })),
    toolCalls: graph.toolCalls.map(t => ({ ...t })),
    steps: graph.steps.map(s => ({ ...s, llmTurnIds: [...s.llmTurnIds] })),
    userTurns: graph.userTurns.map(u => ({ ...u, stepIds: [...u.stepIds] })),
    generatedAt: Date.now(),
  }

  for (const raw of live.runningCalls ?? []) {
    const row = asRecord(raw)
    if (row === null) continue
    const callId = typeof row.callId === 'string' ? row.callId : `live-${next.toolCalls.length}`
    if (next.toolCalls.some(c => c.id === callId)) continue
    const parent = next.llmTurns[next.llmTurns.length - 1]
    const parentId = parent?.id ?? 'llm-live'
    if (parent === undefined) {
      const stepId = next.steps[0]?.id ?? 'step-live'
      if (!next.steps.some(s => s.id === stepId)) {
        next.steps.push({ id: stepId, index: 0, title: '推理轮次', status: 'active', llmTurnIds: [] })
      }
      next.llmTurns.push({
        id: parentId,
        index: next.llmTurns.length,
        status: 'streaming',
        messages: [],
        toolCallIds: [],
        parentStepId: stepId,
        model: next.modelLine?.split('/').pop()?.trim(),
        provider: next.modelLine?.split('/')[0]?.trim(),
      })
      const step = next.steps.find(s => s.id === stepId)
      step?.llmTurnIds.push(parentId)
    }
    const argsRaw = resolveArgsRaw(row)
    const toolName = typeof row.toolName === 'string' ? row.toolName : 'tool'
    next.toolCalls.push(enrichToolCall({
      id: callId,
      toolName,
      argsRaw,
      status: 'streaming',
      parentLlmId: parentId,
    }))
    const llm = next.llmTurns.find(t => t.id === parentId)
    llm?.toolCallIds.push(callId)
    if (llm !== undefined) llm.status = 'streaming'
  }

  const partial = live.partialText?.trim() ?? ''
  if (running && partial !== '') {
    let llm = next.llmTurns[next.llmTurns.length - 1]
    if (llm === undefined || llm.status === 'done') {
      const stepId = activeStepId({
        userTurns: next.userTurns,
        steps: next.steps,
        llmTurns: next.llmTurns,
        toolCalls: next.toolCalls,
        todos: [],
      })
      llm = {
        id: `llm-live-${next.llmTurns.length}`,
        index: next.llmTurns.length,
        status: 'streaming',
        messages: [],
        toolCallIds: [],
        parentStepId: stepId,
        model: next.modelLine?.split('/').pop()?.trim(),
        provider: next.modelLine?.split('/')[0]?.trim(),
        responsePreview: clip(partial, 80),
        responseFull: partial,
      }
      next.llmTurns.push(llm)
      const step = next.steps.find(s => s.id === stepId)
      step?.llmTurnIds.push(llm.id)
    } else {
      llm.status = 'streaming'
      llm.responsePreview = clip(partial, 80)
      llm.responseFull = partial
    }
  } else if (running && next.llmTurns.length > 0) {
    const last = next.llmTurns[next.llmTurns.length - 1]!
    if (last.status !== 'done' && last.toolCallIds.length === 0) {
      last.status = 'streaming'
    }
  }

  return next
}

function partialTextOf(partial: unknown): string {
  if (typeof partial === 'string') return partial
  const row = asRecord(partial)
  if (row === null) return ''
  if (typeof row.text === 'string') return row.text
  return extractText(row.content)
}

export function liveOverlayFromSession(state: {
  running?: boolean
  runningCalls?: readonly unknown[]
  partial?: unknown
}): LiveTrajectoryOverlay {
  return {
    running: state.running,
    runningCalls: state.runningCalls,
    partialText: partialTextOf(state.partial),
  }
}
