import type { ControlPlaneNode, ControlPlaneSnapshot } from '../../shared/control-plane.ts'

/** One agent (root or subagent) and its direct capability children. */
export interface CapabilityGroup {
  agent: ControlPlaneNode
  capabilities: ControlPlaneNode[]
  subagents: CapabilityGroup[]
}

export interface CapabilitiesViewModel {
  sessionId: string | null
  /** Current-session agent tree; null when no session is open. */
  focus: CapabilityGroup | null
  ambient: ControlPlaneNode | null
  plugins: ControlPlaneNode[]
  /** Full node list for child lookups (tools, prompt sections). */
  nodes: ControlPlaneNode[]
}

const CAPABILITY_KINDS = new Set<ControlPlaneNode['kind']>([
  'llm', 'tools', 'prompt', 'memory', 'inbox',
])

function isAgentKind(kind: ControlPlaneNode['kind']): boolean {
  return kind === 'agent' || kind === 'subagent'
}

function buildGroup(
  agent: ControlPlaneNode,
  nodes: readonly ControlPlaneNode[],
): CapabilityGroup {
  const capabilities = nodes.filter(
    node => node.parentId === agent.id && CAPABILITY_KINDS.has(node.kind),
  )
  const subagentNodes = nodes.filter(
    node => node.parentId === agent.id && isAgentKind(node.kind),
  )
  return {
    agent,
    capabilities,
    subagents: subagentNodes.map(sub => buildGroup(sub, nodes)),
  }
}

/**
 * Slice the snapshot to the **current-session agent** only.
 *
 * Terminology:
 * - **Agent** — a harness runtime entity (`LiveAgent`), identified by `agentId`.
 * - **Current session** — the chat tab open on the left (`sessionId`).
 * - In the common case `agentId === sessionId` (one agent per chat).
 * - `current: true` marks the agent bound to the open session; other live agents
 *   (siblings, background workers) are omitted from this view.
 */
export function buildCapabilitiesViewModel(
  snapshot: ControlPlaneSnapshot,
): CapabilitiesViewModel {
  const { nodes, sessionId } = snapshot

  let focusAgent: ControlPlaneNode | undefined
  if (sessionId !== null) {
    focusAgent = nodes.find(
      node => isAgentKind(node.kind) && node.current === true,
    )
    if (focusAgent === undefined) {
      focusAgent = nodes.find(node => node.id === `agent:${sessionId}`)
    }
  }

  const ambient = nodes.find(node => node.kind === 'ambient') ?? null
  const plugins = ambient !== null
    ? nodes.filter(node => node.kind === 'plugin' && node.parentId === ambient.id)
    : []

  return {
    sessionId,
    focus: focusAgent !== undefined ? buildGroup(focusAgent, nodes) : null,
    ambient,
    plugins,
    nodes: [...nodes],
  }
}

/** Child tool nodes for a tools capability row. */
export function childToolsFor(
  nodes: readonly ControlPlaneNode[],
  toolsNode: ControlPlaneNode,
): ControlPlaneNode[] {
  return nodes.filter(
    node => node.kind === 'tool' && node.parentId === toolsNode.id,
  )
}

/** Child prompt-section nodes for a prompt capability row. */
export function childSectionsFor(
  nodes: readonly ControlPlaneNode[],
  promptNode: ControlPlaneNode,
): ControlPlaneNode[] {
  return nodes.filter(
    node => node.kind === 'prompt-section' && node.parentId === promptNode.id,
  )
}

/** Short avatar letter for capability kind (trajectory-style rail). */
export function capabilityAvatar(kind: ControlPlaneNode['kind']): string {
  switch (kind) {
    case 'agent': return 'A'
    case 'subagent': return 'S'
    case 'llm': return 'L'
    case 'tools': return 'T'
    case 'tool': return '·'
    case 'prompt': return 'P'
    case 'prompt-section': return '§'
    case 'memory': return 'M'
    case 'inbox': return 'I'
    case 'ambient': return 'E'
    case 'plugin': return '·'
    default: return '·'
  }
}
