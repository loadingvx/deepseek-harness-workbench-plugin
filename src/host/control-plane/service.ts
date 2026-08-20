import type { Context } from '@deepseek-ai/cordis'
import {
  emptyKnobs,
  type ControlPlaneKnobs,
  type ControlPlaneModelOption,
  type ControlPlaneNode,
  type ControlPlaneSnapshot,
} from '../../shared/control-plane.ts'
import type { ControlPlaneKnobStore } from './store.ts'

interface LiveAgent {
  id: string
  status: 'idle' | 'running'
  options?: { provider?: string; model?: string; maxTokens?: number }
  ctx: Context
  session?: {
    deriveMessages?: () => unknown[]
  }
}

interface ToolSchema {
  name: string
  description?: string
}

interface PromptSection {
  name: string
  text?: string
  complete?: boolean
}

interface AgentBinder {
  dispose(): void
}

interface AgentsApi {
  get(id: string): LiveAgent | undefined
  list(): LiveAgent[]
  roots?(): LiveAgent[]
  isOwnedBy?(id: string, owner: LiveAgent): boolean
}

function asAgents(ctx: Context): AgentsApi | undefined {
  // Must use ctx.get — accessing ctx.agents throws without inject.
  const agents = ctx.get('agents') as AgentsApi | undefined
  if (agents === undefined || typeof agents.get !== 'function' || typeof agents.list !== 'function') {
    return undefined
  }
  return agents
}

function ownedChildren(api: AgentsApi, owner: LiveAgent): LiveAgent[] {
  if (typeof api.isOwnedBy === 'function') {
    return api.list().filter(child => child.id !== owner.id && api.isOwnedBy!(child.id, owner))
  }
  // Fallback: no ownership API — treat non-focus agents as siblings (flat).
  return []
}

function rootAgents(api: AgentsApi): LiveAgent[] {
  if (typeof api.roots === 'function') {
    const roots = api.roots()
    if (roots.length > 0) return roots
  }
  const all = api.list()
  if (typeof api.isOwnedBy !== 'function') return all
  // Agents that are not owned by any other live agent.
  return all.filter(agent => !all.some(other => other.id !== agent.id && api.isOwnedBy!(agent.id, other)))
}

function asTools(ctx: Context): {
  schemas(scope?: unknown): ToolSchema[]
  restrict?(filter: { deny?: string[]; allow?: string[] }): () => void
} | undefined {
  const tools = ctx.get('tools') as {
    schemas?: (scope?: unknown) => ToolSchema[]
    restrict?: (filter: { deny?: string[]; allow?: string[] }) => () => void
  } | undefined
  if (tools === undefined || typeof tools.schemas !== 'function') return undefined
  return tools as {
    schemas(scope?: unknown): ToolSchema[]
    restrict?(filter: { deny?: string[]; allow?: string[] }): () => void
  }
}

function asSystemPrompt(ctx: Context): {
  section?(spec: { name: string; order: number; text: string }): () => void
  assemble?(context?: { agent?: unknown; scope?: unknown }): Promise<{ sections: PromptSection[] }>
} | undefined {
  const prompt = ctx.get('systemPrompt')
  if (prompt === undefined || typeof prompt !== 'object' || prompt === null) return undefined
  return prompt as {
    section?(spec: { name: string; order: number; text: string }): () => void
    assemble?(context?: { agent?: unknown; scope?: unknown }): Promise<{ sections: PromptSection[] }>
  }
}

function pluginEntries(ctx: Context): Array<{ moduleName: string; enabled: boolean }> {
  const inventory = ctx.get('pluginInventory') as {
    list?: () => { entries?: Array<{ moduleName?: string; enabled?: boolean }> }
  } | undefined
  const entries = inventory?.list?.()?.entries
  if (!Array.isArray(entries)) {
    return [{ moduleName: 'dsh-workbench-plugin', enabled: true }]
  }
  return entries
    .filter((row): row is { moduleName: string; enabled: boolean } => (
      typeof row.moduleName === 'string' && row.moduleName !== ''
    ))
    .map(row => ({ moduleName: row.moduleName, enabled: row.enabled !== false }))
}

