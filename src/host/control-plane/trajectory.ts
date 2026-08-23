import type { Context } from '@deepseek-ai/cordis'
import {
  buildTrajectoryFromMessages,
  type TrajectoryBuildOptions,
} from '../../shared/trajectory-build.ts'
import type { TrajPromptSection, TrajectoryGraph } from '../../shared/trajectory.ts'

interface LiveAgent {
  id: string
  status: 'idle' | 'running'
  options?: { provider?: string; model?: string }
  session?: {
    deriveMessages?: () => unknown[]
  }
}

interface AgentsApi {
  get(id: string): LiveAgent | undefined
  list(): LiveAgent[]
}

function asAgents(ctx: Context): AgentsApi | undefined {
  const agents = ctx.get('agents') as AgentsApi | undefined
  if (agents === undefined || typeof agents.get !== 'function') return undefined
  return agents
}

function modelLineOf(agent: LiveAgent | undefined, ctx: Context): string | undefined {
  if (agent?.options?.provider && agent.options.model) {
    return `${agent.options.provider} / ${agent.options.model}`
  }
  const service = ctx.get('agentDefaultModel') as { currentSelection?: () => { provider?: string; model?: string } } | undefined
  const selection = service?.currentSelection?.()
  if (selection?.provider && selection.model) return `${selection.provider} / ${selection.model}`
  return undefined
}

async function promptSectionsFor(ctx: Context, agent: LiveAgent | undefined): Promise<TrajPromptSection[]> {
  const prompt = ctx.get('systemPrompt') as {
    assemble?: (context?: { agent?: unknown; scope?: unknown }) => Promise<{ sections?: Array<{ name?: string; text?: string }> }>
  } | undefined
  if (prompt === undefined || typeof prompt.assemble !== 'function') return []
  try {
    const assembly = await prompt.assemble(agent !== undefined ? { agent, scope: agent } : {})
    return (assembly.sections ?? [])
      .filter((s): s is { name: string; text?: string } => typeof s.name === 'string')
      .map(s => ({ name: s.name, text: s.text ?? '' }))
  } catch {
    return []
  }
}

export async function buildHostTrajectory(
  ctx: Context,
  sessionId: string | undefined,
): Promise<TrajectoryGraph> {
  const focusId = typeof sessionId === 'string' && sessionId !== '' ? sessionId : null
  if (focusId === null) {
    return {
      ...buildTrajectoryFromMessages([], { sessionId: null, noticeZh: '还没有打开会话。打开左侧会话后可查看执行轨迹。' }),
      noticeZh: '还没有打开会话。打开左侧会话后可查看执行轨迹。',
    }
  }

  const agents = asAgents(ctx)
  const agent = agents?.get(focusId)
  let messages: unknown[] = []
  try {
    const derived = agent?.session?.deriveMessages?.()
    if (Array.isArray(derived)) messages = derived
  } catch {
    messages = []
  }

  const opts: TrajectoryBuildOptions = {
    sessionId: focusId,
    running: agent?.status === 'running',
    modelLine: modelLineOf(agent, ctx),
    promptSections: await promptSectionsFor(ctx, agent),
  }

  if (messages.length === 0 && agent === undefined) {
    return buildTrajectoryFromMessages([], {
      ...opts,
      noticeZh: '当前会话还没有活跃的 Agent 运行时。发送消息后，执行轨迹将自动出现。',
    })
  }

  return buildTrajectoryFromMessages(messages, opts)
}
