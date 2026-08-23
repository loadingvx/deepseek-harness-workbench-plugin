import type {
  TrajLlmTurn,
  TrajMessage,
  TrajStep,
  TrajToolCall,
  TrajectoryGraph,
} from '../../shared/trajectory.ts'

export type ThreadAuthor = 'user' | 'agent' | 'tool' | 'system'

export interface ThreadPost {
  id: string
  depth: 0 | 1 | 2
  author: ThreadAuthor
  title: string
  subtitle?: string
  body?: string
  status?: TrajLlmTurn['status']
  tool?: TrajToolCall
  inputText?: string
  outputText?: string
  messages?: TrajMessage[]
  sections?: Array<{ name: string; text: string }>
}

/** 一次 LLM 交互：摘要在外层时间轴，展开后内部为工具 + Agent 回复。 */
export interface ThreadLlmEpisode {
  id: string
  header: ThreadPost
  children: ThreadPost[]
}

export type ThreadFeedItem =
  | { kind: 'post'; post: ThreadPost }
  | { kind: 'llmEpisode'; episode: ThreadLlmEpisode }

export interface BuildThreadPostsOptions {
  sessionNodes?: readonly unknown[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function lower(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : ''
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

function clip(text: string, max = 96): string {
  const one = text.replace(/\s+/g, ' ').trim()
  if (one.length <= max) return one
  return `${one.slice(0, max - 1)}…`
}

function threadMessages(messages: TrajMessage[]): TrajMessage[] {
  return messages.filter(m => m.role === 'user' || m.role === 'assistant')
}

/** 优先 response 字段，否则取最后一条 assistant 消息（避免有工具时结果只落在 messages 里、导轨断线）。 */
function extractLlmResponse(llm: TrajLlmTurn): string {
  const direct = llm.responseFull ?? llm.responsePreview ?? ''
  if (direct.trim() !== '') return direct.trim()

  const msgs = threadMessages(llm.messages)
  for (let index = msgs.length - 1; index >= 0; index--) {
    const msg = msgs[index]!
    if (msg.role !== 'assistant') continue
    const text = msg.fullText?.trim() ?? msg.preview?.trim() ?? ''
    if (text !== '') return text
  }
  return ''
}

function isContextInjectionRow(row: Record<string, unknown>): boolean {
  const kind = lower(row.kind)
  const type = lower(row.type)
  const source = lower(row.source)
  if (kind === 'context' || type === 'context' || source === 'context') return true
  if (row.isContext === true || row.context === true) return true
  if (kind === 'reference' || type === 'reference') return true
  return false
}

export function buildContextInjectionPosts(nodes: readonly unknown[] | undefined): ThreadPost[] {
  const posts: ThreadPost[] = []
  if (nodes === undefined) return posts

  let seq = 0
  const walk = (items: readonly unknown[], depth = 0): void => {
    if (depth > 24) return
    for (const item of items) {
      const row = asRecord(item)
      if (row === null) continue

      if (isContextInjectionRow(row)) {
        const body = extractText(row.content) || (typeof row.text === 'string' ? row.text : '')
        const label = typeof row.label === 'string' ? row.label : (typeof row.name === 'string' ? row.name : 'Context')
        if (body.trim() !== '' || label.trim() !== '') {
          posts.push({
            id: `context-${seq++}`,
            depth: 0,
            author: 'system',
            title: 'Context 注入',
            subtitle: label,
            body: body.trim() !== '' ? body : label,
          })
        }
      }

      for (const key of ['blocks', 'children', 'items', 'nodes', 'messages'] as const) {
        const nested = row[key]
        if (Array.isArray(nested)) walk(nested, depth + 1)
      }
    }
  }

  walk(nodes)
  return posts
}

function toolPreview(tool: TrajToolCall): string | undefined {
  const preview = tool.displayTitle ?? tool.inputDisplay ?? ''
  if (preview.trim() === '' || preview.trim() === tool.toolName) return undefined
  return clip(preview, 88)
}

function toolPost(tool: TrajToolCall): ThreadPost {
  return {
    id: `tool-${tool.id}`,
    depth: 2,
    author: 'tool',
    title: tool.toolName,
    subtitle: toolPreview(tool),
    status: tool.status,
    tool,
    inputText: tool.inputDisplay ?? tool.argsRaw,
    outputText: tool.resultRaw ?? '',
  }
}

export function buildThreadFeed(
  graph: TrajectoryGraph,
  opts: BuildThreadPostsOptions = {},
): ThreadFeedItem[] {
  const feed: ThreadFeedItem[] = []
  const toolById = new Map(graph.toolCalls.map(tool => [tool.id, tool]))
  const pushedTools = new Set<string>()

  const pushTool = (tool: TrajToolCall): ThreadPost | undefined => {
    if (pushedTools.has(tool.id)) return undefined
    pushedTools.add(tool.id)
    return toolPost(tool)
  }

  const pushLlmEpisode = (llm: TrajLlmTurn, tools: TrajToolCall[]): void => {
    const model = [llm.provider, llm.model].filter(Boolean).join(' / ') || graph.modelLine || undefined
    const visibleTools = tools.filter(tool => tool.toolName.toLowerCase() !== 'todowrite')
    const response = extractLlmResponse(llm)
    const msgs = threadMessages(llm.messages)
    const toolCount = visibleTools.length

    const children: ThreadPost[] = []
    for (const tool of visibleTools) {
      const post = pushTool(tool)
      if (post !== undefined) children.push(post)
    }

    if (response !== '') {
      children.push({
        id: `${llm.id}-reply`,
        depth: 1,
        author: 'agent',
        title: 'Agent 回复',
        subtitle: model,
        body: response,
        status: llm.status,
      })
    }

    const headerSubtitle = toolCount > 0
      ? [model, `${toolCount} 个工具`].filter(Boolean).join(' · ')
      : model

    feed.push({
      kind: 'llmEpisode',
      episode: {
        id: llm.id,
        header: {
          id: llm.id,
          depth: 1,
          author: 'agent',
          title: `LLM #${llm.index + 1}`,
          subtitle: headerSubtitle,
          status: llm.status,
          messages: response === '' && msgs.length > 0 ? msgs : undefined,
          sections: response === '' ? llm.promptSections : undefined,
        },
        children,
      },
    })
  }

  for (const turn of graph.userTurns) {
    feed.push({
      kind: 'post',
      post: {
        id: turn.id,
        depth: 0,
        author: 'user',
        title: '用户',
        body: turn.text,
      },
    })

    const stepIds = turn.stepIds.length > 0 ? turn.stepIds : graph.steps.map(step => step.id)

    for (const stepId of stepIds) {
      const step = graph.steps.find(item => item.id === stepId)
      if (step === undefined) continue

      if (step.todoId !== undefined) {
        feed.push({
          kind: 'post',
          post: {
            id: `step-${step.id}`,
            depth: 1,
            author: 'system',
            title: step.title,
            subtitle: step.status === 'done' ? '已完成' : step.status === 'active' ? '进行中' : undefined,
            status: step.status,
          },
        })
      }

      for (const llmId of step.llmTurnIds) {
        const llm = graph.llmTurns.find(item => item.id === llmId)
        if (llm === undefined) continue
        const tools = llm.toolCallIds
          .map(id => toolById.get(id))
          .filter((tool): tool is TrajToolCall => tool !== undefined)
          .sort((a, b) => (a.parallelIndex ?? 0) - (b.parallelIndex ?? 0))
        pushLlmEpisode(llm, tools)
      }
    }
  }

  if (feed.length === 0) {
    for (const llm of graph.llmTurns) {
      const tools = llm.toolCallIds
        .map(id => toolById.get(id))
        .filter((tool): tool is TrajToolCall => tool !== undefined)
      pushLlmEpisode(llm, tools)
    }
  }

  const injections = buildContextInjectionPosts(opts.sessionNodes)
  if (injections.length === 0) return feed

  const injectionItems: ThreadFeedItem[] = injections.map(post => ({ kind: 'post', post }))
  const firstUser = feed.findIndex(item => item.kind === 'post' && item.post.author === 'user')
  if (firstUser < 0) return [...injectionItems, ...feed]
  return [...feed.slice(0, firstUser), ...injectionItems, ...feed.slice(firstUser)]
}

export function flattenThreadPosts(feed: readonly ThreadFeedItem[]): ThreadPost[] {
  const posts: ThreadPost[] = []
  for (const item of feed) {
    if (item.kind === 'post') {
      posts.push(item.post)
      continue
    }
    posts.push(item.episode.header)
    posts.push(...item.episode.children)
  }
  return posts
}

/** @deprecated 请优先使用 buildThreadFeed；保留供测试与兼容。 */
export function buildThreadPosts(
  graph: TrajectoryGraph,
  opts: BuildThreadPostsOptions = {},
): ThreadPost[] {
  return flattenThreadPosts(buildThreadFeed(graph, opts))
}

export function threadStats(graph: TrajectoryGraph): {
  llm: number
  tools: number
  steps: TrajStep[]
} {
  return {
    llm: graph.llmTurns.length,
    tools: graph.toolCalls.length,
    steps: graph.steps.filter(step => step.todoId !== undefined),
  }
}
