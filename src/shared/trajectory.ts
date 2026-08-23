/**
 * Agent 执行轨迹图 — 数据契约（时间序 DAG，非能力拓扑）。
 */

export type TrajStatus = 'pending' | 'active' | 'done' | 'error' | 'streaming'

export interface TrajPromptSection {
  name: string
  text: string
}

export interface TrajMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  preview: string
  fullText: string
  toolName?: string
}

export interface TrajToolCall {
  id: string
  toolName: string
  argsRaw: string
  resultRaw?: string
  status: TrajStatus
  durationMs?: number
  isError?: boolean
  parentLlmId: string
  parallelIndex?: number
  /** 用户可读主标题（命令/路径等） */
  displayTitle?: string
  /** 次要标签（读取/搜索…）；run_code 等通常为空 */
  displayTag?: string
  /** 格式化后的输入文本 */
  inputDisplay?: string
}

export interface TrajLlmTurn {
  id: string
  index: number
  model?: string
  provider?: string
  tokensIn?: number
  tokensOut?: number
  durationMs?: number
  status: TrajStatus
  responsePreview?: string
  responseFull?: string
  messages: TrajMessage[]
  promptSections?: TrajPromptSection[]
  toolCallIds: string[]
  parentStepId: string
}

export interface TrajStep {
  id: string
  index: number
  title: string
  status: TrajStatus
  todoId?: string
  llmTurnIds: string[]
}

export interface TrajUserTurn {
  id: string
  index: number
  text: string
  stepIds: string[]
}

export interface TrajectoryGraph {
  sessionId: string | null
  running: boolean
  modelLine?: string
  userTurns: TrajUserTurn[]
  steps: TrajStep[]
  llmTurns: TrajLlmTurn[]
  toolCalls: TrajToolCall[]
  generatedAt: number
  noticeZh?: string
}

export function emptyTrajectory(sessionId: string | null = null): TrajectoryGraph {
  return {
    sessionId,
    running: false,
    userTurns: [],
    steps: [],
    llmTurns: [],
    toolCalls: [],
    generatedAt: Date.now(),
  }
}
