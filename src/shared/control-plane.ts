/**
 * Agent Control Plane（智能体控制面）
 *
 * 观测 + 策略旋钮契约：图是能力拓扑（非可编辑状态机），旋钮只影响后续执行。
 */

/** Fixed editor tab id — always first when the panel is enabled. */
export const CONTROL_PLANE_TAB_ID = 'control-plane:main'

export type ControlPlaneNodeKind =
  | 'agent'
  | 'llm'
  | 'tools'
  | 'tool'
  | 'prompt'
  | 'prompt-section'
  | 'memory'
  | 'inbox'
  | 'subagent'
  | 'ambient'
  | 'plugin'

export type ControlPlaneAdjustKind =
  | 'none'
  | 'model'
  | 'tools'
  | 'prompt'
  | 'gate'

export interface ControlPlaneNode {
  id: string
  /** Parent node id; omitted for forest roots. */
  parentId?: string
  kind: ControlPlaneNodeKind
  /** Stable display key for i18n or raw tool/plugin name. */
  label: string
  /** Short secondary line (model id, tool desc snippet, status…). */
  detail?: string
  /** Whether this node exposes knobs in the detail pane. */
  adjustable: boolean
  adjustKind: ControlPlaneAdjustKind
  /** Why a node is locked (shown in Chinese to the user). */
  lockReasonZh?: string
  /** Agent session id this node belongs to (roots + descendants). */
  agentId?: string
  /** Tool name when kind === 'tool'. */
  toolName?: string
  /** True when this agent is the session currently open in the chat. */
  current?: boolean
  /** Live agent status when kind === 'agent'. */
  status?: 'idle' | 'running' | 'absent'
  /** Full prompt section text (kind === 'prompt-section'). */
  promptText?: string
  /** Full tool / plugin description (untruncated). */
  description?: string
  /** Compact count shown on the canvas card (e.g. "12 tools"). */
  badge?: string
  /** Key/value rows for the drawer overview grid. */
  stats?: Array<{ label: string; value: string }>
}

/** Per-session policy overlays applied by the host waterfall / scoped restrict. */
export interface ControlPlaneKnobs {
  /** Override provider+model for subsequent `agent/request` calls. null clears. */
  modelOverride: { provider: string; model: string } | null
  /** Global tools denied for this agent (intersected via tools.restrict). */
  toolDeny: string[]
  /** Extra system-prompt section text (scoped). Empty clears. */
  promptAppend: string
  /** Emergency gate: reject every `agent/pre-step` while true. */
  preStepReject: boolean
}

export function emptyKnobs(): ControlPlaneKnobs {
  return {
    modelOverride: null,
    toolDeny: [],
    promptAppend: '',
    preStepReject: false,
  }
}

export interface ControlPlaneModelOption {
  provider: string
  model: string
  label: string
}

export interface ControlPlaneSnapshot {
  sessionId: string | null
  /** Capability forest — edges implied by parentId. */
  nodes: ControlPlaneNode[]
  /** Knobs for the focused chat session (compat). */
  knobs: ControlPlaneKnobs
  /** Per-agent knobs — drawer patches/reads by agentId. */
  agentKnobs: Record<string, ControlPlaneKnobs>
  /** Models the UI may pick for the model override knob. */
  modelOptions: ControlPlaneModelOption[]
  /** Wall-clock of this snapshot (ms). */
  generatedAt: number
  /** Human-readable status when no live agent is bound. */
  noticeZh?: string
}

export type ControlPlaneKnobPatch = Partial<{
  modelOverride: { provider: string; model: string } | null
  toolDeny: string[]
  promptAppend: string
  preStepReject: boolean
  /** Replace knobs with empty defaults. */
  reset: boolean
}>

/** Depth-first walk order for a parentId forest (roots first, children nested). */
export function flattenControlPlaneForest(nodes: readonly ControlPlaneNode[]): ControlPlaneNode[] {
  const byParent = new Map<string | undefined, ControlPlaneNode[]>()
  for (const node of nodes) {
    const key = node.parentId
    const list = byParent.get(key) ?? []
    list.push(node)
    byParent.set(key, list)
  }
  const out: ControlPlaneNode[] = []
  const walk = (parentId: string | undefined): void => {
    for (const child of byParent.get(parentId) ?? []) {
      out.push(child)
      walk(child.id)
    }
  }
  walk(undefined)
  return out
}

/** Depth of each node for indent / lane column (roots = 0). */
export function controlPlaneDepths(nodes: readonly ControlPlaneNode[]): Map<string, number> {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const depths = new Map<string, number>()
  const depthOf = (id: string): number => {
    const cached = depths.get(id)
    if (cached !== undefined) return cached
    const node = byId.get(id)
    if (node === undefined || node.parentId === undefined) {
      depths.set(id, 0)
      return 0
    }
    const d = depthOf(node.parentId) + 1
    depths.set(id, d)
    return d
  }
  for (const node of nodes) depthOf(node.id)
  return depths
}
