import { describe, expect, it } from 'vitest'
import { resolveArgsRaw, resolveCallId } from '../src/shared/trajectory-tool-extract.ts'
import { enrichTrajectoryFromSession } from '../src/shared/trajectory-session-enrich.ts'
import { buildTrajectoryFromMessages } from '../src/shared/trajectory-build.ts'

describe('trajectory tool extract', () => {
  it('reads args from input object', () => {
    const raw = resolveArgsRaw({
      callId: 'c1',
      toolName: 'run_code',
      input: { command: 'npm test' },
    })
    expect(raw).toContain('npm test')
  })

  it('reads args from nested call object', () => {
    const raw = resolveArgsRaw({
      callId: 'c2',
      toolName: 'run_code',
      call: { args: { code: 'echo hello' } },
    })
    expect(raw).toContain('echo hello')
  })

  it('reads shell command from top-level fields', () => {
    const raw = resolveArgsRaw({
      callId: 'c3',
      toolName: 'run_code',
      command: 'ls -la',
    })
    expect(raw).toContain('ls -la')
  })

  it('resolves call id aliases', () => {
    expect(resolveCallId({ tool_call_id: 'tc-9', toolName: 'run_code' })).toBe('tc-9')
    expect(resolveCallId({ id: 'msg-1', content: 'hello' })).toBeUndefined()
  })
})

describe('trajectory session enrich', () => {
  it('fills tool output from session tool blocks', () => {
    const graph = buildTrajectoryFromMessages([
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'tc-1',
          type: 'function',
          function: { name: 'run_code', arguments: '{"command":"ls -la"}' },
        }],
      },
    ])

    const enriched = enrichTrajectoryFromSession(graph, [{
      callId: 'tc-1',
      toolName: 'run_code',
      argsRaw: '{"command":"ls -la"}',
      content: [{ type: 'text', text: 'total 12\nfoo.txt' }],
    }], undefined)

    const tool = enriched.toolCalls.find(t => t.id === 'tc-1')
    expect(tool?.resultRaw).toBe('total 12\nfoo.txt')
    expect(tool?.displayTitle).toBe('ls -la')
    expect(tool?.inputDisplay).toContain('ls -la')
  })

  it('fills empty host args from session input object', () => {
    const graph = buildTrajectoryFromMessages([
      { role: 'user', content: 'run' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'tc-2',
          type: 'function',
          function: { name: 'run_code', arguments: '{}' },
        }],
      },
    ])

    const enriched = enrichTrajectoryFromSession(graph, [{
      id: 'tc-2',
      name: 'run_code',
      input: { command: 'grep -r trajectory src/' },
      content: [{ type: 'text', text: 'found' }],
    }], undefined)

    const tool = enriched.toolCalls.find(t => t.id === 'tc-2')
    expect(tool?.inputDisplay).toContain('grep -r trajectory')
    expect(tool?.displayTitle).toContain('grep -r trajectory')
    expect(tool?.resultRaw).toBe('found')
  })
})
