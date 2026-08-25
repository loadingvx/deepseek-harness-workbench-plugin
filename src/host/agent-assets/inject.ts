import type { Context } from '@deepseek-ai/cordis'
import { renderRulesPrompt, type AgentAsset } from '../../shared/agent-assets.ts'
import { AgentAssetStore } from './store.ts'

interface LiveAgent {
  id: string
  ctx: Context
  session?: {
    header?: { cwd?: string }
  }
}

interface AgentsApi {
  get(id: string): LiveAgent | undefined
  list(): LiveAgent[]
}

function asAgents(ctx: Context): AgentsApi | undefined {
  const agents = ctx.get('agents') as AgentsApi | undefined
  if (agents === undefined || typeof agents.get !== 'function' || typeof agents.list !== 'function') {
    return undefined
  }
  return agents
}

function asSystemPrompt(ctx: Context): {
  section?(spec: { name: string; order: number; text: string }): () => void
} | undefined {
  const prompt = ctx.get('systemPrompt')
  if (prompt === undefined || typeof prompt !== 'object' || prompt === null) return undefined
  return prompt as { section?(spec: { name: string; order: number; text: string }): () => void }
}

function agentCwd(agent: LiveAgent): string | undefined {
  const cwd = agent.session?.header?.cwd
  return typeof cwd === 'string' && cwd.trim() !== '' ? cwd : undefined
}

function workspaceForCwd(
  workspaces: Array<{ path: string }>,
  cwd: string | undefined,
): string | undefined {
  if (cwd === undefined) return undefined
  const hit = workspaces
    .filter(row => cwd === row.path || cwd.startsWith(row.path.endsWith('/') ? row.path : `${row.path}/`))
    .sort((left, right) => right.path.length - left.path.length)[0]
  return hit?.path
}

/**
 * Injects enabled `.dsh/rules` into each live agent's system prompt.
 * AGENTS.md is left to dsh-agent-instructions.
 */
export class RulePromptBinder {
  private readonly binders = new Map<string, () => void>()

  constructor(
    private readonly ctx: Context,
    private readonly store: AgentAssetStore,
    private readonly listWorkspaces: () => Array<{ path: string }>,
  ) {}

  wire(): () => void {
    const disposers: Array<() => void> = []
    disposers.push(this.ctx.on('agent/created', (payload: unknown) => {
      const agent = (payload as { agent?: LiveAgent } | undefined)?.agent
      if (agent === undefined || typeof agent.id !== 'string') return
      void this.rebind(agent)
    }) as () => void)
    disposers.push(this.ctx.on('agent/disposed', (payload: unknown) => {
      const agent = (payload as { agent?: LiveAgent } | undefined)?.agent
      if (agent === undefined || typeof agent.id !== 'string') return
      this.clear(agent.id)
    }) as () => void)
    const agents = asAgents(this.ctx)
    for (const agent of agents?.list() ?? []) {
      void this.rebind(agent)
    }
    return () => {
      for (const dispose of disposers) {
        try { dispose() } catch { /* ignore */ }
      }
      for (const id of [...this.binders.keys()]) this.clear(id)
    }
  }

  async refreshWorkspace(workspacePath: string): Promise<void> {
    const agents = asAgents(this.ctx)
    if (agents === undefined) return
    const workspaces = this.listWorkspaces()
    const only = workspaces.length === 1 ? workspaces[0]!.path : undefined
    for (const agent of agents.list()) {
      const cwd = agentCwd(agent)
      const match = workspaceForCwd(workspaces, cwd) ?? workspaceForCwd([{ path: workspacePath }], cwd)
      const lone = cwd === undefined && only === workspacePath
      if (match === workspacePath || lone) {
        await this.rebind(agent, workspacePath)
      }
    }
  }

  async rebindAll(): Promise<void> {
    const agents = asAgents(this.ctx)
    if (agents === undefined) return
    for (const agent of agents.list()) {
      await this.rebind(agent)
    }
  }

  private async rebind(agent: LiveAgent, fallbackWorkspace?: string): Promise<void> {
    this.clear(agent.id)
    const cwd = agentCwd(agent)
    const workspace = workspaceForCwd(this.listWorkspaces(), cwd) ?? fallbackWorkspace
    if (workspace === undefined) return
    let items: AgentAsset[]
    try {
      items = (await this.store.list(workspace, 'rule')).items
    } catch {
      return
    }
    const text = renderRulesPrompt(items)
    if (text === '') return
    const prompt = asSystemPrompt(agent.ctx) ?? asSystemPrompt(this.ctx)
    if (typeof prompt?.section !== 'function') return
    try {
      this.binders.set(agent.id, prompt.section({
        name: 'workbench:workspace-rules',
        order: 240,
        text,
      }))
    } catch {
      /* duplicate name under hot reload */
    }
  }

  private clear(agentId: string): void {
    const dispose = this.binders.get(agentId)
    if (dispose === undefined) return
    this.binders.delete(agentId)
    try { dispose() } catch { /* ignore */ }
  }
}
