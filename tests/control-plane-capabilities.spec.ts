import { describe, expect, it } from 'vitest'
import type { ControlPlaneNode, ControlPlaneSnapshot } from '../src/shared/control-plane.ts'
import { emptyKnobs } from '../src/shared/control-plane.ts'
import { buildCapabilitiesViewModel } from '../src/client/workbench/control-plane-capabilities.ts'

function node(partial: ControlPlaneNode): ControlPlaneNode {
  return partial
}

function snapshot(nodes: ControlPlaneNode[], sessionId: string | null = 'sess-a'): ControlPlaneSnapshot {
  return {
    sessionId,
    nodes,
    knobs: emptyKnobs(),
    agentKnobs: {},
    modelOptions: [],
    generatedAt: Date.now(),
  }
}

describe('buildCapabilitiesViewModel', () => {
  const nodes: ControlPlaneNode[] = [
    node({
      id: 'agent:a', kind: 'agent', label: 'Agent', adjustable: false, adjustKind: 'none',
      agentId: 'a', current: true, status: 'idle',
    }),
    node({
      id: 'agent:a/llm', parentId: 'agent:a', kind: 'llm', label: 'LLM',
      adjustable: true, adjustKind: 'model', agentId: 'a',
    }),
    node({
      id: 'agent:a/tools', parentId: 'agent:a', kind: 'tools', label: 'Tools',
      adjustable: true, adjustKind: 'tools', agentId: 'a',
    }),
    node({
      id: 'agent:b', kind: 'agent', label: 'Agent', adjustable: false, adjustKind: 'none',
      agentId: 'b', current: false, status: 'idle',
    }),
    node({
      id: 'agent:b/llm', parentId: 'agent:b', kind: 'llm', label: 'LLM',
      adjustable: true, adjustKind: 'model', agentId: 'b',
    }),
    node({
      id: 'agent:a/sub', parentId: 'agent:a', kind: 'subagent', label: 'Sub',
      adjustable: false, adjustKind: 'none', agentId: 'sub', status: 'idle',
    }),
    node({
      id: 'agent:sub/llm', parentId: 'agent:a/sub', kind: 'llm', label: 'LLM',
      adjustable: true, adjustKind: 'model', agentId: 'sub',
    }),
    node({
      id: 'ambient:plugins', kind: 'ambient', label: 'Ambient',
      adjustable: false, adjustKind: 'none',
    }),
    node({
      id: 'plugin:x', parentId: 'ambient:plugins', kind: 'plugin', label: 'x',
      adjustable: false, adjustKind: 'none',
    }),
  ]

  it('focuses only the current-session agent tree', () => {
    const view = buildCapabilitiesViewModel(snapshot(nodes, 'a'))
    expect(view.focus?.agent.id).toBe('agent:a')
    expect(view.focus?.capabilities.map(c => c.id)).toEqual(['agent:a/llm', 'agent:a/tools'])
    expect(view.focus?.subagents).toHaveLength(1)
    expect(view.focus?.subagents[0]?.agent.id).toBe('agent:a/sub')
    expect(view.plugins).toHaveLength(1)
  })

  it('returns null focus when no session is open', () => {
    const view = buildCapabilitiesViewModel(snapshot(nodes, null))
    expect(view.focus).toBeNull()
    expect(view.plugins).toHaveLength(1)
  })
})
