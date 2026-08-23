/**
 * 用 session nodes 补全 host 轨迹：用户轮次、工具 I/O（不注入未知工具）。
 */
import type { TrajectoryGraph } from './trajectory.ts'
import { enrichTrajectoryFromSession } from './trajectory-session-enrich.ts'
import { extractSessionMessages } from './trajectory-session-parse.ts'

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
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
    if (typeof row.text === 'string') parts.push(row.text)
  }
  return parts.join('\n')
}

function linkStepsToLlmTurns(graph: TrajectoryGraph): TrajectoryGraph['steps'] {
  return graph.steps.map(step => ({
    ...step,
    llmTurnIds: graph.llmTurns
      .filter(llm => llm.parentStepId === step.id)
      .map(llm => llm.id),
  }))
}

/** 当 host 只有 LLM/工具、缺少用户轮次时，从 session 消息补用户锚点。 */
export function supplementTrajectoryFromSession(
  graph: TrajectoryGraph,
  nodes: readonly unknown[] | undefined,
  runningCalls: readonly unknown[] | undefined,
): TrajectoryGraph {
  let next: TrajectoryGraph = { ...graph, steps: linkStepsToLlmTurns(graph) }

  if (next.userTurns.length === 0 && next.llmTurns.length > 0) {
    const sessionUsers = extractSessionMessages(nodes).filter(row => row.role === 'user')
    const texts = sessionUsers
      .map(row => extractText(row.content))
      .map(text => text.trim())
      .filter(text => text !== '')

    let steps = [...next.steps]
    if (steps.length === 0) {
      steps = [{
        id: 'turn-0-implicit',
        index: 0,
        title: '推理轮次',
        status: 'active',
        llmTurnIds: next.llmTurns.map(llm => llm.id),
      }]
    } else if (steps.every(step => step.llmTurnIds.length === 0)) {
      steps = steps.map((step, index) => (
        index === 0
          ? { ...step, llmTurnIds: next.llmTurns.map(llm => llm.id) }
          : step
      ))
    }

    next = {
      ...next,
      steps,
      userTurns: [{
        id: 'user-0',
        index: 0,
        text: texts.join('\n\n') || '（用户消息未从会话解析，请展开 Context 注入查看）',
        stepIds: steps.map(step => step.id),
      }],
    }
  }

  return enrichTrajectoryFromSession(next, nodes, runningCalls)
}