function shortModule(name: string): string {
  const bare = name.replace(/^.*\//, '').replace(/@deepseek-ai\//, '')
  return bare.length > 48 ? `${bare.slice(0, 45)}…` : bare
}

function isUiOrWorkbenchPlugin(moduleName: string): boolean {
  const n = moduleName.toLowerCase()
  return n.includes('workbench')
    || n.includes('client-ui')
    || n.includes('dsh-web')
    || n.includes('ui-conversation')
    || n.includes('ui-slots')
}

async function listModelOptions(ctx: Context): Promise<ControlPlaneModelOption[]> {
  const llm = ctx.get('llm') as {
    listProviders?: () => Array<{ id: string }>
    listModels?: (provider: string) => Promise<Array<{ id: string; name?: string }>>
  } | undefined
  if (llm === undefined || typeof llm.listProviders !== 'function' || typeof llm.listModels !== 'function') {
    return []
  }
  const options: ControlPlaneModelOption[] = []
  for (const provider of llm.listProviders()) {
    if (typeof provider.id !== 'string' || provider.id === '') continue
    try {
      const models = await llm.listModels(provider.id)
      for (const model of models) {
        if (typeof model.id !== 'string' || model.id === '') continue
        options.push({
          provider: provider.id,
          model: model.id,
          label: model.name && model.name !== model.id
            ? `${provider.id} / ${model.name}`
            : `${provider.id} / ${model.id}`,
        })
      }
    } catch {
      /* provider offline — skip */
    }
  }
  return options.slice(0, 200)
}

function defaultModelLine(ctx: Context): string {
  const service = ctx.get('agentDefaultModel') as Context['agentDefaultModel'] | undefined
  const selection = service?.currentSelection?.()
  if (
    typeof selection?.provider === 'string'
    && selection.provider !== ''
    && typeof selection.model === 'string'
    && selection.model !== ''
  ) {
    return `${selection.provider} / ${selection.model}`
  }
  return '未配置默认模型'
}

function toolSchemasFor(ctx: Context, agent: LiveAgent | undefined): ToolSchema[] {
  const tools = asTools(ctx)
  if (tools === undefined) return []
  try {
    return tools.schemas(agent)
  } catch {
    try {
      return tools.schemas()
    } catch {
      return []
    }
  }
}

async function promptSectionsFor(ctx: Context, agent: LiveAgent | undefined): Promise<PromptSection[]> {
  const prompt = asSystemPrompt(agent?.ctx ?? ctx)
  if (prompt === undefined || typeof prompt.assemble !== 'function') return []
  try {
    const assembly = await prompt.assemble(agent !== undefined ? { agent, scope: agent } : {})
    return Array.isArray(assembly.sections) ? assembly.sections : []
  } catch {
    return []
  }
}

function messageCount(agent: LiveAgent | undefined): number {
  try {
    const messages = agent?.session?.deriveMessages?.()
    return Array.isArray(messages) ? messages.length : 0
  } catch {
    return 0
  }
}

/**
 * Build the capability forest and keep agent-scoped overlays in sync with knobs.
 */
export class ControlPlaneService {
  private readonly binders = new Map<string, AgentBinder>()
  private wired = false

  constructor(
    private readonly ctx: Context,
    private readonly store: ControlPlaneKnobStore,
  ) {}

  /** Register process-wide waterfalls once. */
  wire(): () => void {
    if (this.wired) return () => {}
    this.wired = true
    const disposers: Array<() => void> = []

    disposers.push(this.ctx.on('agent/created', (payload: unknown) => {
      const agent = (payload as { agent?: LiveAgent } | undefined)?.agent
      if (agent === undefined || typeof agent.id !== 'string') return
      this.rebind(agent.id)
    }) as () => void)

    disposers.push(this.ctx.on('agent/disposed', (payload: unknown) => {
      const agent = (payload as { agent?: LiveAgent } | undefined)?.agent
      if (agent === undefined || typeof agent.id !== 'string') return
      this.clearBinder(agent.id)
    }) as () => void)

    disposers.push(this.ctx.on('agent/request', async (payload: unknown, next: () => Promise<unknown>) => {
      const config = await next()
      const agent = (payload as { agent?: LiveAgent } | undefined)?.agent
      if (agent === undefined || typeof agent.id !== 'string') return config
      const override = this.store.get(agent.id).modelOverride
      if (override === null) return config
      if (typeof config !== 'object' || config === null) {
        return { provider: override.provider, model: override.model }
      }
      return { ...(config as Record<string, unknown>), provider: override.provider, model: override.model }
    }) as () => void)

    disposers.push(this.ctx.on('agent/pre-step', async (payload: unknown, next: () => Promise<unknown>) => {
      const agent = (payload as { agent?: LiveAgent } | undefined)?.agent
      if (agent !== undefined && typeof agent.id === 'string' && this.store.get(agent.id).preStepReject) {
        return { kind: 'reject' }
      }
      return next()
    }) as () => void)

    disposers.push(this.ctx.on('tools/pre-execute', async (payload: unknown, next: () => Promise<unknown>) => {
      const exec = payload as { name?: string; agent?: LiveAgent } | undefined
      const agent = exec?.agent
      const name = exec?.name
      if (agent === undefined || typeof agent.id !== 'string' || typeof name !== 'string') {
        return next()
      }
      if (this.store.get(agent.id).toolDeny.includes(name)) {
        return {
          kind: 'deny',
          reason: `智能体控制面已禁用工具「${name}」。可在工作台控制面面板中重新启用。`,
        }
      }
      return next()
    }) as () => void)

    // Rebind any agents that already exist (plugin loaded mid-session).
    const agents = asAgents(this.ctx)
    for (const agent of agents?.list() ?? []) {
      this.rebind(agent.id)
    }

    return () => {
      for (const dispose of disposers) {
        try { dispose() } catch { /* ignore */ }
      }
      for (const id of [...this.binders.keys()]) this.clearBinder(id)
      this.wired = false
    }
  }

  /** Apply latest knobs to a live agent (scoped restrict + prompt section). */
  rebind(sessionId: string): void {
    this.clearBinder(sessionId)
    const agents = asAgents(this.ctx)
    const agent = agents?.get(sessionId)
    if (agent === undefined) return
    const knobs = this.store.get(sessionId)
    const local: Array<() => void> = []

    const tools = asTools(agent.ctx)
    if (knobs.toolDeny.length > 0 && typeof tools?.restrict === 'function') {
      try {
        local.push(tools.restrict({ deny: knobs.toolDeny }))
      } catch {
        /* unknown tool names / unscoped — waterfall deny still applies */
      }
    }

    const prompt = asSystemPrompt(agent.ctx)
    const text = knobs.promptAppend.trim()
    if (text !== '' && typeof prompt?.section === 'function') {
      try {
        local.push(prompt.section({
          name: 'workbench:control-plane',
          order: 250,
          text,
        }))
      } catch {
        /* duplicate name under hot reload — ignore */
      }
    }

    if (local.length === 0) return
    this.binders.set(sessionId, {
      dispose: () => {
        for (const dispose of local) {
          try { dispose() } catch { /* ignore */ }
        }
      },
    })
  }

  private clearBinder(sessionId: string): void {
    const binder = this.binders.get(sessionId)
    if (binder === undefined) return
    this.binders.delete(sessionId)
    binder.dispose()
  }

  async snapshot(sessionId: string | undefined): Promise<ControlPlaneSnapshot> {
    const agentsApi = asAgents(this.ctx)
    const live = agentsApi?.list() ?? []
    const focusId = typeof sessionId === 'string' && sessionId !== '' ? sessionId : null
    const focus = focusId !== null ? agentsApi?.get(focusId) : undefined
    const knobs = focusId !== null ? this.store.get(focusId) : emptyKnobs()
    const nodes: ControlPlaneNode[] = []

    if (live.length === 0 && focusId !== null) {
      nodes.push(...await this.buildAgentBranch({
        id: focusId,
        status: 'idle',
        ctx: this.ctx,
        options: undefined,
      }, knobs, true, true, undefined, []))
    } else if (agentsApi !== undefined && live.length > 0) {
      const roots = rootAgents(agentsApi)
      const emitTree = async (agent: LiveAgent, parentNodeId: string | undefined): Promise<void> => {
        const isCurrent = focusId !== null && agent.id === focusId
        const agentKnobs = isCurrent ? knobs : this.store.get(agent.id)
        const children = ownedChildren(agentsApi, agent)
        nodes.push(...await this.buildAgentBranch(
          agent,
          agentKnobs,
          isCurrent,
          false,
          parentNodeId,
          children,
        ))
        const agentNodeId = `agent:${agent.id}`
        for (const child of children) {
          await emitTree(child, agentNodeId)
        }
      }
      for (const root of roots) {
        await emitTree(root, undefined)
      }
      // Orphans owned by disposed parents still appear as roots of their own.
      const placed = new Set(nodes.filter(n => n.kind === 'agent' || n.kind === 'subagent').map(n => n.agentId))
      for (const agent of live) {
        if (placed.has(agent.id)) continue
        await emitTree(agent, undefined)
      }
    }

    // Ambient / UI plugins — one read-only branch on the main spine.
    const ambientId = 'ambient:plugins'
    nodes.push({
      id: ambientId,
      kind: 'ambient',
      label: '环境插件',
      detail: 'UI / 工作台等非 Agent 核心能力（只读）',
      adjustable: false,
      adjustKind: 'none',
      lockReasonZh: '环境插件不参与 Agent 执行边界调控，仅作能力清单展示。',
    })
    const seen = new Set<string>()
    for (const entry of pluginEntries(this.ctx)) {
      if (!isUiOrWorkbenchPlugin(entry.moduleName) && !entry.moduleName.includes('workbench')) {
        continue
      }
      if (seen.has(entry.moduleName)) continue
      seen.add(entry.moduleName)
      nodes.push({
        id: `plugin:${entry.moduleName}`,
        parentId: ambientId,
        kind: 'plugin',
        label: shortModule(entry.moduleName),
        detail: entry.enabled ? '已启用' : '已禁用',
        adjustable: false,
        adjustKind: 'none',
        lockReasonZh: '插件流程不在控制面调控范围内。',
      })
    }
    if (seen.size === 0) {
      nodes.push({
        id: 'plugin:dsh-workbench-plugin',
        parentId: ambientId,
        kind: 'plugin',
        label: 'dsh-workbench-plugin',
        detail: '已启用',
        adjustable: false,
        adjustKind: 'none',
        lockReasonZh: '插件流程不在控制面调控范围内。',
      })
    }

    const modelOptions = await listModelOptions(this.ctx)
    const agentKnobs: Record<string, ControlPlaneKnobs> = {}
    for (const node of nodes) {
      if ((node.kind !== 'agent' && node.kind !== 'subagent') || node.agentId === undefined) continue
      if (agentKnobs[node.agentId] !== undefined) continue
      agentKnobs[node.agentId] = this.store.get(node.agentId)
    }
    if (focusId !== null && agentKnobs[focusId] === undefined) {
      agentKnobs[focusId] = knobs
    }

    let noticeZh: string | undefined
    if (focusId === null) {
      noticeZh = '还没有打开会话。打开左侧会话后，可对本会话 Agent 进行微调。'
    } else if (focus === undefined && live.every(agent => agent.id !== focusId)) {
      noticeZh = '当前会话还没有活跃的 Agent 运行时。图中展示的是默认能力面；旋钮会在 Agent 启动后自动生效。'
    }

    return {
      sessionId: focusId,
      nodes,
      knobs,
      agentKnobs,
      modelOptions,
      generatedAt: Date.now(),
      noticeZh,
    }
  }

  private async buildAgentBranch(
    agent: LiveAgent,
    knobs: ControlPlaneKnobs,
    current: boolean,
    absent: boolean,
    parentNodeId: string | undefined,
    children: LiveAgent[],
  ): Promise<ControlPlaneNode[]> {
    const rootId = `agent:${agent.id}`
    const nodes: ControlPlaneNode[] = []
    const isSub = parentNodeId !== undefined
    const modelLine = agent.options?.provider && agent.options?.model
      ? `${agent.options.provider} / ${agent.options.model}`
      : defaultModelLine(this.ctx)
    const effectiveModel = knobs.modelOverride !== null
      ? `${knobs.modelOverride.provider} / ${knobs.modelOverride.model}（覆盖中）`
      : modelLine

    nodes.push({
      id: rootId,
      ...parentNodeId !== undefined ? { parentId: parentNodeId } : {},
      kind: isSub ? 'subagent' : 'agent',
      label: isSub
        ? (current ? '当前 Subagent' : 'Subagent')
        : (current ? '当前会话 Agent' : 'Agent'),
      detail: absent ? '尚未激活' : agent.id.slice(0, 12),
      adjustable: false,
      adjustKind: 'none',
      agentId: agent.id,
      current,
      status: absent ? 'absent' : agent.status,
      lockReasonZh: isSub
        ? 'Subagent 由父 Agent 派生；可在此查看并微调其能力边界（旋钮按该 Agent id 生效）。'
        : 'Agent 本体由 harness 管理，控制面只调控其子能力边界。',
    })

    nodes.push({
      id: `${rootId}/llm`,
      parentId: rootId,
      kind: 'llm',
      label: 'LLM',
      detail: effectiveModel,
      adjustable: true,
      adjustKind: 'model',
      agentId: agent.id,
    })

    const toolsId = `${rootId}/tools`
    const schemas = toolSchemasFor(this.ctx, absent ? undefined : agent)
    nodes.push({
      id: toolsId,
      parentId: rootId,
      kind: 'tools',
      label: 'Tools',
      detail: `${schemas.length} 个可见工具${knobs.toolDeny.length > 0 ? ` · 已禁用 ${knobs.toolDeny.length}` : ''}`,
      adjustable: true,
      adjustKind: 'tools',
      agentId: agent.id,
    })
    for (const schema of schemas) {
      const denied = knobs.toolDeny.includes(schema.name)
      nodes.push({
        id: `${toolsId}/${schema.name}`,
        parentId: toolsId,
        kind: 'tool',
        label: schema.name,
        detail: denied
          ? '已禁用'
          : (schema.description ?? '').slice(0, 80) || undefined,
        adjustable: true,
        adjustKind: 'tools',
        agentId: agent.id,
        toolName: schema.name,
      })
    }

    const promptId = `${rootId}/prompt`
    const sections = await promptSectionsFor(this.ctx, absent ? undefined : agent)
    nodes.push({
      id: promptId,
      parentId: rootId,
      kind: 'prompt',
      label: 'System Prompt',
      detail: knobs.promptAppend.trim() !== ''
        ? `已追加控制面片段 · ${sections.length} 段`
        : `${sections.length} 段`,
      adjustable: true,
      adjustKind: 'prompt',
      agentId: agent.id,
    })
    for (const section of sections.slice(0, 40)) {
      const complete = section.complete === true
      nodes.push({
        id: `${promptId}/${section.name}`,
        parentId: promptId,
        kind: 'prompt-section',
        label: section.name,
        detail: complete ? 'complete（不可替换）' : undefined,
        adjustable: false,
        adjustKind: 'none',
        agentId: agent.id,
        lockReasonZh: complete
          ? 'complete persona 受 harness 保护，控制面不能替换，只能追加独立片段。'
          : '既有提示词段只读展示；请在父节点「System Prompt」追加控制面片段。',
      })
    }

    nodes.push({
      id: `${rootId}/memory`,
      parentId: rootId,
      kind: 'memory',
      label: 'Memory',
      detail: `会话日志 ${messageCount(absent ? undefined : agent)} 条 · 无独立 Memory 服务`,
      adjustable: false,
      adjustKind: 'none',
      agentId: agent.id,
      lockReasonZh: 'Harness 无独立 Memory 服务；记忆 = Session 日志 + workspace。控制面不改写历史日志。',
    })

    nodes.push({
      id: `${rootId}/inbox`,
      parentId: rootId,
      kind: 'inbox',
      label: 'Inbox / Steer',
      detail: children.length > 0
        ? `followup / steer / inject · ${children.length} 个子 Agent`
        : 'followup / steer / inject',
      adjustable: true,
      adjustKind: 'gate',
      agentId: agent.id,
    })

    return nodes
  }
}
