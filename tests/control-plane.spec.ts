import { describe, expect, it } from 'vitest'
import type { ControlPlaneNode } from '../src/shared/control-plane.ts'
import { emptyKnobs } from '../src/shared/control-plane.ts'
import { ControlPlaneKnobStore } from '../src/host/control-plane/store.ts'
import {
  branchRight,
  layoutControlPlaneTopology,
  topologyRailNodes,
} from '../src/client/workbench/control-plane-topology.ts'

function node(partial: ControlPlaneNode): ControlPlaneNode {
  return partial
}

describe('control plane topology (LTR fork + junction dots)', () => {
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
      id: 'agent:a/tools/bash', parentId: 'agent:a/tools', kind: 'tool', label: 'bash',
      adjustable: true, adjustKind: 'tools', agentId: 'a', toolName: 'bash',
    }),
    node({
      id: 'agent:a/memory', parentId: 'agent:a', kind: 'memory', label: 'Memory',
      adjustable: false, adjustKind: 'none', agentId: 'a',
    }),
    node({
      id: 'agent:b', parentId: 'agent:a', kind: 'subagent', label: 'Subagent',
      adjustable: false, adjustKind: 'none', agentId: 'b', status: 'idle',
    }),
    node({
      id: 'agent:b/llm', parentId: 'agent:b', kind: 'llm', label: 'LLM',
      adjustable: true, adjustKind: 'model', agentId: 'b',
    }),
    node({
      id: 'agent:b/tools', parentId: 'agent:b', kind: 'tools', label: 'Tools',
      adjustable: true, adjustKind: 'tools', agentId: 'b',
    }),
    node({
      id: 'ambient:plugins', kind: 'ambient', label: 'Ambient',
      adjustable: false, adjustKind: 'none',
    }),
  ]

  it('keeps leaf tools off the canvas but expands subagent caps', () => {
    const rail = topologyRailNodes(nodes).map(n => n.id)
    expect(rail).not.toContain('agent:a/tools/bash')
    expect(rail).toContain('agent:b/llm')
    expect(rail).toContain('agent:b/tools')
  })

  it('starts from main agent and forks right with up/down branches', () => {
    const layout = layoutControlPlaneTopology(nodes)
    const agent = layout.nodes.find(n => n.id === 'agent:a')!
    const llm = layout.nodes.find(n => n.id === 'agent:a/llm')!
    const tools = layout.nodes.find(n => n.id === 'agent:a/tools')!
    const sub = layout.nodes.find(n => n.id === 'agent:b')!
    const subLlm = layout.nodes.find(n => n.id === 'agent:b/llm')!
    const ambient = layout.nodes.find(n => n.id === 'ambient:plugins')!

    // LTR: children to the right of agent
    expect(llm.x).toBeGreaterThan(agent.x + agent.w)
    expect(sub.x).toBeGreaterThan(agent.x + agent.w)
    expect(subLlm.x).toBeGreaterThan(sub.x + sub.w)
    expect(ambient.x).toBeGreaterThan(agent.x + agent.w)

    // Up/down fan: first cap above later caps
    expect(llm.y + llm.h).toBeLessThanOrEqual(tools.y + 1)

    // Junction dots on the fork rail
    expect(layout.junctions.length).toBeGreaterThan(2)
    expect(layout.junctions.some(j => j.id.includes('stem'))).toBe(true)
    expect(layout.junctions.some(j => j.id.includes('agent:a/llm'))).toBe(true)

    // Git-style curved branch strokes exist
    expect(layout.edges.some(e => /A /.test(e.d))).toBe(true)
    expect(layout.edges.some(e => e.to === 'agent:a/llm')).toBe(true)
    expect(layout.edges.some(e => e.to === 'agent:b/llm')).toBe(true)
  })

  it('forkToChild / branchRight uses git-style arc when peeling vertically', () => {
    const d = branchRight(10, 0, 40, 50)
    expect(d).toContain('A ')
  })
})

describe('ControlPlaneKnobStore', () => {
  it('patches and resets per agent id', () => {
    const store = new ControlPlaneKnobStore()
    expect(store.get('s1')).toEqual(emptyKnobs())
    store.patch('s1', { preStepReject: true, toolDeny: ['bash'] })
    expect(store.isActive('s1')).toBe(true)
    expect(store.patch('s1', { reset: true })).toEqual(emptyKnobs())
  })
})
