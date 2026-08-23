import { describe, expect, it } from 'vitest'
import { resolveSessionMessageRole } from '../src/shared/trajectory-session-parse.ts'
import { buildTrajectoryFromMessages } from '../src/shared/trajectory-build.ts'

describe('trajectory session parse', () => {
  it('skips context and subtool rows mislabeled as user', () => {
    expect(resolveSessionMessageRole({
      role: 'user',
      kind: 'context',
      source: 'context',
      content: 'file ref...',
    })).toBeNull()

    expect(resolveSessionMessageRole({
      role: 'user',
      kind: 'subtool',
      content: 'nested tool ctx',
    })).toBeNull()

    expect(resolveSessionMessageRole({
      role: 'user',
      kind: 'user',
      content: 'real question',
    })).toBe('user')
  })

  it('does not create user turns from context-only session nodes', () => {
    const graph = buildTrajectoryFromMessages([
      { role: 'user', kind: 'context', source: 'context', content: 'ctx chip' },
      { role: 'assistant', content: 'ok' },
    ] as unknown[])
    expect(graph.userTurns).toHaveLength(0)
    expect(graph.llmTurns).toHaveLength(1)
  })

  it('does not treat assistant rows with name as tool blocks', () => {
    expect(resolveSessionMessageRole({
      role: 'assistant',
      name: 'deepseek-official',
      content: 'hello',
      id: 'msg-1',
    })).toBe('assistant')
  })
})
